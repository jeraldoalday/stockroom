import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { inviteAndSetPassword } from "./testUtils/invite";
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

  const locations = await request(app).get("/api/locations").set(auth);
  const locationId = locations.body[0].id as string;

  const product = await request(app)
    .post("/api/products")
    .set(auth)
    .send({ sku: "WIDGET-1", name: "Widget", priceCents: 1999, costCents: 900 });

  await request(app)
    .post("/api/stock-movements")
    .set(auth)
    .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity: 50 });

  return { auth, locationId, productId: product.body.id as string };
}

// Revenue used to be recoverable only by joining a movement back to a sales
// order line, so a counter sale — a SALE posted straight to
// /stock-movements, which is the common case for a shop — contributed units
// to the trend report and zero revenue, understating takings without
// saying so.
describe("SALE movements carry the price charged", () => {
  it("records unitPriceCents on a direct sale", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 3, unitPriceCents: 1799 });

    expect(res.status).toBe(201);
    expect(res.body.unitPriceCents).toBe(1799);
    expect(res.body.quantity).toBe(-3);
  });

  it("still accepts a sale with no price, for callers that predate the field", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.unitPriceCents ?? null).toBeNull();
  });

  it("allows a price of zero, which is a giveaway rather than a missing price", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 1, unitPriceCents: 0 });

    expect(res.status).toBe(201);
    expect(res.body.unitPriceCents).toBe(0);
  });

  it("rejects a negative price", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 1, unitPriceCents: -5 });

    expect(res.status).toBe(400);
  });

  // A "unit price" on a receipt or a shrinkage write-off has no meaning, and
  // storing one would put a number in the audit trail that the reports would
  // then have to decide whether to believe.
  it("rejects a price on a RECEIVE", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "RECEIVE", quantity: 5, unitPriceCents: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only applies to a sale/i);
  });

  it("rejects a price on an ADJUSTMENT", async () => {
    const { auth, locationId, productId } = await setup();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({
        productId,
        locationId,
        type: "ADJUSTMENT",
        quantity: -2,
        reason: "Damaged",
        unitPriceCents: 500,
      });

    expect(res.status).toBe(400);
  });

  it("copies the line price onto the movement when a sales order is fulfilled", async () => {
    const { auth, locationId, productId } = await setup();

    const order = await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({ locationId, lines: [{ productId, quantity: 4, unitPriceCents: 1899 }] });
    expect(order.status).toBe(201);

    const fulfilled = await request(app)
      .post(`/api/sales-orders/${order.body.id}/fulfill`)
      .set(auth);
    expect(fulfilled.status).toBe(200);

    const movements = await request(app)
      .get("/api/stock-movements")
      .query({ type: "SALE" })
      .set(auth);

    expect(movements.body.items).toHaveLength(1);
    expect(movements.body.items[0].unitPriceCents).toBe(1899);
    expect(movements.body.items[0].quantity).toBe(-4);
  });

  it("shows the price in the movement list", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 2, unitPriceCents: 1250 });

    const list = await request(app).get("/api/stock-movements").query({ type: "SALE" }).set(auth);
    expect(list.body.items[0].unitPriceCents).toBe(1250);
  });

  // Price is not cost: STAFF are allowed to see what something sold for,
  // and only margin data is withheld from them (PRD §4).
  it("does not hide the sale price from STAFF", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 1, unitPriceCents: 1999 });

    const ownerToken = auth.Authorization.replace("Bearer ", "");
    await inviteAndSetPassword(app, ownerToken, { email: "clerk@shop.test", password: "hunter22222" });
    const staffLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "clerk@shop.test", password: "hunter22222" });

    const list = await request(app)
      .get("/api/stock-movements")
      .query({ type: "SALE" })
      .set({ Authorization: `Bearer ${staffLogin.body.accessToken}` });

    expect(list.body.items[0].unitPriceCents).toBe(1999);
    expect(list.body.items[0].product?.costCents).toBeUndefined();
  });
});
