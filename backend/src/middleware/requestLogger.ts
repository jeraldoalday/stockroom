import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import { env } from "../lib/env";

/**
 * One structured log line per request, written on `finish` rather than at
 * the top of the handler so it carries the actual outcome — status code,
 * duration, and (when the route is authenticated) which org and user —
 * instead of just "a request started". `req.auth` isn't set yet when this
 * middleware itself runs — `requireAuth` hasn't executed — but the
 * listener below fires after the whole request/response cycle, by which
 * point it is.
 *
 * Deliberately logs method, path and query only, never the request body:
 * every mutating endpoint in this app takes its input as a JSON body, and
 * that's exactly where a password or token would be. Query strings here
 * are just filters and pagination (see the route layer's Zod schemas), so
 * logging the full URL is not a secrets leak.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    // Every one of the hundreds of requests the Jest suite fires would
    // otherwise write a JSON line to stdout per test run, on top of the
    // console noise already there from ConsoleEmailSender — same reasoning
    // as lib/prisma.ts gating its dev-only global caching on NODE_ENV, just
    // applied to log volume instead of a connection pool.
    if (env.nodeEnv === "test") return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info("request", {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      organizationId: req.auth?.organizationId,
      userId: req.auth?.userId,
    });
  });

  next();
}
