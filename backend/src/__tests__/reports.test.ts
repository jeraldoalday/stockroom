import request from "supertest";

jest.mock("../lib/prisma");

import { __resetPrismaMock } from "../lib/__mocks__/prisma";
import { createApp } from "../app";

const app = createApp();

beforeEach(() => {
  __resetPrismaMock();
  jest.restoreAllMocks();
});

async function signUpAndGetToken(email: string, orgName: string) {
  const res = await request(app).post("/api/auth/signup").send({
    organizationName: orgName,
    name: "Owner",
    email,
    password: "hunter22222",
  });
  return res.body.accessToken as string;
}

function mockPythonServiceResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers ?? { "content-type": "text/csv" });
  return jest.spyOn(global, "fetch").mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers,
    text: async () => body,
  } as Response);
}

describe("GET /api/reports/*", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/reports/export/products");
    expect(res.status).toBe(401);
  });

  it("proxies the products CSV export, scoped to the caller's organization", async () => {
    const token = await signUpAndGetToken("owner@shop.test", "The Shop");
    const fetchSpy = mockPythonServiceResponse("sku,name\nSKU-1,Widget\n");

    const res = await request(app).get("/api/reports/export/products").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("SKU-1");
    const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(calledUrl.pathname).toBe("/export/products");
    expect(calledUrl.searchParams.get("organization_id")).toBeTruthy();
    expect(calledUrl.searchParams.get("include_cost")).toBe("true");
    const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((calledInit.headers as Record<string, string>)["x-internal-key"]).toBeTruthy();
  });

  it("tells the python service to drop cost data when a STAFF user exports products", async () => {
    const ownerToken = await signUpAndGetToken("owner8@shop.test", "Shop 8");
    const invite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Clerk", email: "clerk8@shop.test", password: "hunter22222", role: "STAFF" });
    const staffLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "clerk8@shop.test", password: "hunter22222" });
    expect(invite.status).toBe(201);

    const fetchSpy = mockPythonServiceResponse("sku,name\nSKU-1,Widget\n");

    const res = await request(app)
      .get("/api/reports/export/products")
      .set("Authorization", `Bearer ${staffLogin.body.accessToken}`);

    expect(res.status).toBe(200);
    const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(calledUrl.searchParams.get("include_cost")).toBe("false");
  });

  it("passes the days query through to the movements export", async () => {
    const token = await signUpAndGetToken("owner2@shop.test", "Shop 2");
    const fetchSpy = mockPythonServiceResponse("createdAt,sku\n");

    const res = await request(app)
      .get("/api/reports/export/movements")
      .query({ days: 14 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(calledUrl.searchParams.get("days")).toBe("14");
  });

  it("returns the trend JSON payload", async () => {
    const token = await signUpAndGetToken("owner3@shop.test", "Shop 3");
    mockPythonServiceResponse(JSON.stringify({ days: 7, series: [], totals: { unitsSold: 0 } }), {
      headers: { "content-type": "application/json" },
    });

    const res = await request(app).get("/api/reports/trend").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
  });

  it("returns a 502 when the reports service errors", async () => {
    const token = await signUpAndGetToken("owner4@shop.test", "Shop 4");
    mockPythonServiceResponse("", { status: 500 });

    const res = await request(app).get("/api/reports/export/stock").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(502);
  });

  it("rejects an out-of-range days value", async () => {
    const token = await signUpAndGetToken("owner5@shop.test", "Shop 5");
    mockPythonServiceResponse("");

    const res = await request(app)
      .get("/api/reports/trend")
      .query({ days: 0 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("proxies reorder suggestions, passing days and coverageDays through", async () => {
    const token = await signUpAndGetToken("owner6@shop.test", "Shop 6");
    const fetchSpy = mockPythonServiceResponse(JSON.stringify({ days: 30, coverageDays: 7, items: [] }), {
      headers: { "content-type": "application/json" },
    });

    const res = await request(app)
      .get("/api/reports/reorder-suggestions")
      .query({ days: 30, coverageDays: 7 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.coverageDays).toBe(7);
    const calledUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(calledUrl.pathname).toBe("/reports/reorder-suggestions");
    expect(calledUrl.searchParams.get("days")).toBe("30");
    expect(calledUrl.searchParams.get("coverage_days")).toBe("7");
  });

  it("rejects an out-of-range coverageDays value", async () => {
    const token = await signUpAndGetToken("owner7@shop.test", "Shop 7");
    mockPythonServiceResponse("");

    const res = await request(app)
      .get("/api/reports/reorder-suggestions")
      .query({ coverageDays: 0 })
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});
