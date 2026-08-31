import { requestId } from "../middleware/requestId";

function mockReqRes(headers: Record<string, string | string[] | undefined> = {}) {
  const headerStore: Record<string, string> = {};
  const req = { headers, id: undefined as unknown as string };
  const res = {
    setHeader: (name: string, value: string) => {
      headerStore[name] = value;
    },
  };
  return { req, res, headerStore };
}

describe("requestId middleware", () => {
  it("mints a fresh id when the client sends none", () => {
    const { req, res, headerStore } = mockReqRes();
    const next = jest.fn();

    requestId(req as never, res as never, next);

    expect(req.id).toBeTruthy();
    expect(headerStore["X-Request-Id"]).toBe(req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("mints a fresh id for each request", () => {
    const { req: reqA, res: resA } = mockReqRes();
    const { req: reqB, res: resB } = mockReqRes();
    requestId(reqA as never, resA as never, jest.fn());
    requestId(reqB as never, resB as never, jest.fn());

    expect(reqA.id).not.toBe(reqB.id);
  });

  it("honours a well-formed client-supplied X-Request-Id", () => {
    const { req, headerStore } = mockReqRes({ "x-request-id": "client-supplied-id_123" });

    requestId(req as never, { setHeader: (n: string, v: string) => (headerStore[n] = v) } as never, jest.fn());

    expect(req.id).toBe("client-supplied-id_123");
  });

  // The id ends up inside a JSON log line unescaped by anything but
  // JSON.stringify itself — a client that could inject a newline or an
  // enormous string into that line could make the logs harder to read or
  // parse, so anything that doesn't look like an opaque token is replaced
  // rather than trusted.
  it("replaces a client-supplied id that isn't a safe opaque token", () => {
    const badValues = ["has a space", "has\nnewline", "semi;colon", "a".repeat(65), ""];
    for (const bad of badValues) {
      const { req, headerStore } = mockReqRes({ "x-request-id": bad });
      requestId(req as never, { setHeader: (n: string, v: string) => (headerStore[n] = v) } as never, jest.fn());
      expect(req.id).not.toBe(bad);
      expect(req.id).toBeTruthy();
    }
  });

  it("uses only the first value when the header is sent multiple times", () => {
    const { req } = mockReqRes({ "x-request-id": ["first-value", "second-value"] });
    requestId(req as never, { setHeader: () => undefined } as never, jest.fn());

    expect(req.id).toBe("first-value");
  });
});
