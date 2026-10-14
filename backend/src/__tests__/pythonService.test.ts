// lib/env.ts reads PYTHON_SERVICE_TIMEOUT_MS at module load time, so (like
// email.test.ts) this re-requires both lib/env and lib/pythonService fresh
// with a short timeout instead of waiting out the real default.
async function loadPythonService(envOverrides: Record<string, string | undefined>) {
  jest.resetModules();
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await import("../lib/pythonService");
  } finally {
    process.env = previous;
  }
}

describe("callPythonService timeout", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("aborts and surfaces a 503 when the python service never responds", async () => {
    const { callPythonService } = await loadPythonService({ PYTHON_SERVICE_TIMEOUT_MS: "20" });

    jest.spyOn(global, "fetch").mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    await expect(callPythonService("/export/products", {})).rejects.toMatchObject({
      status: 503,
      message: "Reports service is unavailable",
    });
  });

  it("still resolves normally when the python service responds before the timeout", async () => {
    const { callPythonService } = await loadPythonService({ PYTHON_SERVICE_TIMEOUT_MS: "5000" });

    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/csv" }),
      text: async () => "sku,name\n",
    } as Response);

    const result = await callPythonService("/export/products", {});
    expect(result.body).toBe("sku,name\n");
  });
});
