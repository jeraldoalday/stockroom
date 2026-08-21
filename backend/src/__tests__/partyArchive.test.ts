import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

async function signUp() {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    email: "owner@shop.test",
    password: "hunter22222",
  });
  return { Authorization: `Bearer ${res.body.accessToken}` };
}

// Suppliers and Customers behave identically here, so the cases are shared
// rather than written twice — a difference between them would be a bug, and
// duplicating the tests is how such a difference goes unnoticed.
const PARTIES = [
  { path: "suppliers", label: "supplier", name: "Acme Supplies" },
  { path: "customers", label: "customer", name: "Northside Café" },
] as const;

describe.each(PARTIES)("Archiving a $label", ({ path, name }) => {
  async function create(auth: Record<string, string>) {
    const res = await request(app).post(`/api/${path}`).set(auth).send({ name });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("hides it from the default list", async () => {
    const auth = await signUp();
    const id = await create(auth);

    expect((await request(app).delete(`/api/${path}/${id}`).set(auth)).status).toBe(204);

    const list = await request(app).get(`/api/${path}`).set(auth);
    expect(list.body.total).toBe(0);
  });

  it("lists it under status=archived", async () => {
    const auth = await signUp();
    const id = await create(auth);
    await request(app).delete(`/api/${path}/${id}`).set(auth);

    const list = await request(app).get(`/api/${path}`).query({ status: "archived" }).set(auth);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].isActive).toBe(false);
  });

  it("lists both under status=all", async () => {
    const auth = await signUp();
    const id = await create(auth);
    await request(app).post(`/api/${path}`).set(auth).send({ name: "Still Trading" });
    await request(app).delete(`/api/${path}/${id}`).set(auth);

    const all = await request(app).get(`/api/${path}`).query({ status: "all" }).set(auth);
    expect(all.body.total).toBe(2);
  });

  it("rejects an unknown status", async () => {
    const auth = await signUp();
    const res = await request(app).get(`/api/${path}`).query({ status: "deleted" }).set(auth);
    expect(res.status).toBe(400);
  });

  it("restores it", async () => {
    const auth = await signUp();
    const id = await create(auth);
    await request(app).delete(`/api/${path}/${id}`).set(auth);

    const restored = await request(app).post(`/api/${path}/${id}/restore`).set(auth);
    expect(restored.status).toBe(200);
    expect(restored.body.isActive).toBe(true);
    expect((await request(app).get(`/api/${path}`).set(auth)).body.total).toBe(1);
  });

  it("409s on archiving twice", async () => {
    const auth = await signUp();
    const id = await create(auth);
    await request(app).delete(`/api/${path}/${id}`).set(auth);

    const again = await request(app).delete(`/api/${path}/${id}`).set(auth);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already archived/i);
  });

  it("409s on restoring one that is not archived", async () => {
    const auth = await signUp();
    const id = await create(auth);

    const res = await request(app).post(`/api/${path}/${id}/restore`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not archived/i);
  });

  it("404s across a tenant boundary", async () => {
    const auth = await signUp();
    const id = await create(auth);

    const other = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other",
      email: "other@shop.test",
      password: "hunter22222",
    });
    const res = await request(app)
      .post(`/api/${path}/${id}/restore`)
      .set({ Authorization: `Bearer ${other.body.accessToken}` });
    expect(res.status).toBe(404);
  });

  it("still finds it by id after archiving, so order history can resolve it", async () => {
    const auth = await signUp();
    const id = await create(auth);
    await request(app).delete(`/api/${path}/${id}`).set(auth);

    const detail = await request(app).get(`/api/${path}/${id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe(name);
  });
});

// The old behaviour refused outright once any order existed, which made the
// records you most want out of a dropdown — the ones you've stopped trading
// with — the only ones you couldn't remove.
describe("Archiving works despite order history", () => {
  it("archives a supplier that has a purchase order", async () => {
    const auth = await signUp();
    const supplier = await request(app).post("/api/suppliers").set(auth).send({ name: "Acme" });
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "W-1", name: "Widget", priceCents: 100 });
    await request(app)
      .post("/api/purchase-orders")
      .set(auth)
      .send({
        supplierId: supplier.body.id,
        lines: [{ productId: product.body.id, quantityOrdered: 5, unitCostCents: 50 }],
      });

    const res = await request(app).delete(`/api/suppliers/${supplier.body.id}`).set(auth);
    expect(res.status).toBe(204);
  });

  it("archives a customer that has a sales order", async () => {
    const auth = await signUp();
    const customer = await request(app).post("/api/customers").set(auth).send({ name: "Café" });
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "W-2", name: "Widget", priceCents: 100 });
    const locations = await request(app).get("/api/locations").set(auth);
    await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({
        customerId: customer.body.id,
        locationId: locations.body[0].id,
        lines: [{ productId: product.body.id, quantity: 1, unitPriceCents: 100 }],
      });

    const res = await request(app).delete(`/api/customers/${customer.body.id}`).set(auth);
    expect(res.status).toBe(204);
  });
});
