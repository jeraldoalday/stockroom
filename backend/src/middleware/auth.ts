import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "../lib/auth";
import { ApiError } from "../lib/errors";

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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
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
