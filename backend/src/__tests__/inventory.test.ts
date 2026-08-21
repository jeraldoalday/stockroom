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

describe("Inventory API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/inventory");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a brand-new organization", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const res = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it("rejects a locationId that belongs to a different organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    const locationsA = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenA}`);

    const res = await request(app)
      .get(`/api/inventory?locationId=${locationsA.body[0].id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(400);
  });

  it("rejects a productId that belongs to a different organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA2@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB2@shop.test", "Shop B");

    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sku: "SKU-1", name: "Widget" });

    const res = await request(app)
      .get(`/api/inventory?productId=${product.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(400);
  });
});
