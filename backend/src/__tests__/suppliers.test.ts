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

describe("Suppliers API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/suppliers");
    expect(res.status).toBe(401);
  });

  it("creates and lists a supplier", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Distributors", email: "sales@acme.test", phone: "555-0100" });
    expect(create.status).toBe(201);

    const list = await request(app)
      .get("/api/suppliers")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe("Acme Distributors");
  });

  it("updates a supplier", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Distributors" });

    const patch = await request(app)
      .patch(`/api/suppliers/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ phone: "555-9999" });
    expect(patch.status).toBe(200);
    expect(patch.body.phone).toBe("555-9999");
  });

  it("deletes a supplier with no order history", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");

    const create = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Distributors" });

    const del = await request(app)
      .delete(`/api/suppliers/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it("rejects an invalid email", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");

    const res = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme", email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("never returns another organization's suppliers (tenant isolation)", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Shop A Supplier" });

    const listAsB = await request(app)
      .get("/api/suppliers")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(listAsB.body.total).toBe(0);
  });
});
