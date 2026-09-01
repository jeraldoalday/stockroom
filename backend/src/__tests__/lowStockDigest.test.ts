import request from "supertest";

jest.mock("../lib/prisma");

import { resetPrismaMock } from "./testUtils/prismaMock";
import { createApp } from "../app";
import { formatLowStockDigestEmail, sendLowStockDigest } from "../lib/lowStockDigest";

const app = createApp();

beforeEach(() => {
  resetPrismaMock();
});

async function signUp(email: string, orgName: string, name = "Owner") {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: orgName,
    name,
    email,
    password: "hunter22222",
  });
  return { accessToken: res.body.accessToken as string, organizationId: res.body.organization.id as string };
}

async function inviteStaff(accessToken: string, email: string) {
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ email, name: "Clerk", role: "STAFF" });
}

async function createProduct(accessToken: string, sku: string, reorderPoint: number) {
  const res = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ sku, name: `Product ${sku}`, costCents: 100, reorderPoint });
  return res.body.id as string;
}

async function receiveStock(accessToken: string, productId: string, quantity: number) {
  const locations = await request(app).get("/api/locations").set("Authorization", `Bearer ${accessToken}`);
  await request(app)
    .post("/api/stock-movements")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ productId, locationId: locations.body[0].id, type: "RECEIVE", quantity });
}

describe("sendLowStockDigest", () => {
  it("sends nothing for an organization with no low-stock products", async () => {
    const { accessToken } = await signUp("owner@shop.test", "The Shop");
    const productId = await createProduct(accessToken, "SKU-1", 5);
    await receiveStock(accessToken, productId, 50);

    const result = await sendLowStockDigest();

    expect(result).toEqual({ organizationsChecked: 1, organizationsNotified: 0, emailsSent: 0 });
  });

  it("emails the Owner once a product is at or below its reorder point", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { accessToken } = await signUp("owner@shop.test", "The Shop");
    const productId = await createProduct(accessToken, "SKU-1", 10);
    await receiveStock(accessToken, productId, 4);

    const result = await sendLowStockDigest();

    expect(result).toEqual({ organizationsChecked: 1, organizationsNotified: 1, emailsSent: 1 });
    const logged = consoleLog.mock.calls.flat().join("\n");
    expect(logged).toContain("to=owner@shop.test");
    expect(logged).toContain("1 item is low on stock");
    expect(logged).toContain("SKU-1");
    expect(logged).toContain("4 in stock");
    expect(logged).toContain("reorder point 10");
    consoleLog.mockRestore();
  });

  it("does not email Staff, only Owners", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { accessToken } = await signUp("owner@shop.test", "The Shop");
    await inviteStaff(accessToken, "clerk@shop.test");
    const productId = await createProduct(accessToken, "SKU-1", 10);
    await receiveStock(accessToken, productId, 1);
    consoleLog.mockClear();

    const result = await sendLowStockDigest();

    expect(result.emailsSent).toBe(1);
    const logged = consoleLog.mock.calls.flat().join("\n");
    expect(logged).toContain("to=owner@shop.test");
    expect(logged).not.toContain("to=clerk@shop.test");
    consoleLog.mockRestore();
  });

  it("emails every Owner when an organization has more than one", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const first = await signUp("owner@shop.test", "The Shop");
    await inviteStaff(first.accessToken, "second-owner@shop.test");
    // Promote the invited user to Owner the same way the Team page does.
    const users = await request(app).get("/api/users").set("Authorization", `Bearer ${first.accessToken}`);
    const invited = users.body.items.find((u: { email: string }) => u.email === "second-owner@shop.test");
    await request(app)
      .patch(`/api/users/${invited.id}`)
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ role: "OWNER" });
    const productId = await createProduct(first.accessToken, "SKU-1", 10);
    await receiveStock(first.accessToken, productId, 1);
    consoleLog.mockClear();

    const result = await sendLowStockDigest();

    expect(result.emailsSent).toBe(2);
    const logged = consoleLog.mock.calls.flat().join("\n");
    expect(logged).toContain("to=owner@shop.test");
    expect(logged).toContain("to=second-owner@shop.test");
    consoleLog.mockRestore();
  });

  it("skips an Owner who has opted out, but still notifies the rest", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const first = await signUp("owner@shop.test", "The Shop");
    await inviteStaff(first.accessToken, "second-owner@shop.test");
    const users = await request(app).get("/api/users").set("Authorization", `Bearer ${first.accessToken}`);
    const invited = users.body.items.find((u: { email: string }) => u.email === "second-owner@shop.test");
    await request(app)
      .patch(`/api/users/${invited.id}`)
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ role: "OWNER" });
    await request(app)
      .patch("/api/auth/notifications")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ lowStockDigestOptOut: true });
    const productId = await createProduct(first.accessToken, "SKU-1", 10);
    await receiveStock(first.accessToken, productId, 1);
    consoleLog.mockClear();

    const result = await sendLowStockDigest();

    expect(result.emailsSent).toBe(1);
    const logged = consoleLog.mock.calls.flat().join("\n");
    expect(logged).not.toContain("to=owner@shop.test");
    expect(logged).toContain("to=second-owner@shop.test");
    consoleLog.mockRestore();
  });

  it("sends nothing for an organization where every Owner has opted out", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { accessToken } = await signUp("soleowner@shop.test", "The Shop");
    await request(app)
      .patch("/api/auth/notifications")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ lowStockDigestOptOut: true });
    const productId = await createProduct(accessToken, "SKU-1", 10);
    await receiveStock(accessToken, productId, 1);
    consoleLog.mockClear();

    const result = await sendLowStockDigest();

    expect(result).toEqual({ organizationsChecked: 1, organizationsNotified: 0, emailsSent: 0 });
    consoleLog.mockRestore();
  });

  it("only notifies the organizations that actually have low stock", async () => {
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const low = await signUp("low-owner@shop.test", "Low Shop");
    const lowProductId = await createProduct(low.accessToken, "SKU-LOW", 10);
    await receiveStock(low.accessToken, lowProductId, 1);

    const healthy = await signUp("healthy-owner@shop.test", "Healthy Shop");
    const healthyProductId = await createProduct(healthy.accessToken, "SKU-OK", 5);
    await receiveStock(healthy.accessToken, healthyProductId, 50);
    consoleLog.mockClear();

    const result = await sendLowStockDigest();

    expect(result).toEqual({ organizationsChecked: 2, organizationsNotified: 1, emailsSent: 1 });
    const logged = consoleLog.mock.calls.flat().join("\n");
    expect(logged).toContain("to=low-owner@shop.test");
    expect(logged).not.toContain("to=healthy-owner@shop.test");
    consoleLog.mockRestore();
  });
});

