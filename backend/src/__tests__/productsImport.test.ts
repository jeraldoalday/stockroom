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

describe("POST /api/products/import", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/products/import")
      .set("Content-Type", "text/csv")
      .send("sku,name\nSKU-1,Widget");
    expect(res.status).toBe(401);
  });

  it("creates new products from a CSV file", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");
    const csv = [
      "sku,name,category,cost,price,reorderPoint,reorderQty",
      "SKU-1,Blue Widget,Widgets,5.00,12.99,10,50",
      "SKU-2,Red Widget,Widgets,4.50,11.99,5,25",
    ].join("\n");

    const res = await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 2, updated: 0, errors: [] });

    const list = await request(app).get("/api/products").set("Authorization", `Bearer ${token}`);
    expect(list.body.total).toBe(2);
    const widget = list.body.items.find((p: { sku: string }) => p.sku === "SKU-1");
    expect(widget.costCents).toBe(500);
    expect(widget.priceCents).toBe(1299);
    expect(widget.reorderPoint).toBe(10);
    expect(widget.categoryId).toBeTruthy();

    const categories = await request(app).get("/api/categories").set("Authorization", `Bearer ${token}`);
    expect(categories.body.some((c: { name: string }) => c.name === "Widgets")).toBe(true);
  });

  it("updates an existing product by SKU instead of duplicating it", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "Shop 2");
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${token}`)
      .send({ sku: "SKU-1", name: "Old Name", priceCents: 100 });

    const res = await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/csv")
      .send("sku,name,price\nSKU-1,New Name,19.99");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 0, updated: 1, errors: [] });

    const list = await request(app).get("/api/products").set("Authorization", `Bearer ${token}`);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe("New Name");
    expect(list.body.items[0].priceCents).toBe(1999);
  });

  it("collects per-row errors without aborting the whole import", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "Shop 3");
    const csv = ["sku,name,cost", ",Missing SKU,5.00", "SKU-OK,Fine Widget,not-a-number"].join("\n");

    const res = await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0].row).toBe(2);
    expect(res.body.errors[1].row).toBe(3);
  });

  // Regression test: a row with a cost too large for the destination `Int`
  // column used to reach `prisma.product.create`/`.update` unchecked and
  // crash the whole request with a raw 500 (no `errors` body, and — worse —
  // rows processed before the bad one had already committed), breaking the
  // "rows are processed independently" contract described above the route.
  // It must now be recorded as a per-row error like any other bad cell,
  // leaving every other row unaffected.
  it("records an oversized cost as a per-row error instead of crashing the import", async () => {
    const token = await signUpAndGetToken("owner-overflow@shop.test", "Overflow Shop");
    const csv = [
      "sku,name,cost",
      "SKU-BEFORE,Fine Before,5.00",
      "SKU-OVERFLOW,Too Expensive,99999999999",
      "SKU-AFTER,Fine After,6.00",
    ].join("\n");

    const res = await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/csv")
      .send(csv);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.errors).toEqual([{ row: 3, message: "cost is too large" }]);

    const list = await request(app).get("/api/products").set("Authorization", `Bearer ${token}`);
    expect(list.body.total).toBe(2);
  });

  it("never lets one organization's import affect another's products (tenant isolation)", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("Content-Type", "text/csv")
      .send("sku,name\nSKU-1,Shop A Widget");

    const listB = await request(app).get("/api/products").set("Authorization", `Bearer ${tokenB}`);
    expect(listB.body.total).toBe(0);
  });

  it("rejects an empty body", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "Shop 4");
    const res = await request(app)
      .post("/api/products/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "text/csv")
      .send("");
    expect(res.status).toBe(400);
  });
});
