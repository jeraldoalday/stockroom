import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
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

    const openOrders = await prisma.salesOrder.count({
      where: { organizationId, customerId: customer.id },
    });
    if (openOrders > 0) {
      throw ApiError.conflict("Cannot delete a customer with sales order history");
    }

    await prisma.customer.delete({ where: { id: customer.id } });
    res.status(204).send();
  })
);

export default router;