describe("formatLowStockDigestEmail", () => {
  it("uses singular phrasing for exactly one item", () => {
    const { subject, text } = formatLowStockDigestEmail(
      "The Shop",
      [
        {
          product: {
            id: "p1",
            organizationId: "o1",
            categoryId: null,
            sku: "SKU-1",
            name: "Widget",
            description: null,
            costCents: 100,
            priceCents: 200,
            reorderPoint: 10,
            reorderQty: 20,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          quantity: 3,
        },
      ],
      "https://app.example.test/dashboard"
    );

    expect(subject).toBe("StockRoom: 1 item is low on stock — The Shop");
    expect(text).toContain("- SKU-1 Widget: 3 in stock (reorder point 10)");
    expect(text).toContain("https://app.example.test/dashboard");
  });

  it("uses plural phrasing and lists every item for more than one", () => {
    const product = (sku: string) => ({
      id: sku,
      organizationId: "o1",
      categoryId: null,
      sku,
      name: `Product ${sku}`,
      description: null,
      costCents: 100,
      priceCents: 200,
      reorderPoint: 5,
      reorderQty: 10,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { subject, text } = formatLowStockDigestEmail(
      "The Shop",
      [
        { product: product("SKU-1"), quantity: 1 },
        { product: product("SKU-2"), quantity: 2 },
      ],
      "https://app.example.test/dashboard"
    );

    expect(subject).toBe("StockRoom: 2 items are low on stock — The Shop");
    expect(text).toContain("SKU-1");
    expect(text).toContain("SKU-2");
  });
});
