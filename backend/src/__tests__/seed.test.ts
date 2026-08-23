jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";
import {
  DEAD_STOCK_SKUS,
  DEMO_ORGANIZATION_NAME,
  DEMO_OWNER_EMAIL,
  DEMO_STAFF_EMAIL,
  SEED_PRODUCTS,
  createRandom,
  planHistory,
  runningLowSkus,
  seedDemoData,
} from "../lib/seed";
import type { SeedClient } from "../lib/seed";

const client = prisma as unknown as SeedClient;

// A fixed clock, so "12 days ago" means the same thing on every run.
const NOW = new Date("2026-08-21T09:00:00.000Z");

beforeEach(() => {
  resetPrismaMock();
});

// The seed writes StockMovement rows and InventoryItem totals separately
// rather than replaying two thousand movements through the API, so the
// thing that has to be proved is that the two still agree — an inventory
// cache that disagrees with its own audit trail is precisely the bug the
// whole movement engine exists to prevent.
describe("planHistory", () => {
  it("never plans a sale that would drive stock negative", () => {
    const { movements } = planHistory({ days: 60 });
    const running = new Map<string, number>();

    for (const movement of movements) {
      const key = `${movement.sku}::${movement.locationName}`;
      const next = (running.get(key) ?? 0) + movement.quantity;
      expect(next).toBeGreaterThanOrEqual(0);
      running.set(key, next);
    }
  });

  it("ends with quantities equal to the sum of its own movements", () => {
    const { movements, quantities } = planHistory({ days: 60 });
    const summed = new Map<string, number>();

    for (const movement of movements) {
      const key = `${movement.sku}::${movement.locationName}`;
      summed.set(key, (summed.get(key) ?? 0) + movement.quantity);
    }

    expect(Object.fromEntries(summed)).toEqual(Object.fromEntries(quantities));
  });

  it("is deterministic, so a scripted demo can quote its numbers", () => {
    const first = planHistory({ days: 30 });
    const second = planHistory({ days: 30 });

    expect(second.movements).toEqual(first.movements);
    expect(Object.fromEntries(second.quantities)).toEqual(Object.fromEntries(first.quantities));
  });

  it("stocks every seeded product before selling any of it", () => {
    const { movements } = planHistory({ days: 30 });
    const firstMovementBySku = new Map<string, string>();

    for (const movement of movements) {
      if (!firstMovementBySku.has(movement.sku)) {
        firstMovementBySku.set(movement.sku, movement.type);
      }
    }

    expect(firstMovementBySku.size).toBe(SEED_PRODUCTS.length);
    for (const type of firstMovementBySku.values()) {
      expect(type).toBe("RECEIVE");
    }
  });

  it("records sales as negative and receipts as positive, matching the movement engine", () => {
    const { movements } = planHistory({ days: 30 });

    for (const movement of movements) {
      if (movement.type === "RECEIVE") expect(movement.quantity).toBeGreaterThan(0);
      if (movement.type === "SALE") expect(movement.quantity).toBeLessThan(0);
    }
  });

  it("gives every adjustment a reason, which the API requires", () => {
    const { movements } = planHistory({ days: 60 });
    const adjustments = movements.filter((movement) => movement.type === "ADJUSTMENT");

    expect(adjustments.length).toBeGreaterThan(0);
    for (const adjustment of adjustments) {
      expect(adjustment.reason).toBeTruthy();
    }
  });

  // The low-stock panel (F8) and the reorder-quantity report (F12) are two
  // of the things this data exists to demonstrate, and both show nothing at
  // all unless some product is actually at or below its reorder point. An
  // earlier version of the simulation restocked everything on schedule and
  // finished with an empty low-stock list, which made those screens look
  // broken in a demo.
  it("leaves some products at or below their reorder point", () => {
    const { quantities } = planHistory({ days: 60 });

    const totalBySku = new Map<string, number>();
    for (const [key, quantity] of quantities) {
      const [sku] = key.split("::");
      totalBySku.set(sku, (totalBySku.get(sku) ?? 0) + quantity);
    }

    const low = SEED_PRODUCTS.filter(
      (product) => (totalBySku.get(product.sku) ?? 0) <= product.reorderPoint
    );

    expect(low.length).toBeGreaterThanOrEqual(3);
    // Stock on hand is summed across locations, so a product can only read
    // as low if every location is low — including the back room.
    for (const product of low) {
      expect(runningLowSkus()).toContain(product.sku);
    }
  });

  // The dead-stock report (Day 18) has the same failure mode as the
  // low-stock panel: it shows nothing at all unless the data contains a
  // product that holds stock and never sells. Every SKU in the catalogue
  // moved, so the demo would have opened that screen on an empty table —
  // a live demonstration of the problem the report exists to find.
  it("leaves some products holding stock they never sell", () => {
    const { movements, quantities } = planHistory({ days: 60 });

    const soldSkus = new Set(
      movements.filter((movement) => movement.type === "SALE").map((movement) => movement.sku)
    );

    for (const sku of DEAD_STOCK_SKUS) {
      expect(soldSkus.has(sku)).toBe(false);

      const onHand = [...quantities.entries()]
        .filter(([key]) => key.startsWith(`${sku}::`))
        .reduce((total, [, quantity]) => total + quantity, 0);
      // Stock on hand is what makes a product dead rather than merely
      // discontinued: with none left it ties up nothing and the report
      // rightly ignores it.
      expect(onHand).toBeGreaterThan(0);
    }
  });

  it("leaves most products comfortably stocked", () => {
    const { quantities } = planHistory({ days: 60 });

    const totalBySku = new Map<string, number>();
    for (const [key, quantity] of quantities) {
      const [sku] = key.split("::");
      totalBySku.set(sku, (totalBySku.get(sku) ?? 0) + quantity);
    }

    const healthy = SEED_PRODUCTS.filter(
      (product) => (totalBySku.get(product.sku) ?? 0) > product.reorderPoint
    );

    // A demo where everything is low is as uninformative as one where
    // nothing is.
    expect(healthy.length).toBeGreaterThan(SEED_PRODUCTS.length / 2);
  });

  it("produces sales across a range of days, not all on one", () => {
    const { movements } = planHistory({ days: 30 });
    const saleDays = new Set(
      movements.filter((movement) => movement.type === "SALE").map((movement) => movement.daysAgo)
    );

    expect(saleDays.size).toBeGreaterThan(20);
  });
});

