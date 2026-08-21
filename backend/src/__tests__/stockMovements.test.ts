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

async function setUpProductAndLocations(token: string) {
  const product = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-1", name: "Widget" });

  const locations = await request(app)
    .get("/api/locations")
    .set("Authorization", `Bearer ${token}`);
  const mainLocationId = locations.body[0].id;

  const secondLocation = await request(app)
    .post("/api/locations")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Warehouse" });

  return {
    productId: product.body.id as string,
    mainLocationId: mainLocationId as string,
    secondLocationId: secondLocation.body.id as string,
  };
}

describe("Stock movements API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/stock-movements").send({});
    expect(res.status).toBe(401);
  });

  it("RECEIVE increases quantity on hand at a location", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    const receive = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "RECEIVE", quantity: 20 });
    expect(receive.status).toBe(201);
    expect(receive.body.quantity).toBe(20);

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${mainLocationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(20);
  });

  it("SALE decreases quantity and blocks an over-sell", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "RECEIVE", quantity: 5 });

    const oversell = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "SALE", quantity: 10 });
    expect(oversell.status).toBe(400);

    const sale = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "SALE", quantity: 5 });
    expect(sale.status).toBe(201);
    expect(sale.body.quantity).toBe(-5);

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${mainLocationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(0);
  });

  it("ADJUSTMENT requires a reason and allows a signed delta", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    const noReason = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "ADJUSTMENT", quantity: 3 });
    expect(noReason.status).toBe(400);

    const up = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId,
        locationId: mainLocationId,
        type: "ADJUSTMENT",
        quantity: 8,
        reason: "Cycle count correction",
      });
    expect(up.status).toBe(201);

    const down = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId,
        locationId: mainLocationId,
        type: "ADJUSTMENT",
        quantity: -3,
        reason: "Damaged goods",
      });
    expect(down.status).toBe(201);

    const inventory = await request(app)
      .get(`/api/inventory?locationId=${mainLocationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(inventory.body.items[0].quantity).toBe(5);
  });

  it("an adjustment that would take stock negative is rejected", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    const res = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        productId,
        locationId: mainLocationId,
        type: "ADJUSTMENT",
        quantity: -1,
        reason: "Bad count",
      });
    expect(res.status).toBe(400);
  });

  it("transfers stock between two locations", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "The Shop");
    const { productId, mainLocationId, secondLocationId } = await setUpProductAndLocations(token);

    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "RECEIVE", quantity: 10 });

    const transfer = await request(app)
      .post("/api/stock-movements/transfer")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, fromLocationId: mainLocationId, toLocationId: secondLocationId, quantity: 4 });
    expect(transfer.status).toBe(201);
    expect(transfer.body.out.type).toBe("TRANSFER_OUT");
    expect(transfer.body.in.type).toBe("TRANSFER_IN");

    const mainInventory = await request(app)
      .get(`/api/inventory?locationId=${mainLocationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(mainInventory.body.items[0].quantity).toBe(6);

    const secondInventory = await request(app)
      .get(`/api/inventory?locationId=${secondLocationId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(secondInventory.body.items[0].quantity).toBe(4);
  });

  it("rejects a transfer to the same location", async () => {
    const token = await signUpAndGetToken("owner6@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    const res = await request(app)
      .post("/api/stock-movements/transfer")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, fromLocationId: mainLocationId, toLocationId: mainLocationId, quantity: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects a transfer that exceeds stock at the source location", async () => {
    const token = await signUpAndGetToken("owner7@shop.test", "The Shop");
    const { productId, mainLocationId, secondLocationId } = await setUpProductAndLocations(token);

    const res = await request(app)
      .post("/api/stock-movements/transfer")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, fromLocationId: mainLocationId, toLocationId: secondLocationId, quantity: 1 });
    expect(res.status).toBe(400);
  });

  it("lists movement history filtered by product, most recent first", async () => {
    const token = await signUpAndGetToken("owner8@shop.test", "The Shop");
    const { productId, mainLocationId } = await setUpProductAndLocations(token);

    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "RECEIVE", quantity: 10 });
    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId, locationId: mainLocationId, type: "SALE", quantity: 2 });

    const list = await request(app)
      .get(`/api/stock-movements?productId=${productId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
  });

  it("rejects a productId or locationId from another organization", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");
    const { productId, mainLocationId } = await setUpProductAndLocations(tokenA);

    const locationsB = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenB}`);

    const crossProduct = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ productId, locationId: locationsB.body[0].id, type: "RECEIVE", quantity: 5 });
    expect(crossProduct.status).toBe(400);

    const crossLocation = await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ productId, locationId: mainLocationId, type: "RECEIVE", quantity: 5 });
    expect(crossLocation.status).toBe(201);
  });
});
