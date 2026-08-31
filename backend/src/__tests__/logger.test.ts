import { logger } from "../lib/logger";

describe("logger", () => {
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it("writes info lines to console.log as a single parseable JSON object", () => {
    logger.info("request", { requestId: "abc-123", status: 200 });

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleLog.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", message: "request", requestId: "abc-123", status: 200 });
    expect(typeof parsed.time).toBe("string");
  });

  it("writes error lines to console.error, not console.log", () => {
    logger.error("unhandled error", { requestId: "xyz-789" });

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "error", message: "unhandled error", requestId: "xyz-789" });
  });

  it("still produces valid JSON when a field's own value contains quotes and newlines", () => {
    logger.error("unhandled error", { detail: 'line one\nline two "quoted"' });

    const parsed = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(parsed.detail).toBe('line one\nline two "quoted"');
  });
});
