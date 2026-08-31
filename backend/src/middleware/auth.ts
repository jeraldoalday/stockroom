import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "../lib/auth";
import { ApiError } from "../lib/errors";
import { redactForRole } from "../lib/rbac";
import { isFamilyLive } from "../lib/refreshTokens";

// Augment Express's Request with the authenticated principal. Every
// tenant-scoped query in the app reads req.auth.organizationId — the
// client can never supply its own organizationId.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        organizationId: string;
        role: UserRole;
        // The session (refresh-token family) this request's access token
        // came from. Absent on a token minted before the claim existed.
        sessionId?: string;
      };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Missing bearer token"));
  }

  const token = header.slice("Bearer ".length);
  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(ApiError.unauthorized("Invalid or expired token"));
  }

  // Confirms the session this token was minted from hasn't been revoked
  // since — see isFamilyLive's own comment for why this is what makes a
  // revocation take effect immediately rather than after up to 15 minutes.
  // Absent only for a token minted before `sessionId` existed as a claim;
  // those fall back to the old bearer-only trust, same as always.
  if (payload.sessionId) {
    let live: boolean;
    try {
      live = await isFamilyLive(payload.sessionId);
    } catch (error) {
      return next(error);
    }
    if (!live) {
      return next(ApiError.unauthorized("This session has been revoked. Please sign in again."));
    }
  }

  req.auth = {
    userId: payload.sub,
    organizationId: payload.organizationId,
    role: payload.role,
    sessionId: payload.sessionId,
  };

  // Every authenticated JSON response is shaped in one place, regardless
  // of which route produced it (see lib/rbac.ts): secret fields such as
  // passwordHash are always stripped — they leak through Prisma relation
  // includes without any route naming them — and cost/margin fields are
  // additionally stripped for a STAFF principal.
  const originalJson = res.json.bind(res);
  const role = payload.role;
  res.json = ((body: unknown) => originalJson(redactForRole(body, role))) as Response["json"];

  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.auth.role)) {
      return next(ApiError.forbidden("Insufficient role for this action"));
    }
    next();
  };
}
