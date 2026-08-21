import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";
import { RateLimiter } from "../lib/rateLimit";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

const CREDENTIALS = { email: "owner@shop.test", password: "hunter22222" };

async function signUp(email = CREDENTIALS.email) {
  return request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    email,
    password: CREDENTIALS.password,
  });
}

// /api/auth/login is the only unauthenticated endpoint that verifies a
// secret, which makes it both a password oracle and — because bcrypt makes
// *us* pay the CPU — a cheap denial-of-service target. See lib/rateLimit.ts.
describe("login rate limiting", () => {
  it("locks out further attempts after 10 failures and reports Retry-After", async () => {
    await signUp();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: CREDENTIALS.email, password: "wrong-password" });
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: CREDENTIALS.email, password: "wrong-password" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many sign-in attempts/i);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  // The whole point of throttling a password oracle is that it must hold
  // even when the attacker finally guesses right.
  it("blocks the correct password too once the window is exhausted", async () => {
    await signUp();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).post("/api/auth/login").send({ email: CREDENTIALS.email, password: "wrong" });
    }

    const res = await request(app).post("/api/auth/login").send(CREDENTIALS);
    expect(res.status).toBe(429);
  });

  // Keying on IP alone would let one attacker lock every account behind a
  // shared NAT out of the product.
  it("does not throttle a different account from the same address", async () => {
    await signUp();
    await signUp("clerk@other.test");

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await request(app).post("/api/auth/login").send({ email: CREDENTIALS.email, password: "wrong" });
    }

    const other = await request(app)
      .post("/api/auth/login")
      .send({ email: "clerk@other.test", password: CREDENTIALS.password });
    expect(other.status).toBe(200);
  });

  it("clears the counter after a successful sign-in", async () => {
    await signUp();

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await request(app).post("/api/auth/login").send({ email: CREDENTIALS.email, password: "wrong" });
    }

    const ok = await request(app).post("/api/auth/login").send(CREDENTIALS);
    expect(ok.status).toBe(200);

    // Nine more failures would have tripped the limit had the successful
    // sign-in not reset the bucket.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const res = await request(app).post("/api/auth/login").send({ email: CREDENTIALS.email, password: "wrong" });
      expect(res.status).toBe(401);
    }
  });

  it("advertises the remaining budget on every response", async () => {
    await signUp();
    const res = await request(app).post("/api/auth/login").send({ email: CREDENTIALS.email, password: "wrong" });

    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-ratelimit-remaining"]).toBe("9");
  });
});

describe("signup rate limiting", () => {
  it("allows 5 organizations per address per hour, then 429s", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await signUp(`owner${attempt}@shop.test`);
      expect(res.status).toBe(201);
    }

    const blocked = await signUp("owner5@shop.test");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many accounts/i);
  });
});

// The window logic is time-dependent, so it's exercised directly with an
// injected clock rather than by making the suite wait 15 real minutes.
describe("RateLimiter", () => {
  it("allows exactly `limit` hits inside a window", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
    const now = 1_000_000;

    expect(limiter.hit("a", now).allowed).toBe(true);
    expect(limiter.hit("a", now + 10).allowed).toBe(true);
    expect(limiter.hit("a", now + 20).allowed).toBe(true);
    expect(limiter.hit("a", now + 30).allowed).toBe(false);
  });

  it("starts a fresh window once the old one expires", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    const now = 1_000_000;

    expect(limiter.hit("a", now).allowed).toBe(true);
    expect(limiter.hit("a", now + 500).allowed).toBe(false);
    expect(limiter.hit("a", now + 1001).allowed).toBe(true);
  });

  it("counts each key independently", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
    const now = 1_000_000;

    expect(limiter.hit("a", now).allowed).toBe(true);
    expect(limiter.hit("b", now).allowed).toBe(true);
    expect(limiter.hit("a", now).allowed).toBe(false);
  });

  it("reports a retry-after that shrinks as the window drains", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 10_000 });
    const now = 1_000_000;

    limiter.hit("a", now);
    expect(limiter.hit("a", now + 1_000).retryAfterSeconds).toBe(9);
    expect(limiter.hit("a", now + 9_500).retryAfterSeconds).toBe(1);
  });

  it("prunes expired buckets so the map does not grow without bound", () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 1000 });
    const now = 1_000_000;

    limiter.hit("a", now);
    limiter.hit("b", now);
    expect(limiter.size).toBe(2);

    limiter.prune(now + 2000);
    expect(limiter.size).toBe(0);
  });

  it("keeps live buckets when pruning", () => {
    const limiter = new RateLimiter({ limit: 5, windowMs: 10_000 });
    const now = 1_000_000;

    limiter.hit("live", now);
    limiter.prune(now + 1000);
    expect(limiter.size).toBe(1);
  });
});

// /forgot-password is the only unauthenticated endpoint whose side effect
// lands on someone *else* — a stranger's inbox. Unmetered, it will mail a
// reset link as fast as the loop runs and write a token row per request,
// so it is abusable against a third party rather than only against us.
describe("password reset rate limiting", () => {
  it("throttles repeated reset requests for the same address", async () => {
    await signUp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: CREDENTIALS.email });
      expect(res.status).toBe(202);
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: CREDENTIALS.email });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many password reset requests/i);
  });

  // The endpoint deliberately answers 202 whether or not the address exists,
  // so that it isn't a user-enumeration oracle. The limiter must not
  // reintroduce that leak by throttling only the addresses that do exist.
  it("throttles unknown addresses identically, so it stays no oracle", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .send({ email: "nobody@nowhere.test" });
      expect(res.status).toBe(202);
    }

    const blocked = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@nowhere.test" });
    expect(blocked.status).toBe(429);
  });

  it("does not let one address's limit block another's reset", async () => {
    await signUp();
    await signUp("other@shop.test");

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app).post("/api/auth/forgot-password").send({ email: CREDENTIALS.email });
    }

    const other = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "other@shop.test" });
    expect(other.status).toBe(202);
  });

  it("throttles reset-password attempts", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ token: `bogus-${attempt}`, newPassword: "hunter22222" });
      expect(res.status).toBe(400);
    }

    const blocked = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "bogus-again", newPassword: "hunter22222" });
    expect(blocked.status).toBe(429);
  });
});
