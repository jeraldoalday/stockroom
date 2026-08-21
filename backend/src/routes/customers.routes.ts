import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

// Archived customers stay in the database because order history points at
// them; `status` is how the list decides whether to show them. Defaults to
// "active", so every existing caller behaves exactly as it did.
const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    const where = {
      organizationId,
      ...(query.status === "all" ? {} : { isActive: query.status === "active" }),
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, organizationId: req.auth!.organizationId },
    });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    res.json(customer);
  })
);

const customerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(1).max(40).optional().nullable(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = customerSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const customer = await prisma.customer.create({
      data: { ...body, organizationId },
    });
    res.status(201).json(customer);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = customerSchema.partial().parse(req.body);
    const organizationId = req.auth!.organizationId;

    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: body,
    });
    res.json(updated);
  })
);

// Archive, not delete. This used to hard-delete and refuse with a 409 once
// any sales order existed, which was a dead end: the customer you most
// want out of the dropdown is the one you have actually stopped trading
// with, and that is precisely the one with history. Archiving always
// succeeds, keeps the order history intact, and is reversible.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    if (!customer.isActive) {
      throw ApiError.conflict("This customer is already archived");
    }

    await prisma.customer.update({ where: { id: customer.id }, data: { isActive: false } });
    res.status(204).send();
  })
);

router.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    if (customer.isActive) {
      throw ApiError.conflict("This customer is not archived");
    }

    const restored = await prisma.customer.update({
      where: { id: customer.id },
      data: { isActive: true },
    });
    res.json(restored);
  })
);

export default router;
