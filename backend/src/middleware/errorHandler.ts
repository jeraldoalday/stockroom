import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }

  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
