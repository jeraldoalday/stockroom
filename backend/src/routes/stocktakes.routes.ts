import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { toCsv, sanitizeCsvText } from "../lib/csv";
import { requireStockableLocation } from "../lib/locations";
import { PUBLIC_USER_SELECT } from "../lib/rbac";
import { applyStocktake, assertOpen, planStocktakeLines, requireStocktake } from "../lib/stocktake";

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  status: z.enum(["OPEN", "COMPLETED", "CANCELLED"]).optional(),
  locationId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Progress per stocktake, for the list screen.
 *
 * Fetched as one query across every listed id and grouped in memory rather
 * than a count per row: a page of 25 counts would otherwise be 25 extra
 * round trips to render a "12 of 40 counted" label.
 */
async function progressByStocktake(stocktakeIds: string[]) {
  const progress = new Map<string, { lineCount: number; countedCount: number }>();
  for (const id of stocktakeIds) progress.set(id, { lineCount: 0, countedCount: 0 });
  if (stocktakeIds.length === 0) return progress;

  const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: { in: stocktakeIds } } });
  for (const line of lines) {
    const entry = progress.get(line.stocktakeId);
    if (!entry) continue;
    entry.lineCount += 1;
    if (line.countedQty !== null) entry.countedCount += 1;
  }
  return progress;
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    const where = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.stocktake.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.stocktake.count({ where }),
    ]);

    const [locations, users, progress] = await Promise.all([
      prisma.location.findMany({ where: { organizationId } }),
      prisma.user.findMany({ where: { organizationId }, select: PUBLIC_USER_SELECT }),
      progressByStocktake(items.map((item) => item.id)),
    ]);
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const userById = new Map(users.map((user) => [user.id, user]));

    res.json({
      items: items.map((item) => ({
        ...item,
        location: locationById.get(item.locationId) ?? null,
        createdBy: userById.get(item.createdById) ?? null,
        completedBy: item.completedById ? userById.get(item.completedById) ?? null : null,
        ...progress.get(item.id)!,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  })
);

const historyQuerySchema = z.object({
  productId: z.string(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Registered ahead of GET /:id, or "/history" would itself be swallowed as
// an :id lookup.
//
// "When was this last counted, and what did the count find" for one
// product, across every sheet that has ever counted it -- the answer
// StocktakeLine already holds but nothing surfaces (see the product
// screen's history panel). Only counted lines are history; an uncounted
// line on some other sheet says nothing about this product.
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const query = historyQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    const product = await prisma.product.findFirst({ where: { id: query.productId, organizationId } });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }

    // StocktakeLine carries no organizationId of its own -- a line only
    // ever belongs to one organization by construction (every route that
    // creates one scopes the stocktake first), but the tenant filter still
    // belongs on this query rather than trusted from that alone, the same
    // rule every other route here follows.
    const allLines = await prisma.stocktakeLine.findMany({ where: { productId: product.id } });
    const stocktakeIds = [...new Set(allLines.map((line) => line.stocktakeId))];
    const stocktakes = stocktakeIds.length
      ? await prisma.stocktake.findMany({ where: { id: { in: stocktakeIds }, organizationId } })
      : [];
    const stocktakeById = new Map(stocktakes.map((s) => [s.id, s]));

    const counted = allLines
      .filter((line) => line.countedQty !== null && stocktakeById.has(line.stocktakeId))
      .sort((a, b) => new Date(b.countedAt!).getTime() - new Date(a.countedAt!).getTime());

    const locationIds = [...new Set(counted.map((line) => stocktakeById.get(line.stocktakeId)!.locationId))];
    const userIds = [...new Set(counted.map((line) => line.countedById).filter((id): id is string => id !== null))];
    const [locations, users] = await Promise.all([
      locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } } }) : [],
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: PUBLIC_USER_SELECT }) : [],
    ]);
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const userById = new Map(users.map((u) => [u.id, u]));

    const total = counted.length;
    const page = counted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    res.json({
      items: page.map((line) => {
        const stocktake = stocktakeById.get(line.stocktakeId)!;
        return {
          stocktakeId: line.stocktakeId,
          status: stocktake.status,
          location: locationById.get(stocktake.locationId) ?? null,
          expectedQty: line.expectedQty,
          countedQty: line.countedQty,
          appliedDelta: line.appliedDelta,
          countedAt: line.countedAt,
          countedBy: line.countedById ? userById.get(line.countedById) ?? null : null,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  })
);

// The mock Prisma client used in tests doesn't resolve `include`, so the
// lines and their products are fetched separately rather than nested — the
// same trade purchaseOrders.routes.ts makes, and it keeps the response
// shape identical against a real Postgres backend.
async function loadStocktakeWithLines(organizationId: string, id: string) {
  const stocktake = await requireStocktake(organizationId, id);
  const [lines, location, users] = await Promise.all([
    prisma.stocktakeLine.findMany({ where: { stocktakeId: stocktake.id } }),
    prisma.location.findFirst({ where: { id: stocktake.locationId, organizationId } }),
    prisma.user.findMany({ where: { organizationId }, select: PUBLIC_USER_SELECT }),
  ]);

  const productIds = lines.map((line) => line.productId);
  const products = productIds.length
    ? await prisma.product.findMany({ where: { organizationId, id: { in: productIds } } })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    ...stocktake,
    location: location ?? null,
    createdBy: userById.get(stocktake.createdById) ?? null,
    completedBy: stocktake.completedById ? userById.get(stocktake.completedById) ?? null : null,
    lineCount: lines.length,
    countedCount: lines.filter((line) => line.countedQty !== null).length,
    lines: lines
      .map((line) => ({
        ...line,
        product: productById.get(line.productId) ?? null,
        countedBy: line.countedById ? userById.get(line.countedById) ?? null : null,
      }))
      // By product name, so the sheet reads in the order somebody would
      // walk the shelves rather than in insertion order.
      .sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? "")),
  };
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await loadStocktakeWithLines(req.auth!.organizationId, req.params.id));
  })
);

