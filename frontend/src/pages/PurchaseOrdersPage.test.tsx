import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { AuthUser, Location, Product, PurchaseOrder, Supplier } from "../api/types";

const acme: Supplier = { id: "s1", name: "Acme Supplies", email: null, phone: null, isActive: true };
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

function order(overrides: Partial<PurchaseOrder> & { id: string }): PurchaseOrder {
  return {
    supplierId: "s1",
    status: "DRAFT",
    notes: null,
    createdAt: "2026-08-01T00:00:00Z",
    supplier: acme,
    ...overrides,
  } as PurchaseOrder;
}

const draft = order({ id: "po1", status: "DRAFT" });
const ordered = order({ id: "po1", status: "ORDERED" });
const partial = order({ id: "po1", status: "PARTIALLY_RECEIVED" });
const received = order({ id: "po1", status: "RECEIVED" });
const cancelled = order({ id: "po1", status: "CANCELLED" });

function page(items: PurchaseOrder[], total = items.length) {
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
  api.on("GET", "/suppliers", ok({ items: [acme], total: 1, page: 1, pageSize: 25 }));
  api.on("GET", "/products", ok({ items: [widget, gadget], total: 2, page: 1, pageSize: 100 }));
  api.on("GET", "/locations", ok([warehouse, storefront]));
}

function renderPage(user: AuthUser = ownerUser) {
  return renderApp(<PurchaseOrdersPage />, { user });
}

/** The unlabelled per-line product `<select>`s, in row order. */
function productSelects(): HTMLElement[] {
  const supplier = screen.getByLabelText("Supplier");
  return screen.getAllByRole("combobox").filter((el) => el !== supplier);
}

describe("PurchaseOrdersPage list", () => {
  it("shows a loading row, then the orders", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("dashes out a missing supplier rather than omitting the row", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([order({ id: "po1", supplier: undefined })]));
    renderPage();

    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("says the list is empty rather than showing a bare table", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    renderPage();
    expect(await screen.findByText("No purchase orders yet.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load purchase orders.")).toBeInTheDocument();
    expect(screen.queryByText("No purchase orders yet.")).not.toBeInTheDocument();
  });
});

describe("PurchaseOrdersPage create form (Owner-only)", () => {
  it("hides the New purchase order button and form from Staff", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    renderPage(staffUser);

    await screen.findByText("No purchase orders yet.");
    expect(screen.queryByRole("button", { name: "New purchase order" })).not.toBeInTheDocument();
  });

  it("toggles the form open and closed for an Owner", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");

    await user.click(screen.getByRole("button", { name: "New purchase order" }));
    expect(screen.getByLabelText("Supplier")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
  });

  it("adds and removes line item rows", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");
    await user.click(screen.getByRole("button", { name: "New purchase order" }));

    expect(productSelects()).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove" })[0]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "+ Add line" }));
    expect(productSelects()).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove" })[0]).not.toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(productSelects()).toHaveLength(1);
  });

  it("refuses to submit with no line item selected", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");
    await user.click(screen.getByRole("button", { name: "New purchase order" }));

    await user.selectOptions(screen.getByLabelText("Supplier"), "Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Create purchase order" }));

    expect(await screen.findByText("Add at least one line item")).toBeInTheDocument();
    expect(api.requestsFor("POST", "/purchase-orders")).toHaveLength(0);
  });

  it("posts the selected supplier and only the lines with a product chosen", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]), page([draft]));
    api.on("POST", "/purchase-orders", ok(draft, 201));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");
    await user.click(screen.getByRole("button", { name: "New purchase order" }));

    await user.selectOptions(screen.getByLabelText("Supplier"), "Acme Supplies");
    await user.click(screen.getByRole("button", { name: "+ Add line" }));
    const [line1] = productSelects();
    await user.selectOptions(line1, "Widget (WID-1)");
    // The second line is left unselected on purpose — it should be dropped.
    // Controlled and falls back to 1 on an empty value, so `user.clear` +
    // `user.type` bounces back to "1" between keystrokes and appends onto
    // it instead of replacing it — `fireEvent.change` sets the value in one
    // shot the way it would from a real number-input spinner or paste.
    const qtyInput = screen.getAllByPlaceholderText("Qty")[0];
    fireEvent.change(qtyInput, { target: { value: "3" } });
    const costInput = screen.getAllByPlaceholderText("Unit cost ($)")[0];
    await user.type(costInput, "5.50");

    await user.click(screen.getByRole("button", { name: "Create purchase order" }));

    await waitFor(() => expect(api.requestsFor("POST", "/purchase-orders")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/purchase-orders")[0].data)).toEqual({
      supplierId: "s1",
      lines: [{ productId: "p1", quantityOrdered: 3, unitCostCents: 550 }],
    });
  });

  it("closes the form and resets its lines on success", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]), page([draft]));
    api.on("POST", "/purchase-orders", ok(draft, 201));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");
    await user.click(screen.getByRole("button", { name: "New purchase order" }));
    await user.selectOptions(screen.getByLabelText("Supplier"), "Acme Supplies");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");

    await user.click(screen.getByRole("button", { name: "Create purchase order" }));

    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([]));
    api.on("POST", "/purchase-orders", fail(422, "Supplier is archived"));
    const { user } = renderPage();
    await screen.findByText("No purchase orders yet.");
    await user.click(screen.getByRole("button", { name: "New purchase order" }));
    await user.selectOptions(screen.getByLabelText("Supplier"), "Acme Supplies");
    await user.selectOptions(productSelects()[0], "Widget (WID-1)");

    await user.click(screen.getByRole("button", { name: "Create purchase order" }));

    expect(await screen.findByText("Supplier is archived")).toBeInTheDocument();
    expect(screen.getByLabelText("Supplier")).toBeInTheDocument();
  });
});

