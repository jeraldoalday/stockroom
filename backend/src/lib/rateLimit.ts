// Shared-state (Postgres-backed) fixed-window rate limiter.
//
// PRD §7 asks for bcrypt-hashed passwords and short-lived tokens but says
// nothing about throttling; without it, /api/auth/login is an unmetered
// password oracle — bcrypt at 10 rounds costs an attacker nothing because
// *we* pay the CPU, so a slow hash actually makes an unthrottled login
// endpoint a cheap denial-of-service target as well as a credential one.
//
// This used to be an in-process Map, which worked for a single container
// but silently stopped protecting anything the moment a second API instance
// ran behind a load balancer — each instance would count independently, so
// an attacker gets `limit` attempts per instance rather than in total. It's
// backed by the same Postgres database everything else already lives in,
// rather than adding Redis as a second store this project has no other use
// for. One row per (limiter name, caller key); the window check and the
// increment happen in a single `INSERT ... ON CONFLICT DO UPDATE`, so two
// requests racing to open a fresh window still serialize on the same row
// instead of both resetting the counter to 1. Expired rows aren't deleted
// here — the same hourly sweep that already prunes token tables
// (lib/tokenPruning.ts) prunes this one too.

import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";
import { prisma } from "./prisma";

export interface RateLimitOptions {
  /** Distinguishes this limiter's buckets from every other limiter's in the
   *  shared table. Without it, login and forgot-password both keying on
   *  `ip:email` would silently share one counter. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Derives the caller's portion of the bucket key; defaults to their IP. */
  keyGenerator?: (req: Request) => string;
  /** Message returned once the limit is exceeded. */
  message?: string;
}

export interface HitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function defaultKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Records a hit against `bucketKey` and reports whether it's within `limit`
 * for a `windowMs` fixed window, atomically.
 *
 * `now` is injectable so tests don't have to wait out a real window.
 */
export async function hitRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<HitResult> {
  const freshResetAt = new Date(now.getTime() + windowMs);

  // The CASE expressions do the "is the old window still live?" check and
  // the increment-or-reset in the same statement Postgres uses to resolve
  // the conflict, so there's no gap between reading the row and writing it
  // back for two concurrent requests to land in.
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    -- rateLimit.hit
    INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt")
    VALUES (${bucketKey}, 1, ${freshResetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN ${freshResetAt}
        ELSE "rate_limit_buckets"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  const retryAfterSeconds = Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
  if (row.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - row.count, retryAfterSeconds };
}

/** Clears a bucket outright — called after a successful login so a user who
 * simply mistyped their password a few times isn't left throttled. */
export async function resetRateLimit(bucketKey: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({ where: { key: bucketKey } });
}

export function rateLimit(options: RateLimitOptions) {
  const keyFor = (req: Request) => `${options.name}:${(options.keyGenerator ?? defaultKey)(req)}`;

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await hitRateLimit(keyFor(req), options.limit, options.windowMs);

      res.setHeader("X-RateLimit-Limit", String(options.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        return next(new ApiError(429, options.message ?? "Too many requests, please try again later"));
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  // Exposed so a route can clear its own caller's bucket on success (see the
  // login handler) without recomputing the key itself.
  middleware.keyFor = keyFor;
  middleware.reset = (req: Request) => resetRateLimit(keyFor(req));

  return middleware;
}
