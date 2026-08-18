import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { callPythonService } from "../lib/pythonService";

const router = Router();
router.use(requireAuth);

const daysQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });

function sendProxied(res: import("express").Response, result: Awaited<ReturnType<typeof callPythonService>>) {
  res.type(result.contentType);
  if (result.contentDisposition) {
    res.setHeader("Content-Disposition", result.contentDisposition);
  }
  res.send(result.body);
}

router.get(
  "/export/products",
  asyncHandler(async (req, res) => {
    const result = await callPythonService("/export/products", {
      organization_id: req.auth!.organizationId,
      // Cost data is Owner-only (PRD §4); the Python service drops the
      // column server-side rather than the Node proxy trying to edit CSV
      // text after the fact.
      include_cost: String(req.auth!.role === "OWNER"),
    });
    sendProxied(res, result);
  })
);

router.get(
  "/export/stock",
  asyncHandler(async (req, res) => {
    const result = await callPythonService("/export/stock", { organization_id: req.auth!.organizationId });
    sendProxied(res, result);
  })
);

router.get(
  "/export/movements",
  asyncHandler(async (req, res) => {
    const query = daysQuerySchema.parse(req.query);
    const result = await callPythonService("/export/movements", {
      organization_id: req.auth!.organizationId,
      ...(query.days ? { days: String(query.days) } : {}),
    });
    sendProxied(res, result);
  })
);

// F11: sales/stock trend, 7/30-day windows. JSON, not a file download, so
// the frontend can render it directly instead of triggering a save.
router.get(
  "/trend",
  asyncHandler(async (req, res) => {
    const query = daysQuerySchema.parse(req.query);
    const result = await callPythonService("/reports/trend", {
      organization_id: req.auth!.organizationId,
      ...(query.days ? { days: String(query.days) } : {}),
    });
    res.type("application/json").send(result.body);
  })
);

const reorderSuggestionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  coverageDays: z.coerce.number().int().min(1).max(90).optional(),
});

// F12: reorder-quantity suggestion (moving-average demand). JSON, same
// proxy pattern as /trend above.
router.get(
  "/reorder-suggestions",
  asyncHandler(async (req, res) => {
    const query = reorderSuggestionsQuerySchema.parse(req.query);
    const result = await callPythonService("/reports/reorder-suggestions", {
      organization_id: req.auth!.organizationId,
      ...(query.days ? { days: String(query.days) } : {}),
      ...(query.coverageDays ? { coverage_days: String(query.coverageDays) } : {}),
    });
    res.type("application/json").send(result.body);
  })
);

export default router;
