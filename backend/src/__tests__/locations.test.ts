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

describe("Locations API", () => {
  it("signup already created a default 'Main Location'", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");

    const list = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("Main Location");
    expect(list.body[0].isDefault).toBe(true);
  });

  it("creates a second location", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "The Shop");

    const res = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Warehouse", address: "123 Dock St" });

    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(false);
  });

  it("rejects a duplicate location name within the same organization", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "The Shop");

    const dup = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Main Location" });

    expect(dup.status).toBe(409);
  });

  it("moves the default flag when a new location is created as default", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "The Shop");

    const created = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Warehouse", isDefault: true });
    expect(created.status).toBe(201);
    expect(created.body.isDefault).toBe(true);

    const list = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);
    const main = list.body.find((l: { name: string }) => l.name === "Main Location");
    expect(main.isDefault).toBe(false);
  });

  it("refuses to delete the last remaining location", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "The Shop");

    const list = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);
    const mainId = list.body[0].id;

    const del = await request(app)
      .delete(`/api/locations/${mainId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(400);
  });

  it("refuses to delete the current default location even if others exist", async () => {
    const token = await signUpAndGetToken("owner6@shop.test", "The Shop");

    const list = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);
    const mainId = list.body[0].id;

    await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Warehouse" });

    const del = await request(app)
      .delete(`/api/locations/${mainId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(400);
  });

  it("deletes a non-default location with no inventory", async () => {
    const token = await signUpAndGetToken("owner7@shop.test", "The Shop");

    const created = await request(app)
      .post("/api/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Warehouse" });

    const del = await request(app)
      .delete(`/api/locations/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });

  it("returns an empty inventory list for a fresh location", async () => {
    const token = await signUpAndGetToken("owner8@shop.test", "The Shop");

    const list = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${token}`);
    const mainId = list.body[0].id;

    const res = await request(app)
      .get(`/api/locations/${mainId}/inventory`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it("never returns another organization's locations (tenant isolation)", async () => {
    const tokenA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const tokenB = await signUpAndGetToken("ownerB@shop.test", "Shop B");

    const listB = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenB}`);

    expect(listB.body.every((l: { name: string }) => l.name === "Main Location")).toBe(true);
    expect(listB.body).toHaveLength(1);

    const listA = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(listA.body[0].id).not.toBe(listB.body[0].id);
  });
});

// An InventoryItem row is created the first time a product/location pair is
// touched and never removed — it only goes to zero. The delete guard used
// to count rows rather than stock, so any location that had ever been used
// became permanently undeletable, behind a message ("has inventory
// records") that gave the user nothing to act on.
describe("Deleting a location that has been used", () => {
  async function setup() {
    const signup = await request(app).post("/api/auth/signup").send({
      organizationName: "The Shop",
      name: "Owner",
      email: "owner-delete@shop.test",
      password: "hunter22222",
    });
    const auth = { Authorization: `Bearer ${signup.body.accessToken}` };

    const extra = await request(app).post("/api/locations").set(auth).send({ name: "Back Room" });
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-1", name: "Widget", priceCents: 999 });

    return { auth, locationId: extra.body.id as string, productId: product.body.id as string };
  }

  it("refuses while the location still holds stock, and says what to do", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "RECEIVE", quantity: 5 });

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still holds stock/i);
  });

  it("reports movement history, not stock, once the location is emptied", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "RECEIVE", quantity: 5 });
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 5 });

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stock movement history/i);
  });

  // SalesOrder.locationId is a plain column with no relation in the schema,
  // so the database wouldn't stop this and the orders would be left
  // pointing at a location that no longer exists.
  it("refuses when a sales order still references the location", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({ locationId, lines: [{ productId, quantity: 1, unitPriceCents: 999 }] });

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sales order/i);
  });

  it("deletes an unused location and leaves no orphaned inventory rows", async () => {
    const { auth, locationId } = await setup();

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(204);

    const remaining = await request(app).get("/api/locations").set(auth);
    expect(remaining.body.map((location: { id: string }) => location.id)).not.toContain(locationId);

    const inventory = await request(app).get("/api/inventory").set(auth);
    expect(
      inventory.body.items.filter((item: { locationId: string }) => item.locationId === locationId)
    ).toHaveLength(0);
  });
});