describe("PurchaseOrdersPage row detail", () => {
  const lines = [
    { id: "line1", productId: "p1", quantityOrdered: 10, quantityReceived: 0, unitCostCents: 500, product: widget },
  ];

  it("fetches the lines only once a row is expanded", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    expect(api.requestsFor("GET", "/purchase-orders/po1")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(api.requestsFor("GET", "/purchase-orders/po1")).toHaveLength(1);
  });

  it("shows the Unit cost column to an Owner", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText("Unit cost")).toBeInTheDocument();
    // A draft's own lines are editable for an Owner, so the cost renders as
    // an input's value rather than static currency text.
    expect(screen.getByLabelText("Unit cost for Widget")).toHaveValue(5);
  });

  it("hides the Unit cost column from Staff", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines }));
    const { user } = renderPage(staffUser);
    await screen.findByText("Acme Supplies");

    await user.click(screen.getByRole("button", { name: "View" }));

    await screen.findByText("Widget");
    expect(screen.queryByText("Unit cost")).not.toBeInTheDocument();
    expect(screen.queryByText("$5.00")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Product to add")).not.toBeInTheDocument();
  });

  it("lets an Owner add a line on a draft", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines }));
    api.on("POST", "/purchase-orders/po1/lines", ok({ ...draft, lines }, 201));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    await user.selectOptions(screen.getByLabelText("Product to add"), "Gadget (GAD-1)");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.requestsFor("POST", "/purchase-orders/po1/lines")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/purchase-orders/po1/lines")[0].data as string)).toMatchObject({
      productId: "p2",
      quantityOrdered: 1,
      unitCostCents: 0,
    });
  });

  it("lets an Owner edit and remove a line on a draft with more than one line", async () => {
    const twoLines = [...lines, { id: "line2", productId: "p2", quantityOrdered: 3, quantityReceived: 0, unitCostCents: 800, product: gadget }];
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines: twoLines }));
    api.on("PATCH", "/purchase-orders/po1/lines/line1", ok({ ...draft, lines: twoLines }));
    api.on("DELETE", "/purchase-orders/po1/lines/line2", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    const qtyInput = screen.getByLabelText("Ordered quantity for Widget");
    fireEvent.change(qtyInput, { target: { value: "15" } });
    fireEvent.blur(qtyInput);
    await waitFor(() => expect(api.requestsFor("PATCH", "/purchase-orders/po1/lines/line1")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/purchase-orders/po1/lines/line1")[0].data as string)).toEqual({
      quantityOrdered: 15,
    });

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    expect(removeButtons.every((btn) => !btn.hasAttribute("disabled"))).toBe(true);
    await user.click(removeButtons[1]);
    await waitFor(() => expect(api.requestsFor("DELETE", "/purchase-orders/po1/lines/line2")).toHaveLength(1));
  });

  it("disables removing a purchase order's last remaining line", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("GET", "/purchase-orders/po1", ok({ ...draft, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "View" }));
    await screen.findByText("Widget");

    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});

