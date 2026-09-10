import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

async function setup() {
  const signup = await request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    email: "owner@shop.test",
    password: "hunter22222",
  });
  const auth = { Authorization: `Bearer ${signup.body.accessToken}` };

  const product = await request(app)
    .post("/api/products")
    .set(auth)
    .send({ sku: "WIDGET-1", name: "Widget", priceCents: 1999 });

  return { auth, productId: product.body.id as string };
}

// DELETE /api/products/:id has always been a soft delete — the SKU is
// referenced by movements and order lines — but until now nothing could
// read or undo that state, so an accidental archive was unrecoverable and
// left its SKU permanently taken.
describe("Product archiving", () => {
  it("hides an archived product from the default list", async () => {
    const { auth, productId } = await setup();

    const archived = await request(app).delete(`/api/products/${productId}`).set(auth);
    expect(archived.status).toBe(204);

    const list = await request(app).get("/api/products").set(auth);
    expect(list.body.total).toBe(0);
  });

  it("lists archived products with status=archived", async () => {
    const { auth, productId } = await setup();
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const list = await request(app).get("/api/products").query({ status: "archived" }).set(auth);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].sku).toBe("WIDGET-1");
    expect(list.body.items[0].isActive).toBe(false);
  });

  it("lists both states with status=all", async () => {
    const { auth, productId } = await setup();
    await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-2", name: "Other Widget", priceCents: 500 });
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const all = await request(app).get("/api/products").query({ status: "all" }).set(auth);
    expect(all.body.total).toBe(2);
  });

  it("rejects an unknown status value", async () => {
    const { auth } = await setup();
    const res = await request(app).get("/api/products").query({ status: "deleted" }).set(auth);
    expect(res.status).toBe(400);
  });

  it("restores an archived product back into the catalogue", async () => {
    const { auth, productId } = await setup();
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const restored = await request(app).post(`/api/products/${productId}/restore`).set(auth);
    expect(restored.status).toBe(200);
    expect(restored.body.isActive).toBe(true);

    const list = await request(app).get("/api/products").set(auth);
    expect(list.body.total).toBe(1);
  });

  it("409s when restoring a product that is not archived", async () => {
    const { auth, productId } = await setup();

    const res = await request(app).post(`/api/products/${productId}/restore`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not archived/i);
  });

  it("409s when archiving a product twice", async () => {
    const { auth, productId } = await setup();
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app).delete(`/api/products/${productId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already archived/i);
  });

  it("404s on a product belonging to another organization", async () => {
    const { productId } = await setup();
    const other = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other Owner",
      email: "other@shop.test",
      password: "hunter22222",
    });
    const otherAuth = { Authorization: `Bearer ${other.body.accessToken}` };

    const res = await request(app).post(`/api/products/${productId}/restore`).set(otherAuth);
    expect(res.status).toBe(404);
  });

  // Receiving against an open PO for an archived product would post stock
  // movements that silently resurrect an SKU no list shows.
  it("blocks archiving a product that is on an open purchase order", async () => {
    const { auth, productId } = await setup();

    const supplier = await request(app).post("/api/suppliers").set(auth).send({ name: "Acme" });
    const po = await request(app)
      .post("/api/purchase-orders")
      .set(auth)
      .send({
        supplierId: supplier.body.id,
        lines: [{ productId, quantityOrdered: 10, unitCostCents: 500 }],
      });
    expect(po.status).toBe(201);

    const res = await request(app).delete(`/api/products/${productId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/open purchase or sales order/i);
  });

  it("allows archiving once the purchase order is finished", async () => {
    const { auth, productId } = await setup();

    const supplier = await request(app).post("/api/suppliers").set(auth).send({ name: "Acme" });
    const po = await request(app)
      .post("/api/purchase-orders")
      .set(auth)
      .send({
        supplierId: supplier.body.id,
        lines: [{ productId, quantityOrdered: 10, unitCostCents: 500 }],
      });
    await request(app).post(`/api/purchase-orders/${po.body.id}/cancel`).set(auth);

    const res = await request(app).delete(`/api/products/${productId}`).set(auth);
    expect(res.status).toBe(204);
  });

  it("blocks archiving a product that is on a draft sales order", async () => {
    const { auth, productId } = await setup();

    const locations = await request(app).get("/api/locations").set(auth);
    const so = await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({
        locationId: locations.body[0].id,
        lines: [{ productId, quantity: 2, unitPriceCents: 1999 }],
      });
    expect(so.status).toBe(201);

    const res = await request(app).delete(`/api/products/${productId}`).set(auth);
    expect(res.status).toBe(409);
  });
});

