import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import * as client from "../api/client";
import type { AuthResponse, AuthUser } from "../api/types";

const owner: AuthUser = { id: "u1", name: "Dana Owner", email: "owner@northside.test", role: "OWNER" };

const authResponse: AuthResponse = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  user: owner,
};

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

let revoke: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  revoke = vi.spyOn(client, "revokeSessionOnServer").mockResolvedValue(undefined);
});

afterEach(() => {
  client.setSessionExpiredHandler(null);
});

describe("useAuth", () => {
  it("throws outside a provider rather than handing back undefined", () => {
    // The alternative is a null context that every consumer has to guard,
    // and a `Cannot read properties of undefined` fifteen frames away from
    // the missing provider.
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/must be used within an AuthProvider/);
    onError.mockRestore();
  });
});

describe("session lifecycle", () => {
  it("starts signed out with empty storage", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("stores both tokens and the user on sign-in", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.setSession(authResponse));

    expect(result.current.user).toEqual(owner);
    expect(result.current.isAuthenticated).toBe(true);
    expect(client.getStoredToken()).toBe("access-1");
    // Day 15's bug: this one was dropped on the floor, so every session
    // died fifteen minutes in with no way to renew it.
    expect(client.getStoredRefreshToken()).toBe("refresh-1");
  });

  it("restores the signed-in user on a page reload", () => {
    localStorage.setItem("stockroom_user", JSON.stringify(owner));
    localStorage.setItem("stockroom_access_token", "access-1");

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toEqual(owner);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("treats a cached user with no token as signed out", () => {
    // The interceptor clears the token when a refresh fails but a stale tab
    // may still hold the cached user; without the token half of the check
    // the app would render the shell and 401 on every panel.
    localStorage.setItem("stockroom_user", JSON.stringify(owner));

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toEqual(owner);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("ignores a corrupted cached user instead of crashing on boot", () => {
    localStorage.setItem("stockroom_user", "{not json");
    localStorage.setItem("stockroom_access_token", "access-1");

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
  });

  it("clears everything on logout and revokes the session server-side", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(authResponse));

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(client.getStoredToken()).toBeNull();
    expect(client.getStoredRefreshToken()).toBeNull();
    expect(localStorage.getItem("stockroom_user")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("revokes before clearing the tokens the revocation needs", () => {
    // `revokeSessionOnServer` reads the refresh token to name the session.
    // Clearing first would make every sign-out a silent no-op server-side,
    // leaving the refresh token valid for its full seven days.
    let tokenAtRevokeTime: string | null = "not-called";
    revoke.mockImplementation(async () => {
      tokenAtRevokeTime = client.getStoredRefreshToken();
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(authResponse));

    act(() => result.current.logout());

    expect(tokenAtRevokeTime).toBe("refresh-1");
  });

  it("signs out locally even if the revocation request rejects", () => {
    revoke.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(authResponse));

    act(() => result.current.logout());

    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe("session-expiry handler", () => {
  it("clears the user when the API layer reports an unrecoverable session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(authResponse));

    // What api/client.ts calls after a refresh gives up.
    act(() => client.endStoredSession());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
    expect(client.getStoredToken()).toBeNull();
    expect(localStorage.getItem("stockroom_user")).toBeNull();
  });

  it("clears the tokens as well as the user", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.setSession(authResponse));

    act(() => client.endStoredSession());

    expect(client.getStoredToken()).toBeNull();
    expect(client.getStoredRefreshToken()).toBeNull();
  });

  it("unregisters its handler on unmount", () => {
    // A handler still pointing at an unmounted tree's setState is a leak,
    // and React warns about it on the next expiry.
    const setHandler = vi.spyOn(client, "setSessionExpiredHandler");
    const { unmount } = renderHook(() => useAuth(), { wrapper });
    unmount();
    expect(setHandler).toHaveBeenLastCalledWith(null);
  });
});

describe("consumers", () => {
  it("re-renders every consumer when the session changes", async () => {
    function Banner() {
      const { user, isAuthenticated, setSession, logout } = useAuth();
      return (
        <div>
          <p>{isAuthenticated ? `Signed in as ${user?.name}` : "Signed out"}</p>
          <button type="button" onClick={() => setSession(authResponse)}>
            Sign in
          </button>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Banner />, { wrapper });

    expect(screen.getByText("Signed out")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Signed in as Dana Owner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });
});