describe("createRandom", () => {
  it("returns the same sequence for the same seed", () => {
    const a = createRandom(1234);
    const b = createRandom(1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("returns values in [0, 1)", () => {
    const random = createRandom(99);
    for (let i = 0; i < 200; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("seedDemoData", () => {
  it("creates a complete, self-consistent demo organization", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });

    expect(summary.ownerEmail).toBe(DEMO_OWNER_EMAIL);
    expect(summary.staffEmail).toBe(DEMO_STAFF_EMAIL);
    expect(summary.counts.products).toBe(SEED_PRODUCTS.length);

    const products = await client.product.findMany({ where: { organizationId: summary.organizationId } });
    expect(products).toHaveLength(SEED_PRODUCTS.length);

    const users = await client.user.findMany({ where: { organizationId: summary.organizationId } });
    expect(users.map((user) => user.role).sort()).toEqual(["OWNER", "STAFF"]);

    const locations = await client.location.findMany({ where: { organizationId: summary.organizationId } });
    expect(locations.filter((location) => location.isDefault)).toHaveLength(1);
  });

  it("keeps the inventory cache equal to the sum of the movements it wrote", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const organizationId = summary.organizationId;

    const movements = await client.stockMovement.findMany({ where: { organizationId } });
    const inventory = await client.inventoryItem.findMany({ where: { organizationId } });

    const summed = new Map<string, number>();
    for (const movement of movements) {
      const key = `${movement.productId}::${movement.locationId}`;
      summed.set(key, (summed.get(key) ?? 0) + (movement.quantity as number));
    }

    expect(inventory.length).toBeGreaterThan(0);
    for (const item of inventory) {
      const key = `${item.productId}::${item.locationId}`;
      expect(item.quantity).toBe(summed.get(key));
    }
  });

  // The trend report reads revenue from the movement's own price. Without
  // prices on the seeded sales, the demo's chart plots units against a flat
  // zero revenue line — the exact gap that column was added to close.
  it("prices every seeded sale, so the trend report has revenue to show", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const movements = await client.stockMovement.findMany({
      where: { organizationId: summary.organizationId },
    });

    const sales = movements.filter((movement) => movement.type === "SALE");
    expect(sales.length).toBeGreaterThan(0);
    for (const sale of sales) {
      expect(sale.unitPriceCents as number).toBeGreaterThan(0);
    }

    // ...and nothing else carries a price, which the API would reject.
    for (const other of movements.filter((movement) => movement.type !== "SALE")) {
      expect(other.unitPriceCents ?? null).toBeNull();
    }
  });

  it("leaves no inventory row negative", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const inventory = await client.inventoryItem.findMany({
      where: { organizationId: summary.organizationId },
    });

    for (const item of inventory) {
      expect(item.quantity as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("backdates movements so the trend and forecast reports have a window to read", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const movements = await client.stockMovement.findMany({
      where: { organizationId: summary.organizationId },
    });

    const timestamps = movements.map((movement) => (movement.createdAt as Date).getTime());
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);

    expect(newest).toBeLessThanOrEqual(NOW.getTime());
    // 30 days of trading plus the opening-stock day before it.
    expect(NOW.getTime() - oldest).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
  });

  it("covers every purchase and sales order status the UI can filter on", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const organizationId = summary.organizationId;

    const purchaseOrders = await client.purchaseOrder.findMany({ where: { organizationId } });
    const salesOrders = await client.salesOrder.findMany({ where: { organizationId } });

    expect(new Set(purchaseOrders.map((order) => order.status))).toEqual(
      new Set(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"])
    );
    expect(new Set(salesOrders.map((order) => order.status))).toEqual(
      new Set(["DRAFT", "FULFILLED", "CANCELLED"])
    );
  });

  it("gives every order at least one line", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const purchaseOrders = await client.purchaseOrder.findMany({
      where: { organizationId: summary.organizationId },
    });

    for (const order of purchaseOrders) {
      const lines = await client.purchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } });
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  // Re-running the seed is the normal way to reset a demo, so it has to be
  // idempotent rather than piling a second copy on top of the first.
  it("replaces the previous demo org instead of duplicating it", async () => {
    const first = await seedDemoData(client, { now: NOW, days: 20 });
    const second = await seedDemoData(client, { now: NOW, days: 20 });

    expect(second.organizationId).not.toBe(first.organizationId);

    const organizations = await client.organization.findMany({
      where: { name: DEMO_ORGANIZATION_NAME },
    });
    expect(organizations).toHaveLength(1);

    const orphanedProducts = await client.product.findMany({
      where: { organizationId: first.organizationId },
    });
    expect(orphanedProducts).toHaveLength(0);

    const orphanedMovements = await client.stockMovement.findMany({
      where: { organizationId: first.organizationId },
    });
    expect(orphanedMovements).toHaveLength(0);
  });

  // The seed must be safe to run against a database that also holds real
  // signups; it is scoped to the demo org by name and nothing else.
  it("leaves other organizations untouched", async () => {
    const other = await client.organization.create({ data: { name: "Someone Else's Shop" } });
    await client.product.create({
      data: { organizationId: other.id, sku: "REAL-1", name: "Real product", isActive: true },
    });

    await seedDemoData(client, { now: NOW, days: 20 });
    await seedDemoData(client, { now: NOW, days: 20 });

    const survivors = await client.product.findMany({ where: { organizationId: other.id } });
    expect(survivors).toHaveLength(1);
    expect(survivors[0].sku).toBe("REAL-1");
  });

  it("reports a stock value consistent with the inventory it wrote", async () => {
    const summary = await seedDemoData(client, { now: NOW, days: 30 });
    const [inventory, products] = await Promise.all([
      client.inventoryItem.findMany({ where: { organizationId: summary.organizationId } }),
      client.product.findMany({ where: { organizationId: summary.organizationId } }),
    ]);

    const costById = new Map(products.map((product) => [product.id as string, product.costCents as number]));
    const expected = inventory.reduce(
      (total, item) => total + (item.quantity as number) * (costById.get(item.productId as string) ?? 0),
      0
    );

    expect(summary.totalStockValueCents).toBe(expected);
    expect(summary.totalStockValueCents).toBeGreaterThan(0);
  });
});
