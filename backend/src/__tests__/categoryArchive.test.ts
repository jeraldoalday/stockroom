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

async function createCategory(auth: Record<string, string>, name = "Beverages") {
  const res = await request(app).post("/api/categories").set(auth).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("Archiving a category", () => {
  it("hides it from the default list", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);

    expect((await request(app).delete(`/api/categories/${id}`).set(auth)).status).toBe(204);

    const list = await request(app).get("/api/categories").set(auth);
    expect(list.body).toEqual([]);
  });

  it("lists it under status=archived", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);
    await request(app).delete(`/api/categories/${id}`).set(auth);

    const list = await request(app).get("/api/categories").query({ status: "archived" }).set(auth);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].isActive).toBe(false);
  });

  it("lists both under status=all", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);
    await request(app).post("/api/categories").set(auth).send({ name: "Snacks" });
    await request(app).delete(`/api/categories/${id}`).set(auth);

    const all = await request(app).get("/api/categories").query({ status: "all" }).set(auth);
    expect(all.body).toHaveLength(2);
  });

  it("rejects an unknown status", async () => {
    const auth = await signUp();
    const res = await request(app).get("/api/categories").query({ status: "deleted" }).set(auth);
    expect(res.status).toBe(400);
  });

  it("restores it", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);
    await request(app).delete(`/api/categories/${id}`).set(auth);

    const restored = await request(app).post(`/api/categories/${id}/restore`).set(auth);
    expect(restored.status).toBe(200);
    expect(restored.body.isActive).toBe(true);
    expect((await request(app).get("/api/categories").set(auth)).body).toHaveLength(1);
  });

  it("409s on archiving twice", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);
    await request(app).delete(`/api/categories/${id}`).set(auth);

    const again = await request(app).delete(`/api/categories/${id}`).set(auth);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already archived/i);
  });

  it("409s on restoring one that is not archived", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);

    const res = await request(app).post(`/api/categories/${id}/restore`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not archived/i);
  });

  it("404s across a tenant boundary", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);

    const other = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other",
      email: "other@shop.test",
      password: "hunter22222",
    });
    const res = await request(app)
      .post(`/api/categories/${id}/restore`)
      .set({ Authorization: `Bearer ${other.body.accessToken}` });
    expect(res.status).toBe(404);
  });

  it("does not clear a product's categoryId, unlike the old hard delete", async () => {
    const auth = await signUp();
    const id = await createCategory(auth);
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "W-1", name: "Widget", priceCents: 100, categoryId: id });
    expect(product.status).toBe(201);

    await request(app).delete(`/api/categories/${id}`).set(auth);

    const fetched = await request(app).get("/api/products").set(auth);
    const row = fetched.body.items.find((p: { id: string }) => p.id === product.body.id);
    expect(row.categoryId).toBe(id);
  });
});
