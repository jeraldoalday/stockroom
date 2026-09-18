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

// PATCH /:id previously skipped straight to `prisma.category.update`, so a
// rename onto an already-used name only ever hit the database's own
// `@@unique([organizationId, name])` index — surfacing as the generic
// P2002-mapped 409 in errorHandler.ts instead of this route's own message,
// unlike POST / (checked below) and unlike locations.routes.ts's PATCH,
// which already guards its own rename the same way.
describe("Renaming a category", () => {
  it("rejects a rename onto a name already used by another active category", async () => {
    const auth = await signUp();
    await createCategory(auth, "Beverages");
    const snacksId = await createCategory(auth, "Snacks");

    const res = await request(app).patch(`/api/categories/${snacksId}`).set(auth).send({ name: "Beverages" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("rejects a rename onto a name already used by an archived category, with a distinct message", async () => {
    const auth = await signUp();
    const beveragesId = await createCategory(auth, "Beverages");
    await request(app).delete(`/api/categories/${beveragesId}`).set(auth);
    const snacksId = await createCategory(auth, "Snacks");

    const res = await request(app).patch(`/api/categories/${snacksId}`).set(auth).send({ name: "Beverages" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("An archived category already uses this name — restore or rename it");
  });

  it("allows renaming a category to its own current name", async () => {
    const auth = await signUp();
    const id = await createCategory(auth, "Beverages");

    const res = await request(app).patch(`/api/categories/${id}`).set(auth).send({ name: "Beverages" });
    expect(res.status).toBe(200);
  });

  it("still allows an ordinary rename to an unused name", async () => {
    const auth = await signUp();
    const id = await createCategory(auth, "Beverages");

    const res = await request(app).patch(`/api/categories/${id}`).set(auth).send({ name: "Drinks" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Drinks");
  });

  // Every list/search filter on a name elsewhere already runs case-
  // insensitively; the duplicate-name guard here and on POST / used to
  // compare case-sensitively, so "Beverages" and "beverages" could coexist
  // as two categories indistinguishable in any picker that lists them.
  it("rejects a create that differs from an existing category only by case", async () => {
    const auth = await signUp();
    await createCategory(auth, "Beverages");

    const res = await request(app).post("/api/categories").set(auth).send({ name: "beverages" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("rejects a rename that differs from another category only by case", async () => {
    const auth = await signUp();
    await createCategory(auth, "Beverages");
    const snacksId = await createCategory(auth, "Snacks");

    const res = await request(app).patch(`/api/categories/${snacksId}`).set(auth).send({ name: "BEVERAGES" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("A category with this name already exists");
  });

  it("allows renaming a category to its own current name with different case", async () => {
    const auth = await signUp();
    const id = await createCategory(auth, "Beverages");

    const res = await request(app).patch(`/api/categories/${id}`).set(auth).send({ name: "beverages" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("beverages");
  });
});
