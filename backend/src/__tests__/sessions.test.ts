import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

const CREDENTIALS = { email: "owner@shop.test", password: "hunter22222" };

interface Session {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
  userAgent: string | null;
}

async function signUp() {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    ...CREDENTIALS,
  });
  return { accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

async function signIn() {
  const res = await request(app).post("/api/auth/login").send(CREDENTIALS);
  return { accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

async function listSessions(accessToken: string): Promise<Session[]> {
  const res = await request(app)
    .get("/api/auth/sessions")
    .set("Authorization", `Bearer ${accessToken}`);
  expect(res.status).toBe(200);
  return res.body as Session[];
}

describe("GET /api/auth/sessions", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/auth/sessions");
    expect(res.status).toBe(401);
  });

  it("lists the session the caller is using, marked as current", async () => {
    const { accessToken } = await signUp();

    const sessions = await listSessions(accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
  });

  it("records the signing-in client's User-Agent", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .set("User-Agent", "TestBrowser/1.0")
      .send({ organizationName: "The Shop", name: "Owner", ...CREDENTIALS });

    const sessions = await listSessions(signup.body.accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userAgent).toBe("TestBrowser/1.0");
  });

  it("records no User-Agent when the client sends none", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .unset("User-Agent")
      .send({ organizationName: "The Shop", name: "Owner", ...CREDENTIALS });

    const sessions = await listSessions(signup.body.accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userAgent).toBeNull();
  });

  // A refreshed session re-stamps the header from whichever request rotated
  // it last, so the list reflects the device still using it rather than a
  // stale value frozen at login.
  it("updates the recorded User-Agent on refresh", async () => {
    const first = await signUp();

    await request(app)
      .post("/api/auth/refresh")
      .set("User-Agent", "NewBrowser/2.0")
      .send({ refreshToken: first.refreshToken });

    const sessions = await listSessions(first.accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userAgent).toBe("NewBrowser/2.0");
  });

  it("lists one row per sign-in and marks only the caller's own as current", async () => {
    await signUp();
    const second = await signIn();
    await signIn();

    const sessions = await listSessions(second.accessToken);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
  });

  // A live session rewrites its refresh token every fifteen minutes, and
  // every rotation leaves the previous row behind. Counting rows would show
  // one browser as a growing pile of "sessions"; they collapse into the
  // family they belong to.
  it("keeps a refreshed session as one row, not one per rotation", async () => {
    const first = await signUp();

    let refreshToken = first.refreshToken;
    let accessToken = first.accessToken;
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
      expect(res.status).toBe(200);
      refreshToken = res.body.refreshToken;
      accessToken = res.body.accessToken;
    }

    const sessions = await listSessions(accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
    // Rotating does not restart the session, it continues it.
    expect(new Date(sessions[0].lastActiveAt).getTime()).toBeGreaterThanOrEqual(
      new Date(sessions[0].createdAt).getTime()
    );
  });

  it("drops a session once it has been signed out", async () => {
    const first = await signUp();
    const second = await signIn();

    await request(app).post("/api/auth/logout").send({ refreshToken: first.refreshToken });

    const sessions = await listSessions(second.accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
  });

  it("never shows another user's sessions", async () => {
    await signUp();
    const otherSignup = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other Owner",
      email: "other@shop.test",
      password: "hunter22222",
    });

    const sessions = await listSessions(otherSignup.body.accessToken);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
  });
});

describe("DELETE /api/auth/sessions/:id", () => {
  it("requires authentication", async () => {
    const res = await request(app).delete("/api/auth/sessions/anything");
    expect(res.status).toBe(401);
  });

  it("ends another device's session and stops its refresh token working", async () => {
    const first = await signUp();
    const second = await signIn();

    const sessions = await listSessions(second.accessToken);
    const other = sessions.find((session) => !session.current)!;

    const deleted = await request(app)
      .delete(`/api/auth/sessions/${other.id}`)
      .set("Authorization", `Bearer ${second.accessToken}`);
    expect(deleted.status).toBe(204);

    // The revoked device can no longer refresh...
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(401);

    // ...and the caller's own session is untouched.
    expect(await listSessions(second.accessToken)).toHaveLength(1);
  });

  // Ending the session you are looking at is the same act as signing out.
  // Refusing it would mean the one row a user can definitely identify is
  // the one row they are not allowed to end.
  it("allows ending the current session", async () => {
    const { accessToken, refreshToken } = await signUp();
    const [session] = await listSessions(accessToken);

    const deleted = await request(app)
      .delete(`/api/auth/sessions/${session.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(deleted.status).toBe(204);

    const refreshed = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it("404s on an unknown session rather than reporting success", async () => {
    const { accessToken } = await signUp();

    const res = await request(app)
      .delete("/api/auth/sessions/no-such-family")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  // The family id is the only thing identifying a session, so anyone who
  // learns one must not be able to sign that person out with it.
  it("will not end a session belonging to another user", async () => {
    const victim = await signUp();
    const [victimSession] = await listSessions(victim.accessToken);

    const attacker = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other Owner",
      email: "other@shop.test",
      password: "hunter22222",
    });

    const res = await request(app)
      .delete(`/api/auth/sessions/${victimSession.id}`)
      .set("Authorization", `Bearer ${attacker.body.accessToken}`);
    expect(res.status).toBe(404);

    // The victim's session still works.
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: victim.refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it("leaves nothing to list after a password change ends everything", async () => {
    const { accessToken } = await signUp();
    await signIn();

    const changed = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: CREDENTIALS.password, newPassword: "brandnewpassword" });
    expect(changed.status).toBe(204);

    // The access token outlives the sessions it was minted alongside, which
    // is exactly why the page that shows this list signs the user out after
    // a password change.
    expect(await listSessions(accessToken)).toEqual([]);
  });
});
