import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SalesOrdersPage } from "./SalesOrdersPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { AuthUser, Customer, Location, Product, SalesOrder } from "../api/types";

const acmeCafe: Customer = { id: "c1", name: "Acme Cafe", email: null, phone: null, isActive: true };
const widget: Product = {
  id: "p1", sku: "WID-1", name: "Widget", description: null, categoryId: null,
  costCents: 500, priceCents: 999, reorderPoint: 5, reorderQty: 10, isActive: true,
};
const gadget: Product = {
  id: "p2", sku: "GAD-1", name: "Gadget", description: null, categoryId: null,
  costCents: 800, priceCents: 1999, reorderPoint: 3, reorderQty: 5, isActive: true,
};
const warehouse: Location = { id: "l1", name: "Warehouse", address: null, isDefault: true, isActive: true };
const storefront: Location = { id: "l2", name: "Storefront", address: null, isDefault: false, isActive: true };

function order(overrides: Partial<SalesOrder> & { id: string }): SalesOrder {
  return {
    customerId: null,
    locationId: "l1",
    status: "DRAFT",
    notes: null,
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as SalesOrder;
}

const draft = order({ id: "so1", status: "DRAFT" });
const withCustomer = order({ id: "so1", status: "DRAFT", customerId: "c1", customer: acmeCafe });
const fulfilled = order({ id: "so1", status: "FULFILLED" });
const cancelled = order({ id: "so1", status: "CANCELLED" });

function page(items: SalesOrder[], total = items.length) {
  return ok({ items, total, page: 1, pageSize: 25 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

/** Every mount fires these three regardless of what the test cares about. */
function mockLookups(): void {
  api.on("GET", "/customers", ok({ items: [acmeCafe], total: 1, page: 1, pageSize: 25 }));
  api.on("GET", "/products", ok({ items: [widget, gadget], total: 2, page: 1, pageSize: 100 }));
  api.on("GET", "/locations", ok([warehouse, storefront]));
}

function renderPage(user: AuthUser = ownerUser) {
  return renderApp(<SalesOrdersPage />, { user });
}

/** The unlabelled per-line product `<select>`s, in row order. */
function productSelects(): HTMLElement[] {
  const named = new Set([screen.getByLabelText("Customer (optional)"), screen.getByLabelText("Location")]);
  return screen.getAllByRole("combobox").filter((el) => !named.has(el));
}

describe("SalesOrdersPage list", () => {
  it("shows a loading row, then the orders", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Walk-in")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows the customer's name when one was attached, not just Walk-in", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([withCustomer]));
    renderPage();
    expect(await screen.findByText("Acme Cafe")).toBeInTheDocument();
  });

  it("says the list is empty rather than showing a bare table", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    renderPage();
    expect(await screen.findByText("No sales orders yet.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load sales orders.")).toBeInTheDocument();
    expect(screen.queryByText("No sales orders yet.")).not.toBeInTheDocument();
  });
});

describe("SalesOrdersPage create form", () => {
  it("is offered to Staff as well as Owner, since fulfilling sales orders isn't Owner-gated", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    renderPage(staffUser);
    await screen.findByText("No sales orders yet.");
    expect(screen.getByRole("button", { name: "New sales order" })).toBeInTheDocument();
  });

  it("toggles the form open and closed", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");

    await user.click(screen.getByRole("button", { name: "New sales order" }));
    expect(screen.getByLabelText("Location")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Location")).not.toBeInTheDocument();
  });

  it("adds and removes line item rows", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));

    expect(productSelects()).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove" })[0]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "+ Add line" }));
    expect(productSelects()).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(productSelects()).toHaveLength(1);
  });

  it("refuses to submit with no line item selected", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));
    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");

    await user.click(screen.getByRole("button", { name: "Create sales order" }));

    expect(await screen.findByText("Add at least one line item")).toBeInTheDocument();
    expect(api.requestsFor("POST", "/sales-orders")).toHaveLength(0);
  });

  it("posts a null customerId when left on Walk-in", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]), page([draft]));
    api.on("POST", "/sales-orders", ok(draft, 201));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));
    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");
    // Controlled and falls back to 1 on an empty value, so `user.clear` +
    // `user.type` bounces back to "1" between keystrokes and appends onto
    // it instead of replacing it — `fireEvent.change` sets the value in one
    // shot the way it would from a real number-input spinner or paste.
    const qtyInput = screen.getByPlaceholderText("Qty");
    fireEvent.change(qtyInput, { target: { value: "2" } });
    await user.type(screen.getByPlaceholderText("Unit price ($)"), "9.99");

    await user.click(screen.getByRole("button", { name: "Create sales order" }));

    await waitFor(() => expect(api.requestsFor("POST", "/sales-orders")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/sales-orders")[0].data)).toEqual({
      customerId: null,
      locationId: "l1",
      lines: [{ productId: "p1", quantity: 2, unitPriceCents: 999 }],
    });
  });

  it("posts the chosen customer's id when one is selected", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]), page([withCustomer]));
    api.on("POST", "/sales-orders", ok(withCustomer, 201));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));
    await user.selectOptions(screen.getByLabelText("Customer (optional)"), "Acme Cafe");
    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");

    await user.click(screen.getByRole("button", { name: "Create sales order" }));

    await waitFor(() => expect(api.requestsFor("POST", "/sales-orders")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/sales-orders")[0].data)).toMatchObject({ customerId: "c1" });
  });

  it("closes the form and resets its lines on success", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]), page([draft]));
    api.on("POST", "/sales-orders", ok(draft, 201));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));
    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");

    await user.click(screen.getByRole("button", { name: "Create sales order" }));

    expect(await screen.findByText("Walk-in")).toBeInTheDocument();
    expect(screen.queryByLabelText("Location")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([]));
    api.on("POST", "/sales-orders", fail(409, "Not enough stock at this location"));
    const { user } = renderPage();
    await screen.findByText("No sales orders yet.");
    await user.click(screen.getByRole("button", { name: "New sales order" }));
    await user.selectOptions(screen.getByLabelText("Location"), "Warehouse");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");

    await user.click(screen.getByRole("button", { name: "Create sales order" }));

    expect(await screen.findByText("Not enough stock at this location")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
  });
});

