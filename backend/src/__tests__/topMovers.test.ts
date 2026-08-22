import request from "supertest";

jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

interface Fixture {
  auth: { Authorization: string };
  locationId: string;
  productIds: Record<string, string>;
}

async function setup(skus: string[]): Promise<Fixture> {
  const signup = await request(app).post("/api/auth/signup").send({
    organizationName: "The Shop",
    name: "Owner",
    email: "owner@shop.test",
    password: "hunter22222",
  });
  const auth = { Authorization: `Bearer ${signup.body.accessToken}` };

  const locations = await request(app).get("/api/locations").set(auth);
  const locationId = locations.body[0].id as string;

  const productIds: Record<string, string> = {};
  for (const sku of skus) {
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku, name: `Product ${sku}`, priceCents: 1000 });
    productIds[sku] = product.body.id;

    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity: 500 });
  }

  return { auth, locationId, productIds };
}

async function sell(fixture: Fixture, sku: string, quantity: number) {
  await request(app).post("/api/stock-movements").set(fixture.auth).send({
    productId: fixture.productIds[sku],
    locationId: fixture.locationId,
    type: "SALE",
    quantity,
  });
}

// Backdates a movement that has already been posted, which is the only way
// to test the time window without making the suite wait a day.
async function backdate(sku: string, fixture: Fixture, daysAgo: number) {
  const movements = await (prisma as unknown as {
    stockMovement: { findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]> };
  }).stockMovement.findMany({ where: { productId: fixture.productIds[sku], type: "SALE" } });

  for (const movement of movements) {
    await (prisma as unknown as {
      stockMovement: { update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown> };
    }).stockMovement.update({
      where: { id: movement.id },
      data: { createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) },
    });
  }
}

// Writes a SALE movement straight to the store, signed as given. The API
// deliberately refuses to post a sale with a negative quantity, so this is
// the only way to produce the reversal row the ranking has to cope with.
async function insertRawSale(fixture: Fixture, sku: string, signedQuantity: number) {
  await (prisma as unknown as {
    stockMovement: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  }).stockMovement.create({
    data: {
      organizationId: (await currentOrganizationId(fixture)),
      productId: fixture.productIds[sku],
      locationId: fixture.locationId,
      type: "SALE",
      quantity: signedQuantity,
      actorId: "reversal",
      createdAt: new Date(),
    },
  });
}

// The org id isn't handed back by any of the fixture calls, so it is read
// off a movement the fixture already created.
async function currentOrganizationId(fixture: Fixture): Promise<string> {
  const [movement] = await (prisma as unknown as {
    stockMovement: { findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]> };
  }).stockMovement.findMany({ where: { locationId: fixture.locationId } });
  return movement.organizationId as string;
}

