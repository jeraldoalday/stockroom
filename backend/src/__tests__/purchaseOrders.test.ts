import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { inviteAndSetPassword } from "./testUtils/invite";
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

  // quantityOrdered/unitCostCents back a Postgres `Int` column; without an
  // explicit upper bound an oversized value would pass Zod's `.int()` check
  // and crash the write at the database instead of failing validation.
  it("rejects a quantityOrdered too large to fit the underlying Int column", async () => {
    const token = await signUpAndGetToken("owner-overflow@shop.test", "Overflow Shop");
    const { supplierId, productId } = await setUp(token);

    const res = await createDraftPo(token, supplierId, productId, 99999999999);
    expect(res.status).toBe(400);
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

  it("rejects a receiving request that names the same line twice", async () => {
    const token = await signUpAndGetToken("owner4b@shop.test", "The Shop");
    const { supplierId, productId, locationId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId, 10);
    await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/receive`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        locationId,
        lines: [
          { lineId: po.body.lines[0].id, quantity: 6 },
          { lineId: po.body.lines[0].id, quantity: 6 },
        ],
      });
    expect(res.status).toBe(400);

    // Confirm the rejected request didn't partially apply: no stock moved
    // and the line's received quantity is untouched.
    const inventory = await request(app)
      .get(`/api/inventory?locationId=${locationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items).toHaveLength(0);

    const detail = await request(app)
      .get(`/api/purchase-orders/${po.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.body.lines[0].quantityReceived).toBe(0);
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

  it("adds, edits, and removes lines on a draft purchase order", async () => {
    const token = await signUpAndGetToken("owner7@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);

    const secondProduct = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-2", name: "Gadget" });

    const added = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/lines`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: secondProduct.body.id, quantityOrdered: 5, unitCostCents: 250 });
    expect(added.status).toBe(201);
    expect(added.body.lines).toHaveLength(2);
    const newLine = added.body.lines.find((l: { productId: string }) => l.productId === secondProduct.body.id);

    const edited = await request(app)
      .patch(`/api/purchase-orders/${po.body.id}/lines/${newLine.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantityOrdered: 9 });
    expect(edited.status).toBe(200);
    const editedLine = edited.body.lines.find((l: { id: string }) => l.id === newLine.id);
    expect(editedLine.quantityOrdered).toBe(9);
    expect(editedLine.unitCostCents).toBe(250);

    const removed = await request(app)
      .delete(`/api/purchase-orders/${po.body.id}/lines/${newLine.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.lines).toHaveLength(1);
  });

  it("rejects removing a purchase order's last remaining line", async () => {
    const token = await signUpAndGetToken("owner8@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);
    const onlyLineId = po.body.lines[0].id;

    const res = await request(app)
      .delete(`/api/purchase-orders/${po.body.id}/lines/${onlyLineId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("blocks line edits once the purchase order is no longer a draft", async () => {
    const token = await signUpAndGetToken("owner9@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);
    await request(app)
      .post(`/api/purchase-orders/${po.body.id}/order`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/lines`)
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, quantityOrdered: 1, unitCostCents: 100 });
    expect(res.status).toBe(400);
  });

  it("keeps line management Owner-only, like the rest of purchase-order management", async () => {
    const token = await signUpAndGetToken("owner10@shop.test", "The Shop");
    const { supplierId, productId } = await setUp(token);
    const po = await createDraftPo(token, supplierId, productId);
    await inviteAndSetPassword(app, token, { email: "clerk10@shop.test", password: "hunter22222" });
    const login = await request(app).post("/api/auth/login").send({ email: "clerk10@shop.test", password: "hunter22222" });
    const staffToken = login.body.accessToken as string;

    const res = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/lines`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ productId, quantityOrdered: 1, unitCostCents: 100 });
    expect(res.status).toBe(403);
  });
});
