import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { InventoryPage } from "./InventoryPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import { DEFAULT_DEBOUNCE_MS } from "../components/useDebouncedValue";
import type { InventoryItem, Location } from "../api/types";

// Read-only: no create/archive/edit anywhere on this page, so the suite is
// just the search box, the location filter, the table, and pagination (a
// real envelope here, unlike the bare array `GET /locations` itself
// returns).

function location(overrides: Partial<Location> & { id: string; name: string }): Location {
  return { address: null, isDefault: false, isActive: true, ...overrides } as Location;
}

const warehouse = location({ id: "l1", name: "Main Warehouse" });
const storefront = location({ id: "l2", name: "Storefront" });

function item(overrides: Partial<InventoryItem> & { id: string }): InventoryItem {
  return {
    productId: "p1",
    locationId: "l1",
    quantity: 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as InventoryItem;
}

const widget = item({
  id: "i1",
  quantity: 42,
  product: { id: "p1", sku: "WID-1", name: "Widget" } as InventoryItem["product"],
  location: warehouse,
});

function page(items: InventoryItem[], total = items.length) {
  return ok({ items, total, page: 1, pageSize: 50 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
  api.on("GET", "/locations", ok([warehouse, storefront]));
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<InventoryPage />, { user: ownerUser });
}

describe("InventoryPage list", () => {
  it("shows a loading row, then the stock-on-hand rows", async () => {
    api.on("GET", "/inventory", page([widget]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("WID-1")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("dashes out a row whose product or location wasn't included", async () => {
    api.on(
      "GET",
      "/inventory",
      page([item({ id: "i2", quantity: 5 })]) // no product, no location
    );
    renderPage();

    const row = (await screen.findByText("5")).closest("tr") as HTMLElement;
    // Product name, SKU, and location each fall back independently.
    expect(within(row).getAllByText("—")).toHaveLength(3);
  });

  it("asks for every location by default", async () => {
    api.on("GET", "/inventory", page([widget]));
    renderPage();

    await screen.findByText("Widget");
    expect(api.requestsFor("GET", "/inventory")[0].params).toEqual({ page: 1, pageSize: 50 });
  });

  it("says there's no stock rather than showing a bare table", async () => {
    api.on("GET", "/inventory", page([]));
    renderPage();
    expect(await screen.findByText("No stock recorded yet. Record a movement to get started.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/inventory", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load inventory.")).toBeInTheDocument();
    expect(screen.queryByText("No stock recorded yet. Record a movement to get started.")).not.toBeInTheDocument();
  });
});

describe("InventoryPage search", () => {
  it("searches once for a typed word, not once per keystroke", async () => {
    api.on("GET", "/inventory", page([widget], 2), page([widget]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.type(screen.getByPlaceholderText("Search by product name or SKU..."), "Widget");

    await waitFor(
      () => expect(api.requestsFor("GET", "/inventory")).toHaveLength(2),
      { timeout: DEFAULT_DEBOUNCE_MS * 4 }
    );
    expect(api.requestsFor("GET", "/inventory")[1].params).toMatchObject({ search: "Widget", page: 1 });
  });

  it("shows a search-specific empty message, not the brand-new-org one", async () => {
    api.on("GET", "/inventory", page([widget], 1), page([]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.type(screen.getByPlaceholderText("Search by product name or SKU..."), "nope");

    expect(await screen.findByText("No stock records match “nope”.")).toBeInTheDocument();
    expect(screen.queryByText("No stock recorded yet. Record a movement to get started.")).not.toBeInTheDocument();
  });
});

describe("InventoryPage location filter", () => {
  it("filters by the chosen location and resets to page 1", async () => {
    api.on("GET", "/inventory", page([widget], 120), page([widget]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.selectOptions(screen.getByDisplayValue("All locations"), "Main Warehouse");

    await waitFor(() => expect(api.requestsFor("GET", "/inventory")).toHaveLength(2));
    expect(api.requestsFor("GET", "/inventory")[1].params).toEqual({
      page: 1,
      pageSize: 50,
      locationId: "l1",
    });
  });
});

describe("InventoryPage pagination", () => {
  it("hides the control while everything fits on one page", async () => {
    api.on("GET", "/inventory", page([widget]));
    renderPage();
    await screen.findByText("Widget");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("steps to the next page and asks the API for it", async () => {
    api.on(
      "GET",
      "/inventory",
      page([widget], 120),
      ok({ items: [item({ id: "i3", quantity: 7, product: widget.product, location: storefront })], total: 120, page: 2, pageSize: 50 })
    );
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.requestsFor("GET", "/inventory")).toHaveLength(2));
    expect(api.requestsFor("GET", "/inventory")[1].params).toMatchObject({ page: 2 });
    expect(await screen.findByText("51–100 of 120 stock records")).toBeInTheDocument();
  });
});