/**
 * The same "counted vs. sheet, or what was actually posted" rule the sheet
 * itself renders (`lineVariance` in `StocktakesPage.tsx`) — kept in sync
 * deliberately rather than each computing it independently, since a printed
 * sheet and the screen disagreeing about a variance is exactly the kind of
 * thing a counter would (rightly) not trust either of again.
 */
function lineVariance(line: { appliedDelta: number | null; countedQty: number | null; expectedQty: number }): number | null {
  if (line.appliedDelta !== null) return line.appliedDelta;
  if (line.countedQty === null) return null;
  return line.countedQty - line.expectedQty;
}

function csvFilenameSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "location";
}

// Every other write path here is a Node-only affair (see the comment above
// loadStocktakeWithLines), so this stays Node-only too rather than
// round-tripping through the Python service like reports.routes.ts's
// exports: the shaping this needs -- nullable-vs-zero, the applied-vs-sheet
// variance rule, the product-name sort -- already lives entirely in
// loadStocktakeWithLines, and restating it in a second SQL query on the
// Python side would risk the two quietly disagreeing.
//
// Works at any status: an OPEN sheet is exactly the thing somebody prints
// and carries into the aisle with a pen, and a COMPLETED one is the record
// of what a count actually found.
router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const sheet = await loadStocktakeWithLines(req.auth!.organizationId, req.params.id);

    const rows: string[][] = [
      ["SKU", "Product", "Expected", "Counted", "Variance", "Counted by", "Counted at"],
      ...sheet.lines.map((line) => {
        const variance = lineVariance(line);
        return [
          sanitizeCsvText(line.product?.sku ?? ""),
          sanitizeCsvText(line.product?.name ?? line.productId),
          String(line.expectedQty),
          line.countedQty === null ? "" : String(line.countedQty),
          variance === null ? "" : String(variance),
          sanitizeCsvText(line.countedBy?.name ?? ""),
          line.countedAt ? new Date(line.countedAt).toISOString() : "",
        ];
      }),
    ];

    const filename = `stocktake-${csvFilenameSlug(sheet.location?.name ?? "")}-${
      new Date(sheet.createdAt).toISOString().slice(0, 10)
    }.csv`;

    res.type("text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(toCsv(rows));
  })
);

const createSchema = z.object({
  locationId: z.string(),
  scope: z.enum(["with-stock", "all-products"]).default("with-stock"),
  notes: z.string().max(1000).optional(),
});

// Opening and filling in a count is Staff work — it is somebody walking the
// aisle with a sheet, the same way receiving a delivery is. Completing one
// is not; see the Owner gate on /complete below.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const location = await requireStockableLocation(organizationId, body.locationId);

    // One open count per location at a time. Two overlapping sheets for the
    // same room mean two counters recording different numbers for the same
    // shelf, and whichever is completed second silently overwrites the
    // first — with no signal to either of them that it happened.
    const existing = await prisma.stocktake.findFirst({
      where: { organizationId, locationId: location.id, status: "OPEN" },
    });
    if (existing) {
      throw ApiError.conflict(`${location.name} already has an open stocktake`);
    }

    const planned = await planStocktakeLines(organizationId, location.id, body.scope);

    const stocktake = await prisma.$transaction(async (tx) => {
      const created = await tx.stocktake.create({
        data: {
          organizationId,
          locationId: location.id,
          notes: body.notes,
          createdById: req.auth!.userId,
          status: "OPEN",
        },
      });
      for (const line of planned) {
        await tx.stocktakeLine.create({
          data: { stocktakeId: created.id, productId: line.productId, expectedQty: line.expectedQty },
        });
      }
      return created;
    });

    res.status(201).json(await loadStocktakeWithLines(organizationId, stocktake.id));
  })
);

