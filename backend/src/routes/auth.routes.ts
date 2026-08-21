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
import { rateLimit } from "../lib/rateLimit";

const router = Router();

// Credential endpoints are the only unauthenticated writes in the product,
// so they're the only place an attacker can spend our CPU for free. Keyed
// by IP *and* email so one noisy office NAT can't lock out everyone behind
// it, while a credential-stuffing run against many accounts from one host
// still gets throttled by the shared IP portion of the key.
const loginLimiter = rateLimit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
  message: "Too many sign-in attempts. Please try again in a few minutes.",
});

const signupLimiter = rateLimit({
  limit: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many accounts created from this address. Please try again later.",
});

const signupSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

router.post(
  "/signup",
  signupLimiter,
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
  loginLimiter,
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

    // A user who simply mistyped their password a few times shouldn't stay
    // throttled once they get it right.
    loginLimiter.limiter.reset(loginLimiter.keyFor(req));

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
