import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";
import { logger } from "../lib/logger";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Route not found" });
}

// Prisma throws for constraint violations that the route layer usually
// checks for first (e.g. "is this SKU taken?"), but a check-then-write is
// not atomic: two concurrent requests can both pass the check and one will
// then fail at the database. Without this mapping those races surfaced as
// an opaque 500 even though the correct answer is a plain 409/404.
function translatePrismaError(err: Prisma.PrismaClientKnownRequestError): ApiError | null {
  switch (err.code) {
    case "P2002": {
      // Unique constraint violation. `target` is the column list, which is
      // useful to echo back ("email already exists") but is only populated
      // on some connectors, so it degrades to a generic message.
      const target = err.meta?.target;
      const fields = Array.isArray(target) ? target.join(", ") : typeof target === "string" ? target : null;
      return ApiError.conflict(
        fields ? `A record with this ${fields} already exists` : "A record with these details already exists"
      );
    }
    case "P2003":
      return ApiError.conflict("This record is still referenced by other records");
    case "P2025":
      return ApiError.notFound("Record not found");
    default:
      return null;
  }
}

// Logs an unexpected failure with everything needed to find it again: the
// request id (also echoed on the response's X-Request-Id header, so a
// client-side error report or a support ticket can be matched back to this
// exact line), which route it was, and the stack. Client errors (bad input,
// a missing record, an expired token) are not logged here — `requestLogger`
// already writes a line for every request with its status code, and a 4xx
// is an expected outcome, not an incident to page anyone about.
function logUnexpected(err: unknown, req: Request) {
  logger.error("unhandled error", {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
}

// Express identifies an error handler by its four-parameter signature, so
// `_next` must stay in the list even though nothing calls it.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const translated = translatePrismaError(err);
    if (translated) {
      return res.status(translated.status).json({ error: translated.message });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // A malformed query is our bug, not the caller's — log it in full but
    // don't echo the query back, since it names internal columns.
    logUnexpected(err, req);
    return res.status(500).json({ error: "Internal server error" });
  }

  logUnexpected(err, req);
  return res.status(500).json({ error: "Internal server error" });
}
