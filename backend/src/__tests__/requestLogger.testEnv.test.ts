// Deliberately does NOT mock ../lib/env, unlike requestLogger.test.ts —
// this exercises the real value NODE_ENV takes under Jest ("test", set by
// Jest itself), confirming the middleware actually stays quiet here rather
// than just asserting it in the abstract.
import { requestLogger } from "../middleware/requestLogger";
import { logger } from "../lib/logger";
import { env } from "../lib/env";

describe("requestLogger middleware under the real test environment", () => {
  it("NODE_ENV is actually 'test', not assumed", () => {
    expect(env.nodeEnv).toBe("test");
  });

  it("does not log once the response finishes", () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const listeners: Record<string, () => void> = {};
    const req = { id: "req-1", method: "GET", originalUrl: "/api/products", auth: undefined };
    const res = { statusCode: 200, on: (event: string, cb: () => void) => (listeners[event] = cb) };

    requestLogger(req as never, res as never, jest.fn());
    listeners.finish?.();

    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });
});
