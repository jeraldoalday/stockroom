import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "../lib/auth";
import { ApiError } from "../lib/errors";
import { redactForRole } from "../lib/rbac";

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
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Missing bearer token"));
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      role: payload.role,
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
  } catch {
    next(ApiError.unauthorized("Invalid or expired token"));
  }
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
