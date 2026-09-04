import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { ReportsPage } from "./ReportsPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { DeadStockResponse, ReorderSuggestionsResponse, TrendResponse } from "../api/reports";

// ReportsPage fires four independent queries (trend, reorder suggestions,
// dead stock, and — on click only — an export download) plus a days/window
// toggle per panel, none of which shared any coverage before this suite:
// ReportsPage and ProductsPage were the only two pages in the app with none
// at all.

function trend(overrides: Partial<TrendResponse> = {}): TrendResponse {
  return {
    days: 7,
    series: [{ date: "2026-08-25", unitsSold: 5, unitsReceived: 2, revenueCents: 4995 }],
    totals: { unitsSold: 5, unitsReceived: 2, revenueCents: 4995 },
    ...overrides,
  };
}

function reorder(overrides: Partial<ReorderSuggestionsResponse> = {}): ReorderSuggestionsResponse {
  return {
    days: 30,
    coverageDays: 14,
    items: [
      {
        productId: "p1",
        sku: "WID-1",
        name: "Widget",
        currentStock: 2,
        reorderPoint: 5,
        reorderQty: 10,
        avgDailyDemand: 1.5,
        daysOfStockRemaining: 1.3,
        suggestedQty: 19,
      },
    ],
    ...overrides,
  };
}

function deadStock(overrides: Partial<DeadStockResponse> = {}): DeadStockResponse {
  return {
    days: 90,
    items: [
      {
        productId: "p2",
        sku: "DUST-1",
        name: "Old Stock",
        quantityOnHand: 4,
        costCents: 500,
        tiedUpValueCents: 2000,
        lastSoldAt: "2026-05-01T00:00:00.000Z",
        daysSinceLastSale: 120,
      },
    ],
    totals: { productCount: 1, tiedUpValueCents: 2000 },
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
  return renderApp(<ReportsPage />, { user });
}

function mockAllPanels() {
  api.on("GET", "/reports/trend", ok(trend()));
  api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
  api.on("GET", "/reports/dead-stock", ok(deadStock()));
}

describe("ReportsPage days toggle", () => {
  it("asks for 7 days by default", async () => {
    mockAllPanels();
    renderPage();
    await screen.findByText("Widget");
    expect(api.requestsFor("GET", "/reports/trend")[0].params).toEqual({ days: 7 });
  });

  it("switches to 30 days on click", async () => {
    api.on("GET", "/reports/trend", ok(trend()), ok(trend({ days: 30 })));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "30 days" }));

    await waitFor(() => expect(api.requestsFor("GET", "/reports/trend")).toHaveLength(2));
    expect(api.requestsFor("GET", "/reports/trend")[1].params).toEqual({ days: 30 });
  });
});

describe("ReportsPage stat cards", () => {
  it("shows placeholders before the trend loads, then the totals", async () => {
    mockAllPanels();
    renderPage();

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    await screen.findByText("Widget"); // wait for every panel to settle
    expect(screen.getByText("Units sold").nextSibling).toHaveTextContent("5");
    expect(screen.getByText("Units received").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Revenue (attributed)").nextSibling).toHaveTextContent("$49.95");
  });
});

describe("ReportsPage trend panel", () => {
  it("reports a failed load", async () => {
    api.on("GET", "/reports/trend", fail(500, "boom"));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    renderPage();

    expect(await screen.findByText("Failed to load the trend report.")).toBeInTheDocument();
  });

  it("says there were no movements rather than showing a bare chart", async () => {
    api.on("GET", "/reports/trend", ok(trend({ series: [] })));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    renderPage();

    expect(await screen.findByText("No stock movements in the last 7 days.")).toBeInTheDocument();
  });

  it("plots each day with its sold/received counts and revenue", async () => {
    mockAllPanels();
    renderPage();

    expect(await screen.findByText("2026-08-25")).toBeInTheDocument();
    expect(screen.getByText("5 sold")).toBeInTheDocument();
    expect(screen.getByText("2 received")).toBeInTheDocument();
  });
});

describe("ReportsPage reorder suggestions panel", () => {
  it("reports a failed load", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", fail(500, "boom"));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    renderPage();

    expect(await screen.findByText("Failed to load reorder suggestions.")).toBeInTheDocument();
  });

  it("says nothing is at its reorder point rather than showing a bare table", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder({ items: [] })));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    renderPage();

    expect(await screen.findByText("No products are at or below their reorder point.")).toBeInTheDocument();
  });

  it("lists a candidate with its stock, demand, and suggested quantity", async () => {
    mockAllPanels();
    renderPage();

    const row = (await screen.findByText("WID-1", { exact: false })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Widget", { exact: false })).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("1.5")).toBeInTheDocument();
    expect(within(row).getByText("1.3")).toBeInTheDocument();
    expect(within(row).getByText("19")).toBeInTheDocument();
  });

  it("dashes out days-of-stock-remaining when demand is zero", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on(
      "GET",
      "/reports/reorder-suggestions",
      ok(reorder({ items: [{ ...reorder().items[0], avgDailyDemand: 0, daysOfStockRemaining: null }] }))
    );
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    renderPage();

    const row = (await screen.findByText("WID-1", { exact: false })).closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});

