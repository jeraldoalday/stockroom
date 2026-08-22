jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";
import { PRUNE_GRACE_MS, pruneExpiredTokens, startTokenPruner } from "../lib/tokenPruning";

beforeEach(() => {
  resetPrismaMock();
});

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-08-23T12:00:00Z");

function at(offsetMs: number): Date {
  return new Date(now.getTime() + offsetMs);
}

async function createRefreshToken(overrides: {
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  familyId?: string;
}) {
  await prisma.refreshToken.create({
    data: {
      userId: "user-1",
      familyId: overrides.familyId ?? "family-1",
      tokenHash: overrides.tokenHash,
      expiresAt: overrides.expiresAt,
      revokedAt: overrides.revokedAt ?? null,
    },
  });
}

async function refreshTokenHashes(): Promise<string[]> {
  const rows = await prisma.refreshToken.findMany({ orderBy: { tokenHash: "asc" } });
  return rows.map((row) => row.tokenHash);
}

describe("pruneExpiredTokens", () => {
  it("deletes refresh tokens that expired more than the grace period ago", async () => {
    await createRefreshToken({ tokenHash: "long-dead", expiresAt: at(-48 * HOUR) });
    await createRefreshToken({ tokenHash: "live", expiresAt: at(48 * HOUR) });

    const result = await pruneExpiredTokens(now);

    expect(result.refreshTokens).toBe(1);
    expect(await refreshTokenHashes()).toEqual(["live"]);
  });

  // A row whose expiry has only just passed is left alone, so a clock that
  // disagrees with the database by a few seconds can't delete a token that
  // is still inside its last moments of life.
  it("leaves a just-expired token inside the grace period", async () => {
    await createRefreshToken({ tokenHash: "just-expired", expiresAt: at(-PRUNE_GRACE_MS / 2) });

    const result = await pruneExpiredTokens(now);

    expect(result.refreshTokens).toBe(0);
    expect(await refreshTokenHashes()).toEqual(["just-expired"]);
  });

  // The important one. A revoked token that has not yet expired is the
  // reuse detector: presenting it means someone is replaying a token that
  // was already exchanged, and the response is to revoke the whole family.
  // Pruning it early would turn that replay into an ordinary "unknown
  // token" 401 and leave the thief's other tokens working.
  it("keeps a revoked token that has not expired yet", async () => {
    await createRefreshToken({
      tokenHash: "revoked-but-live",
      expiresAt: at(72 * HOUR),
      revokedAt: at(-HOUR),
    });

    const result = await pruneExpiredTokens(now);

    expect(result.refreshTokens).toBe(0);
    expect(await refreshTokenHashes()).toEqual(["revoked-but-live"]);
  });

  it("deletes a revoked token once it has also expired", async () => {
    await createRefreshToken({
      tokenHash: "revoked-and-expired",
      expiresAt: at(-48 * HOUR),
      revokedAt: at(-72 * HOUR),
    });

    const result = await pruneExpiredTokens(now);

    expect(result.refreshTokens).toBe(1);
    expect(await refreshTokenHashes()).toEqual([]);
  });

  it("deletes expired password reset tokens", async () => {
    await prisma.passwordResetToken.create({
      data: { userId: "user-1", tokenHash: "expired-reset", expiresAt: at(-48 * HOUR) },
    });
    await prisma.passwordResetToken.create({
      data: { userId: "user-1", tokenHash: "live-reset", expiresAt: at(HOUR) },
    });

    const result = await pruneExpiredTokens(now);

    expect(result.passwordResetTokens).toBe(1);
    const remaining = await prisma.passwordResetToken.findMany({});
    expect(remaining.map((row) => row.tokenHash)).toEqual(["live-reset"]);
  });

  // A reset token is single-use, so a spent one is inert well before its
  // hour is up. Unlike a refresh token there is no family to trace a replay
  // back to, so there is nothing to learn by keeping it.
  it("deletes a spent password reset token even though it has not expired", async () => {
    await prisma.passwordResetToken.create({
      data: {
        userId: "user-1",
        tokenHash: "spent-reset",
        expiresAt: at(HOUR),
        usedAt: at(-2 * HOUR),
      },
    });

    const result = await pruneExpiredTokens(now);

    expect(result.passwordResetTokens).toBe(1);
    expect(await prisma.passwordResetToken.findMany({})).toEqual([]);
  });

  it("keeps an unused reset token that is still inside its hour", async () => {
    await prisma.passwordResetToken.create({
      data: { userId: "user-1", tokenHash: "pending-reset", expiresAt: at(HOUR), usedAt: null },
    });

    const result = await pruneExpiredTokens(now);

    expect(result.passwordResetTokens).toBe(0);
    expect(await prisma.passwordResetToken.findMany({})).toHaveLength(1);
  });

  it("reports nothing to do on an empty table", async () => {
    expect(await pruneExpiredTokens(now)).toEqual({ refreshTokens: 0, passwordResetTokens: 0 });
  });
});

describe("startTokenPruner", () => {
  it("sweeps immediately rather than waiting out the first interval", async () => {
    await createRefreshToken({ tokenHash: "long-dead", expiresAt: new Date(Date.now() - 48 * HOUR) });

    const logged: string[] = [];
    const pruner = startTokenPruner(HOUR, (message: string) => logged.push(message));
    // The sweep is fired without being awaited, so let the microtask queue
    // drain before looking at the result.
    await new Promise((resolve) => setImmediate(resolve));
    pruner.stop();

    expect(await refreshTokenHashes()).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("1 expired refresh token");
  });

  it("says nothing when there was nothing to prune", async () => {
    const logged: string[] = [];
    const pruner = startTokenPruner(HOUR, (message: string) => logged.push(message));
    await new Promise((resolve) => setImmediate(resolve));
    pruner.stop();

    expect(logged).toEqual([]);
  });

  // Housekeeping must not be able to take the API process down, so a failed
  // sweep is logged and swallowed.
  it("survives a failing sweep", async () => {
    const deleteMany = jest
      .spyOn(prisma.refreshToken, "deleteMany")
      .mockRejectedValueOnce(new Error("connection reset"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    const pruner = startTokenPruner(HOUR, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    pruner.stop();

    expect(consoleError).toHaveBeenCalledWith("Token prune failed", expect.any(Error));
    deleteMany.mockRestore();
    consoleError.mockRestore();
  });
});
