jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";

// The in-memory store the route tests run against is itself a fair amount
// of query semantics, and it is the only thing standing between a wrong
// query and a green suite. When it ignored `orderBy` — which it did until
// now — every test asserting "newest first" was really asserting insertion
// order, and a route that lost its orderBy would still have passed. These
// tests hold the store to the parts of Prisma's behaviour the routes rely
// on, including the awkward ones like a _sum over an all-null column.

beforeEach(() => {
  resetPrismaMock();
});

async function seedMovements() {
  const rows = [
    { organizationId: "org1", productId: "p1", quantity: -3, unitPriceCents: 100, createdAt: new Date("2026-08-01") },
    { organizationId: "org1", productId: "p2", quantity: -5, unitPriceCents: 250, createdAt: new Date("2026-08-03") },
    { organizationId: "org1", productId: "p1", quantity: -2, unitPriceCents: null, createdAt: new Date("2026-08-02") },
    { organizationId: "org2", productId: "p1", quantity: -9, unitPriceCents: 900, createdAt: new Date("2026-08-04") },
  ];
  for (const row of rows) {
    await prisma.stockMovement.create({
      data: { ...row, locationId: "l1", type: "SALE", actorId: "u1" },
    });
  }
}

describe("orderBy", () => {
  it("sorts descending by date", async () => {
    await seedMovements();
    const found = await prisma.stockMovement.findMany({
      where: { organizationId: "org1" },
      orderBy: { createdAt: "desc" },
    });
    expect(found.map((m) => m.createdAt.toISOString().slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-02",
      "2026-08-01",
    ]);
  });

  it("sorts ascending by name, case-insensitively like Postgres", async () => {
    for (const name of ["banana", "Apple", "cherry"]) {
      await prisma.product.create({ data: { organizationId: "org1", sku: name, name } });
    }
    const found = await prisma.product.findMany({ orderBy: { name: "asc" } });
    expect(found.map((p) => p.name)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("applies take after ordering, not before", async () => {
    await seedMovements();
    const found = await prisma.stockMovement.findMany({
      where: { organizationId: "org1" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(found).toHaveLength(1);
    expect(found[0].productId).toBe("p2");
  });

  it("breaks ties with the second clause of an array orderBy", async () => {
    for (const [sku, name] of [
      ["b", "Shared"],
      ["a", "Shared"],
      ["c", "Other"],
    ]) {
      await prisma.product.create({ data: { organizationId: "org1", sku, name } });
    }
    const found = await prisma.product.findMany({ orderBy: [{ name: "asc" }, { sku: "asc" }] });
    expect(found.map((p) => p.sku)).toEqual(["c", "a", "b"]);
  });

  it("orders findFirst too", async () => {
    await seedMovements();
    const newest = await prisma.stockMovement.findFirst({
      where: { organizationId: "org1" },
      orderBy: { createdAt: "desc" },
    });
    expect(newest?.productId).toBe("p2");
  });
});

describe("groupBy", () => {
  it("sums a column per group, scoped by where", async () => {
    await seedMovements();
    const groups = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { organizationId: "org1" },
      _sum: { quantity: true },
      orderBy: { productId: "asc" },
    });
    expect(groups).toEqual([
      { productId: "p1", _sum: { quantity: -5 } },
      { productId: "p2", _sum: { quantity: -5 } },
    ]);
  });

  it("returns null rather than zero when every value in the group is null", async () => {
    await prisma.stockMovement.create({
      data: {
        organizationId: "org1",
        productId: "p9",
        locationId: "l1",
        type: "SALE",
        actorId: "u1",
        quantity: -1,
        unitPriceCents: null,
      },
    });
    const [group] = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { organizationId: "org1" },
      _sum: { unitPriceCents: true },
    });
    expect(group._sum.unitPriceCents).toBeNull();
  });

  it("counts rows in each group", async () => {
    await seedMovements();
    const groups = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { organizationId: "org1" },
      _count: true,
      orderBy: { productId: "asc" },
    });
    expect(groups.map((g) => g._count)).toEqual([2, 1]);
  });

  it("orders by an aggregate", async () => {
    await seedMovements();
    const groups = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { organizationId: "org1", createdAt: { gte: new Date("2026-08-02") } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "asc" } },
    });
    expect(groups.map((g) => g.productId)).toEqual(["p2", "p1"]);
  });

  it("groups by more than one column", async () => {
    await prisma.inventoryItem.create({ data: { organizationId: "org1", productId: "p1", locationId: "l1", quantity: 4 } });
    await prisma.inventoryItem.create({ data: { organizationId: "org1", productId: "p1", locationId: "l2", quantity: 6 } });
    await prisma.inventoryItem.create({ data: { organizationId: "org1", productId: "p2", locationId: "l1", quantity: 7 } });

    const groups = await prisma.inventoryItem.groupBy({
      by: ["productId", "locationId"],
      where: { organizationId: "org1" },
      _sum: { quantity: true },
      orderBy: [{ productId: "asc" }, { locationId: "asc" }],
    });
    expect(groups).toEqual([
      { productId: "p1", locationId: "l1", _sum: { quantity: 4 } },
      { productId: "p1", locationId: "l2", _sum: { quantity: 6 } },
      { productId: "p2", locationId: "l1", _sum: { quantity: 7 } },
    ]);
  });
});

