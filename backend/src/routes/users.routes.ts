import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { hashPassword } from "../lib/auth";

const router = Router();
router.use(requireAuth);

// Team management is squarely an Owner responsibility per the PRD persona
// model ("Owner ... invites staff") — every route here is Owner-only.
router.use(requireRole("OWNER"));

function toPublicUser(user: { id: string; name: string; email: string; role: string; createdAt: Date }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const users = await prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items: users.map(toPublicUser) });
  })
);

const inviteSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: z.enum(["OWNER", "STAFF"]).default("STAFF"),
});

// Signup (auth.routes.ts) always creates an Owner for a brand-new
// organization; this is the only way to add any other user — Staff or a
// second Owner — to an org that already exists.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = inviteSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const email = body.email.toLowerCase();

    // Email is unique across the whole product (not just this org), same
    // rule signup already enforces.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { organizationId, email, name: body.name, passwordHash, role: body.role },
    });

    res.status(201).json(toPublicUser(user));
  })
);

async function assertOrgKeepsAnOwner(organizationId: string, excludingUserId: string) {
  const remainingOwners = await prisma.user.count({
    where: { organizationId, role: "OWNER", NOT: { id: excludingUserId } },
  });
  if (remainingOwners === 0) {
    throw ApiError.badRequest("An organization must always have at least one Owner");
  }
}

const patchSchema = z.object({ role: z.enum(["OWNER", "STAFF"]) });

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!user) {
      throw ApiError.notFound("User not found");
    }

    if (user.role === "OWNER" && body.role === "STAFF") {
      await assertOrgKeepsAnOwner(organizationId, user.id);
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: { role: body.role } });
    res.json(toPublicUser(updated));
  })
);

// Users are hard-deleted (no soft-delete flag on the model), but a user who
// has ever posted a stock movement is the `actor` on that audit row, so
// deleting them would either corrupt the trail or fail the FK outright —
// same "block delete once there's history" rule already applied to
// Suppliers/Customers.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;

    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!user) {
      throw ApiError.notFound("User not found");
    }
    if (user.id === req.auth!.userId) {
      throw ApiError.badRequest("You cannot remove your own account");
    }
    if (user.role === "OWNER") {
      await assertOrgKeepsAnOwner(organizationId, user.id);
    }

    const movementCount = await prisma.stockMovement.count({ where: { organizationId, actorId: user.id } });
    if (movementCount > 0) {
      throw ApiError.conflict("Cannot remove a user with stock movement history");
    }

    await prisma.user.delete({ where: { id: user.id } });
    res.status(204).send();
  })
);

export default router;
