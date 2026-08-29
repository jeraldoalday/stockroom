import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { StockMovementsPage } from "./StockMovementsPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Location, MovementActor, Product, StockMovement } from "../api/types";

const widget: Product = {
  id: "p1", sku: "WID-1", name: "Widget", description: null, categoryId: null,
  priceCents: 999, reorderPoint: 5, reorderQty: 10, isActive: true,
};
const gadget: Product = {
  id: "p2", sku: "GAD-1", name: "Gadget", description: null, categoryId: null,
  priceCents: 1999, reorderPoint: 3, reorderQty: 5, isActive: true,
};
const warehouse: Location = { id: "l1", name: "Warehouse", address: null, isDefault: true, isActive: true };
const storefront: Location = { id: "l2", name: "Storefront", address: null, isDefault: false, isActive: true };
const dana: MovementActor = { id: "u1", name: "Riley Actor", email: "owner@northside.test", role: "OWNER" };

function movement(overrides: Partial<StockMovement> & { id: string }): StockMovement {
  return {
    type: "RECEIVE",
    quantity: 10,
    unitPriceCents: null,
    reason: null,
    createdAt: "2026-08-01T12:00:00Z",
    product: widget,
    location: warehouse,
    actor: dana,
    ...overrides,
  } as StockMovement;
}

function page(items: StockMovement[], total = items.length, pageNum = 1) {
  return ok({ items, total, page: pageNum, pageSize: 25 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

/** Every mount fires these two regardless of what the test cares about. */
function mockLookups(): void {
  api.on("GET", "/products", ok({ items: [widget, gadget], total: 2, page: 1, pageSize: 100 }));
  api.on("GET", "/locations", ok([warehouse, storefront]));
}

function renderPage() {
  return renderApp(<StockMovementsPage />, { user: ownerUser });
}

/** The single open form (Record movement and Transfer stock are mutually exclusive). */
function openForm(container: HTMLElement): HTMLElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("no form is open");
  return form as HTMLElement;
}

describe("StockMovementsPage list", () => {
  it("shows a loading row, then the movements", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([movement({ id: "m1" })]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    // "Warehouse"/"Received" also name options in the always-present filter
    // bar, so a plain text query is ambiguous — the table cell has role
    // "cell", the `<option>` doesn't.
    expect(screen.getByRole("cell", { name: "Warehouse" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Received" })).toBeInTheDocument();
    expect(screen.getByText("Riley Actor")).toBeInTheDocument();
  });

  it("signs a positive quantity and leaves a negative one alone", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([
      movement({ id: "m1", quantity: 10 }),
      movement({ id: "m2", type: "SALE", quantity: -4 }),
    ]));
    renderPage();

    expect(await screen.findByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-4")).toBeInTheDocument();
  });

  it("dashes out unit price, reason, and actor when absent, and formats price when present", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([
      movement({ id: "m1", unitPriceCents: 999, reason: "Weekly restock" }),
      movement({ id: "m2", product: gadget, actor: undefined }),
    ]));
    renderPage();

    await screen.findByText("Weekly restock");
    expect(screen.getByText("$9.99")).toBeInTheDocument();
    const gadgetRow = (await screen.findByText("Gadget")).closest("tr") as HTMLElement;
    expect(within(gadgetRow).getByText("—", { selector: "td:last-child" })).toBeInTheDocument();
  });

  it("says the list is empty rather than showing a bare table", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    renderPage();
    expect(await screen.findByText("No stock movements yet.")).toBeInTheDocument();
  });

  it("blames the filters, not the account, when they match nothing", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([movement({ id: "m1" })]), page([]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.selectOptions(screen.getByLabelText("Product"), "Widget (WID-1)");

    expect(await screen.findByText("No stock movements match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("No stock movements yet.")).not.toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load stock movements.")).toBeInTheDocument();
  });
});

describe("StockMovementsPage filters", () => {
  it("hides Clear filters until a filter is set", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([movement({ id: "m1" })]));
    renderPage();
    await screen.findByText("Widget");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("filters by product and resets to page 1", async () => {
    mockLookups();
    api.on(
      "GET",
      "/stock-movements",
      page([movement({ id: "m1" })], 50, 1),
      page([movement({ id: "m2" })], 50, 2),
      page([movement({ id: "m1" })], 1, 1)
    );
    const { user } = renderPage();
    await screen.findByText("Widget");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.requestsFor("GET", "/stock-movements")).toHaveLength(2));

    await user.selectOptions(screen.getByLabelText("Product"), "Widget (WID-1)");

    await waitFor(() => expect(api.requestsFor("GET", "/stock-movements")).toHaveLength(3));
    expect(api.requestsFor("GET", "/stock-movements")[2].params).toMatchObject({
      productId: "p1",
      page: 1,
    });
  });

  it("clears every filter and refetches the unfiltered list", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([movement({ id: "m1" })]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");
    await waitFor(() => expect(api.requestsFor("GET", "/stock-movements")).toHaveLength(2));
    expect(api.requestsFor("GET", "/stock-movements")[1].params).toMatchObject({ locationId: "l1" });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(api.requestsFor("GET", "/stock-movements")).toHaveLength(3));
    expect(api.requestsFor("GET", "/stock-movements")[2].params).not.toHaveProperty("locationId");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

describe("StockMovementsPage pagination", () => {
  it("steps to the next page and asks the API for it", async () => {
    mockLookups();
    api.on(
      "GET",
      "/stock-movements",
      page([movement({ id: "m1" })], 30, 1),
      page([movement({ id: "m2" })], 30, 2)
    );
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.requestsFor("GET", "/stock-movements")).toHaveLength(2));
    expect(api.requestsFor("GET", "/stock-movements")[1].params).toMatchObject({ page: 2 });
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });
});

