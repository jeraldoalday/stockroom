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
