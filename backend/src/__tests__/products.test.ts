import request from "supertest";

jest.mock("../lib/prisma");

import { __resetPrismaMock } from "../lib/__mocks__/prisma";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  __resetPrismaMock();
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

describe("Products API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });

  it("creates and lists a product for the authenticated org", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-1", name: "Blue Widget", priceCents: 1999, costCents: 900 });
    expect(create.status).toBe(201);

    const list = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].sku).toBe("SKU-1");
  });

  it("rejects a duplicate SKU within the same organization", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop 2");

    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-DUP", name: "Widget" });

    const second = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-DUP", name: "A Different Widget" });

    expect(second.status).toBe(409);
  });

  it("never returns another organization's products (tenant isolation)", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sku: "SKU-A", name: "Shop A Widget" });

    const listAsB = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(listAsB.status).toBe(200);
    expect(listAsB.body.total).toBe(0);
  });

  it("allows the same SKU to be reused across different organizations", async () => {
    const tokenA = await signUpAndGetToken("ownerC@shop.test", "Shop C");
    const tokenB = await signUpAndGetToken("ownerD@shop.test", "Shop D");

    const createA = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sku: "SHARED-SKU", name: "Shop C Widget" });
    const createB = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ sku: "SHARED-SKU", name: "Shop D Widget" });

    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);
  });

  it("rejects a categoryId that belongs to a different organization", async () => {
    const tokenA = await signUpAndGetToken("ownerE@shop.test", "Shop E");
    const tokenB = await signUpAndGetToken("ownerF@shop.test", "Shop F");

    const category = await request(app)
      .post("/api/categories")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Beverages" });

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ sku: "SKU-X", name: "Soda", categoryId: category.body.id });

    expect(res.status).toBe(400);
  });

  it("soft-deletes a product instead of removing it outright", async () => {
    const token = await signUpAndGetToken("ownerG@shop.test", "Shop G");

    const created = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-DEL", name: "To Delete" });

    const del = await request(app)
      .delete(`/api/products/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.total).toBe(0);
  });
});