describe("StockMovementsPage record movement", () => {
  it("toggles the form open and closed", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");

    await user.click(screen.getByRole("button", { name: "Record movement" }));
    expect(container.querySelector("form")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.querySelector("form")).not.toBeInTheDocument();
  });

  it("shows the unit price field only for a Sale", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);

    expect(within(form).queryByLabelText(/Unit price/)).not.toBeInTheDocument();

    await user.selectOptions(within(form).getByLabelText("Type"), "Sale");
    expect(within(form).getByLabelText(/Unit price/)).toBeInTheDocument();
  });

  it("marks the reason required and the quantity as a signed delta for an Adjustment", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);

    await user.selectOptions(within(form).getByLabelText("Type"), "Adjustment");

    expect(within(form).getByLabelText("Reason (required)")).toBeRequired();
    expect(within(form).getByLabelText("Quantity (signed delta)")).toBeInTheDocument();
  });

  it("posts a RECEIVE movement without a unit price", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]), page([movement({ id: "m1" })]));
    api.on("POST", "/stock-movements", ok(movement({ id: "m1" }), 201));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);

    await user.type(within(form).getByLabelText("Quantity"), "10");
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.selectOptions(within(form).getByLabelText("Location"), "Warehouse");
    await user.click(within(form).getByRole("button", { name: "Record movement" }));

    await waitFor(() => expect(api.requestsFor("POST", "/stock-movements")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/stock-movements")[0].data)).toEqual({
      productId: "p1",
      locationId: "l1",
      type: "RECEIVE",
      quantity: 10,
    });
  });

  it("converts a Sale's dollar price to cents, and omits it entirely when left blank", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]), page([movement({ id: "m1" })]));
    api.on("POST", "/stock-movements", ok(movement({ id: "m1" }), 201));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);
    await user.selectOptions(within(form).getByLabelText("Type"), "Sale");

    await user.type(within(form).getByLabelText("Quantity"), "3");
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.selectOptions(within(form).getByLabelText("Location"), "Warehouse");
    await user.type(within(form).getByLabelText(/Unit price/), "12.50");
    await user.click(within(form).getByRole("button", { name: "Record movement" }));

    await waitFor(() => expect(api.requestsFor("POST", "/stock-movements")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/stock-movements")[0].data)).toEqual({
      productId: "p1",
      locationId: "l1",
      type: "SALE",
      quantity: 3,
      unitPriceCents: 1250,
    });
  });

  it("closes the form, resets to page 1, and refreshes the list on success", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([], 60, 3), page([movement({ id: "m1" })], 61, 1));
    api.on("POST", "/stock-movements", ok(movement({ id: "m1" }), 201));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);
    await user.type(within(form).getByLabelText("Quantity"), "10");
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.selectOptions(within(form).getByLabelText("Location"), "Warehouse");

    await user.click(within(form).getByRole("button", { name: "Record movement" }));

    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(container.querySelector("form")).not.toBeInTheDocument();
    expect(api.requestsFor("GET", "/stock-movements")[1].params).toMatchObject({ page: 1 });
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    api.on("POST", "/stock-movements", fail(409, "Would take stock negative"));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Record movement" }));
    const form = openForm(container);
    await user.type(within(form).getByLabelText("Quantity"), "10");
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.selectOptions(within(form).getByLabelText("Location"), "Warehouse");

    await user.click(within(form).getByRole("button", { name: "Record movement" }));

    expect(await screen.findByText("Would take stock negative")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeInTheDocument();
  });
});

