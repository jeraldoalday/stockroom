import request from "supertest";

jest.mock("../lib/prisma");

import { prisma } from "../lib/prisma";
import { resetPrismaMock } from "./testUtils/prismaMock";
import { inviteAndSetPassword } from "./testUtils/invite";
import { createApp } from "../app";
import { parseCsvRecords } from "../lib/csv";

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

async function signInAs(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.accessToken as string;
}

/** An org with one location and two products, one of which holds 10 units. */
async function setUp(token: string) {
  const locations = await request(app).get("/api/locations").set("Authorization", `Bearer ${token}`);
  const locationId = locations.body[0].id as string;

  const stocked = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-STOCKED", name: "Apple Sauce" });
  const empty = await request(app)
    .post("/api/products")
    .set("Authorization", `Bearer ${token}`)
    .send({ sku: "SKU-EMPTY", name: "Bread Flour" });

  await request(app)
    .post("/api/stock-movements")
    .set("Authorization", `Bearer ${token}`)
    .send({ productId: stocked.body.id, locationId, type: "RECEIVE", quantity: 10 });

  return {
    locationId,
    stockedProductId: stocked.body.id as string,
    emptyProductId: empty.body.id as string,
  };
}

function createStocktake(token: string, body: Record<string, unknown>) {
  return request(app).post("/api/stocktakes").set("Authorization", `Bearer ${token}`).send(body);
}

