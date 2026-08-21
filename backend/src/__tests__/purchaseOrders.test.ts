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
  const supplier = await request(app)
    .post("/api/suppliers")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Acme Distributors" });

  const product = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-1", name: "Widget" });

  const locations = await request(app)
    .get("/api/locations")
    .set("Authorization", `Bearer ${token}`);

  return {
    supplierId: supplier.body.id as string,
    productId: product.body.id as string,
    locationId: locations.body[0].id as string,
  };
}

async function createDraftPo(token: string, supplierId: string, productId: string, quantityOrdered = 10) {
  return request(app)
    .post("/api/purchase-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      supplierId,
      lines: [{ productId, quantityOrdered, unitCostCents: 500 }],
    });
}

describe("Purchase orders API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/purchase-orders");
    expect(res.status).toBe(401);
  });

  it("creates a draft purchase order with lines", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);

    const res = await createDraftPo(token, supplierId, productId);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].quantityReceived).toBe(0);
  });

  it("rejects a supplierId from another organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");
    const { supplierId } = await setUp(tokenA);
    const { productId } = await setUp(tokenB);

    const res = await createDraftPo(tokenB, supplierId, productId);
    expect(res.status).toBe(400);
  });

  it("moves a draft to ordered, then blocks direct receiving of a draft", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");
    const { supplierId, productId, locationId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);

    const receiveDraft = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId, lines: [{ lineId: po.body.lines[0].id, quantity: 1 }] });
    expect(receiveDraft.status).toBe(400);

    const ordered = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);
    expect(ordered.status).toBe(200);
    expect(ordered.body.status).toBe("ORDERED");
  });

  it("supports partial receiving and transitions to PARTIALLY_RECEIVED then RECEIVED", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");
    const { supplierId, productId, locationId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId, 10);
    await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);

    const firstReceive = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId, lines: [{ lineId: po.body.lines[0].id, quantity: 4 }] });
    expect(firstReceive.status).toBe(200);
    expect(firstReceive.body.status).toBe("PARTIALLY_RECEIVED");
    expect(firstReceive.body.lines[0].quantityReceived).toBe(4);

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${locationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(4);

    const secondReceive = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId, lines: [{ lineId: po.body.lines[0].id, quantity: 6 }] });
    expect(secondReceive.status).toBe(200);
    expect(secondReceive.body.status).toBe("RECEIVED");
    expect(secondReceive.body.lines[0].quantityReceived).toBe(10);

    const movements = await request(app)
      .get(`/api/stock-movements?productId=${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(movements.body.total).toBe(2);
  });

  it("rejects receiving more than the remaining quantity on a line", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");
    const { supplierId, productId, locationId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId, 5);
    await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locationId, lines: [{ lineId: po.body.lines[0].id, quantity: 6 }] });
    expect(res.status).toBe(400);
  });

  it("cancels a draft purchase order", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);

    const cancelled = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("CANCELLED");
  });

  it("prevents editing a purchase order once it is no longer a draft", async () => {
    const token = await signUpAndGetToken("owner6@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);
    await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);

    const patch = await request(app)
      .patch(`/api/purchase-orders/${po.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ notes: "updated" });
    expect(patch.status).toBe(400);
  });
});
