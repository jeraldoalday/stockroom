import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

// Archived categories stay in the database because products can still point
// at them; `status` is how the list decides whether to show them. Defaults
// to "active", so every existing caller (the inline picker on the product
// form) behaves exactly as it did.
const listQuerySchema = z.object({
  status: z.enum(["active", "archived", "all"]).default("active"),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const categories = await prisma.category.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        ...(query.status === "all" ? {} : { isActive: query.status === "active" }),
      },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  })
);

const createSchema = z.object({ name: z.string().min(1).max(120) });

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const existing = await prisma.category.findFirst({
      where: { organizationId, name: body.name },
    });
    if (existing) {
      throw ApiError.conflict("A category with this name already exists");
    }

    const category = await prisma.category.create({
      data: { organizationId, name: body.name },
    });
    res.status(201).json(category);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = createSchema.partial().parse(req.body);
    const organizationId = req.auth!.organizationId;

    const category = await prisma.category.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!category) {
      throw ApiError.notFound("Category not found");
    }

    const updated = await prisma.category.update({
      where: { id: category.id },
      data: body,
    });
    res.json(updated);
  })
);

// Archive, not delete — same reason as Supplier/Customer/Location. Hard
// deleting used to succeed silently and clear `categoryId` on every product
// filed under it (the FK is ON DELETE SET NULL), which is worse than the
// 409 the other archivable entities used to give: nothing said it happened.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!category) {
      throw ApiError.notFound("Category not found");
    }
    if (!category.isActive) {
      throw ApiError.conflict("This category is already archived");
    }

    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    res.status(204).send();
  })
);

router.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!category) {
      throw ApiError.notFound("Category not found");
    }
    if (category.isActive) {
      throw ApiError.conflict("This category is not archived");
    }

    const restored = await prisma.category.update({
      where: { id: category.id },
      data: { isActive: true },
    });
    res.json(restored);
  })
);

export default router;
