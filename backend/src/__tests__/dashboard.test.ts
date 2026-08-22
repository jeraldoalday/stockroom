import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

async function signUpAndGetToken(email: string, orgName: string) {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: orgName,
    name: "Owner",
    email,
    password: "hunter22222",
  });
  return res.body.accessToken as string;
}

describe("Dashboard API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(401);
  });

  it("returns zeroed-out figures for a brand-new organization", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const res = await request(app)
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalStockValueCents).toBe(0);
    expect(res.body.lowStockCount).toBe(0);
    expect(res.body.recentMovements).toEqual([]);
  });

  it("computes stock value and flags a product at or below its reorder point", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");

    const lowProduct = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "LOW-1", name: "Low Stock Widget", costCents: 300, reorderPoint: 10 });
    const healthyProduct = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "OK-1", name: "Healthy Widget", costCents: 500, reorderPoint: 5 });

    const locations = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);
    const locationId = locations.body[0].id;

    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: lowProduct.body.id, locationId, type: "RECEIVE", quantity: 4 });
    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: healthyProduct.body.id, locationId, type: "RECEIVE", quantity: 50 });

    const summary = await request(app)
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(summary.body.totalStockValueCents).toBe(4 * 300 + 50 * 500);
    expect(summary.body.lowStockCount).toBe(1);
    expect(summary.body.recentMovements.length).toBe(2);

    const lowStock = await request(app)
      .get("/api/dashboard/low-stock")
      .set("Authorization", `Bearer ${token}`);
    expect(lowStock.body.total).toBe(1);
    expect(lowStock.body.items[0].product.sku).toBe("LOW-1");
    expect(lowStock.body.items[0].quantity).toBe(4);
  });

  // Stock is summed across locations by a GROUP BY now, so the same product
  // held in three places has to come back as one figure rather than three
  // rows fighting over the map key.
  it("sums a product's stock across every location it is held in", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");
    const auth = { Authorization: `Bearer ${token}` };

    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "SPREAD-1", name: "Spread Widget", costCents: 200, reorderPoint: 5 });

    const back = await request(app).post("/api/locations").set(auth).send({ name: "Back Room" });
    const van = await request(app).post("/api/locations").set(auth).send({ name: "Van" });
    const main = await request(app).get("/api/locations").set(auth);
    const mainId = main.body.find((l: { isDefault: boolean }) => l.isDefault).id;

    for (const [locationId, quantity] of [
      [mainId, 2],
      [back.body.id, 3],
      [van.body.id, 4],
    ] as [string, number][]) {
      await request(app)
        .post("/api/stock-movements")
        .set(auth)
        .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity });
    }

    const summary = await request(app).get("/api/dashboard/summary").set(auth);
    expect(summary.body.totalStockValueCents).toBe(9 * 200);
    // Nine on hand against a reorder point of five is healthy; counting a
    // single location's two units instead would have flagged it.
    expect(summary.body.lowStockCount).toBe(0);

    const lowStock = await request(app).get("/api/dashboard/low-stock").set(auth);
    expect(lowStock.body.total).toBe(0);
  });

  // A product that has never been stocked anywhere has no inventory_items
  // row at all, so it is absent from the grouped sums entirely rather than
  // present with a zero. Zero on hand is the definition of low stock, so
  // missing it is the expensive kind of wrong.
  it("counts a product with no inventory row at all as low stock", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "NEVER-1", name: "Never Stocked", costCents: 100, reorderPoint: 3 });

    const summary = await request(app).get("/api/dashboard/summary").set(auth);
    expect(summary.body.lowStockCount).toBe(1);
    expect(summary.body.totalStockValueCents).toBe(0);

    const lowStock = await request(app).get("/api/dashboard/low-stock").set(auth);
    expect(lowStock.body.items[0].quantity).toBe(0);
  });

  // Paging is offset-based, so the sort has to be total: two products on the
  // same quantity in an unstable order can appear on both pages, or on
  // neither.
  it("orders the low-stock list by quantity and breaks ties by name", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "The Shop");
    const auth = { Authorization: `Bearer ${token}` };

    for (const [sku, name] of [
      ["T-1", "Zephyr"],
      ["T-2", "Anvil"],
      ["T-3", "Mallet"],
    ]) {
      await request(app)
        .post("/api/products")
        .set(auth)
        .send({ sku, name, costCents: 100, reorderPoint: 2 });
    }

    const first = await request(app).get("/api/dashboard/low-stock?page=1&pageSize=2").set(auth);
    const second = await request(app).get("/api/dashboard/low-stock?page=2&pageSize=2").set(auth);
    expect(first.body.total).toBe(3);
    expect(first.body.items.map((i: { product: { name: string } }) => i.product.name)).toEqual([
      "Anvil",
      "Mallet",
    ]);
    expect(second.body.items.map((i: { product: { name: string } }) => i.product.name)).toEqual([
      "Zephyr",
    ]);
  });

  it("never mixes stock across organizations", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    const productA = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sku: "A-1", name: "Shop A Widget", costCents: 1000 });
    const locationsA = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenA}`);
    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ productId: productA.body.id, locationId: locationsA.body[0].id, type: "RECEIVE", quantity: 10 });

    const summaryB = await request(app)
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(summaryB.body.totalStockValueCents).toBe(0);
  });
});
