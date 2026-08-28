import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  getStoredRefreshToken,
  getStoredToken,
  revokeSessionOnServer,
  setSessionExpiredHandler,
  setStoredRefreshToken,
  setStoredToken,
} from "./client";
import { MockApi, fail, ok } from "../test/mockApi";

const API_URL = "http://api.test/api";

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
  setSessionExpiredHandler(null);
});

describe("token storage", () => {
  it("round-trips the access token and clears it on null", () => {
    expect(getStoredToken()).toBeNull();
    setStoredToken("abc");
    expect(getStoredToken()).toBe("abc");
    setStoredToken(null);
    expect(getStoredToken()).toBeNull();
    expect(localStorage.getItem("stockroom_access_token")).toBeNull();
  });

  it("keeps the refresh token under its own key", () => {
    setStoredToken("access");
    setStoredRefreshToken("refresh");
    expect(getStoredRefreshToken()).toBe("refresh");
    setStoredToken(null);
    // Clearing one must not clear the other: the refresh flow rewrites the
    // access token on every renewal and would take the session with it.
    expect(getStoredRefreshToken()).toBe("refresh");
  });
});

describe("request interceptor", () => {
  it("attaches the stored token as a bearer header", async () => {
    setStoredToken("token-123");
    api.on("GET", "/products", ok({ items: [] }));

    await apiClient.get("/products");

    expect(api.requests[0].headers.Authorization).toBe("Bearer token-123");
  });

  it("sends no Authorization header when signed out", async () => {
    api.on("GET", "/products", ok({ items: [] }));

    await apiClient.get("/products");

    expect(api.requests[0].headers.Authorization).toBeUndefined();
  });

  it("reads the token per request rather than capturing it at import", async () => {
    // Sign-in happens after this module is imported, so a token read once
    // at module scope would leave the whole session unauthenticated.
    api.on("GET", "/products", ok({}), ok({}));
    await apiClient.get("/products");
    setStoredToken("arrived-later");
    await apiClient.get("/products");

    expect(api.requests[0].headers.Authorization).toBeUndefined();
    expect(api.requests[1].headers.Authorization).toBe("Bearer arrived-later");
  });
});

