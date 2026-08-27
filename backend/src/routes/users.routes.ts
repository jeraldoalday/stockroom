import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { env } from "../lib/env";
import { emailSender } from "../lib/email";
import { generateOpaqueToken, hashOpaqueToken, hashPassword } from "../lib/auth";
import { resetLoginLockout } from "../lib/rateLimit";

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
  role: z.enum(["OWNER", "STAFF"]).default("STAFF"),
});

// A week is generous for someone to get to their inbox and click through,
// longer than the 1-hour forgot-password link since that one guards an
// account someone can already get into another way (they know the old
// password); an invite is the only way in for a brand-new member.
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Signup (auth.routes.ts) always creates an Owner for a brand-new
// organization; this is the only way to add any other user — Staff or a
// second Owner — to an org that already exists.
//
// The Owner no longer chooses the new member's password. That used to mean
// the Owner learned (and had to relay, out of band) a real credential for
// someone else's account, with no way for that person to prove they'd ever
// seen it. Instead the account is created locked — its password hash is a
// random value nobody, including the Owner, knows — and this reuses the
// same one-time-link machinery as forgot-password (lib/auth's
// generateOpaqueToken/hashOpaqueToken, the PasswordResetToken table, and
// `/api/auth/reset-password` itself all treat "set a password from a mailed
// link" identically whether the link came from an invite or a reset).
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

    const passwordHash = await hashPassword(generateOpaqueToken());
    const token = generateOpaqueToken();
    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { organizationId, email, name: body.name, passwordHash, role: body.role },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        },
      });
      return user;
    });

    const inviteUrl = `${env.corsOrigin}/reset-password?token=${token}&type=invite`;
    await emailSender.send({
      to: user.email,
      subject: "You've been invited to StockRoom",
      text: `You've been invited to join a StockRoom organization as ${body.role === "OWNER" ? "an Owner" : "a Staff member"}.\n\nSet your password here (valid for 7 days): ${inviteUrl}\n\nIf you weren't expecting this, you can ignore this email.`,
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

// Login attempts are throttled per (IP, email) so a credential-stuffing run
// can't just move to a fresh account (see lib/rateLimit.ts) — but that
// leaves an Owner with no way to help a colleague who genuinely mistyped
// their password ten times: the window has to be waited out, up to 15
// minutes, with no self-service reset available (the throttle exists
// precisely so the correct password doesn't lift it early). This clears
// every login bucket for the member's email regardless of which IP tripped
// it, since the Owner doing the unlocking has no way to know that.
//
// Deliberately its own endpoint rather than folded into PATCH — clearing a
// lockout isn't a change to the user record, and mixing it into the role
// update would make "no-op PATCH with nothing changed" an unclear signal
// for whether a lockout was meant to be cleared.
router.post(
  "/:id/unlock-login",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;

    const user = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!user) {
      throw ApiError.notFound("User not found");
    }

    const clearedCount = await resetLoginLockout(user.email);
    res.json({ wasLockedOut: clearedCount > 0 });
  })
);

export default router;
