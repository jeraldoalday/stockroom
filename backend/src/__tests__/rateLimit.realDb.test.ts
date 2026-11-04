// Runs lib/rateLimit.ts's raw SQL against a real Postgres connection rather
// than the hand-written JS approximation in lib/__mocks__/prisma.ts.
//
// The mock's own comment admits the gap: mockResetLoginLockout stands in
// for the real query's `left()`/`right()` string comparison with JS's
// startsWith/endsWith, and the real query exists specifically so an email
// local-part containing `%` or `_` — both valid SQL `LIKE` wildcards —
// can't be misread as one and clear buckets it shouldn't. A mock written in
// the same language as the assumption it's checking can't be the thing that
// catches a mistake in that assumption; only a real Postgres running the
// real `left`/`right` comparison can.
//
// Skipped unless STOCKROOM_TEST_DATABASE_URL points at a real database — the
// same opt-in convention webhook-forge uses for its own Postgres-only
// coverage — so `npm test` and CI stay fast and infra-free by default.
import type { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL = process.env.STOCKROOM_TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  // Overrides (not `??=`) the fake `stockroom_test` fallback
  // __tests__/testUtils/setupEnv.ts already set for this file's own module
  // registry, so lib/prisma's singleton — the same one resetLoginLockout
  // reads — connects to the real database instead.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

describeIfDb("resetLoginLockout against a real Postgres", () => {
  let prisma: PrismaClient;
  let resetLoginLockout: (email: string) => Promise<number>;

  beforeAll(async () => {
    // Imported after the override above, and dynamically rather than at
    // module scope, so this suite still loads (and skips cleanly) when no
    // test database is configured.
    ({ prisma } = await import("../lib/prisma"));
    ({ resetLoginLockout } = await import("../lib/rateLimit"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "login:" } } });
  });

  async function seed(key: string) {
    await prisma.rateLimitBucket.create({
      data: { key, count: 1, resetAt: new Date(Date.now() + 60_000) },
    });
  }

  it("clears every bucket for the exact email, across IPs", async () => {
    await seed("login:1.2.3.4:owner@shop.test");
    await seed("login:5.6.7.8:owner@shop.test");
    await seed("login:1.2.3.4:other@shop.test");

    const cleared = await resetLoginLockout("owner@shop.test");

    expect(cleared).toBe(2);
    const remaining = await prisma.rateLimitBucket.findMany({ orderBy: { key: "asc" } });
    expect(remaining.map((r) => r.key)).toEqual(["login:1.2.3.4:other@shop.test"]);
  });

  it("does not let a `_` in the email match an unrelated address as a SQL wildcard", async () => {
    // If the suffix comparison were ever done with LIKE instead of an exact
    // left()/right() match, `_` (and `%`) would be live wildcards: a bucket
    // for "ownerXshop@test.com" would wrongly match a lockout reset meant
    // only for "owner_shop@test.com".
    await seed("login:1.2.3.4:owner_shop@test.com");
    await seed("login:1.2.3.4:ownerXshop@test.com");

    const cleared = await resetLoginLockout("owner_shop@test.com");

    expect(cleared).toBe(1);
    const remaining = await prisma.rateLimitBucket.findMany();
    expect(remaining.map((r) => r.key)).toEqual(["login:1.2.3.4:ownerXshop@test.com"]);
  });

  it("reports zero, not an error, when nothing matches", async () => {
    await expect(resetLoginLockout("nobody@shop.test")).resolves.toBe(0);
  });
});
