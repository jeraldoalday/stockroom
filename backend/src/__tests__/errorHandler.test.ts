import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";
import { errorHandler, notFoundHandler } from "../middleware/errorHandler";
import { ApiError } from "../lib/errors";

function mockResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function knownRequestError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "5.19.1",
    meta,
  });
}

const req = {} as never;
const next = (() => undefined) as never;

describe("errorHandler", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("returns 400 with flattened field errors for a ZodError", () => {
    const res = mockResponse();
    let zodError: ZodError;
    try {
      z.object({ email: z.string().email() }).parse({ email: "nope" });
      throw new Error("expected a ZodError");
    } catch (err) {
      zodError = err as ZodError;
    }

    errorHandler(zodError!, req, res as never, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: "Validation failed" });
  });

  it("passes an ApiError's status and message straight through", () => {
    const res = mockResponse();
    errorHandler(ApiError.forbidden("Insufficient role for this action"), req, res as never, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: "Insufficient role for this action" });
  });

  // The routes check "is this SKU/email taken?" before writing, but that
  // check-then-write isn't atomic — two concurrent signups with the same
  // email both pass the check and one loses at the database. That used to
  // surface as a 500; a duplicate is a 409.
  it("maps a P2002 unique-constraint violation to 409 and names the field", () => {
    const res = mockResponse();
    errorHandler(knownRequestError("P2002", { target: ["email"] }), req, res as never, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "A record with this email already exists" });
  });

  it("falls back to a generic 409 message when P2002 carries no target", () => {
    const res = mockResponse();
    errorHandler(knownRequestError("P2002"), req, res as never, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "A record with these details already exists" });
  });

  it("maps a P2003 foreign-key violation to 409", () => {
    const res = mockResponse();
    errorHandler(knownRequestError("P2003"), req, res as never, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "This record is still referenced by other records" });
  });

  it("maps a P2025 missing-record error to 404", () => {
    const res = mockResponse();
    errorHandler(knownRequestError("P2025"), req, res as never, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Record not found" });
  });

  it("still returns 500 for an unrecognised Prisma error code", () => {
    const res = mockResponse();
    errorHandler(knownRequestError("P1001"), req, res as never, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  // A malformed query is our bug; the message names internal columns, so
  // it's logged in full but never echoed to the caller.
  it("logs but does not echo a Prisma validation error", () => {
    const res = mockResponse();
    errorHandler(
      new Prisma.PrismaClientValidationError("Unknown arg `nope`", { clientVersion: "5.19.1" }),
      req,
      res as never,
      next
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("nope");
    expect(consoleError).toHaveBeenCalled();
  });

  it("returns 500 without leaking the message for an unknown error", () => {
    const res = mockResponse();
    errorHandler(new Error("connection string is postgres://user:pass@host"), req, res as never, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("notFoundHandler", () => {
  it("returns 404 for an unmatched route", () => {
    const res = mockResponse();
    notFoundHandler(req, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Route not found" });
  });
});
