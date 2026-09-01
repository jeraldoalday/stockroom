import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";
import { emailSender } from "../lib/email";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
  jest.restoreAllMocks();
});

function extractResetToken(text: string): string {
  const match = text.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`No reset token found in email text: ${text}`);
  return match[1];
}

describe("POST /api/auth/signup", () => {
  it("creates an organization, an owner user, and a default location", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email: "jamie@cornerstore.test",
      password: "hunter22222",
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.role).toBe("OWNER");
    expect(res.body.organization.name).toBe("Corner Store");
  });

  it("rejects a second signup with the same email", async () => {
    const payload = {
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email: "dupe@cornerstore.test",
      password: "hunter22222",
    };

    const first = await request(app).post("/api/auth/signup").send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/auth/signup")
      .send({ ...payload, organizationName: "A Different Shop" });

    expect(second.status).toBe(409);
  });

  it("rejects a weak password with a validation error", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email: "weak@cornerstore.test",
      password: "short",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  async function signUp(email: string) {
    return request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email,
      password: "hunter22222",
    });
  }

  it("logs in with correct credentials", async () => {
    await signUp("login@cornerstore.test");

    const res = await request(app).post("/api/auth/login").send({
      email: "login@cornerstore.test",
      password: "hunter22222",
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("rejects an incorrect password without leaking which field was wrong", async () => {
    await signUp("wrongpw@cornerstore.test");

    const res = await request(app).post("/api/auth/login").send({
      email: "wrongpw@cornerstore.test",
      password: "totally-wrong",
    });

    expect(res.status).toBe(401);
  });

  it("rejects a login for an email that never signed up", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "nobody@cornerstore.test",
      password: "hunter22222",
    });

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/auth/password", () => {
  async function signUpAndGetToken(email: string) {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email,
      password: "hunter22222",
    });
    return res.body.accessToken as string;
  }

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .patch("/api/auth/password")
      .send({ currentPassword: "hunter22222", newPassword: "newpassword1" });

    expect(res.status).toBe(401);
  });

  it("changes the password when the current password is correct, and the new one works to log in", async () => {
    const token = await signUpAndGetToken("changepw@cornerstore.test");

    const res = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "hunter22222", newPassword: "newpassword1" });
    expect(res.status).toBe(204);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "changepw@cornerstore.test", password: "hunter22222" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "changepw@cornerstore.test", password: "newpassword1" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects an incorrect current password without changing anything", async () => {
    const token = await signUpAndGetToken("wrongcurrent@cornerstore.test");

    const res = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "totally-wrong", newPassword: "newpassword1" });
    expect(res.status).toBe(401);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "wrongcurrent@cornerstore.test", password: "hunter22222" });
    expect(login.status).toBe(200);
  });

  it("rejects a weak new password with a validation error", async () => {
    const token = await signUpAndGetToken("weaknew@cornerstore.test");

    const res = await request(app)
      .patch("/api/auth/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "hunter22222", newPassword: "short" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/auth/notifications", () => {
  async function signUpAndGetToken(email: string) {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email,
      password: "hunter22222",
    });
    return res.body.accessToken as string;
  }

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).patch("/api/auth/notifications").send({ lowStockDigestOptOut: true });

    expect(res.status).toBe(401);
  });

  it("defaults to subscribed on signup", async () => {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email: "defaultoptin@cornerstore.test",
      password: "hunter22222",
    });

    expect(res.body.user.lowStockDigestOptOut).toBe(false);
  });

  it("opts out and back in, and reports the current state on login", async () => {
    const token = await signUpAndGetToken("digestoptout@cornerstore.test");

    const optOut = await request(app)
      .patch("/api/auth/notifications")
      .set("Authorization", `Bearer ${token}`)
      .send({ lowStockDigestOptOut: true });
    expect(optOut.status).toBe(200);
    expect(optOut.body.lowStockDigestOptOut).toBe(true);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "digestoptout@cornerstore.test", password: "hunter22222" });
    expect(login.body.user.lowStockDigestOptOut).toBe(true);

    const optIn = await request(app)
      .patch("/api/auth/notifications")
      .set("Authorization", `Bearer ${token}`)
      .send({ lowStockDigestOptOut: false });
    expect(optIn.body.lowStockDigestOptOut).toBe(false);
  });

  it("rejects a non-boolean value", async () => {
    const token = await signUpAndGetToken("digestbadvalue@cornerstore.test");

    const res = await request(app)
      .patch("/api/auth/notifications")
      .set("Authorization", `Bearer ${token}`)
      .send({ lowStockDigestOptOut: "yes" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/forgot-password + /api/auth/reset-password", () => {
  async function signUp(email: string) {
    return request(app).post("/api/auth/signup").send({
      organizationName: "Corner Store",
      name: "Jamie Owner",
      email,
      password: "hunter22222",
    });
  }

  it("emails a reset link for a known account, and the link resets the password", async () => {
    await signUp("forgot@cornerstore.test");
    const sendSpy = jest.spyOn(emailSender, "send").mockResolvedValue();

    const forgotRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "forgot@cornerstore.test" });
    expect(forgotRes.status).toBe(202);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].to).toBe("forgot@cornerstore.test");

    const token = extractResetToken(sendSpy.mock.calls[0][0].text);

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "brandnewpassword1" });
    expect(resetRes.status).toBe(204);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "forgot@cornerstore.test", password: "hunter22222" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "forgot@cornerstore.test", password: "brandnewpassword1" });
    expect(newLogin.status).toBe(200);
  });

  it("responds 202 for an unknown email without sending anything (no account enumeration)", async () => {
    const sendSpy = jest.spyOn(emailSender, "send").mockResolvedValue();

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@cornerstore.test" });

    expect(res.status).toBe(202);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects a reset with an unknown token", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "brandnewpassword1" });
    expect(res.status).toBe(400);
  });

  it("rejects reusing an already-used reset token", async () => {
    await signUp("reuse@cornerstore.test");
    const sendSpy = jest.spyOn(emailSender, "send").mockResolvedValue();

    await request(app).post("/api/auth/forgot-password").send({ email: "reuse@cornerstore.test" });
    const token = extractResetToken(sendSpy.mock.calls[0][0].text);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "brandnewpassword1" });
    expect(first.status).toBe(204);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "yetanotherpassword2" });
    expect(second.status).toBe(400);
  });

  it("supersedes an earlier unused token when a new reset is requested", async () => {
    await signUp("supersede@cornerstore.test");
    const sendSpy = jest.spyOn(emailSender, "send").mockResolvedValue();

    await request(app).post("/api/auth/forgot-password").send({ email: "supersede@cornerstore.test" });
    const firstToken = extractResetToken(sendSpy.mock.calls[0][0].text);

    await request(app).post("/api/auth/forgot-password").send({ email: "supersede@cornerstore.test" });
    const secondToken = extractResetToken(sendSpy.mock.calls[1][0].text);

    const staleAttempt = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: firstToken, newPassword: "brandnewpassword1" });
    expect(staleAttempt.status).toBe(400);

    const freshAttempt = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: secondToken, newPassword: "brandnewpassword1" });
    expect(freshAttempt.status).toBe(204);
  });
});
