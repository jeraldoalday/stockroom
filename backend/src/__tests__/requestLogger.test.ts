// Mocked so this file can exercise the "actually logs" branch, which is
// gated off for every other test file by NODE_ENV === "test" (see
// requestLogger.ts's comment on why: one JSON line per request times the
// rest of the suite would drown its output).
jest.mock("../lib/env", () => ({ env: { nodeEnv: "production" } }));

import { requestLogger } from "../middleware/requestLogger";
import { logger } from "../lib/logger";

function mockReqRes(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, () => void> = {};
  const req = {
    id: "req-1",
    method: "GET",
    originalUrl: "/api/products?search=widget",
    auth: undefined,
    ...overrides,
  };
  const res = {
    statusCode: 200,
    on: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
  };
  return { req, res, finish: () => listeners.finish?.() };
}

describe("requestLogger middleware", () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("calls next immediately, before the response finishes", () => {
    const { req, res } = mockReqRes();
    const next = jest.fn();

    requestLogger(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs method, path, status and requestId once the response finishes", () => {
    const { req, res, finish } = mockReqRes({ id: "req-42", method: "POST", originalUrl: "/api/products" });
    (res as { statusCode: number }).statusCode = 201;

    requestLogger(req as never, res as never, jest.fn());
    finish();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [message, fields] = infoSpy.mock.calls[0];
    expect(message).toBe("request");
    expect(fields).toMatchObject({
      requestId: "req-42",
      method: "POST",
      path: "/api/products",
      status: 201,
    });
    expect(typeof fields.durationMs).toBe("number");
  });

  it("includes organizationId and userId once requireAuth has populated req.auth", () => {
    const { req, res, finish } = mockReqRes({
      auth: { userId: "user_1", organizationId: "org_1", role: "OWNER" },
    });

    requestLogger(req as never, res as never, jest.fn());
    finish();

    const [, fields] = infoSpy.mock.calls[0];
    expect(fields).toMatchObject({ organizationId: "org_1", userId: "user_1" });
  });

  it("omits organizationId and userId for an unauthenticated request", () => {
    const { req, res, finish } = mockReqRes();

    requestLogger(req as never, res as never, jest.fn());
    finish();

    const [, fields] = infoSpy.mock.calls[0];
    expect(fields.organizationId).toBeUndefined();
    expect(fields.userId).toBeUndefined();
  });
});
