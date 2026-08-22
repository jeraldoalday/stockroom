import { prisma } from "../lib/prisma";
import { pruneExpiredTokens } from "../lib/tokenPruning";

// `npm run prune:tokens` — the cron-friendly form of the sweep the API
// process runs on a timer. Use this instead of the in-process pruner once
// more than one API instance is running, for the same reason the rate
// limiter will need moving to shared state: every instance otherwise does
// the same work on its own schedule.
async function main() {
  const result = await pruneExpiredTokens();
  console.log(
    `Pruned ${result.refreshTokens} expired refresh token(s) and ` +
      `${result.passwordResetTokens} spent password reset token(s)`
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
