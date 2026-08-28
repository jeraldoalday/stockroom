import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { CustomersPage } from "./CustomersPage";
import { DEFAULT_DEBOUNCE_MS } from "../components/useDebouncedValue";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Customer } from "../api/types";

function customer(overrides: Partial<Customer> & { id: string; name: string }): Customer {
  return {
    email: null,
    phone: null,
    isActive: true,
    ...overrides,
  } as Customer;
}

const acme = customer({ id: "c1", name: "Acme Cafe", email: "hi@acme.test", phone: "555-0100" });
const bolt = customer({ id: "c2", name: "Bolt Diner" });
const archived = customer({ id: "c3", name: "Closed Deli", isActive: false });

function page(items: Customer[], total = items.length) {
  return ok({ items, total, page: 1, pageSize: 25 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<CustomersPage />, { user: ownerUser });
}

describe("CustomersPage list", () => {
  it("shows a loading row, then the customers", async () => {
    api.on("GET", "/customers", page([acme, bolt]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Acme Cafe")).toBeInTheDocument();
    expect(screen.getByText("Bolt Diner")).toBeInTheDocument();
    expect(screen.getByText("hi@acme.test")).toBeInTheDocument();
  });

  it("dashes out the columns a customer hasn't filled in", async () => {
    api.on("GET", "/customers", page([bolt]));
    renderPage();

    const row = (await screen.findByText("Bolt Diner")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("asks for the active tab by default", async () => {
    api.on("GET", "/customers", page([acme]));
    renderPage();

    await screen.findByText("Acme Cafe");
    expect(api.requestsFor("GET", "/customers")[0].params).toEqual({
      page: 1,
      pageSize: 25,
      status: "active",
    });
  });

  it("says the list is empty rather than showing a bare table", async () => {
    api.on("GET", "/customers", page([]));
    renderPage();
    expect(await screen.findByText("No customers yet.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    // These two states look identical in a table body, and confusing them
    // is how a user concludes their data is gone.
    api.on("GET", "/customers", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load customers.")).toBeInTheDocument();
    expect(screen.queryByText("No customers yet.")).not.toBeInTheDocument();
  });

  it("marks an archived row and offers Restore instead of Archive", async () => {
    api.on("GET", "/customers", page([archived]));
    renderPage();

    const row = (await screen.findByText("Closed Deli")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("CustomersPage filtering", () => {
  it("switches tabs and resets to the first page", async () => {
    api.on("GET", "/customers", page([acme]), page([archived]));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    await waitFor(() => expect(api.requestsFor("GET", "/customers")).toHaveLength(2));
    expect(api.requestsFor("GET", "/customers")[1].params).toMatchObject({
      status: "archived",
      page: 1,
    });
  });

  it("searches once for a typed word, not once per keystroke", async () => {
    // The Day 23 debounce, asserted end to end rather than only on the hook.
    api.on("GET", "/customers", page([acme, bolt]), page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Acme");

    await waitFor(
      () => expect(api.requestsFor("GET", "/customers")).toHaveLength(2),
      { timeout: DEFAULT_DEBOUNCE_MS * 4 }
    );
    expect(api.requestsFor("GET", "/customers")[1].params).toMatchObject({ search: "Acme" });
  });

  it("keeps the previous rows on screen while the next search runs", async () => {
    // `placeholderData` — without it the table blanks between searches and
    // the page flickers on every letter.
    api.on("GET", "/customers", page([acme, bolt]), page([acme]));
    const { user } = renderPage();
    await screen.findByText("Bolt Diner");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Acme");

    expect(screen.getByText("Bolt Diner")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Bolt Diner")).not.toBeInTheDocument());
  });
});

describe("CustomersPage archive", () => {
  it("names the customer in the confirmation before archiving anything", async () => {
    api.on("GET", "/customers", page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Acme Cafe")).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/customers/c1")).toHaveLength(0);
  });

  it("archives on confirm and refreshes the list", async () => {
    api.on("GET", "/customers", page([acme]), page([]));
    api.on("DELETE", "/customers/c1", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive customer" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/customers/c1")).toHaveLength(1));
    expect(await screen.findByText("No customers yet.")).toBeInTheDocument();
  });

  it("archives nothing when the dialog is cancelled", async () => {
    api.on("GET", "/customers", page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/customers/c1")).toHaveLength(0);
  });

  it("surfaces a rejected archive rather than failing silently", async () => {
    api.on("GET", "/customers", page([acme]));
    api.on("DELETE", "/customers/c1", fail(409, "Customer has open sales orders"));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive customer" }));

    expect(await screen.findByText("Customer has open sales orders")).toBeInTheDocument();
    expect(screen.getByText("Acme Cafe")).toBeInTheDocument();
  });

  it("restores an archived customer without a confirmation", async () => {
    // Restoring is not destructive, so it doesn't get a dialog in its way.
    api.on("GET", "/customers", page([archived]), page([customer({ id: "c3", name: "Closed Deli" })]));
    api.on("POST", "/customers/c3/restore", ok({}));
    const { user } = renderPage();
    await screen.findByText("Closed Deli");

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(api.requestsFor("POST", "/customers/c3/restore")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("CustomersPage create", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/customers", page([]));
    renderPage();
    await screen.findByText("No customers yet.");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("posts only the fields that were filled in", async () => {
    // The API rejects `email: ""` as an invalid address, so the blank
    // optional fields have to be omitted rather than sent empty.
    api.on("GET", "/customers", page([]), page([bolt]));
    api.on("POST", "/customers", ok(bolt, 201));
    const { user } = renderPage();
    await screen.findByText("No customers yet.");

    await user.click(screen.getByRole("button", { name: "Add customer" }));
    await user.type(screen.getByLabelText("Name"), "Bolt Diner");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(api.requestsFor("POST", "/customers")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/customers")[0].data)).toEqual({ name: "Bolt Diner" });
  });

  it("closes the form and shows the new row on success", async () => {
    api.on("GET", "/customers", page([]), page([bolt]));
    api.on("POST", "/customers", ok(bolt, 201));
    const { user } = renderPage();
    await screen.findByText("No customers yet.");

    await user.click(screen.getByRole("button", { name: "Add customer" }));
    await user.type(screen.getByLabelText("Name"), "Bolt Diner");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    expect(await screen.findByText("Bolt Diner")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    // Closing on error would throw away everything the user typed.
    api.on("GET", "/customers", page([]));
    api.on("POST", "/customers", fail(409, "A customer with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("No customers yet.");

    await user.click(screen.getByRole("button", { name: "Add customer" }));
    await user.type(screen.getByLabelText("Name"), "Acme Cafe");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    expect(await screen.findByText("A customer with that name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Cafe");
  });
});

describe("CustomersPage pagination", () => {
  it("hides the control while everything fits on one page", async () => {
    api.on("GET", "/customers", page([acme, bolt]));
    renderPage();
    await screen.findByText("Acme Cafe");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("steps to the next page and asks the API for it", async () => {
    api.on("GET", "/customers", page([acme], 60), ok({ items: [bolt], total: 60, page: 2, pageSize: 25 }));
    const { user } = renderPage();
    await screen.findByText("Acme Cafe");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.requestsFor("GET", "/customers")).toHaveLength(2));
    expect(api.requestsFor("GET", "/customers")[1].params).toMatchObject({ page: 2 });
    expect(await screen.findByText("26–50 of 60 customers")).toBeInTheDocument();
  });
});
