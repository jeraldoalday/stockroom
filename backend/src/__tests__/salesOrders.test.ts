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

async function setUp(token: string) {
  const customer = await request(app)
    .post("/api/customers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Jane Regular" });

  const product = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-1", name: "Widget" });

  const locations = await request(app)
    .get("/api/locations")
    .set("Authorization", `Bearer ${token}`);
  const locationId = locations.body[0].id as string;

  await request(app)
    .post("/api/stock-movements")
    .set("Authorization", `Bearer ${token}`)
    .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity: 10 });

  return { customerId: customer.body.id as string, productId: product.body.id as string, locationId };
}

async function createDraftSo(token: string, locationId: string, productId: string, quantity: number, customerId?: string) {
  return request(app)
    .post("/api/sales-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      locationId,
      customerId,
      lines: [{ productId, quantity, unitPriceCents: 1999 }],
    });
}

describe("Sales orders API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/sales-orders");
    expect(res.status).toBe(401);
  });

  it("creates a draft sales order with lines", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");
    const { customerId, productId, locationId } = await setUp(token);

    const res = await createDraftSo(token, locationId, productId, 3, customerId);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.lines).toHaveLength(1);
  });

  it("fulfills a draft, decrementing stock and posting a SALE movement", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 4);

    const fulfilled = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(fulfilled.status).toBe(200);
    expect(fulfilled.body.status).toBe("FULFILLED");

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${locationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(6);

    const movements = await request(app)
      .get(`/api/stock-movements?productId=${productId}&type=SALE`)
      .set("Authorization", `Bearer ${token}`);
    expect(movements.body.total).toBe(1);
    expect(movements.body.items[0].quantity).toBe(-4);
  });

  it("blocks an over-sell and leaves stock untouched", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 999);

    const fulfilled = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(fulfilled.status).toBe(400);

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${locationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(10);
  });

  it("cannot fulfill an order twice", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 2);

    await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    const second = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(400);
  });

  it("cancels a draft sales order", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 1);

    const cancelled = await request(app)
      .post(`/api/sales-orders/${so.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");

    const fulfillAfterCancel = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(fulfillAfterCancel.status).toBe(400);
  });

  it("rejects a locationId from another organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");
    const { productId } = await setUp(tokenA);
    const { locationId } = await setUp(tokenB);

    const res = await createDraftSo(tokenA, locationId, productId, 1);
    expect(res.status).toBe(400);
  });
});
