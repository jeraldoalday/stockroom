import { prisma } from "./prisma";

// Nothing ever deleted a token row. Rotation writes one on every refresh —
// roughly every fifteen minutes for an active session — so a single user
// working an eight-hour day leaves behind about thirty rows, all but one of
// them revoked, plus one more per sign-in. The table only grows, and it is
// on the hot path of every refresh through a unique index on tokenHash.
// Password reset tokens accumulate the same way, one per request.
//
// What is safe to delete, and what is not:
//
// - **Expired rows go.** The token itself is a signed JWT with the same
//   expiry, so `verifyRefreshToken` rejects it before the row is ever
//   looked up. The row cannot change any outcome after that point.
//
// - **Revoked but still-valid rows stay.** These are the reuse detector.
//   Presenting one means someone is replaying a token that was already
//   exchanged, and the response is to revoke the whole family (OAuth 2.0
//   BCP section 4.14.2). Delete the row early and that replay looks like an
//   unknown token instead — a plain 401, with the thief's other tokens left
//   working. Pruning them "because they're dead anyway" would quietly
//   disable the defence, so it is called out here rather than left to be
//   rediscovered.
//
// A grace period is applied on top so that a clock skew between the API and
// the database can't delete a row that is still inside its last second of
// life.

export const PRUNE_GRACE_MS = 60 * 60 * 1000; // 1 hour

export interface PruneResult {
  refreshTokens: number;
  passwordResetTokens: number;
}

/**
 * Deletes token rows that can no longer affect any request.
 *
 * `now` is injectable so tests don't have to wait, and so a caller can
 * prune against a deliberately conservative timestamp.
 */
export async function pruneExpiredTokens(now: Date = new Date()): Promise<PruneResult> {
  const cutoff = new Date(now.getTime() - PRUNE_GRACE_MS);

  const [refreshTokens, passwordResetTokens] = await Promise.all([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    // A reset token is single-use and short-lived. Once it is expired *or*
    // spent it is inert: the route checks both before honouring it, and
    // unlike a refresh token there is no family to trace a replay back to.
    prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] },
    }),
  ]);

  return {
    refreshTokens: refreshTokens.count,
    passwordResetTokens: passwordResetTokens.count,
  };
}

export interface PrunerHandle {
  stop: () => void;
}

/**
 * Runs {@link pruneExpiredTokens} on an interval for as long as the process
 * is up.
 *
 * Deliberately not wired into a request handler. Sweeping on login would
 * put a table-wide delete in front of a user waiting to sign in, and would
 * fire hardest exactly when the API is busiest. A timer costs nothing when
 * idle and the work is unordered with respect to any request.
 *
 * This is per-process, so two API instances both sweep. That is harmless —
 * `deleteMany` on already-deleted rows is a no-op — but it is the same
 * single-instance assumption the in-memory rate limiter makes, and when
 * this stack grows a second instance the sweep belongs in a cron job
 * calling `npm run prune:tokens` instead.
 *
 * A failure is logged and swallowed: the pruner is housekeeping, and taking
 * the API process down because a delete lost a race would trade a table
 * that grows for an outage.
 */
export function startTokenPruner(intervalMs: number, log = console.log): PrunerHandle {
  async function sweep() {
    try {
      const result = await pruneExpiredTokens();
      if (result.refreshTokens > 0 || result.passwordResetTokens > 0) {
        log(
          `Pruned ${result.refreshTokens} expired refresh token(s) and ` +
            `${result.passwordResetTokens} spent password reset token(s)`
        );
      }
    } catch (error) {
      console.error("Token prune failed", error);
    }
  }

  void sweep();
  const timer = setInterval(() => void sweep(), intervalMs);
  // Without this the timer holds the event loop open and the process never
  // exits on its own — which turns a clean shutdown into a hang, and makes
  // any test that starts the pruner hang with it.
  timer.unref();

  return { stop: () => clearInterval(timer) };
}
