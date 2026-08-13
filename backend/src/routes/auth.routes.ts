import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { ApiError } from "../lib/errors";
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyPassword,
  verifyRefreshToken,
} from "../lib/auth";

const router = Router();

const signupSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

router.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);

    // An org + its first (owner) user are created together — if either
    // insert fails the whole signup rolls back, so we never end up with
    // an orphaned organization.
    const { organization, user } = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: body.organizationName },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email,
          passwordHash,
          name: body.name,
          role: "OWNER",
        },
      });
      await tx.location.create({
        data: {
          organizationId: organization.id,
          name: "Main Location",
          isDefault: true,
        },
      });
      return { organization, user };
    });

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: organization.id,
      role: user.role,
    });
    const refreshToken = signRefreshToken({ sub: user.id });

    res.status(201).json({
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: { id: organization.id, name: organization.name },
    });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    });
    const refreshToken = signRefreshToken({ sub: user.id });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

const refreshSchema = z.object({ refreshToken: z.string() });

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(body.refreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    });

    res.json({ accessToken });
  })
);

export default router;