describe("401 refresh", () => {
  it("refreshes, retries the original request, and returns its result", async () => {
    setStoredToken("expired");
    setStoredRefreshToken("refresh-1");
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "fresh", refreshToken: "refresh-2" },
    });
    api.on("GET", "/products", fail(401, "Unauthorized"), ok({ items: ["widget"] }));

    const res = await apiClient.get("/products");

    expect(res.data).toEqual({ items: ["widget"] });
    expect(post).toHaveBeenCalledWith(`${API_URL}/auth/refresh`, { refreshToken: "refresh-1" });
    expect(api.requestsFor("GET", "/products")).toHaveLength(2);
    expect(api.requests[1].headers.Authorization).toBe("Bearer fresh");
  });

  it("persists the rotated refresh token, not just the access token", async () => {
    // The server revokes the spent refresh token and treats a replay as a
    // session-wide compromise. Dropping the rotated one signs the user out
    // at the *next* refresh, an hour later, for no visible reason.
    setStoredRefreshToken("refresh-1");
    vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "fresh", refreshToken: "refresh-2" },
    });
    api.on("GET", "/products", fail(401), ok({}));

    await apiClient.get("/products");

    expect(getStoredToken()).toBe("fresh");
    expect(getStoredRefreshToken()).toBe("refresh-2");
  });

  it("shares one refresh across a burst of simultaneous 401s", async () => {
    // A dashboard fires several queries at once, so an expired token
    // produces several 401s in the same tick. Each firing its own refresh
    // would rotate the token N times and leave N-1 losers writing a token
    // the server has already revoked.
    setStoredRefreshToken("refresh-1");
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "fresh", refreshToken: "refresh-2" },
    });
    api.on("GET", "/a", fail(401), ok({ n: "a" }));
    api.on("GET", "/b", fail(401), ok({ n: "b" }));
    api.on("GET", "/c", fail(401), ok({ n: "c" }));

    const results = await Promise.all([apiClient.get("/a"), apiClient.get("/b"), apiClient.get("/c")]);

    expect(results.map((r) => r.data)).toEqual([{ n: "a" }, { n: "b" }, { n: "c" }]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("refreshes again on a later 401 rather than reusing the settled promise", async () => {
    // The single-flight promise is cleared in a `finally`; if it weren't,
    // the second expiry would await an already-resolved refresh and retry
    // with a token that has since expired too.
    setStoredRefreshToken("refresh-1");
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "fresh", refreshToken: "refresh-2" },
    });
    api.on("GET", "/a", fail(401), ok({}), fail(401), ok({}));

    await apiClient.get("/a");
    await apiClient.get("/a");

    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries a request only once", async () => {
    // A 401 that survives a successful refresh means the server is
    // rejecting a genuinely valid token — a permissions problem, not an
    // expiry. Retrying on that is an infinite loop.
    setStoredRefreshToken("refresh-1");
    vi.spyOn(axios, "post").mockResolvedValue({
      data: { accessToken: "fresh", refreshToken: "refresh-2" },
    });
    api.on("GET", "/products", fail(401), fail(401));

    await expect(apiClient.get("/products")).rejects.toMatchObject({ response: { status: 401 } });
    expect(api.requestsFor("GET", "/products")).toHaveLength(2);
  });

  it("does not refresh on a failed sign-in", async () => {
    // A 401 from /auth/login is "wrong password". Refreshing there would
    // turn a typo into a redirect to the login page the user is already on.
    const post = vi.spyOn(axios, "post");
    api.on("POST", "/auth/login", fail(401, "Invalid credentials"));

    await expect(apiClient.post("/auth/login", {})).rejects.toMatchObject({
      response: { data: { error: "Invalid credentials" } },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("does not refresh on a rejected signup or refresh call", async () => {
    const post = vi.spyOn(axios, "post");
    api.on("POST", "/auth/signup", fail(401));
    api.on("POST", "/auth/refresh", fail(401));

    await expect(apiClient.post("/auth/signup", {})).rejects.toBeInstanceOf(Error);
    await expect(apiClient.post("/auth/refresh", {})).rejects.toBeInstanceOf(Error);
    expect(post).not.toHaveBeenCalled();
  });

  it("leaves non-401 failures alone", async () => {
    setStoredRefreshToken("refresh-1");
    const post = vi.spyOn(axios, "post");
    api.on("GET", "/products", fail(403, "Owner access required"));

    await expect(apiClient.get("/products")).rejects.toMatchObject({ response: { status: 403 } });
    expect(post).not.toHaveBeenCalled();
    expect(api.requestsFor("GET", "/products")).toHaveLength(1);
  });

  it("ends the session when the refresh token is rejected", async () => {
    setStoredToken("expired");
    setStoredRefreshToken("refresh-dead");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("401"));
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    api.on("GET", "/products", fail(401));

    await expect(apiClient.get("/products")).rejects.toBeInstanceOf(Error);

    expect(getStoredToken()).toBeNull();
    expect(getStoredRefreshToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("ends the session when there is no refresh token at all", async () => {
    setStoredToken("orphan-access-token");
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    api.on("GET", "/products", fail(401));

    await expect(apiClient.get("/products")).rejects.toBeInstanceOf(Error);

    expect(getStoredToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("rejects with the original error, not the refresh failure", async () => {
    // The component's catch reads `err.response.data.error`. Surfacing the
    // refresh's error instead would show the user a message about a token
    // they have never heard of.
    setStoredRefreshToken("refresh-dead");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("refresh exploded"));
    setSessionExpiredHandler(vi.fn());
    api.on("GET", "/products", fail(401, "Token expired"));

    await expect(apiClient.get("/products")).rejects.toMatchObject({
      response: { data: { error: "Token expired" } },
    });
  });

  it("survives a session expiry with no handler registered", async () => {
    // Between AuthProvider unmounting and remounting the handler is null.
    setStoredRefreshToken("refresh-dead");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("nope"));
    api.on("GET", "/products", fail(401));

    await expect(apiClient.get("/products")).rejects.toBeInstanceOf(Error);
    expect(getStoredToken()).toBeNull();
  });
});

describe("revokeSessionOnServer", () => {
  it("posts the refresh token to the logout endpoint", async () => {
    setStoredRefreshToken("refresh-1");
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: {} });

    await revokeSessionOnServer();

    expect(post).toHaveBeenCalledWith(`${API_URL}/auth/logout`, { refreshToken: "refresh-1" });
  });

  it("does nothing when there is no session to revoke", async () => {
    const post = vi.spyOn(axios, "post");
    await revokeSessionOnServer();
    expect(post).not.toHaveBeenCalled();
  });

  it("resolves even when the server is unreachable", async () => {
    // Sign-out must complete locally whatever the network did, so this
    // swallows the failure rather than leaving the user signed in.
    setStoredRefreshToken("refresh-1");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("network down"));

    await expect(revokeSessionOnServer()).resolves.toBeUndefined();
  });
});
