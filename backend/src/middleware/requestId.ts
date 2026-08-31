import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

// Bounded and restricted to an opaque-token shape so a caller-supplied
// value can't smuggle a newline or a huge string into a JSON log line —
// this is the one piece of every log line that comes straight from the
// request rather than from our own code.
const SAFE_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Stamps every request with an id, first so every later middleware and log
 * line can carry it, and echoes it back on the response header so a client
 * (or whoever's looking at their network tab) can hand it to support to
 * find the matching server log line.
 *
 * Honours an incoming `X-Request-Id` when it's already the right shape —
 * useful once a caller (a future frontend build, an internal service)
 * generates its own — and mints a fresh one otherwise.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  req.id = candidate && SAFE_CLIENT_ID.test(candidate) ? candidate : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}
