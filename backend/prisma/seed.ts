// Loads the demo dataset into the database configured by DATABASE_URL.
//
//   npm run seed
//
// Safe to re-run: it removes only the demo organization it created last
// time (matched by name) and leaves any real signups in the database
// untouched. The generation logic lives in src/lib/seed so it can be tested
// without a live Postgres — this file is just the wiring and the report.
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../src/lib/seed";
import type { SeedClient } from "../src/lib/seed";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const summary = await seedDemoData(prisma as unknown as SeedClient, {
      log: (message) => console.log(`  ${message}`),
    });

    console.log("\nSeed complete.\n");
    console.log(`  Organization    ${summary.organizationId}`);
    console.log(`  Products        ${summary.counts.products}`);
    console.log(`  Locations       ${summary.counts.locations}`);
    console.log(`  Suppliers       ${summary.counts.suppliers}`);
    console.log(`  Customers       ${summary.counts.customers}`);
    console.log(`  Stock movements ${summary.counts.stockMovements}`);
    console.log(`  Purchase orders ${summary.counts.purchaseOrders}`);
    console.log(`  Sales orders    ${summary.counts.salesOrders}`);
    console.log(`  Stock value     ${formatCents(summary.totalStockValueCents)}`);
    console.log("\nSign in with:\n");
    console.log(`  Owner   ${summary.ownerEmail} / ${summary.password}`);
    console.log(`  Staff   ${summary.staffEmail} / ${summary.password}`);
    console.log("\nThe Staff account is the one to use when checking that cost");
    console.log("and margin data stays hidden (PRD section 4).\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("\nSeed failed:", error);
  process.exit(1);
});
