import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env";
import type { UserRole } from "@prisma/client";

const SALT_ROUNDS = 10;

export interface AccessTokenPayload {
  sub: string; // user id
  organizationId: string;
  role: UserRole;
  // The refresh-token family this access token was minted from, i.e. the
  // session. Carried so an authenticated request can tell which of the
  // user's sessions is the one making it — the Account page needs to label
  // "this device" in the session list, and nothing else in the request
  // identifies it.
  //
  // Optional because a token issued before this claim existed is still
  // valid for up to its fifteen minutes; those simply report no session
  // rather than being rejected.
  sessionId?: string;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtAccessTtl as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

export function signRefreshToken(payload: { sub: string }): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtRefreshTtl as jwt.SignOptions["expiresIn"] };
  // `jti` makes every issued token unique. Without it the payload is just
  // {sub, iat, exp}, and `iat`/`exp` have one-second resolution — so two
  // tokens minted for the same user in the same second are byte-identical.
  // That was harmless while refresh tokens were stateless, and became a bug
  // the moment they were stored: identical tokens hash identically, and the
  // unique index on RefreshToken.tokenHash would reject the second one, so
  // logging in twice quickly (or rotating immediately after login) failed at
  // the database.
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, env.jwtRefreshSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}

// Shared by the forgot-password flow and the team-invite flow: both hand a
// user a one-time link that lands on `/reset-password`, and both need the
// same "generate an opaque token, store only its hash" shape. Keeping this
// in one place means the two call sites can't quietly drift onto different
// hashing schemes the way two independently-written copies eventually do.
export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
