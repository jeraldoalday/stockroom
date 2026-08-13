import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env";
import type { UserRole } from "@prisma/client";

const SALT_ROUNDS = 10;

export interface AccessTokenPayload {
  sub: string; // user id
  organizationId: string;
  role: UserRole;
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
  return jwt.sign(payload, env.jwtRefreshSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}
