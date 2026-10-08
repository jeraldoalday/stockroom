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

describe("Inventory API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/inventory");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a brand-new organization", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const res = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it("rejects a locationId that belongs to a different organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    const locationsA = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenA}`);

    const res = await request(app)
      .get(`/api/inventory?locationId=${locationsA.body[0].id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(400);
  });

  it("rejects a productId that belongs to a different organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA2@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB2@shop.test", "Shop B");

    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sku: "SKU-1", name: "Widget" });

    const res = await request(app)
      .get(`/api/inventory?productId=${product.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(400);
  });

  async function receiveStock(token: string, sku: string, name: string, locationId: string, quantity: number) {
    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku, name });
    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity });
    return product.body.id as string;
  }

  it("filters to the products a search matches by name or SKU, case-insensitively", async () => {
    const token = await signUpAndGetToken("search-owner@shop.test", "Search Shop");
    const locations = await request(app).get("/api/locations").set("Authorization", `Bearer ${token}`);
    const locationId = locations.body[0].id;

    const widgetId = await receiveStock(token, "WID-1", "Widget", locationId, 10);
    const gadgetId = await receiveStock(token, "GAD-1", "Gadget", locationId, 7);

    const byName = await request(app)
      .get("/api/inventory?search=widget")
      .set("Authorization", `Bearer ${token}`);
    expect(byName.body.total).toBe(1);
    expect(byName.body.items[0].productId).toBe(widgetId);

    const bySku = await request(app)
      .get("/api/inventory?search=GAD")
      .set("Authorization", `Bearer ${token}`);
    expect(bySku.body.total).toBe(1);
    expect(bySku.body.items[0].productId).toBe(gadgetId);
  });

  it("returns an empty list, not every row, when a search matches no product", async () => {
    const token = await signUpAndGetToken("search-empty@shop.test", "Empty Search Shop");
    const locations = await request(app).get("/api/locations").set("Authorization", `Bearer ${token}`);
    await receiveStock(token, "WID-2", "Widget", locations.body[0].id, 5);

    const res = await request(app)
      .get("/api/inventory?search=nonexistent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it("scopes a search to the requesting organization's own products", async () => {
    const tokenA = await signUpAndGetToken("search-a@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("search-b@shop.test", "Shop B");
    const locationsA = await request(app).get("/api/locations").set("Authorization", `Bearer ${tokenA}`);
    const locationsB = await request(app).get("/api/locations").set("Authorization", `Bearer ${tokenB}`);

    await receiveStock(tokenA, "WID-A", "Widget", locationsA.body[0].id, 3);
    const productBId = await receiveStock(tokenB, "WID-B", "Widget", locationsB.body[0].id, 4);

    const res = await request(app)
      .get("/api/inventory?search=widget")
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].productId).toBe(productBId);
  });
});
