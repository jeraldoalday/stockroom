import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { organizationId: req.auth!.organizationId },
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

    await prisma.category.delete({ where: { id: category.id } });
    res.status(204).send();
  })
);

export default router;