// The reverse direction from the block above: once a product IS archived,
// nothing stopped a *new* write from naming it anyway — a stock movement, a
// transfer, a fresh order or order line, a stocktake line. Same "stock
// quietly moves against an SKU no list shows" problem archiving exists to
// prevent, just reached the other way around.
describe("Archived products refused on new writes", () => {
  it("rejects a stock movement against an archived product", async () => {
    const { auth, productId } = await setup();
    const locations = await request(app).get("/api/locations").set(auth);
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId: locations.body[0].id, type: "RECEIVE", quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects a transfer of an archived product", async () => {
    const { auth, productId } = await setup();
    const locations = await request(app).get("/api/locations").set(auth);
    await request(app).post("/api/locations").set(auth).send({ name: "Second" });
    const refreshed = await request(app).get("/api/locations").set(auth);
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app)
      .post("/api/stock-movements/transfer")
      .set(auth)
      .send({
        productId,
        fromLocationId: locations.body[0].id,
        toLocationId: refreshed.body.find((l: { id: string }) => l.id !== locations.body[0].id).id,
        quantity: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects creating a purchase order for an archived product", async () => {
    const { auth, productId } = await setup();
    await request(app).delete(`/api/products/${productId}`).set(auth);
    const supplier = await request(app).post("/api/suppliers").set(auth).send({ name: "Acme" });

    const res = await request(app)
      .post("/api/purchase-orders")
      .set(auth)
      .send({
        supplierId: supplier.body.id,
        lines: [{ productId, quantityOrdered: 10, unitCostCents: 500 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects adding a line for an archived product to a draft purchase order", async () => {
    const { auth, productId } = await setup();
    const other = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-2", name: "Other", priceCents: 500 });
    const supplier = await request(app).post("/api/suppliers").set(auth).send({ name: "Acme" });
    const po = await request(app)
      .post("/api/purchase-orders")
      .set(auth)
      .send({
        supplierId: supplier.body.id,
        lines: [{ productId: other.body.id, quantityOrdered: 5, unitCostCents: 100 }],
      });
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app)
      .post(`/api/purchase-orders/${po.body.id}/lines`)
      .set(auth)
      .send({ productId, quantityOrdered: 5, unitCostCents: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects creating a sales order for an archived product", async () => {
    const { auth, productId } = await setup();
    const locations = await request(app).get("/api/locations").set(auth);
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({
        locationId: locations.body[0].id,
        lines: [{ productId, quantity: 2, unitPriceCents: 1999 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects adding a line for an archived product to a draft sales order", async () => {
    const { auth, productId } = await setup();
    const other = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-2", name: "Other", priceCents: 500 });
    const locations = await request(app).get("/api/locations").set(auth);
    const so = await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({
        locationId: locations.body[0].id,
        lines: [{ productId: other.body.id, quantity: 1, unitPriceCents: 500 }],
      });
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const res = await request(app)
      .post(`/api/sales-orders/${so.body.id}/lines`)
      .set(auth)
      .send({ productId, quantity: 1, unitPriceCents: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });

  it("rejects adding an archived product to an open stocktake", async () => {
    const { auth, productId } = await setup();
    const locations = await request(app).get("/api/locations").set(auth);
    await request(app).delete(`/api/products/${productId}`).set(auth);

    const stocktake = await request(app)
      .post("/api/stocktakes")
      .set(auth)
      .send({ locationId: locations.body[0].id, scope: "all-products" });
    expect(stocktake.status).toBe(201);

    const res = await request(app)
      .post(`/api/stocktakes/${stocktake.body.id}/lines`)
      .set(auth)
      .send({ productId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived product/i);
  });
});
