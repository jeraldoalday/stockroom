import { prisma } from "../lib/prisma";
import { pruneExpiredTokens } from "../lib/tokenPruning";

// `npm run prune:tokens` — the cron-friendly form of the sweep the API
// process runs on a timer. Use this instead of the in-process pruner once
// more than one API instance is running: every instance otherwise sweeps on
// its own schedule, doing the same deletes redundantly.
async function main() {
  const result = await pruneExpiredTokens();
  console.log(
    `Pruned ${result.refreshTokens} expired refresh token(s), ` +
      `${result.passwordResetTokens} spent password reset token(s), and ` +
      `${result.rateLimitBuckets} expired rate-limit bucket(s)`
  );
}

main()
  .catch((error) => {
    console.error("Token prune failed", error);
    // Non-zero so a cron wrapper or CI step notices, rather than the job
    // reporting success while the table keeps growing.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
