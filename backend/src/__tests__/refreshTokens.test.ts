import request from "supertest";

jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";
import { hashRefreshToken, isFamilyLive } from "../lib/refreshTokens";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

const PASSWORD = "hunter22222";

async function signUp(email = "owner@shop.test") {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    email,
    password: PASSWORD,
  });
  return res.body as { accessToken: string; refreshToken: string };
}

async function login(email = "owner@shop.test", password = PASSWORD) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res;
}

function refresh(refreshToken: string) {
  return request(app).post("/api/auth/refresh").send({ refreshToken });
}

// Reaches into the store to assert on rows the API deliberately never
// exposes — the point of this feature is the server-side state.
interface TokenRow {
  id: string;
  tokenHash: string;
  familyId: string;
  revokedAt: Date | null;
  replacedById: string | null;
}
function tokenRows(): Promise<TokenRow[]> {
  return (prisma as unknown as {
    refreshToken: { findMany(args?: unknown): Promise<TokenRow[]> };
  }).refreshToken.findMany({});
}

describe("Refresh token rotation", () => {
  it("records a token row for a signup and a login", async () => {
    await signUp();
    expect(await tokenRows()).toHaveLength(1);

    await login();
    expect(await tokenRows()).toHaveLength(2);
  });

  it("stores only a hash, never the token itself", async () => {
    const { refreshToken } = await signUp();
    const rows = await tokenRows();

    expect(rows[0].tokenHash).toBe(hashRefreshToken(refreshToken));
    expect(rows[0].tokenHash).not.toBe(refreshToken);
    expect(JSON.stringify(rows)).not.toContain(refreshToken);
  });

  it("returns a new refresh token and revokes the old one", async () => {
    const { refreshToken } = await signUp();

    const res = await refresh(refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(refreshToken);

    const rows = await tokenRows();
    const old = rows.find((row) => row.tokenHash === hashRefreshToken(refreshToken));
    expect(old?.revokedAt).toBeTruthy();
  });

  it("links the revoked token to its replacement", async () => {
    const { refreshToken } = await signUp();
    const res = await refresh(refreshToken);

    const rows = await tokenRows();
    const old = rows.find((row) => row.tokenHash === hashRefreshToken(refreshToken));
    const next = rows.find((row) => row.tokenHash === hashRefreshToken(res.body.refreshToken));
    expect(old?.replacedById).toBe(next?.id);
  });

  it("keeps the rotated token in the same family", async () => {
    const { refreshToken } = await signUp();
    await refresh(refreshToken);

    const rows = await tokenRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
  });

  it("starts a separate family for each login, so devices are independent", async () => {
    await signUp();
    await login();

    const rows = await tokenRows();
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(2);
  });

  it("lets the newly issued token be used in turn", async () => {
    const { refreshToken } = await signUp();
    const first = await refresh(refreshToken);
    const second = await refresh(first.body.refreshToken);

    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
  });
});

// A token presented twice means someone is replaying one that was already
// exchanged. Nothing in the request says whether that's a thief or a client
// racing itself, so the whole family goes.
describe("Refresh token reuse detection", () => {
  it("rejects a token that has already been rotated away", async () => {
    const { refreshToken } = await signUp();
    await refresh(refreshToken);

    const replay = await refresh(refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatch(/revoked/i);
  });

  it("revokes the whole family, so the thief's newer token dies too", async () => {
    const { refreshToken } = await signUp();
    const rotated = await refresh(refreshToken);

    // The legitimate client's next token still works...
    expect((await refresh(rotated.body.refreshToken)).status).toBe(200);

    // ...until the stolen original is replayed, which burns the family.
    await refresh(refreshToken);

    const rows = await tokenRows();
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("leaves other logins alone when one family is burned", async () => {
    const { refreshToken } = await signUp();
    const other = await login();

    await refresh(refreshToken);
    await refresh(refreshToken); // replay: burns only the signup family

    const stillGood = await refresh(other.body.refreshToken);
    expect(stillGood.status).toBe(200);
  });

  it("rejects a well-formed token that has no row", async () => {
    const { refreshToken } = await signUp();
    await (prisma as unknown as {
      refreshToken: { deleteMany(args: unknown): Promise<unknown> };
    }).refreshToken.deleteMany({ where: {} });

    const res = await refresh(refreshToken);
    expect(res.status).toBe(401);
  });

  it("rejects a garbage token without touching the database", async () => {
    await signUp();
    const res = await refresh("not-a-jwt");
    expect(res.status).toBe(401);
  });
});

describe("Signing out", () => {
  it("revokes the session and stops the token refreshing", async () => {
    const { refreshToken } = await signUp();

    const out = await request(app).post("/api/auth/logout").send({ refreshToken });
    expect(out.status).toBe(204);

    const after = await refresh(refreshToken);
    expect(after.status).toBe(401);
  });

  it("is idempotent and never reveals whether the token was real", async () => {
    const { refreshToken } = await signUp();

    await request(app).post("/api/auth/logout").send({ refreshToken });
    const again = await request(app).post("/api/auth/logout").send({ refreshToken });
    expect(again.status).toBe(204);

    const bogus = await request(app).post("/api/auth/logout").send({ refreshToken: "nonsense" });
    expect(bogus.status).toBe(204);
  });

  it("does not sign the user out of their other devices", async () => {
    const { refreshToken } = await signUp();
    const other = await login();

    await request(app).post("/api/auth/logout").send({ refreshToken });

    expect((await refresh(other.body.refreshToken)).status).toBe(200);
  });

  // Signing out used to only stop the refresh token from working — the
  // access token minted alongside it kept authenticating requests for up to
  // its own 15-minute life, since nothing on the request path checked the
  // database. requireAuth now consults the session behind every access
  // token, so this takes effect immediately instead of on a delay.
  it("also rejects the access token minted for that session, immediately", async () => {
    const { refreshToken, accessToken } = await signUp();

    await request(app).post("/api/auth/logout").send({ refreshToken });

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });

  it("leaves another device's access token working", async () => {
    const first = await signUp();
    const other = await login();

    await request(app).post("/api/auth/logout").send({ refreshToken: other.body.refreshToken });

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${first.accessToken}`);
    expect(res.status).toBe(200);
  });
});

// The reason to change a password after a compromise is to stop whoever
// else has access. A refresh token that outlives the change defeats that.
describe("Password changes end every session", () => {
  it("revokes all sessions when the password is changed", async () => {
    const first = await signUp();
    const second = await login();

    const changed = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: "brand-new-secret" });
    expect(changed.status).toBe(204);

    expect((await refresh(first.refreshToken)).status).toBe(401);
    expect((await refresh(second.body.refreshToken)).status).toBe(401);
  });

  it("leaves sessions intact when the current password was wrong", async () => {
    const { accessToken, refreshToken } = await signUp();

    const rejected = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "not-it", newPassword: "brand-new-secret" });
    expect(rejected.status).toBe(401);

    expect((await refresh(refreshToken)).status).toBe(200);
  });

  it("revokes all sessions when a password is reset by token", async () => {
    const { refreshToken } = await signUp();

    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    await request(app).post("/api/auth/forgot-password").send({ email: "owner@shop.test" });
    const logged = consoleLog.mock.calls.flat().join("\n");
    consoleLog.mockRestore();

    const token = /reset-password\?token=([a-f0-9]+)/.exec(logged)?.[1];
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "brand-new-secret" });
    expect(reset.status).toBe(204);

    expect((await refresh(refreshToken)).status).toBe(401);

    // ...and the new password works.
    expect((await login("owner@shop.test", "brand-new-secret")).status).toBe(200);
  });
});

describe("isFamilyLive", () => {
  it("is true for a freshly issued session and false for an unknown one", async () => {
    await signUp();
    const [row] = await tokenRows();

    expect(await isFamilyLive(row.familyId)).toBe(true);
    expect(await isFamilyLive("no-such-family")).toBe(false);
  });

  it("goes false the moment the family is revoked", async () => {
    const { refreshToken } = await signUp();
    const [row] = await tokenRows();

    await request(app).post("/api/auth/logout").send({ refreshToken });

    expect(await isFamilyLive(row.familyId)).toBe(false);
  });

  it("stays true across a rotation — the family continues, it doesn't restart", async () => {
    const { refreshToken } = await signUp();
    const [before] = await tokenRows();

    await refresh(refreshToken);

    expect(await isFamilyLive(before.familyId)).toBe(true);
  });
});