describe("StockMovementsPage transfer stock", () => {
  it("toggles the form open and closed", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");

    await user.click(screen.getByRole("button", { name: "Transfer stock" }));
    expect(within(openForm(container)).getByLabelText("From location")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.querySelector("form")).not.toBeInTheDocument();
  });

  it("posts the product, quantity, both locations, and an optional reason", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]), page([movement({ id: "m1", type: "TRANSFER_OUT" })]));
    api.on("POST", "/stock-movements/transfer", ok({ out: movement({ id: "m1" }), in: movement({ id: "m2" }) }, 201));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Transfer stock" }));
    const form = openForm(container);

    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.type(within(form).getByLabelText("Quantity"), "5");
    await user.selectOptions(within(form).getByLabelText("From location"), "Warehouse");
    await user.selectOptions(within(form).getByLabelText("To location"), "Storefront");
    await user.type(within(form).getByLabelText("Reason (optional)"), "Rebalancing stock");
    await user.click(within(form).getByRole("button", { name: "Transfer stock" }));

    await waitFor(() => expect(api.requestsFor("POST", "/stock-movements/transfer")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/stock-movements/transfer")[0].data)).toEqual({
      productId: "p1",
      fromLocationId: "l1",
      toLocationId: "l2",
      quantity: 5,
      reason: "Rebalancing stock",
    });
  });

  it("closes the form and refreshes the list on success", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]), page([movement({ id: "m1", type: "TRANSFER_OUT" })]));
    api.on("POST", "/stock-movements/transfer", ok({ out: movement({ id: "m1" }), in: movement({ id: "m2" }) }, 201));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Transfer stock" }));
    const form = openForm(container);
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.type(within(form).getByLabelText("Quantity"), "5");
    await user.selectOptions(within(form).getByLabelText("From location"), "Warehouse");
    await user.selectOptions(within(form).getByLabelText("To location"), "Storefront");

    await user.click(within(form).getByRole("button", { name: "Transfer stock" }));

    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(container.querySelector("form")).not.toBeInTheDocument();
  });

  it("surfaces a rejected transfer and keeps the form open", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    api.on("POST", "/stock-movements/transfer", fail(409, "Not enough stock at the source location"));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");
    await user.click(screen.getByRole("button", { name: "Transfer stock" }));
    const form = openForm(container);
    await user.selectOptions(within(form).getByLabelText("Product"), "Widget (WID-1)");
    await user.type(within(form).getByLabelText("Quantity"), "5");
    await user.selectOptions(within(form).getByLabelText("From location"), "Warehouse");
    await user.selectOptions(within(form).getByLabelText("To location"), "Storefront");

    await user.click(within(form).getByRole("button", { name: "Transfer stock" }));

    expect(await screen.findByText("Not enough stock at the source location")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeInTheDocument();
  });

  it("opening Transfer while Record movement is open replaces it, not stacks it", async () => {
    mockLookups();
    api.on("GET", "/stock-movements", page([]));
    const { user, container } = renderPage();
    await screen.findByText("No stock movements yet.");

    await user.click(screen.getByRole("button", { name: "Record movement" }));
    await user.click(screen.getByRole("button", { name: "Transfer stock" }));

    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(within(openForm(container)).getByLabelText("From location")).toBeInTheDocument();
  });
});
