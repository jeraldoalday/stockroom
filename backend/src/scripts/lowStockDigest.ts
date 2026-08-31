import { prisma } from "../lib/prisma";
import { sendLowStockDigest } from "../lib/lowStockDigest";

// `npm run digest:low-stock` — meant for a daily cron entry, the same way
// `npm run prune:tokens` is (see docs/DEPLOYMENT.md). Not on an in-process
// timer: unlike the token sweep, this sends email, and a job that emails
// customers belongs on a schedule someone chose on purpose, not on
// whatever TOKEN_PRUNE_INTERVAL_MS-style interval a process happened to be
// started with.
async function main() {
  const result = await sendLowStockDigest();
  console.log(
    `Low-stock digest: checked ${result.organizationsChecked} organization(s), ` +
      `notified ${result.organizationsNotified} with ${result.emailsSent} email(s) sent`
  );
}

main()
  .catch((error) => {
    console.error("Low-stock digest failed", error);
    // Non-zero so a cron wrapper notices, rather than the job reporting
    // success while an Owner never finds out they're about to stock out.
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
