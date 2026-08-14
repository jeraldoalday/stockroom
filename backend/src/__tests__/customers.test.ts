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

describe("Customers API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/customers");
    expect(res.status).toBe(401);
  });

  it("creates and lists a customer", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Jane Regular", email: "jane@customer.test" });
    expect(create.status).toBe(201);

    const list = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe("Jane Regular");
  });

  it("searches customers by name", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");

    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Jane Regular" });
    await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bob Occasional" });

    const search = await request(app)
      .get("/api/customers?search=jane")
      .set("Authorization", `Bearer ${token}`);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].name).toBe("Jane Regular");
  });

  it("deletes a customer with no order history", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Jane Regular" });

    const del = await request(app)
      .delete(`/api/customers/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it("404s for a customer in another organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    const created = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Shop A Customer" });

    const res = await request(app)
      .get(`/api/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});
