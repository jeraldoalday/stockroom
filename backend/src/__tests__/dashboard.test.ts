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
