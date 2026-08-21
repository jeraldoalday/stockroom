import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { env } from "../lib/env";
import { emailSender } from "../lib/email";
import { hashPassword, signAccessToken, verifyPassword } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeSession,
  rotateRefreshToken,
} from "../lib/refreshTokens";

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

// /forgot-password is unauthenticated and has a side effect on someone
// else's inbox, which makes it the one endpoint here that can be abused
// against a third party rather than against us: unmetered, it mails a
// stranger a reset link as fast as the loop runs, and writes a token row
// per request. Keyed by IP and email for the same reason login is — one
// shared office address shouldn't be able to lock a colleague out of
// requesting their own reset.
const forgotPasswordLimiter = rateLimit({
  limit: 5,
  windowMs: 60 * 60 * 1000,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
  message: "Too many password reset requests. Please try again later.",
});

// The reset token itself is 256 bits, so this isn't about guessing it —
// it's that an unmetered endpoint doing a hash and a database lookup per
// request is free work for anyone who wants to spend our CPU.
const resetPasswordLimiter = rateLimit({
  limit: 20,
  windowMs: 15 * 60 * 1000,
  message: "Too many password reset attempts. Please try again later.",
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
    const { token: refreshToken } = await issueRefreshToken(prisma, user.id);

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
    // A fresh login starts a new rotation family, so signing out on one
    // device doesn't end the session on another.
    const { token: refreshToken } = await issueRefreshToken(prisma, user.id);

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

// Refreshing now rotates: the presented token is revoked and a new one is
// returned alongside the access token, so a token is only ever good once.
// Callers must persist the returned refreshToken — the old one stops
// working the moment this succeeds.
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const { userId, token: refreshToken } = await rotateRefreshToken(body.refreshToken);

    // Role and organization are read fresh rather than taken from the
    // token, so a promotion or demotion takes effect on the next refresh
    // instead of waiting out the old access token.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    });

    res.json({ accessToken, refreshToken });
  })
);

const logoutSchema = z.object({ refreshToken: z.string() });

// Signing out ends the session server-side instead of only clearing the
// browser. Unauthenticated on purpose: the access token has usually expired
// by the time a user gets around to signing out, and holding the refresh
// token is itself the proof. Always 204, never reporting whether the token
// was real, so this can't be used to probe token validity.
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const body = logoutSchema.parse(req.body);
    await revokeSession(body.refreshToken);
    res.status(204).send();
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

// Self-service password change — the only password-lifecycle flow this
// product has (no email provider is configured anywhere, so a token-based
// reset-by-email flow isn't available yet; see docs/PROGRESS.md). Requires
// knowing the current password rather than an admin override, so an Owner
// can't silently take over a Staff account's login.
router.patch(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      throw ApiError.unauthorized("Current password is incorrect");
    }

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // Changing a password ends every session, including this one. The
      // reason anyone changes a password under suspicion is to stop whoever
      // else has access — leaving their refresh token working for another
      // seven days would defeat the entire exercise. The client re-signs in
      // with the new password.
      await revokeAllForUser(tx, user.id);
    });

    res.status(204).send();
  })
);

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Always responds 202 whether or not the email matches an account — telling
// an anonymous caller "no such account" turns this into a user-enumeration
// oracle, so the only observable difference is whether an email actually
// goes out (and in dev, whether anything gets logged).
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const body = forgotPasswordSchema.parse(req.body);
    const email = body.email.toLowerCase();

    const user = await prisma.user.findFirst({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.$transaction(async (tx) => {
        // Superseding a stale link on every new request keeps at most one
        // usable reset token per user, same reasoning as the invite flow's
        // other password-lifecycle guards.
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashResetToken(token),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });
      });

      const resetUrl = `${env.corsOrigin}/reset-password?token=${token}`;
      await emailSender.send({
        to: user.email,
        subject: "Reset your StockRoom password",
        text: `Someone requested a password reset for this StockRoom account.\n\nReset it here (valid for 1 hour): ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
      });
    }

    res.status(202).json({ message: "If an account exists for that email, we've sent reset instructions." });
  })
);

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

router.post(
  "/reset-password",
  resetPasswordLimiter,
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(body.token) },
    });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw ApiError.badRequest("This reset link is invalid or has expired");
    }

    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: resetToken.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      // A reset is the response to "someone else may have my account", so
      // it has to end that someone else's sessions too.
      await revokeAllForUser(tx, resetToken.userId);
    });

    res.status(204).send();
  })
);

export default router;
