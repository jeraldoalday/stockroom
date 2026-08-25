import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";
import { redactForRole, redactSecretFields } from "../lib/rbac";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

// A stock movement's `actor` is a User, and the audit-trail list route
// embeds it. Written as `include: { actor: true }` that hands the caller
// every User column — passwordHash included — without the route ever
// mentioning the field. Two independent defences are tested here: the
// narrow `select` on the include, and the global response redaction that
// makes any future forgotten include non-exploitable.
describe("passwordHash never reaches a client", () => {
  async function signUp(email: string) {
    const res = await request(app).post("/api/auth/signup").send({
      organizationName: "The Shop",
      name: "Owner",
      email,
      password: "hunter22222",
    });
    return res.body.accessToken as string;
  }

  it("is absent from the signup and login responses", async () => {
    const signup = await request(app).post("/api/auth/signup").send({
      organizationName: "The Shop",
      name: "Owner",
      email: "owner@shop.test",
      password: "hunter22222",
    });
    expect(signup.status).toBe(201);
    expect(JSON.stringify(signup.body)).not.toContain("passwordHash");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@shop.test", password: "hunter22222" });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain("passwordHash");
  });

  it("is absent from the stock movement audit trail's actor", async () => {
    const token = await signUp("owner@shop.test");
    const auth = { Authorization: `Bearer ${token}` };

    const product = await request(app)
      .post("/api/products")
      .set(auth)
      .send({ sku: "WIDGET-1", name: "Widget", priceCents: 999 });
    const locations = await request(app).get("/api/locations").set(auth);

    await request(app).post("/api/stock-movements").set(auth).send({
      productId: product.body.id,
      locationId: locations.body[0].id,
      type: "RECEIVE",
      quantity: 5,
    });

    const movements = await request(app).get("/api/stock-movements").set(auth);
    expect(movements.status).toBe(200);
    expect(movements.body.items).toHaveLength(1);
    expect(JSON.stringify(movements.body)).not.toContain("passwordHash");
    expect(JSON.stringify(movements.body)).not.toContain("$2a$");
  });

  it("is absent from the team member list", async () => {
    const token = await signUp("owner@shop.test");
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post("/api/users")
      .set(auth)
      .send({ name: "Clerk", email: "clerk@shop.test", role: "STAFF" });

    const users = await request(app).get("/api/users").set(auth);
    expect(users.status).toBe(200);
    expect(users.body.items).toHaveLength(2);
    expect(JSON.stringify(users.body)).not.toContain("passwordHash");
  });
});

describe("redactSecretFields", () => {
  it("strips passwordHash at any nesting depth", () => {
    const input = {
      items: [
        {
          id: "mov_1",
          actor: { id: "u1", name: "Owner", passwordHash: "$2a$10$secret" },
        },
      ],
    };

    expect(redactSecretFields(input)).toEqual({
      items: [{ id: "mov_1", actor: { id: "u1", name: "Owner" } }],
    });
  });

  it("strips secrets for an OWNER but leaves their cost data intact", () => {
    const input = { costCents: 400, priceCents: 999, actor: { passwordHash: "x", name: "Owner" } };

    expect(redactForRole(input, "OWNER")).toEqual({
      costCents: 400,
      priceCents: 999,
      actor: { name: "Owner" },
    });
  });

  it("strips both secrets and cost data for STAFF in a single pass", () => {
    const input = { costCents: 400, priceCents: 999, actor: { passwordHash: "x", name: "Clerk" } };

    expect(redactForRole(input, "STAFF")).toEqual({
      priceCents: 999,
      actor: { name: "Clerk" },
    });
  });
});