describe("Dashboard top movers", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dashboard/top-movers");
    expect(res.status).toBe(401);
  });

  it("ranks products by units sold, highest first", async () => {
    const fixture = await setup(["SLOW", "FAST", "MID"]);
    await sell(fixture, "SLOW", 3);
    await sell(fixture, "FAST", 40);
    await sell(fixture, "MID", 12);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);

    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["FAST", "MID", "SLOW"]);
    expect(res.body.items[0].unitsSold).toBe(40);
  });

  it("sums repeated sales of the same product", async () => {
    const fixture = await setup(["WIDGET"]);
    await sell(fixture, "WIDGET", 4);
    await sell(fixture, "WIDGET", 6);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items[0].unitsSold).toBe(10);
  });

  it("values units at the product's current list price", async () => {
    const fixture = await setup(["WIDGET"]);
    await sell(fixture, "WIDGET", 7);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items[0].estimatedValueCents).toBe(7 * 1000);
  });

  it("ignores receipts, transfers and adjustments", async () => {
    const fixture = await setup(["WIDGET"]);
    await request(app).post("/api/stock-movements").set(fixture.auth).send({
      productId: fixture.productIds.WIDGET,
      locationId: fixture.locationId,
      type: "ADJUSTMENT",
      quantity: -5,
      reason: "Damaged",
    });

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items).toHaveLength(0);
  });

  it("honours the limit parameter", async () => {
    const fixture = await setup(["A", "B", "C", "D"]);
    await sell(fixture, "A", 4);
    await sell(fixture, "B", 3);
    await sell(fixture, "C", 2);
    await sell(fixture, "D", 1);

    const res = await request(app).get("/api/dashboard/top-movers").query({ limit: 2 }).set(fixture.auth);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["A", "B"]);
  });

  it("only counts sales inside the requested window", async () => {
    const fixture = await setup(["RECENT", "STALE"]);
    await sell(fixture, "RECENT", 5);
    await sell(fixture, "STALE", 50);
    await backdate("STALE", fixture, 45);

    const res = await request(app).get("/api/dashboard/top-movers").query({ days: 30 }).set(fixture.auth);

    expect(res.body.days).toBe(30);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["RECENT"]);
  });

  it("includes an older sale once the window is widened to cover it", async () => {
    const fixture = await setup(["STALE"]);
    await sell(fixture, "STALE", 50);
    await backdate("STALE", fixture, 45);

    const res = await request(app).get("/api/dashboard/top-movers").query({ days: 60 }).set(fixture.auth);
    expect(res.body.items).toHaveLength(1);
  });

  it("rejects an out-of-range window", async () => {
    const fixture = await setup([]);
    const res = await request(app).get("/api/dashboard/top-movers").query({ days: 0 }).set(fixture.auth);
    expect(res.status).toBe(400);
  });

  it("returns an empty list for an org with no sales", async () => {
    const fixture = await setup(["WIDGET"]);
    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  // Archived products still sold while they were live, so they belong in a
  // historical ranking — flagged, not hidden, so the owner isn't left
  // wondering why last month's best seller vanished from the report.
  it("still reports a product that has since been archived", async () => {
    const fixture = await setup(["RETIRED"]);
    await sell(fixture, "RETIRED", 9);
    await request(app).delete(`/api/products/${fixture.productIds.RETIRED}`).set(fixture.auth);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].isActive).toBe(false);
  });

  // The ranking is produced by a GROUP BY in the database, and a database
  // is free to return equal groups in any order. Two products that sold the
  // same number of units must still come back in the same order every time,
  // or the dashboard shuffles on refresh for no visible reason.
  it("settles a tie on units sold by name", async () => {
    const fixture = await setup(["ZZZ", "AAA"]);
    await sell(fixture, "ZZZ", 7);
    await sell(fixture, "AAA", 7);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["AAA", "ZZZ"]);
  });

  // A SALE row with a positive quantity is a reversal — the API won't
  // create one (POST /stock-movements rejects a negative sale outright),
  // but a correction applied by hand or by a future returns feature will
  // net a product's sales back to zero. Listing it as a top mover with 0
  // sold is noise, and a negative count would be worse, so the ranking
  // drops it. Written straight to the store because no route will do it.
  it("omits a product whose sales net out to nothing", async () => {
    const fixture = await setup(["NET-0", "REAL"]);
    await sell(fixture, "NET-0", 4);
    await insertRawSale(fixture, "NET-0", 4);
    await sell(fixture, "REAL", 1);

    const res = await request(app).get("/api/dashboard/top-movers").set(fixture.auth);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["REAL"]);
  });

  // The limit is applied to the ranked groups before the products are
  // looked up, so this also pins that the truncation happens on the right
  // side of that lookup — take the top 2 of 4 and you must get the two
  // biggest, not the first two the store happened to return.
  it("takes the biggest sellers, not the first ones found", async () => {
    const fixture = await setup(["A", "B", "C", "D"]);
    await sell(fixture, "A", 1);
    await sell(fixture, "B", 40);
    await sell(fixture, "C", 2);
    await sell(fixture, "D", 30);

    const res = await request(app).get("/api/dashboard/top-movers?limit=2").set(fixture.auth);
    expect(res.body.items.map((item: { sku: string }) => item.sku)).toEqual(["B", "D"]);
  });

  it("does not leak another organization's sales", async () => {
    const fixture = await setup(["WIDGET"]);
    await sell(fixture, "WIDGET", 11);

    const other = await request(app).post("/api/auth/signup").send({
      organizationName: "Other Shop",
      name: "Other Owner",
      email: "other@shop.test",
      password: "hunter22222",
    });

    const res = await request(app)
      .get("/api/dashboard/top-movers")
      .set({ Authorization: `Bearer ${other.body.accessToken}` });
    expect(res.body.items).toEqual([]);
  });
});
