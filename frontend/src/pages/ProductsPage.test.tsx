import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { ProductsPage } from "./ProductsPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { Category, Product } from "../api/types";

function product(overrides: Partial<Product> & { id: string; sku: string; name: string }): Product {
  return {
    description: null,
    categoryId: null,
    priceCents: 0,
    reorderPoint: 0,
    reorderQty: 0,
    isActive: true,
    ...overrides,
  } as Product;
}

function category(overrides: Partial<Category> & { id: string; name: string }): Category {
  return { isActive: true, ...overrides } as Category;
}

const widget = product({ id: "p1", sku: "WID-1", name: "Widget", priceCents: 1999, costCents: 500, reorderPoint: 3 });
const archived = product({ id: "p2", sku: "OLD-1", name: "Old Thing", isActive: false });
const beverages = category({ id: "cat1", name: "Beverages" });

function page(items: Product[], total = items.length) {
  return ok({ items, total, page: 1, pageSize: 25 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
  api.on("GET", "/categories", ok([beverages]));
});

afterEach(() => {
  api.restore();
});

function renderPage(user = ownerUser) {
  return renderApp(<ProductsPage />, { user });
}

describe("ProductsPage list", () => {
  it("shows a loading row, then the products", async () => {
    api.on("GET", "/products", page([widget]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("WID-1")).toBeInTheDocument();
    expect(screen.getByText("$19.99")).toBeInTheDocument();
  });

  it("asks for the active tab, page 1, and the page size by default", async () => {
    api.on("GET", "/products", page([widget]));
    renderPage();

    await screen.findByText("Widget");
    expect(api.requestsFor("GET", "/products")[0].params).toEqual({ status: "active", page: 1, pageSize: 25 });
  });

  it("says the list is empty rather than showing a bare table", async () => {
    api.on("GET", "/products", page([]));
    renderPage();
    expect(await screen.findByText("No products yet.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/products", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load products.")).toBeInTheDocument();
    expect(screen.queryByText("No products yet.")).not.toBeInTheDocument();
  });

  it("marks an archived row, offers Restore, and hides Archive", async () => {
    api.on("GET", "/products", page([archived]));
    renderPage();

    const row = (await screen.findByText("Old Thing")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("ProductsPage search and status tabs", () => {
  it("searches once for a typed word, resetting to page 1", async () => {
    api.on("GET", "/products", page([widget], 60), page([widget]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.type(screen.getByPlaceholderText("Search by name or SKU..."), "wid");

    await waitFor(() => expect(api.requestsFor("GET", "/products")).toHaveLength(2), { timeout: 2000 });
    expect(api.requestsFor("GET", "/products")[1].params).toEqual({
      status: "active",
      page: 1,
      pageSize: 25,
      search: "wid",
    });
  });

  it("switches tabs and resets to page 1", async () => {
    api.on("GET", "/products", page([widget], 60), page([archived]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    await waitFor(() => expect(api.requestsFor("GET", "/products")).toHaveLength(2));
    expect(api.requestsFor("GET", "/products")[1].params).toEqual({ status: "archived", page: 1, pageSize: 25 });
    expect(await screen.findByText("Old Thing")).toBeInTheDocument();
  });
});

describe("ProductsPage pagination", () => {
  it("hides the control while everything fits on one page", async () => {
    api.on("GET", "/products", page([widget]));
    renderPage();
    await screen.findByText("Widget");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("steps to the next page and asks the API for it", async () => {
    api.on(
      "GET",
      "/products",
      page([widget], 60),
      ok({ items: [product({ id: "p3", sku: "GAD-1", name: "Gadget" })], total: 60, page: 2, pageSize: 25 })
    );
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.requestsFor("GET", "/products")).toHaveLength(2));
    expect(api.requestsFor("GET", "/products")[1].params).toMatchObject({ page: 2 });
    expect(await screen.findByText("26–50 of 60 products")).toBeInTheDocument();
  });
});

describe("ProductsPage create", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/products", page([]));
    renderPage();
    await screen.findByText("No products yet.");
    expect(screen.queryByLabelText("SKU")).not.toBeInTheDocument();
  });

  it("shows the Cost field to an Owner but not to Staff", async () => {
    api.on("GET", "/products", page([]));
    const { user } = renderPage(ownerUser);
    await screen.findByText("No products yet.");
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(screen.getByLabelText("Cost ($)")).toBeInTheDocument();
  });

  it("hides the Cost field from Staff", async () => {
    api.on("GET", "/products", page([]));
    const { user } = renderPage(staffUser);
    await screen.findByText("No products yet.");
    await user.click(screen.getByRole("button", { name: "Add product" }));
    expect(screen.queryByLabelText("Cost ($)")).not.toBeInTheDocument();
  });

  it("creates a product with the entered values and closes the form", async () => {
    api.on("GET", "/products", page([]), page([widget]));
    api.on("POST", "/products", ok(widget, 201));
    const { user } = renderPage();
    await screen.findByText("No products yet.");

    await user.click(screen.getByRole("button", { name: "Add product" }));
    await user.type(screen.getByLabelText("SKU"), "WID-1");
    await user.type(screen.getByLabelText("Name"), "Widget");
    await user.type(screen.getByLabelText("Price ($)"), "19.99");
    await user.type(screen.getByLabelText("Cost ($)"), "5.00");
    await user.type(screen.getByLabelText("Reorder point"), "3");
    await user.click(screen.getByRole("button", { name: "Save product" }));

    await waitFor(() => expect(api.requestsFor("POST", "/products")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/products")[0].data)).toEqual({
      sku: "WID-1",
      name: "Widget",
      categoryId: null,
      priceCents: 1999,
      costCents: 500,
      reorderPoint: 3,
      reorderQty: 0,
    });
    expect(await screen.findByText("Widget")).toBeInTheDocument();
    expect(screen.queryByLabelText("SKU")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    api.on("GET", "/products", page([]));
    api.on("POST", "/products", fail(409, "A product with that SKU already exists"));
    const { user } = renderPage();
    await screen.findByText("No products yet.");

    await user.click(screen.getByRole("button", { name: "Add product" }));
    await user.type(screen.getByLabelText("SKU"), "WID-1");
    await user.type(screen.getByLabelText("Name"), "Widget");
    await user.click(screen.getByRole("button", { name: "Save product" }));

    expect(await screen.findByText("A product with that SKU already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("SKU")).toHaveValue("WID-1");
  });

  it("adds a category inline from the create form without leaving it", async () => {
    api.on("GET", "/products", page([]));
    api.on("GET", "/categories", ok([beverages]), ok([beverages, category({ id: "cat2", name: "Snacks" })]));
    api.on("POST", "/categories", ok(category({ id: "cat2", name: "Snacks" }), 201));
    const { user } = renderPage();
    await screen.findByText("No products yet.");

    await user.click(screen.getByRole("button", { name: "Add product" }));
    await user.type(screen.getByPlaceholderText("New category name"), "Snacks");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.requestsFor("POST", "/categories")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/categories")[0].data)).toEqual({ name: "Snacks" });
    expect(await screen.findByRole("option", { name: "Snacks" })).toBeInTheDocument();
    // The quick-add input clears once the category lands, and the create
    // form itself stays open — a category is a means to the product, not
    // a reason to lose everything already typed.
    expect(screen.getByPlaceholderText("New category name")).toHaveValue("");
    expect(screen.getByLabelText("SKU")).toBeInTheDocument();
  });
});

describe("ProductsPage edit", () => {
  it("opens the form prefilled with the product's current values", async () => {
    api.on("GET", "/products", page([widget]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("SKU")).toHaveValue("WID-1");
    expect(screen.getByLabelText("Name")).toHaveValue("Widget");
    expect(screen.getByLabelText("Price ($)")).toHaveValue(19.99);
    expect(screen.getByLabelText("Cost ($)")).toHaveValue(5);
  });

  it("saves changes with PATCH and refreshes the list", async () => {
    const renamed = product({ ...widget, name: "Widget Deluxe" });
    api.on("GET", "/products", page([widget]), page([renamed]));
    api.on("PATCH", "/products/p1", ok(renamed));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Widget Deluxe");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/products/p1")).toHaveLength(1));
    expect(await screen.findByText("Widget Deluxe")).toBeInTheDocument();
  });
});

describe("ProductsPage archive/restore", () => {
  it("names the product in the confirmation before archiving anything", async () => {
    api.on("GET", "/products", page([widget]));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Widget")).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/products/p1")).toHaveLength(0);
  });

  it("archives on confirm and refreshes the list", async () => {
    api.on("GET", "/products", page([widget]), page([]));
    api.on("DELETE", "/products/p1", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive product" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/products/p1")).toHaveLength(1));
    expect(await screen.findByText("No products yet.")).toBeInTheDocument();
  });

  it("surfaces a rejected archive rather than failing silently", async () => {
    api.on("GET", "/products", page([widget]));
    api.on("DELETE", "/products/p1", fail(409, "Product is on an open order"));
    const { user } = renderPage();
    await screen.findByText("Widget");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive product" }));

    expect(await screen.findByText("Product is on an open order")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
  });

  it("restores an archived product without a confirmation", async () => {
    api.on("GET", "/products", page([archived]), page([product({ ...archived, isActive: true })]));
    api.on("POST", "/products/p2/restore", ok(product({ ...archived, isActive: true })));
    const { user } = renderPage();
    await screen.findByText("Old Thing");

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(api.requestsFor("POST", "/products/p2/restore")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("ProductsPage CSV import", () => {
  function fileInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("imports a CSV and shows the created/updated/skipped summary", async () => {
    api.on("GET", "/products", page([]), page([widget]));
    api.on("POST", "/products/import", ok({ created: 1, updated: 0, errors: [] }));
    const { user, container } = renderPage();
    await screen.findByText("No products yet.");

    const file = new File(["sku,name,price\nWID-1,Widget,19.99\n"], "products.csv", { type: "text/csv" });
    await user.upload(fileInput(container), file);

    await waitFor(() => expect(api.requestsFor("POST", "/products/import")).toHaveLength(1));
    expect(api.requestsFor("POST", "/products/import")[0].data).toBe("sku,name,price\nWID-1,Widget,19.99\n");
    expect(await screen.findByText("Imported: 1 created, 0 updated.")).toBeInTheDocument();
  });

  it("lists per-row errors alongside a partial import", async () => {
    api.on("GET", "/products", page([]));
    api.on(
      "POST",
      "/products/import",
      ok({ created: 1, updated: 0, errors: [{ row: 3, message: "Missing SKU" }] })
    );
    const { user, container } = renderPage();
    await screen.findByText("No products yet.");

    await user.upload(fileInput(container), new File(["sku,name\n,Widget\n"], "products.csv", { type: "text/csv" }));

    expect(await screen.findByText("Imported: 1 created, 0 updated, 1 row(s) skipped.")).toBeInTheDocument();
    expect(screen.getByText("Row 3: Missing SKU")).toBeInTheDocument();
  });

  it("surfaces a rejected import rather than failing silently", async () => {
    api.on("GET", "/products", page([]));
    api.on("POST", "/products/import", fail(400, "Could not parse CSV"));
    const { user, container } = renderPage();
    await screen.findByText("No products yet.");

    await user.upload(fileInput(container), new File(["not,a,csv"], "products.csv", { type: "text/csv" }));

    expect(await screen.findByText("Could not parse CSV")).toBeInTheDocument();
  });
});