describe("PurchaseOrdersPage status actions (Owner-only)", () => {
  it("offers Mark as ordered to an Owner while a Draft", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    renderPage();
    expect(await screen.findByRole("button", { name: "Mark as ordered" })).toBeInTheDocument();
  });

  it("hides Mark as ordered once an order is no longer a Draft", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([ordered]));
    renderPage();
    await screen.findByText("Acme Supplies");
    expect(screen.queryByRole("button", { name: "Mark as ordered" })).not.toBeInTheDocument();
  });

  it("hides Mark as ordered from Staff even on a Draft", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    renderPage(staffUser);
    await screen.findByText("Acme Supplies");
    expect(screen.queryByRole("button", { name: "Mark as ordered" })).not.toBeInTheDocument();
  });

  it("offers Cancel for a Draft order", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    renderPage();
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("hides Cancel once an order is Received", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([received]));
    renderPage();
    await screen.findByText("Acme Supplies");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("marks an order as ordered and refreshes the list", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]), page([ordered]));
    api.on("POST", "/purchase-orders/po1/order", ok(ordered));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Mark as ordered" }));

    await waitFor(() => expect(api.requestsFor("POST", "/purchase-orders/po1/order")).toHaveLength(1));
    expect(await screen.findByText("Ordered")).toBeInTheDocument();
  });

  it("cancels an order and refreshes the list", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]), page([cancelled]));
    api.on("POST", "/purchase-orders/po1/cancel", ok(cancelled));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(api.requestsFor("POST", "/purchase-orders/po1/cancel")).toHaveLength(1));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });

  it("surfaces a rejected status change instead of failing silently", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    api.on("POST", "/purchase-orders/po1/order", fail(409, "Order has no lines"));
    const { user } = renderPage();
    await screen.findByText("Draft");

    await user.click(screen.getByRole("button", { name: "Mark as ordered" }));

    expect(await screen.findByText("Order has no lines")).toBeInTheDocument();
  });
});

describe("PurchaseOrdersPage receiving", () => {
  const lines = [
    { id: "line1", productId: "p1", quantityOrdered: 10, quantityReceived: 4, unitCostCents: 500, product: widget },
    { id: "line2", productId: "p2", quantityOrdered: 5, quantityReceived: 5, unitCostCents: 800, product: gadget },
  ];

  it("offers Receive only while Ordered or Partially received", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([draft]));
    renderPage();
    await screen.findByText("Acme Supplies");
    expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();
  });

  it("opens the receiving form pre-filled with the remaining quantity, skipping fully received lines", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([partial]));
    api.on("GET", "/purchase-orders/po1", ok({ ...partial, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");

    await user.click(screen.getByRole("button", { name: "Receive" }));

    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.queryByText("Gadget")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Receiving location")).toBeInTheDocument();
    expect(screen.getByDisplayValue("6")).toBeInTheDocument(); // 10 ordered - 4 received
  });

  it("Receive relabels to Cancel receipt and closes the form again", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([partial]));
    api.on("GET", "/purchase-orders/po1", ok({ ...partial, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");

    await user.click(screen.getByRole("button", { name: "Receive" }));
    await screen.findByLabelText("Receiving location");
    await user.click(screen.getByRole("button", { name: "Cancel receipt" }));

    expect(screen.queryByLabelText("Receiving location")).not.toBeInTheDocument();
  });

  it("rejects a receipt with every quantity cleared to zero, without calling the API", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([partial]));
    api.on("GET", "/purchase-orders/po1", ok({ ...partial, lines }));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Receive" }));
    await user.selectOptions(await screen.findByLabelText("Receiving location"), "Warehouse");

    const qtyInput = screen.getByDisplayValue("6");
    await user.clear(qtyInput);
    await user.type(qtyInput, "0");
    await user.click(screen.getByRole("button", { name: "Confirm receipt" }));

    expect(await screen.findByText("Enter at least one quantity to receive")).toBeInTheDocument();
    expect(api.requestsFor("POST", "/purchase-orders/po1/receive")).toHaveLength(0);
  });

  it("submits the receiving location and quantities, then closes the form", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([partial]), page([received]));
    api.on("GET", "/purchase-orders/po1", ok({ ...partial, lines }));
    api.on("POST", "/purchase-orders/po1/receive", ok(received));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Receive" }));
    await user.selectOptions(await screen.findByLabelText("Receiving location"), "Warehouse");

    await user.click(screen.getByRole("button", { name: "Confirm receipt" }));

    await waitFor(() => expect(api.requestsFor("POST", "/purchase-orders/po1/receive")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/purchase-orders/po1/receive")[0].data)).toEqual({
      locationId: "l1",
      lines: [{ lineId: "line1", quantity: 6 }],
    });
    expect(screen.queryByLabelText("Receiving location")).not.toBeInTheDocument();
  });

  it("surfaces a rejected receipt and keeps the form open", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([partial]));
    api.on("GET", "/purchase-orders/po1", ok({ ...partial, lines }));
    api.on("POST", "/purchase-orders/po1/receive", fail(409, "Would take stock negative"));
    const { user } = renderPage();
    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Receive" }));
    await user.selectOptions(await screen.findByLabelText("Receiving location"), "Warehouse");

    await user.click(screen.getByRole("button", { name: "Confirm receipt" }));

    expect(await screen.findByText("Would take stock negative")).toBeInTheDocument();
    expect(screen.getByLabelText("Receiving location")).toBeInTheDocument();
  });

  it("is offered to Staff as well as Owner, since receiving isn't Owner-gated", async () => {
    mockLookups();
    api.on("GET", "/purchase-orders", page([ordered]));
    renderPage(staffUser);
    expect(await screen.findByRole("button", { name: "Receive" })).toBeInTheDocument();
  });
});
