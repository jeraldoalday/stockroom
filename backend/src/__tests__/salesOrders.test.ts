import request from "supertest";

jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
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

  // quantity/unitPriceCents back a Postgres `Int` column; without an
  // explicit upper bound an oversized value would pass Zod's `.int()` check
  // and crash the write at the database instead of failing validation.
  it("rejects a quantity too large to fit the underlying Int column", async () => {
    const token = await signUpAndGetToken("owner-overflow@shop.test", "Overflow Shop");
    const { customerId, productId, locationId } = await setUp(token);

    const res = await createDraftSo(token, locationId, productId, 99999999999, customerId);
    expect(res.status).toBe(400);
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

  // The pre-transaction status check above reads its own snapshot of the
  // order, so a second /fulfill request that read the order before a first
  // one committed could pass that check on a stale "still DRAFT" status.
  // Real concurrent requests can't be reproduced against this in-memory
  // mock (see purchaseOrders.test.ts's identical note on the overreceive
  // race), so the stale read is reproduced directly: fake the
  // pre-transaction lookup into reporting the order as still DRAFT, as it
  // would have looked before the first fulfill actually landed, and confirm
  // the in-transaction updateMany guard still catches it against the real
  // current row rather than trusting that stale snapshot.
  it("cannot fulfill an order twice even when the pre-check read a stale snapshot", async () => {
    const token = await signUpAndGetToken("owner4b@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 2);

    const firstFulfill = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(firstFulfill.status).toBe(200);

    const staleSalesOrder = { ...firstFulfill.body, status: "DRAFT" };
    delete staleSalesOrder.lines;
    jest.spyOn(prisma.salesOrder, "findFirst").mockResolvedValueOnce(staleSalesOrder as never);

    const secondFulfill = await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(secondFulfill.status).toBe(400);

    (prisma.salesOrder.findFirst as jest.Mock).mockRestore();

    // Rejected, so nothing from the second request applied: still only the
    // first fulfillment's single SALE movement and the stock it actually
    // moved, not a second decrement on top of it.
    const inventory = await request(app)
      .get(`/api/inventory?locationId=${locationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(8);

    const movements = await request(app)
      .get(`/api/stock-movements?productId=${productId}&type=SALE`)
      .set("Authorization", `Bearer ${token}`);
    expect(movements.body.total).toBe(1);
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

  it("adds, edits, and removes lines on a draft sales order", async () => {
    const token = await signUpAndGetToken("owner6@shop.test", "The Shop");
    const { customerId, productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 2, customerId);

    const secondProduct = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-2", name: "Gadget" });

    const added = await request(app)
      .post(`/api/sales-orders/${so.body.id}/lines`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: secondProduct.body.id, quantity: 1, unitPriceCents: 999 });
    expect(added.status).toBe(201);
    expect(added.body.lines).toHaveLength(2);
    const newLine = added.body.lines.find((l: { productId: string }) => l.productId === secondProduct.body.id);

    const edited = await request(app)
      .patch(`/api/sales-orders/${so.body.id}/lines/${newLine.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 3 });
    expect(edited.status).toBe(200);
    const editedLine = edited.body.lines.find((l: { id: string }) => l.id === newLine.id);
    expect(editedLine.quantity).toBe(3);
    expect(editedLine.unitPriceCents).toBe(999);

    const removed = await request(app)
      .delete(`/api/sales-orders/${so.body.id}/lines/${newLine.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.lines).toHaveLength(1);
  });

  it("rejects removing a sales order's last remaining line", async () => {
    const token = await signUpAndGetToken("owner7@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 1);
    const onlyLineId = so.body.lines[0].id;

    const res = await request(app)
      .delete(`/api/sales-orders/${so.body.id}/lines/${onlyLineId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a sales order that doesn't exist", async () => {
    const token = await signUpAndGetToken("owner9@shop.test", "The Shop");

    const res = await request(app)
      .get("/api/sales-orders/does-not-exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a customerId from another organization, on create and on PATCH", async () => {
    const tokenA = await signUpAndGetToken("owner10a@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("owner10b@shop.test", "Shop B");
    const { productId, locationId } = await setUp(tokenA);
    const { customerId: customerIdB } = await setUp(tokenB);

    const createRes = await createDraftSo(tokenA, locationId, productId, 1, customerIdB);
    expect(createRes.status).toBe(400);

    const so = await createDraftSo(tokenA, locationId, productId, 1);
    const patchRes = await request(app)
      .patch(`/api/sales-orders/${so.body.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ customerId: customerIdB });
    expect(patchRes.status).toBe(400);
  });

  it("returns 404 editing or removing a line that doesn't exist", async () => {
    const token = await signUpAndGetToken("owner11@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 1);

    const edit = await request(app)
      .patch(`/api/sales-orders/${so.body.id}/lines/does-not-exist`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 2 });
    expect(edit.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/sales-orders/${so.body.id}/lines/does-not-exist`)
      .set("Authorization", `Bearer ${token}`);
    expect(remove.status).toBe(404);
  });

  it("returns 404 cancelling a sales order that doesn't exist", async () => {
    const token = await signUpAndGetToken("owner12@shop.test", "The Shop");

    const res = await request(app)
      .post("/api/sales-orders/does-not-exist/cancel")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("blocks line edits once the sales order is no longer a draft", async () => {
    const token = await signUpAndGetToken("owner8@shop.test", "The Shop");
    const { productId, locationId } = await setUp(token);
    const so = await createDraftSo(token, locationId, productId, 1);
    await request(app)
      .post(`/api/sales-orders/${so.body.id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/sales-orders/${so.body.id}/lines`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, quantity: 1, unitPriceCents: 999 });
    expect(res.status).toBe(400);
  });
});