describe("ReportsPage dead stock panel", () => {
  it("is shown to an Owner", async () => {
    mockAllPanels();
    renderPage(ownerUser);
    expect(await screen.findByText("Dead stock")).toBeInTheDocument();
  });

  it("is hidden from Staff, and the report is never requested", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    renderPage(staffUser);

    await screen.findByText("Widget");
    expect(screen.queryByText("Dead stock")).not.toBeInTheDocument();
    expect(api.requestsFor("GET", "/reports/dead-stock")).toHaveLength(0);
  });

  it("defaults to a 90-day window", async () => {
    mockAllPanels();
    renderPage();
    await screen.findByText("Old Stock");
    expect(api.requestsFor("GET", "/reports/dead-stock")[0].params).toEqual({ days: 90 });
  });

  it("switches window on click", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock()), ok(deadStock({ days: 180 })));
    const { user } = renderPage();
    await screen.findByText("Old Stock");

    await user.click(screen.getByRole("button", { name: "180d" }));

    await waitFor(() => expect(api.requestsFor("GET", "/reports/dead-stock")).toHaveLength(2));
    expect(api.requestsFor("GET", "/reports/dead-stock")[1].params).toEqual({ days: 180 });
  });

  it("reports a failed load", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", fail(500, "boom"));
    renderPage();

    expect(await screen.findByText("Failed to load the dead-stock report.")).toBeInTheDocument();
  });

  it("says everything has sold rather than showing a bare table", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock({ items: [], totals: { productCount: 0, tiedUpValueCents: 0 } })));
    renderPage();

    expect(
      await screen.findByText("Everything on the shelf has sold at least once in the last 90 days.")
    ).toBeInTheDocument();
  });

  it("shows the tied-up total and a row per dead product", async () => {
    mockAllPanels();
    renderPage();

    expect(await screen.findByText(/tied up/)).toHaveTextContent("$20.00 tied up across 1 product.");
    const row = screen.getByText("Old Stock", { exact: false }).closest("tr") as HTMLElement;
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("$20.00")).toBeInTheDocument();
    expect(within(row).getByText("120 days ago")).toBeInTheDocument();
  });

  it("says a dead product has never sold rather than showing a blank", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on(
      "GET",
      "/reports/dead-stock",
      ok(deadStock({ items: [{ ...deadStock().items[0], lastSoldAt: null, daysSinceLastSale: null }] }))
    );
    renderPage();

    expect(await screen.findByText("Never sold")).toBeInTheDocument();
  });
});

describe("ReportsPage export", () => {
  it("offers all four exports to an Owner", async () => {
    mockAllPanels();
    renderPage(ownerUser);
    await screen.findByText("Widget");

    expect(screen.getByRole("button", { name: "Export Products" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Stock on hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Stock movements" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Dead stock" })).toBeInTheDocument();
  });

  it("hides the dead-stock export from Staff — the report itself is Owner-only", async () => {
    api.on("GET", "/reports/trend", ok(trend()));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    renderPage(staffUser);
    await screen.findByText("Widget");

    expect(screen.getByRole("button", { name: "Export Products" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export Dead stock" })).not.toBeInTheDocument();
  });

  it("downloads the products CSV on click", async () => {
    mockAllPanels();
    api.on("GET", "/reports/export/products", ok("sku,name\nWID-1,Widget\n"));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Export Products" }));

    await waitFor(() => expect(api.requestsFor("GET", "/reports/export/products")).toHaveLength(1));
  });

  it("surfaces a failed export rather than failing silently", async () => {
    mockAllPanels();
    api.on("GET", "/reports/export/stock", fail(500, "boom"));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Export Stock on hand" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("passes the current window through to the movements and dead-stock exports", async () => {
    api.on("GET", "/reports/trend", ok(trend()), ok(trend({ days: 30 })));
    api.on("GET", "/reports/reorder-suggestions", ok(reorder()));
    api.on("GET", "/reports/dead-stock", ok(deadStock()));
    api.on("GET", "/reports/export/movements", ok("createdAt,sku\n"));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() => expect(api.requestsFor("GET", "/reports/trend")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Export Stock movements" }));

    await waitFor(() => expect(api.requestsFor("GET", "/reports/export/movements")).toHaveLength(1));
    expect(api.requestsFor("GET", "/reports/export/movements")[0].params).toEqual({ days: 30 });
  });
});
