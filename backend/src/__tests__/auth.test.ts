import request from "supertest";

jest.mock("../lib/prisma");

import { __resetPrismaMock } from "../lib/__mocks__/prisma";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  __resetPrismaMock();
});

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