describe("aggregate", () => {
  it("sums across every matching row", async () => {
    await seedMovements();
    const result = await prisma.stockMovement.aggregate({
      where: { organizationId: "org1" },
      _sum: { quantity: true },
      _count: true,
    });
    expect(result._sum.quantity).toBe(-10);
    expect(result._count).toBe(3);
  });

  it("sums to null when nothing matches", async () => {
    const result = await prisma.stockMovement.aggregate({
      where: { organizationId: "nobody" },
      _sum: { quantity: true },
    });
    expect(result._sum.quantity).toBeNull();
  });
});

describe("comparisons against a null column", () => {
  // `NULL < now()` is NULL in SQL, so the row isn't returned. JS turns the
  // same expression into `0 < 1755000000000` and returns everything. A
  // query like "reset tokens spent before this cutoff" would have matched
  // every unspent token here and none in Postgres.
  it("does not match a null value with lt", async () => {
    await prisma.passwordResetToken.create({
      data: { userId: "u1", tokenHash: "unused", expiresAt: new Date("2027-01-01"), usedAt: null },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: "u1",
        tokenHash: "spent",
        expiresAt: new Date("2027-01-01"),
        usedAt: new Date("2026-01-01"),
      },
    });

    const found = await prisma.passwordResetToken.findMany({
      where: { usedAt: { lt: new Date("2026-06-01") } },
    });
    expect(found.map((t) => t.tokenHash)).toEqual(["spent"]);
  });

  it("does not match a null value with gt either", async () => {
    await prisma.refreshToken.create({
      data: { userId: "u1", tokenHash: "live", familyId: "f1", expiresAt: new Date("2027-01-01") },
    });
    const found = await prisma.refreshToken.findMany({
      where: { revokedAt: { gt: new Date("2000-01-01") } },
    });
    expect(found).toEqual([]);
  });
});

// applyMovementDelta (lib/inventory.ts) relies on the guard and the write
// landing in a single updateMany() so a real Postgres can resolve the two
// as one statement. These hold the mock to the same call shape.
describe("update operators", () => {
  it("increment adds to whatever the row currently holds", async () => {
    const item = await prisma.inventoryItem.create({
      data: { organizationId: "org1", productId: "p1", locationId: "l1", quantity: 10 },
    });
    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { increment: 5 } },
    });
    expect(updated.quantity).toBe(15);
  });

  it("decrement subtracts from whatever the row currently holds", async () => {
    const item = await prisma.inventoryItem.create({
      data: { organizationId: "org1", productId: "p1", locationId: "l1", quantity: 10 },
    });
    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: { decrement: 4 } },
    });
    expect(updated.quantity).toBe(6);
  });

  it("updateMany's where is re-checked per row, not against a value read earlier", async () => {
    await prisma.inventoryItem.create({
      data: { organizationId: "org1", productId: "p1", locationId: "l1", quantity: 2 },
    });
    await prisma.inventoryItem.create({
      data: { organizationId: "org1", productId: "p2", locationId: "l1", quantity: 20 },
    });

    // Only the second row has enough on hand for a delta of -5; the guard
    // must exclude the first rather than incrementing both and leaving one
    // negative.
    const result = await prisma.inventoryItem.updateMany({
      where: { locationId: "l1", quantity: { gte: 5 } },
      data: { quantity: { increment: -5 } },
    });
    expect(result.count).toBe(1);

    const rows = await prisma.inventoryItem.findMany({ where: { locationId: "l1" } });
    expect(rows.map((r) => r.quantity).sort((a, b) => a - b)).toEqual([2, 15]);
  });

  it("rejects an update operator it does not understand rather than writing it through literally", async () => {
    const item = await prisma.inventoryItem.create({
      data: { organizationId: "org1", productId: "p1", locationId: "l1", quantity: 10 },
    });
    expect(() =>
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { multiply: 2 } as never },
      })
    ).toThrow(/unsupported update operator/);
  });
});