function countLine(token: string, id: string, lineId: string, countedQty: number | null) {
  return request(app)
    .patch(`/api/stocktakes/${id}/lines/${lineId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ countedQty });
}

function quantityAt(token: string, productId: string) {
  return request(app)
    .get("/api/inventory")
    .query({ productId })
    .set("Authorization", `Bearer ${token}`);
}

describe("Stocktakes API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/stocktakes");
    expect(res.status).toBe(401);
  });

  describe("creating a count sheet", () => {
    it("lists only products holding stock by default", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);

      const res = await createStocktake(token, { locationId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("OPEN");
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0].productId).toBe(stockedProductId);
      expect(res.body.lines[0].expectedQty).toBe(10);
      // Nobody has counted anything yet, which is not the same as zero.
      expect(res.body.lines[0].countedQty).toBeNull();
    });

    it("lists every active product when scoped to all-products", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, emptyProductId } = await setUp(token);

      const res = await createStocktake(token, { locationId, scope: "all-products" });

      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(2);
      const emptyLine = res.body.lines.find((line: { productId: string }) => line.productId === emptyProductId);
      expect(emptyLine.expectedQty).toBe(0);
    });

    it("names the product and location on the sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);

      const res = await createStocktake(token, { locationId });

      expect(res.body.location.id).toBe(locationId);
      expect(res.body.lines[0].product.name).toBe("Apple Sauce");
      expect(res.body.createdBy.email).toBe("owner@shop.test");
    });

    it("refuses a second open count at the same location", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);

      await createStocktake(token, { locationId });
      const res = await createStocktake(token, { locationId });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already has an open stocktake/i);
    });

    it("allows a new count once the previous one is completed", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);

      const first = await createStocktake(token, { locationId });
      await countLine(token, first.body.id, first.body.lines[0].id, 10);
      await request(app)
        .post(`/api/stocktakes/${first.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      const res = await createStocktake(token, { locationId });
      expect(res.status).toBe(201);
    });

    it("refuses a locationId from another organization", async () => {
      const tokenA = await signUpAndGetToken("a@shop.test", "Shop A");
      const tokenB = await signUpAndGetToken("b@shop.test", "Shop B");
      const { locationId } = await setUp(tokenA);
      await setUp(tokenB);

      const res = await createStocktake(tokenB, { locationId });
      expect(res.status).toBe(400);
    });

    it("refuses an archived location", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const second = await request(app)
        .post("/api/locations")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Overflow shed" });
      await request(app)
        .delete(`/api/locations/${second.body.id}`)
        .set("Authorization", `Bearer ${token}`);

      const res = await createStocktake(token, { locationId: second.body.id });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/archived/i);
      expect(locationId).toBeTruthy();
    });
  });

  describe("counting", () => {
    it("records who counted a line and when", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await countLine(token, sheet.body.id, sheet.body.lines[0].id, 8);

      expect(res.status).toBe(200);
      expect(res.body.lines[0].countedQty).toBe(8);
      expect(res.body.lines[0].countedBy.email).toBe("owner@shop.test");
      expect(res.body.lines[0].countedAt).not.toBeNull();
      expect(res.body.countedCount).toBe(1);
    });

    it("clears a figure entered by mistake back to uncounted", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 8);
      const res = await countLine(token, sheet.body.id, sheet.body.lines[0].id, null);

      expect(res.status).toBe(200);
      expect(res.body.lines[0].countedQty).toBeNull();
      expect(res.body.lines[0].countedBy).toBeNull();
      expect(res.body.countedCount).toBe(0);
    });

    it("rejects a negative count", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await countLine(token, sheet.body.id, sheet.body.lines[0].id, -1);
      expect(res.status).toBe(400);
    });

    it("rejects a line belonging to a different stocktake", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const second = await request(app)
        .post("/api/locations")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Back room" });
      const sheetA = await createStocktake(token, { locationId, scope: "all-products" });
      const sheetB = await createStocktake(token, { locationId: second.body.id, scope: "all-products" });

      const res = await countLine(token, sheetB.body.id, sheetA.body.lines[0].id, 5);
      expect(res.status).toBe(404);
    });

    it("adds a product the sheet did not predict", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, emptyProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/lines`)
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: emptyProductId });

      expect(res.status).toBe(201);
      expect(res.body.lines).toHaveLength(2);
      const added = res.body.lines.find((line: { productId: string }) => line.productId === emptyProductId);
      expect(added.expectedQty).toBe(0);
    });

    it("refuses to add the same product twice", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/lines`)
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: stockedProductId });

      expect(res.status).toBe(409);
    });
  });

  describe("completing", () => {
    it("writes the shelf down when the count is short, and says so", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.completedBy.email).toBe("owner@shop.test");
      expect(res.body.summary).toMatchObject({
        countedLines: 1,
        adjustedLines: 1,
        unitsFound: 0,
        unitsLost: 3,
      });

      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(7);
    });

    it("writes the shelf up when the count finds more than the ledger knew", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 14);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.body.summary.unitsFound).toBe(4);
      expect(res.body.summary.unitsLost).toBe(0);

      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(14);
    });

    it("posts an adjustment movement attributed to the stocktake", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const movements = await request(app)
        .get("/api/stock-movements")
        .query({ type: "ADJUSTMENT" })
        .set("Authorization", `Bearer ${token}`);

      expect(movements.body.items).toHaveLength(1);
      expect(movements.body.items[0].quantity).toBe(-3);
      expect(movements.body.items[0].stocktakeId).toBe(sheet.body.id);
      expect(movements.body.items[0].reason).toContain("Stocktake");
    });

    it("leaves uncounted lines alone entirely", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId, emptyProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId, scope: "all-products" });
      const stockedLine = sheet.body.lines.find(
        (line: { productId: string }) => line.productId === emptyProductId
      );
      await countLine(token, sheet.body.id, stockedLine.id, 2);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.body.summary.countedLines).toBe(1);
      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(10);
    });

    it("records a zero variance without posting a movement", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 10);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.body.summary).toMatchObject({ countedLines: 1, adjustedLines: 0 });
      expect(res.body.lines[0].appliedDelta).toBe(0);

      const movements = await request(app)
        .get("/api/stock-movements")
        .query({ type: "ADJUSTMENT" })
        .set("Authorization", `Bearer ${token}`);
      expect(movements.body.items).toHaveLength(0);
    });

    it("adjusts against live stock, not the sheet's snapshot, when stock moved mid-count", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      expect(sheet.body.lines[0].expectedQty).toBe(10);

      // A sale rings through while the aisle is being counted.
      await request(app)
        .post("/api/stock-movements")
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: stockedProductId, locationId, type: "SALE", quantity: 2 });

      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 9);
      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      // Counted 9 against a sheet that said 10, so the sheet variance is -1;
      // live stock was already 8 by then, so only +1 was actually posted.
      // Applying the sheet variance instead would have taken the sale off
      // the shelf a second time and left 7.
      expect(res.body.summary.variances[0]).toMatchObject({ variance: -1, appliedDelta: 1 });
      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(9);
    });

    // Completion reads on-hand, then writes based on what it read — the
    // exact read-then-write shape applyMovementDelta itself was fixed for
    // (see inventory.ts). A concurrent movement landing between that read
    // and the write would make an *increment* computed from the stale read
    // land on top of a quantity it was never computed against. Real
    // concurrent requests can't be reproduced against this in-memory mock
    // (see rateLimit.test.ts's note on hitRateLimit), so the stale read is
    // reproduced directly: fake the on-hand lookup into reporting a value
    // lower than what the row actually holds, and confirm completion still
    // sets on-hand to exactly what was counted rather than to the stale
    // read plus a computed delta.
    it("sets on-hand to exactly what was counted even when the on-hand read was stale", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 9);

      // True on-hand is 10 (from setUp), but the completion route's own
      // read of it is faked to report 3 — as if a large concurrent receipt
      // had landed between that read and the write.
      jest.spyOn(prisma.inventoryItem, "findFirst").mockResolvedValueOnce({ quantity: 3 } as never);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      (prisma.inventoryItem.findFirst as jest.Mock).mockRestore();

      expect(res.status).toBe(200);
      // An increment computed from the stale read (9 - 3 = +6) applied to
      // the true row (10) would have landed on 16, not 9.
      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(9);
    });

    it("refuses to complete a sheet nobody has counted", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/count at least one line/i);
    });

    it("refuses to complete an already completed sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/only an open stocktake/i);
    });

    // The assertOpen check above reads its own snapshot of the sheet, so a
    // second /complete request that read the sheet before a first one
    // committed could pass that check on a stale "still OPEN" status. Real
    // concurrent requests can't be reproduced against this in-memory mock
    // (see salesOrders.test.ts's identical note on the double-fulfill
    // race), so the stale read is reproduced directly: fake the
    // pre-transaction lookup into reporting the sheet as still OPEN, as it
    // would have looked before the first completion actually landed, and
    // confirm the in-transaction updateMany guard still catches it against
    // the real current row rather than trusting that stale snapshot.
    it("cannot complete a stocktake twice even when the pre-check read a stale snapshot", async () => {
      const token = await signUpAndGetToken("owner5@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);

      const firstComplete = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);
      expect(firstComplete.status).toBe(200);

      const staleStocktake = { ...firstComplete.body, status: "OPEN" };
      delete staleStocktake.lines;
      delete staleStocktake.summary;
      jest.spyOn(prisma.stocktake, "findFirst").mockResolvedValueOnce(staleStocktake as never);

      const secondComplete = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${token}`);
      expect(secondComplete.status).toBe(400);
      expect(secondComplete.body.error).toMatch(/only an open stocktake/i);

      (prisma.stocktake.findFirst as jest.Mock).mockRestore();

      // Rejected, so nothing from the second request applied: still only
      // the first completion's single ADJUSTMENT movement and the on-hand
      // it actually set, not a second one posted on top of it.
      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(7);

      const movements = await request(app)
        .get(`/api/stock-movements?productId=${stockedProductId}&type=ADJUSTMENT`)
        .set("Authorization", `Bearer ${token}`);
      expect(movements.body.total).toBe(1);
    });

    it("refuses to count a line on a completed sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const res = await countLine(token, sheet.body.id, sheet.body.lines[0].id, 5);
      expect(res.status).toBe(400);
    });
  });

  describe("cancelling", () => {
    it("cancels an open sheet without touching stock", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 3);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CANCELLED");
      // The figure somebody wrote down stays on the record; it was true.
      expect(res.body.lines[0].countedQty).toBe(3);

      const inventory = await quantityAt(token, stockedProductId);
      expect(inventory.body.items[0].quantity).toBe(10);
    });

    it("refuses to cancel a completed sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/cancel`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe("listing and tenancy", () => {
    it("reports progress per sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId, scope: "all-products" });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 4);

      const res = await request(app).get("/api/stocktakes").set("Authorization", `Bearer ${token}`);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ lineCount: 2, countedCount: 1 });
      expect(res.body.items[0].location.id).toBe(locationId);
    });

    it("filters by status", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await request(app).post(`/api/stocktakes/${sheet.body.id}/cancel`).set("Authorization", `Bearer ${token}`);

      const open = await request(app)
        .get("/api/stocktakes")
        .query({ status: "OPEN" })
        .set("Authorization", `Bearer ${token}`);
      const cancelled = await request(app)
        .get("/api/stocktakes")
        .query({ status: "CANCELLED" })
        .set("Authorization", `Bearer ${token}`);

      expect(open.body.items).toHaveLength(0);
      expect(cancelled.body.items).toHaveLength(1);
    });

    it("never shows another organization's sheets", async () => {
      const tokenA = await signUpAndGetToken("a@shop.test", "Shop A");
      const tokenB = await signUpAndGetToken("b@shop.test", "Shop B");
      const { locationId } = await setUp(tokenA);
      await setUp(tokenB);
      const sheet = await createStocktake(tokenA, { locationId });

      const list = await request(app).get("/api/stocktakes").set("Authorization", `Bearer ${tokenB}`);
      const detail = await request(app)
        .get(`/api/stocktakes/${sheet.body.id}`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(list.body.items).toHaveLength(0);
      expect(detail.status).toBe(404);
    });
  });

  describe("exporting a count sheet as CSV", () => {
    function exportSheet(token: string, id: string) {
      return request(app).get(`/api/stocktakes/${id}/export`).set("Authorization", `Bearer ${token}`);
    }

    it("prints an in-progress sheet: expected, but nothing counted yet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await exportSheet(token, sheet.body.id);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="stocktake-.*\.csv"$/);
      const lines = res.text.trim().split("\r\n");
      expect(lines[0]).toBe("SKU,Product,Expected,Counted,Variance,Counted by,Counted at");
      // Not counted is a blank field, not "0" — the same rule the on-screen
      // sheet enforces, so a printed-then-reopened sheet can't be misread.
      expect(lines[1]).toBe("SKU-STOCKED,Apple Sauce,10,,,,");
    });

    it("shows what a counter found, and the variance against the sheet", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);

      const res = await exportSheet(token, sheet.body.id);

      const [, row] = res.text.trim().split("\r\n");
      const fields = row.split(",");
      expect(fields.slice(0, 6)).toEqual(["SKU-STOCKED", "Apple Sauce", "10", "7", "-3", "Owner"]);
      // Counted at is a real timestamp once a figure has been recorded.
      expect(fields[6]).not.toBe("");
    });

    it("uses the applied delta, not the sheet variance, once a count is completed", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);

      // Stock moves after the counter wrote 7 down but before the sheet is
      // completed -- the same scenario `applyStocktake` itself is built
      // around (see lib/stocktake.ts).
      await request(app)
        .post("/api/stock-movements")
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: stockedProductId, locationId, type: "RECEIVE", quantity: 5 });
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const res = await exportSheet(token, sheet.body.id);

      // Sheet variance would read -3 (7 - 10); what was actually posted was
      // -8 (7 - 15 on-hand), and the export must show the real correction.
      const [, row] = res.text.trim().split("\r\n");
      expect(row.split(",").slice(0, 6)).toEqual(["SKU-STOCKED", "Apple Sauce", "10", "7", "-8", "Owner"]);
    });

    it("defuses a product name/SKU that would read as a spreadsheet formula, without touching a real negative variance", async () => {
      // Excel/Sheets treats a cell starting with `=`, `+`, `-`, or `@` as a
      // formula regardless of this API's own text/csv content type, and a
      // Staff member can freely set a product's SKU or name to anything --
      // there's no character restriction. Whoever opens this export is an
      // Owner, so an unsanitized SKU/name is a way for a lower-trust user to
      // run a formula in a higher-trust one's spreadsheet the moment they
      // open the file (see `sanitizeCsvText` in lib/csv.ts).
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const locations = await request(app).get("/api/locations").set("Authorization", `Bearer ${token}`);
      const locationId = locations.body[0].id as string;
      const product = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({ sku: "=cmd|' /C calc'!A0", name: '=HYPERLINK("http://evil.example/","steal")' });
      await request(app)
        .post("/api/stock-movements")
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: product.body.id, locationId, type: "RECEIVE", quantity: 10 });
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 3);

      const res = await exportSheet(token, sheet.body.id);

      // Parsed through the app's own CSV reader, not a naive split(",") --
      // the malicious name itself contains commas and quotes, which is
      // exactly the kind of field formatCsvField has to quote correctly on
      // top of sanitizeCsvText's own prefix.
      const [record] = parseCsvRecords(res.text);
      expect(record.SKU).toBe("'=cmd|' /C calc'!A0");
      expect(record.Product).toBe('\'=HYPERLINK("http://evil.example/","steal")');
      // A genuinely negative computed field (3 counted - 10 expected) must
      // stay a plain "-7", not gain a defusing quote of its own.
      expect(record.Variance).toBe("-7");
    });

    it("exposes Content-Disposition across origins, so the browser can read the filename", async () => {
      // Content-Disposition isn't on the CORS response-header safelist by
      // default; a browser fetch() from the Vite dev origin can read the
      // CSV body but not this header unless the server explicitly exposes
      // it (app.ts's cors({ exposedHeaders: [...] })). Caught by driving
      // this export through an actual cross-origin browser fetch before
      // this test existed -- the mocked axios adapter the frontend suite
      // uses can't see CORS behaviour at all, so this has to be asserted
      // here, against the header the server actually sends.
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });

      const res = await exportSheet(token, sheet.body.id);

      expect(res.headers["access-control-expose-headers"]).toContain("Content-Disposition");
    });

    it("never exports another organization's sheet", async () => {
      const tokenA = await signUpAndGetToken("a@shop.test", "Shop A");
      const tokenB = await signUpAndGetToken("b@shop.test", "Shop B");
      const { locationId } = await setUp(tokenA);
      await setUp(tokenB);
      const sheet = await createStocktake(tokenA, { locationId });

      const res = await exportSheet(tokenB, sheet.body.id);

      expect(res.status).toBe(404);
    });
  });

  describe("count history for one product", () => {
    function history(token: string, productId: string, params: Record<string, unknown> = {}) {
      return request(app)
        .get("/api/stocktakes/history")
        .query({ productId, ...params })
        .set("Authorization", `Bearer ${token}`);
    }

    it("is empty until the product has actually been counted", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      await createStocktake(token, { locationId });

      const res = await history(token, stockedProductId);

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it("shows a counted line, with location and who counted it", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);

      const res = await history(token, stockedProductId);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        stocktakeId: sheet.body.id,
        status: "OPEN",
        expectedQty: 10,
        countedQty: 7,
        appliedDelta: null,
      });
      expect(res.body.items[0].location.id).toBe(locationId);
      expect(res.body.items[0].countedBy.email).toBe("owner@shop.test");
    });

    it("leaves an uncounted line off the history entirely", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, emptyProductId } = await setUp(token);
      await createStocktake(token, { locationId, scope: "all-products" });

      // emptyProductId is on the sheet (all-products scope) but nobody has
      // recorded a figure for it yet.
      const res = await history(token, emptyProductId);

      expect(res.body.items).toEqual([]);
    });

    it("carries the applied delta once a count completes", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const sheet = await createStocktake(token, { locationId });
      await countLine(token, sheet.body.id, sheet.body.lines[0].id, 7);
      await request(app).post(`/api/stocktakes/${sheet.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const res = await history(token, stockedProductId);

      expect(res.body.items[0]).toMatchObject({ status: "COMPLETED", appliedDelta: -3 });
    });

    it("orders most recently counted first, across two separate sheets", async () => {
      const token = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId, stockedProductId } = await setUp(token);
      const first = await createStocktake(token, { locationId });
      await countLine(token, first.body.id, first.body.lines[0].id, 9);
      await request(app).post(`/api/stocktakes/${first.body.id}/complete`).set("Authorization", `Bearer ${token}`);

      const second = await createStocktake(token, { locationId });
      await countLine(token, second.body.id, second.body.lines[0].id, 9);

      const res = await history(token, stockedProductId);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].stocktakeId).toBe(second.body.id);
      expect(res.body.items[1].stocktakeId).toBe(first.body.id);
    });

    it("404s for a product from another organization", async () => {
      const tokenA = await signUpAndGetToken("a@shop.test", "Shop A");
      const tokenB = await signUpAndGetToken("b@shop.test", "Shop B");
      const { stockedProductId } = await setUp(tokenA);
      await setUp(tokenB);

      const res = await history(tokenB, stockedProductId);

      expect(res.status).toBe(404);
    });
  });

  describe("who is allowed to do what", () => {
    it("lets Staff open a count and fill it in", async () => {
      const ownerToken = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(ownerToken);
      await inviteAndSetPassword(app, ownerToken, { email: "clerk@shop.test", password: "hunter22222" });
      const staffToken = await signInAs("clerk@shop.test", "hunter22222");

      const sheet = await createStocktake(staffToken, { locationId });
      expect(sheet.status).toBe(201);

      const counted = await countLine(staffToken, sheet.body.id, sheet.body.lines[0].id, 9);
      expect(counted.status).toBe(200);
    });

    it("does not let Staff complete a count", async () => {
      const ownerToken = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(ownerToken);
      await inviteAndSetPassword(app, ownerToken, { email: "clerk@shop.test", password: "hunter22222" });
      const staffToken = await signInAs("clerk@shop.test", "hunter22222");
      const sheet = await createStocktake(staffToken, { locationId });
      await countLine(staffToken, sheet.body.id, sheet.body.lines[0].id, 9);

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/complete`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
    });

    it("does not let Staff cancel a count", async () => {
      const ownerToken = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(ownerToken);
      await inviteAndSetPassword(app, ownerToken, { email: "clerk@shop.test", password: "hunter22222" });
      const staffToken = await signInAs("clerk@shop.test", "hunter22222");
      const sheet = await createStocktake(staffToken, { locationId });

      const res = await request(app)
        .post(`/api/stocktakes/${sheet.body.id}/cancel`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
    });

    it("keeps product cost off a Staff member's count sheet", async () => {
      const ownerToken = await signUpAndGetToken("owner@shop.test", "The Shop");
      const { locationId } = await setUp(ownerToken);
      await inviteAndSetPassword(app, ownerToken, { email: "clerk@shop.test", password: "hunter22222" });
      const staffToken = await signInAs("clerk@shop.test", "hunter22222");

      const sheet = await createStocktake(staffToken, { locationId });
      expect(sheet.body.lines[0].product).not.toHaveProperty("costCents");
      expect(sheet.body.createdBy).not.toHaveProperty("passwordHash");
    });
  });
});
