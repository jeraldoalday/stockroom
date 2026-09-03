import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { DashboardSummary, StockMovement } from "../api/types";
import type { TopMoversResponse } from "../api/dashboard";

// DashboardPage fires three independent queries (summary, low-stock,
// top-movers) and each one's failure/loading/empty state is handled
// separately in the markup — the "most logic, least coverage" page flagged
// in the Day 23 log. Covers: the OWNER-only stock-value card (the one place
// on this page PRD §4's cost/margin redaction is visible), each panel's own
// loading/empty/error state, and that the three queries don't block on
// each other.

const movement: StockMovement = {
  id: "m1",
  type: "RECEIVE",
  quantity: 20,
  unitPriceCents: null,
  stocktakeId: null,
  reason: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  product: { id: "p1", sku: "SKU-1", name: "Widget", description: null, categoryId: null, priceCents: 999, reorderPoint: 5, reorderQty: 10, isActive: true },
};

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    totalStockValueCents: 500000,
    activeProductCount: 12,
    lowStockCount: 1,
    recentMovements: [movement],
    ...overrides,
  };
}

function topMovers(overrides: Partial<TopMoversResponse> = {}): TopMoversResponse {
  return {
    days: 30,
    items: [
      { productId: "p1", sku: "SKU-1", name: "Widget", isActive: true, unitsSold: 40, estimatedValueCents: 39960 },
    ],
    ...overrides,
  };
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

function renderPage(user = ownerUser) {
  return renderApp(<DashboardPage />, { user });
}

describe("DashboardPage greeting", () => {
  it("greets the signed-in user by name", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("Welcome back, Dana Owner")).toBeInTheDocument();
  });
});

describe("DashboardPage stat cards", () => {
  it("shows the stock value card to an Owner", async () => {
    api.on("GET", "/dashboard/summary", ok(summary({ totalStockValueCents: 123456 })));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage(ownerUser);

    expect(screen.getByText("Total stock value")).toBeInTheDocument();
    expect(await screen.findByText("$1,234.56")).toBeInTheDocument();
  });

  it("hides the stock value card from Staff — cost/margin data is Owner-only (PRD §4)", async () => {
    // The API also omits totalStockValueCents for a STAFF principal, but the
    // card is hidden on `user.role` alone rather than on the field's
    // presence, so this holds even if a response ever includes it by mistake.
    api.on("GET", "/dashboard/summary", ok(summary({ totalStockValueCents: undefined })));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage(staffUser);

    await screen.findByText("Active products");
    expect(screen.queryByText("Total stock value")).not.toBeInTheDocument();
  });

  it("shows placeholders before the summary loads, then the real counts", async () => {
    api.on("GET", "/dashboard/summary", ok(summary({ activeProductCount: 7, lowStockCount: 2 })));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("reports a failed summary load without hiding the rest of the page", async () => {
    api.on("GET", "/dashboard/summary", fail(500, "boom"));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("Failed to load the dashboard.")).toBeInTheDocument();
    // The other two panels don't depend on the summary query and should
    // still render their own data.
    expect(await screen.findByText("Widget")).toBeInTheDocument();
  });
});

describe("DashboardPage low stock panel", () => {
  it("lists a low-stock product with its quantity and reorder point", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on(
      "GET",
      "/dashboard/low-stock",
      ok({
        items: [{ product: { ...movement.product!, name: "Gadget", reorderPoint: 15 }, quantity: 3 }],
        total: 1,
        page: 1,
        pageSize: 25,
      })
    );
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    const row = (await screen.findByText("Gadget")).closest("tr") as HTMLElement;
    expect(row.textContent).toContain("3");
    expect(row.textContent).toContain("15");
  });

  it("says nothing is low on stock rather than showing a bare table", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("Nothing is low on stock.")).toBeInTheDocument();
  });

  it("reports a failed low-stock load instead of an empty table", async () => {
    // This query previously had no isError branch at all: a failed load
    // rendered nothing, indistinguishable from "nothing is low on stock".
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", fail(500, "boom"));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("Failed to load low stock.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is low on stock.")).not.toBeInTheDocument();
  });
});

describe("DashboardPage recent activity panel", () => {
  it("labels each movement type and signs the quantity", async () => {
    api.on(
      "GET",
      "/dashboard/summary",
      ok(
        summary({
          recentMovements: [
            { ...movement, id: "m1", type: "RECEIVE", quantity: 20 },
            { ...movement, id: "m2", type: "SALE", quantity: -5 },
          ],
        })
      )
    );
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("Received")).toBeInTheDocument();
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("Sold")).toBeInTheDocument();
    expect(screen.getByText("-5")).toBeInTheDocument();
  });

  it("falls back to a dash for a movement whose product isn't included", async () => {
    api.on(
      "GET",
      "/dashboard/summary",
      ok(summary({ recentMovements: [{ ...movement, product: undefined }] }))
    );
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    await screen.findByText("Received");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says no movements yet rather than showing a bare table", async () => {
    api.on("GET", "/dashboard/summary", ok(summary({ recentMovements: [] })));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers()));
    renderPage();

    expect(await screen.findByText("No stock movements yet.")).toBeInTheDocument();
  });
});

describe("DashboardPage top movers panel", () => {
  it("shows units sold and value at list price, with the window used", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on(
      "GET",
      "/dashboard/top-movers",
      ok(topMovers({ days: 30, items: [{ productId: "p1", sku: "SKU-1", name: "Widget", isActive: true, unitsSold: 40, estimatedValueCents: 39960 }] }))
    );
    renderPage();

    // Both the recent-activity panel and this one can render a "Widget"
    // row, so anchor on the SKU tag, which only the top-movers panel shows.
    const sku = await screen.findByText("SKU-1");
    const row = sku.closest("tr") as HTMLElement;
    expect(within(row).getByText("Widget")).toBeInTheDocument();
    expect(within(row).getByText("40")).toBeInTheDocument();
    expect(within(row).getByText("$399.60")).toBeInTheDocument();
    expect(screen.getByText("last 30 days")).toBeInTheDocument();
  });

  it("flags an archived product that still sold in the window", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on(
      "GET",
      "/dashboard/top-movers",
      ok(topMovers({ items: [{ productId: "p1", sku: "SKU-1", name: "Widget", isActive: false, unitsSold: 40, estimatedValueCents: 39960 }] }))
    );
    renderPage();

    const sku = await screen.findByText("SKU-1");
    const row = sku.closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
  });

  it("names the window in the empty state, not just a bare count", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", ok(topMovers({ days: 30, items: [] })));
    renderPage();

    expect(await screen.findByText("No sales recorded in the last 30 days.")).toBeInTheDocument();
  });

  it("reports a failed load without blocking the other panels", async () => {
    api.on("GET", "/dashboard/summary", ok(summary()));
    api.on("GET", "/dashboard/low-stock", ok({ items: [], total: 0, page: 1, pageSize: 25 }));
    api.on("GET", "/dashboard/top-movers", fail(500, "boom"));
    renderPage();

    expect(await screen.findByText("Failed to load top movers.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is low on stock.")).toBeInTheDocument();
  });
});