describe("SalesOrdersPage row detail", () => {
  const lines = [{ id: "line1", productId: "p1", quantity: 2, unitPriceCents: 999, product: widget }];

  it("fetches the lines only once a row is expanded, and shows the unit price", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("GET", "/sales-orders/so1", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Walk-in");
    expect(api.requestsFor("GET", "/sales-orders/so1")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText("Widget")).toBeInTheDocument();
    // A draft's own lines are editable (fulfilling and now editing a draft
    // are both Staff-reachable), so price renders as an input's value.
    expect(screen.getByLabelText("Unit price for Widget")).toHaveValue(9.99);
    expect(api.requestsFor("GET", "/sales-orders/so1")).toHaveLength(1);
  });

  it("shows the unit price to Staff too — price isn't cost", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("GET", "/sales-orders/so1", ok({ ...draft, lines }));
    const { user } = renderPage(staffUser);
    await screen.findByText("Walk-in");

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByLabelText("Unit price for Widget")).toHaveValue(9.99);
  });

  it("lets a Staff user add a line on a draft", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("GET", "/sales-orders/so1", ok({ ...draft, lines }));
    api.on("POST", "/sales-orders/so1/lines", ok({ ...draft, lines }, 201));
    const { user } = renderPage(staffUser);
    await screen.findByText("Walk-in");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    await user.selectOptions(screen.getByLabelText("Product to add"), "Gadget (GAD-1)");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.requestsFor("POST", "/sales-orders/so1/lines")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/sales-orders/so1/lines")[0].data as string)).toMatchObject({
      productId: "p2",
      quantity: 1,
      unitPriceCents: 0,
    });
  });

  it("lets an Owner edit and remove a line on a draft with more than one line", async () => {
    const twoLines = [...lines, { id: "line2", productId: "p2", quantity: 1, unitPriceCents: 1999, product: gadget }];
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("GET", "/sales-orders/so1", ok({ ...draft, lines: twoLines }));
    api.on("PATCH", "/sales-orders/so1/lines/line1", ok({ ...draft, lines: twoLines }));
    api.on("DELETE", "/sales-orders/so1/lines/line2", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Walk-in");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    const qtyInput = screen.getByLabelText("Quantity for Widget");
    fireEvent.change(qtyInput, { target: { value: "5" } });
    fireEvent.blur(qtyInput);
    await waitFor(() => expect(api.requestsFor("PATCH", "/sales-orders/so1/lines/line1")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/sales-orders/so1/lines/line1")[0].data as string)).toEqual({
      quantity: 5,
    });

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons.every((btn) => !btn.hasAttribute("disabled"))).toBe(true);
    await user.click(removeButtons[1]);
    await waitFor(() => expect(api.requestsFor("DELETE", "/sales-orders/so1/lines/line2")).toHaveLength(1));
  });

  it("disables removing a sales order's last remaining line", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("GET", "/sales-orders/so1", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Walk-in");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});

describe("SalesOrdersPage status actions", () => {
  it("offers Fulfill and Cancel on a Draft order", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    renderPage();
    expect(await screen.findByRole("button", { name: "Fulfill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("hides Fulfill and Cancel once an order is Fulfilled", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([fulfilled]));
    renderPage();
    await screen.findByText("Walk-in");
    expect(screen.queryByRole("button", { name: "Fulfill" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("is offered to Staff too, since fulfilling isn't Owner-gated", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    renderPage(staffUser);
    expect(await screen.findByRole("button", { name: "Fulfill" })).toBeInTheDocument();
  });

  it("fulfills an order and refreshes the list", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]), page([fulfilled]));
    api.on("POST", "/sales-orders/so1/fulfill", ok(fulfilled));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Fulfill" }));

    await waitFor(() => expect(api.requestsFor("POST", "/sales-orders/so1/fulfill")).toHaveLength(1));
    expect(await screen.findByText("Fulfilled")).toBeInTheDocument();
  });

  it("cancels an order and refreshes the list", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]), page([cancelled]));
    api.on("POST", "/sales-orders/so1/cancel", ok(cancelled));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(api.requestsFor("POST", "/sales-orders/so1/cancel")).toHaveLength(1));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });

  it("surfaces a rejected fulfil instead of failing silently", async () => {
    mockLookups();
    api.on("GET", "/sales-orders", page([draft]));
    api.on("POST", "/sales-orders/so1/fulfill", fail(409, "Insufficient stock for Widget"));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Fulfill" }));

    expect(await screen.findByText("Insufficient stock for Widget")).toBeInTheDocument();
  });
});
