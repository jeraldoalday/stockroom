// Fixed-window rate limiter, in-process.
//
// PRD §7 asks for bcrypt-hashed passwords and short-lived tokens but says
// nothing about throttling; without it, /api/auth/login is an unmetered
// password oracle — bcrypt at 10 rounds costs an attacker nothing because
// *we* pay the CPU, so a slow hash actually makes an unthrottled login
// endpoint a cheap denial-of-service target as well as a credential one.
//
// Deliberately in-process (a Map, not Redis): the MVP runs as a single
// container per docker-compose, and an in-memory limiter that works today
// beats a distributed one that needs infrastructure the project doesn't
// have yet. The counter resetting on deploy is an acceptable trade; the
// limitation is written down in docs/DEPLOYMENT.md so that scaling to more
// than one API instance doesn't silently weaken this.

import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./errors";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Derives the bucket key; defaults to the caller's IP. */
  keyGenerator?: (req: Request) => string;
  /** Message returned once the limit is exceeded. */
  message?: string;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private options: RateLimitOptions) {}

  /**
   * Records a hit and reports whether it is allowed. `retryAfterSeconds` is
   * how long the caller should wait before the window rolls over.
   */
  hit(key: string, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + this.options.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.options.limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count > this.options.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: this.options.limit - bucket.count, retryAfterSeconds };
  }

  /** Clears a key's counter — called after a successful login so a user who
   * simply mistyped their password a few times isn't left throttled. */
  reset(key: string) {
    this.buckets.delete(key);
  }

  /** Drops expired buckets so the Map doesn't grow without bound. Called
   * opportunistically from the middleware rather than on a timer, which
   * would keep the event loop alive and hang Jest. */
  prune(now = Date.now()) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  get size() {
    return this.buckets.size;
  }

  clear() {
    this.buckets.clear();
  }
}

function defaultKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

// Every limiter created via rateLimit() registers here so the test suite
// can clear all of them between cases. The limiters are module-level
// singletons by design (they have to outlive a request to count anything),
// which would otherwise leak a 429 from one test into the next.
const registry: RateLimiter[] = [];

export function __resetAllRateLimiters() {
  registry.forEach((limiter) => limiter.clear());
}

export function rateLimit(options: RateLimitOptions) {
  const limiter = new RateLimiter(options);
  registry.push(limiter);
  let hitsSincePrune = 0;

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    hitsSincePrune += 1;
    if (hitsSincePrune >= 1000) {
      hitsSincePrune = 0;
      limiter.prune();
    }

    const key = (options.keyGenerator ?? defaultKey)(req);
    const result = limiter.hit(key);

    res.setHeader("X-RateLimit-Limit", String(options.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      return next(new ApiError(429, options.message ?? "Too many requests, please try again later"));
    }
    next();
  };

  // Exposed so routes can clear a caller's counter on success (see the
  // login handler) and so tests can assert against the bucket directly.
  middleware.limiter = limiter;
  middleware.keyFor = options.keyGenerator ?? defaultKey;
  return middleware;
}