const patchSchema = z.object({
  notes: z.string().max(1000).nullable().optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const stocktake = await requireStocktake(organizationId, req.params.id);
    assertOpen(stocktake.status, "edited");

    await prisma.stocktake.update({ where: { id: stocktake.id }, data: body });
    res.json(await loadStocktakeWithLines(organizationId, stocktake.id));
  })
);

const addLineSchema = z.object({ productId: z.string() });

// Adding a product the sheet didn't predict is the whole point of counting:
// a with-stock sheet lists nothing for a product the ledger thinks is
// empty, so goods actually sitting on that shelf would have no row to
// record them in.
router.post(
  "/:id/lines",
  asyncHandler(async (req, res) => {
    const body = addLineSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const stocktake = await requireStocktake(organizationId, req.params.id);
    assertOpen(stocktake.status, "added to");

    const product = await prisma.product.findFirst({ where: { id: body.productId, organizationId } });
    if (!product) {
      throw ApiError.badRequest("productId does not belong to this organization");
    }
    const duplicate = await prisma.stocktakeLine.findFirst({
      where: { stocktakeId: stocktake.id, productId: product.id },
    });
    if (duplicate) {
      throw ApiError.conflict("That product is already on this stocktake");
    }

    const item = await prisma.inventoryItem.findFirst({
      where: { productId: product.id, locationId: stocktake.locationId },
    });
    await prisma.stocktakeLine.create({
      data: { stocktakeId: stocktake.id, productId: product.id, expectedQty: item?.quantity ?? 0 },
    });

    res.status(201).json(await loadStocktakeWithLines(organizationId, stocktake.id));
  })
);

const countSchema = z.object({
  // Null clears a figure entered by mistake, putting the line back to
  // "not counted" — which is not the same as counting it to zero.
  countedQty: z.number().int().min(0).nullable(),
});

router.patch(
  "/:id/lines/:lineId",
  asyncHandler(async (req, res) => {
    const body = countSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const stocktake = await requireStocktake(organizationId, req.params.id);
    assertOpen(stocktake.status, "counted");

    const line = await prisma.stocktakeLine.findFirst({
      where: { id: req.params.lineId, stocktakeId: stocktake.id },
    });
    if (!line) {
      throw ApiError.notFound("Stocktake line not found");
    }

    await prisma.stocktakeLine.update({
      where: { id: line.id },
      data: {
        countedQty: body.countedQty,
        countedById: body.countedQty === null ? null : req.auth!.userId,
        countedAt: body.countedQty === null ? null : new Date(),
      },
    });

    res.json(await loadStocktakeWithLines(organizationId, stocktake.id));
  })
);

// Owner-only, unlike opening and counting. Completing a stocktake is the
// moment shrinkage is written off against stock value — an accounting act,
// not a warehouse one, and the same reason PRD section 4 keeps cost data
// away from Staff in the first place.
router.post(
  "/:id/complete",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const actorId = req.auth!.userId;
    const stocktake = await requireStocktake(organizationId, req.params.id);
    assertOpen(stocktake.status, "completed");

    // Re-checked at completion, not only at creation: a location archived
    // while its count was open would otherwise have stock written into it
    // by the completion step, landing goods somewhere no picker can see.
    await requireStockableLocation(organizationId, stocktake.locationId);

    const lines = await prisma.stocktakeLine.findMany({ where: { stocktakeId: stocktake.id } });
    if (lines.every((line) => line.countedQty === null)) {
      throw ApiError.badRequest("Count at least one line before completing this stocktake");
    }

    const summary = await prisma.$transaction(async (tx) => {
      const applied = await applyStocktake(tx, {
        organizationId,
        locationId: stocktake.locationId,
        stocktakeId: stocktake.id,
        actorId,
        lines,
      });
      await tx.stocktake.update({
        where: { id: stocktake.id },
        data: { status: "COMPLETED", completedById: actorId, completedAt: new Date() },
      });
      return applied;
    });

    res.json({ ...(await loadStocktakeWithLines(organizationId, stocktake.id)), summary });
  })
);

router.post(
  "/:id/cancel",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const stocktake = await requireStocktake(organizationId, req.params.id);
    assertOpen(stocktake.status, "cancelled");

    // Counted figures are deliberately left on the cancelled sheet rather
    // than cleared. They are a record of what somebody saw on a shelf on a
    // given day, which stays true whether or not the count was applied.
    await prisma.stocktake.update({ where: { id: stocktake.id }, data: { status: "CANCELLED" } });
    res.json(await loadStocktakeWithLines(organizationId, stocktake.id));
  })
);

export default router;
