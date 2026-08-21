import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { signRefreshToken, verifyRefreshToken } from "./auth";
import { ApiError } from "./errors";
import { env } from "./env";

// Server-side refresh token state. See the RefreshToken model in
// schema.prisma for why this exists at all.
//
// The token handed to the client is still a signed JWT, and this stores a
// hash of it rather than replacing it with an opaque string. Two reasons:
// the signature check is a cheap first gate that rejects garbage without
// touching the database, and the JWT's own `exp` keeps the token
// self-describing for anyone debugging one. The database row is what makes
// it *revocable*, which the JWT alone never could be.

type TxClient = Prisma.TransactionClient | typeof prisma;

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshTokenExpiry(): Date {
  // Mirrors JWT_REFRESH_TTL so the row and the JWT agree on when the token
  // dies. Supports the "7d"/"12h"/"30m"/"3600" forms the env var accepts;
  // anything else is a configuration error worth failing loudly on rather
  // than silently defaulting, since guessing short would log everyone out
  // and guessing long would outlive the token itself.
  const ttl = env.jwtRefreshTtl;
  const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Unsupported JWT_REFRESH_TTL value: ${ttl}`);
  }
  const amount = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "s"] ?? 1000;
  return new Date(Date.now() + amount * unitMs);
}

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
}

/**
 * Mints a refresh token and records it. `familyId` is omitted for a fresh
 * login (a new family starts) and carried through on rotation.
 */
export async function issueRefreshToken(
  tx: TxClient,
  userId: string,
  familyId?: string
): Promise<IssuedRefreshToken> {
  const token = signRefreshToken({ sub: userId });
  const family = familyId ?? crypto.randomUUID();

  await tx.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      familyId: family,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return { token, familyId: family };
}

export async function revokeFamily(tx: TxClient, familyId: string) {
  await tx.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Ends every session for a user. Called when a password changes — the whole
 * point of changing a password after a compromise is that whoever else was
 * holding a token stops being able to use it.
 */
export async function revokeAllForUser(tx: TxClient, userId: string) {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export interface RotationResult {
  userId: string;
  token: string;
}

/**
 * Exchanges a refresh token for a new one, revoking the old.
 *
 * Throws 401 for anything that isn't a live, unexpired, unrevoked token.
 * The one case worth calling out is a token that exists but was already
 * revoked: that means someone is presenting a token that has already been
 * exchanged. It could be a stolen copy being replayed, or a legitimate
 * client that raced itself; nothing in the request distinguishes them, so
 * the whole family is revoked and every session from that login has to
 * re-authenticate. Losing a session is recoverable, an attacker silently
 * refreshing forever is not.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotationResult> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(rawToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  // A validly-signed token with no row is one issued before this table
  // existed, or one whose row was deleted. Either way it is not a session
  // we can account for, so it isn't honoured.
  if (!existing) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  if (existing.revokedAt) {
    await revokeFamily(prisma, existing.familyId);
    throw ApiError.unauthorized("This session has been revoked. Please sign in again.");
  }

  if (existing.expiresAt <= new Date()) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.id !== existing.userId) {
    throw ApiError.unauthorized("User no longer exists");
  }

  const issued = await prisma.$transaction(async (tx) => {
    const next = await issueRefreshToken(tx, existing.userId, existing.familyId);
    const replacement = await tx.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(next.token) },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: replacement?.id ?? null },
    });
    return next;
  });

  return { userId: existing.userId, token: issued.token };
}

/**
 * Ends the session a token belongs to. Revokes the whole family rather than
 * the single token, because "sign out" means this device stops working —
 * revoking only the presented token would leave its already-rotated
 * predecessors' family alive if one were still in flight.
 */
export async function revokeSession(rawToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  });
  // Signing out is idempotent and never reports whether the token was real:
  // an unauthenticated caller shouldn't be able to probe token validity here.
  if (!existing) return;
  await revokeFamily(prisma, existing.familyId);
}
