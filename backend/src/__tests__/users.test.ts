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
  return res.body as { accessToken: string; user: { id: string } };
}

async function inviteStaff(ownerToken: string, email: string) {
  const res = await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: "Clerk", email, password: "hunter22222", role: "STAFF" });
  return res.body as { id: string };
}

async function loginToken(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: "hunter22222" });
  return res.body.accessToken as string;
}

describe("Users (team management) API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("lets an Owner invite a Staff user who can then log in", async () => {
    const owner = await signUpAndGetToken("owner@shop.test", "The Shop");

    const invite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Clerk", email: "clerk@shop.test", password: "hunter22222", role: "STAFF" });
    expect(invite.status).toBe(201);
    expect(invite.body.role).toBe("STAFF");
    expect(invite.body).not.toHaveProperty("passwordHash");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "clerk@shop.test", password: "hunter22222" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("STAFF");
  });

  it("blocks a STAFF user from managing the team", async () => {
    const owner = await signUpAndGetToken("owner2@shop.test", "Shop 2");
    await inviteStaff(owner.accessToken, "clerk2@shop.test");
    const staffToken = await loginToken("clerk2@shop.test");

    const list = await request(app).get("/api/users").set("Authorization", `Bearer ${staffToken}`);
    expect(list.status).toBe(403);

    const invite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ name: "Another", email: "another2@shop.test", password: "hunter22222" });
    expect(invite.status).toBe(403);
  });

  it("lists only the calling organization's members", async () => {
    const ownerA = await signUpAndGetToken("ownerA@shop.test", "Shop A");
    const ownerB = await signUpAndGetToken("ownerB@shop.test", "Shop B");
    await inviteStaff(ownerA.accessToken, "clerkA@shop.test");

    const listA = await request(app).get("/api/users").set("Authorization", `Bearer ${ownerA.accessToken}`);
    expect(listA.body.items.length).toBe(2);

    const listB = await request(app).get("/api/users").set("Authorization", `Bearer ${ownerB.accessToken}`);
    expect(listB.body.items.length).toBe(1);
  });

  it("rejects inviting an email that is already registered", async () => {
    const owner = await signUpAndGetToken("owner3@shop.test", "Shop 3");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Dup", email: "owner3@shop.test", password: "hunter22222" });
    expect(res.status).toBe(409);
  });

  it("lets an Owner promote a Staff user and demote another Owner, but never drop the last Owner", async () => {
    const owner = await signUpAndGetToken("owner4@shop.test", "Shop 4");
    const staff = await inviteStaff(owner.accessToken, "clerk4@shop.test");

    const promote = await request(app)
      .patch(`/api/users/${staff.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "OWNER" });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe("OWNER");

    // Now demote the original owner back to STAFF - allowed, since the
    // promoted user keeps the org staffed with an Owner.
    const demoteOriginal = await request(app)
      .patch(`/api/users/${owner.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "STAFF" });
    expect(demoteOriginal.status).toBe(200);

    // The sole remaining Owner cannot demote themselves - that would leave
    // the org with no Owner at all.
    const selfDemote = await request(app)
      .patch(`/api/users/${staff.id}`)
      .set("Authorization", `Bearer ${await loginToken("clerk4@shop.test")}`)
      .send({ role: "STAFF" });
    // clerk4 is now the OWNER (promoted above); this call uses their own
    // token to try demoting themselves.
    expect(selfDemote.status).toBe(400);
  });

  it("blocks removing your own account and the last Owner", async () => {
    const owner = await signUpAndGetToken("owner5@shop.test", "Shop 5");
    const staff = await inviteStaff(owner.accessToken, "clerk5@shop.test");

    const selfDelete = await request(app)
      .delete(`/api/users/${owner.user.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(selfDelete.status).toBe(400);

    const deleteStaff = await request(app)
      .delete(`/api/users/${staff.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(deleteStaff.status).toBe(204);
  });

  it("blocks removing a user who has posted stock movements", async () => {
    const owner = await signUpAndGetToken("owner6@shop.test", "Shop 6");
    const staff = await inviteStaff(owner.accessToken, "clerk6@shop.test");
    const staffToken = await loginToken("clerk6@shop.test");

    const product = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ sku: "SKU-1", name: "Widget" });
    const locations = await request(app)
      .get("/api/locations")
      .set("Authorization", `Bearer ${owner.accessToken}`);

    await request(app)
      .post("/api/stock-movements")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ productId: product.body.id, locationId: locations.body[0].id, type: "RECEIVE", quantity: 5 });

    const del = await request(app)
      .delete(`/api/users/${staff.id}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(del.status).toBe(409);
  });
});
