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

  it("refuses to remove the last remaining location", async () => {
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

  it("refuses to remove the current default location even if others exist", async () => {
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

  it("removes a non-default location with no inventory", async () => {
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

// Removing a location archives it. Hard deletion was refused outright once
// a location had any movement history or any sales order pointing at it,
// which is every location that has ever been used — so the stockroom you
// have stopped using was exactly the one the product insisted on keeping in
// every picker.
describe("Archiving a location", () => {
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

  async function receive(
    auth: Record<string, string>,
    productId: string,
    locationId: string,
    quantity: number
  ) {
    return request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "RECEIVE", quantity });
  }

  it("refuses while the location still holds stock, and says what to do", async () => {
    const { auth, locationId, productId } = await setup();
    await receive(auth, productId, locationId, 5);

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/still holds stock/i);
  });

  // The case that used to be a dead end: emptied out, but with history, so
  // it could never be removed.
  it("archives a location that has movement history once it is emptied", async () => {
    const { auth, locationId, productId } = await setup();
    await receive(auth, productId, locationId, 5);
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId, type: "SALE", quantity: 5 });

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(204);

    const remaining = await request(app).get("/api/locations").set(auth);
    expect(remaining.body.map((l: { id: string }) => l.id)).not.toContain(locationId);
  });

  // Sales orders keep pointing at the location they shipped from, and the
  // foreign key means the row genuinely cannot go — which is the whole
  // argument for archiving rather than deleting.
  it("archives a location a sales order still references", async () => {
    const { auth, locationId, productId } = await setup();
    await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({ locationId, lines: [{ productId, quantity: 1, unitPriceCents: 999 }] });

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(204);

    const order = await request(app).get("/api/sales-orders").set(auth);
    expect(order.body.items[0].locationId).toBe(locationId);
  });

  it("hides an archived location from the list but lists it on request", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const active = await request(app).get("/api/locations").set(auth);
    expect(active.body.map((l: { id: string }) => l.id)).not.toContain(locationId);

    const archived = await request(app).get("/api/locations?status=archived").set(auth);
    expect(archived.body.map((l: { id: string }) => l.id)).toEqual([locationId]);

    const all = await request(app).get("/api/locations?status=all").set(auth);
    expect(all.body).toHaveLength(2);
  });

  it("still resolves an archived location by id, so history can be read", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const res = await request(app).get(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("restores an archived location", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const restored = await request(app).post(`/api/locations/${locationId}/restore`).set(auth);
    expect(restored.status).toBe(200);
    expect(restored.body.isActive).toBe(true);

    const active = await request(app).get("/api/locations").set(auth);
    expect(active.body.map((l: { id: string }) => l.id)).toContain(locationId);
  });

  it("refuses to archive twice or restore something active", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const again = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already archived/i);

    await request(app).post(`/api/locations/${locationId}/restore`).set(auth);
    const restoreAgain = await request(app).post(`/api/locations/${locationId}/restore`).set(auth);
    expect(restoreAgain.status).toBe(409);
    expect(restoreAgain.body.error).toMatch(/not archived/i);
  });

  it("refuses to archive the default location", async () => {
    const { auth } = await setup();
    const locations = await request(app).get("/api/locations").set(auth);
    const defaultLocation = locations.body.find((l: { isDefault: boolean }) => l.isDefault);

    const res = await request(app).delete(`/api/locations/${defaultLocation.id}`).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/default/i);
  });

  it("refuses to archive the last active location", async () => {
    const { auth, locationId } = await setup();
    // Make the Back Room the default so the original can be archived, then
    // try to archive the only one left.
    await request(app).patch(`/api/locations/${locationId}`).set(auth).send({ isDefault: true });
    const locations = await request(app).get("/api/locations").set(auth);
    const other = locations.body.find((l: { id: string }) => l.id !== locationId);
    await request(app).delete(`/api/locations/${other.id}`).set(auth);

    const res = await request(app).delete(`/api/locations/${locationId}`).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one active location/i);
  });

  it("will not make an archived location the default", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const res = await request(app)
      .patch(`/api/locations/${locationId}`)
      .set(auth)
      .send({ isDefault: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/restore/i);
  });

  it("names the archived location behind a name clash", async () => {
    const { auth, locationId } = await setup();
    await request(app).delete(`/api/locations/${locationId}`).set(auth);

    const res = await request(app).post("/api/locations").set(auth).send({ name: "Back Room" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/archived location already uses this name/i);
  });
});

describe("Recording stock against an archived location", () => {
  async function archivedLocation() {
    const signup = await request(app).post("/api/auth/signup").send({
      organizationName: "The Shop",
      name: "Owner",
      email: "owner-archived@shop.test",
      password: "hunter22222",
    });
    const auth = { Authorization: `Bearer ${signup.body.accessToken}` };

    const extra = await request(app).post("/api/locations").set(auth).send({ name: "Old Depot" });
    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-2", name: "Widget", priceCents: 999 });
    await request(app).delete(`/api/locations/${extra.body.id}`).set(auth);

    const locations = await request(app).get("/api/locations").set(auth);
    return {
      auth,
      archivedId: extra.body.id as string,
      activeId: locations.body[0].id as string,
      productId: product.body.id as string,
    };
  }

  // An archived location is gone from every picker, so stock booked into
  // one would show in the valuation and in no list anyone looks at.
  it("refuses a movement into an archived location", async () => {
    const { auth, archivedId, productId } = await archivedLocation();

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId: archivedId, type: "RECEIVE", quantity: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived location/i);
  });

  it("refuses a transfer in either direction and names the field", async () => {
    const { auth, archivedId, activeId, productId } = await archivedLocation();
    await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId: activeId, type: "RECEIVE", quantity: 10 });

    const inbound = await request(app)
      .post("/api/stock-movements/transfer")
      .set(auth)
      .send({ productId, fromLocationId: activeId, toLocationId: archivedId, quantity: 1 });
    expect(inbound.status).toBe(400);
    expect(inbound.body.error).toMatch(/toLocationId/);

    const outbound = await request(app)
      .post("/api/stock-movements/transfer")
      .set(auth)
      .send({ productId, fromLocationId: archivedId, toLocationId: activeId, quantity: 1 });
    expect(outbound.status).toBe(400);
    expect(outbound.body.error).toMatch(/fromLocationId/);
  });

  it("refuses a sales order shipping from an archived location", async () => {
    const { auth, archivedId, productId } = await archivedLocation();

    const res = await request(app)
      .post("/api/sales-orders")
      .set(auth)
      .send({ locationId: archivedId, lines: [{ productId, quantity: 1, unitPriceCents: 999 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived location/i);
  });

  it("accepts everything again once the location is restored", async () => {
    const { auth, archivedId, productId } = await archivedLocation();
    await request(app).post(`/api/locations/${archivedId}/restore`).set(auth);

    const res = await request(app)
      .post("/api/stock-movements")
      .set(auth)
      .send({ productId, locationId: archivedId, type: "RECEIVE", quantity: 3 });
    expect(res.status).toBe(201);
  });
});
