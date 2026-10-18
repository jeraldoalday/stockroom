import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { SuppliersPage } from "./SuppliersPage";
import { DEFAULT_DEBOUNCE_MS } from "../components/useDebouncedValue";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Supplier } from "../api/types";

// Mirrors CustomersPage.test.tsx: SuppliersPage is the same list-page
// template (search + tabs + create + archive/restore) with different nouns,
// so the same failure modes apply and deserve the same coverage.

function supplier(overrides: Partial<Supplier> & { id: string; name: string }): Supplier {
  return {
    email: null,
    phone: null,
    isActive: true,
    ...overrides,
  } as Supplier;
}

const acme = supplier({ id: "s1", name: "Acme Roasters", email: "hi@acme.test", phone: "555-0100" });
const bolt = supplier({ id: "s2", name: "Bolt Wholesale" });
const archived = supplier({ id: "s3", name: "Closed Distributor", isActive: false });

function page(items: Supplier[], total = items.length) {
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
  return renderApp(<SuppliersPage />, { user: ownerUser });
}

describe("SuppliersPage list", () => {
  it("shows a loading row, then the suppliers", async () => {
    api.on("GET", "/suppliers", page([acme, bolt]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Acme Roasters")).toBeInTheDocument();
    expect(screen.getByText("Bolt Wholesale")).toBeInTheDocument();
    expect(screen.getByText("hi@acme.test")).toBeInTheDocument();
  });

  it("dashes out the columns a supplier hasn't filled in", async () => {
    api.on("GET", "/suppliers", page([bolt]));
    renderPage();

    const row = (await screen.findByText("Bolt Wholesale")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("asks for the active tab by default", async () => {
    api.on("GET", "/suppliers", page([acme]));
    renderPage();

    await screen.findByText("Acme Roasters");
    expect(api.requestsFor("GET", "/suppliers")[0].params).toEqual({
      page: 1,
      pageSize: 25,
      status: "active",
    });
  });

  it("says the list is empty rather than showing a bare table", async () => {
    api.on("GET", "/suppliers", page([]));
    renderPage();
    expect(await screen.findByText("No suppliers yet.")).toBeInTheDocument();
  });

  it("blames the search, not the account, when a search matches nothing", async () => {
    api.on("GET", "/suppliers", page([acme]), page([]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Nobody");

    expect(await screen.findByText("No suppliers match “Nobody”.")).toBeInTheDocument();
    expect(screen.queryByText("No suppliers yet.")).not.toBeInTheDocument();
  });

  it("says the archived tab is empty rather than the account", async () => {
    api.on("GET", "/suppliers", page([acme]), page([]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("No archived suppliers.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/suppliers", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load suppliers.")).toBeInTheDocument();
    expect(screen.queryByText("No suppliers yet.")).not.toBeInTheDocument();
  });

  it("marks an archived row and offers Restore instead of Archive", async () => {
    api.on("GET", "/suppliers", page([archived]));
    renderPage();

    const row = (await screen.findByText("Closed Distributor")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("SuppliersPage filtering", () => {
  it("switches tabs and resets to the first page", async () => {
    api.on("GET", "/suppliers", page([acme]), page([archived]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    await waitFor(() => expect(api.requestsFor("GET", "/suppliers")).toHaveLength(2));
    expect(api.requestsFor("GET", "/suppliers")[1].params).toMatchObject({
      status: "archived",
      page: 1,
    });
  });

  it("searches once for a typed word, not once per keystroke", async () => {
    api.on("GET", "/suppliers", page([acme, bolt]), page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Acme");

    await waitFor(
      () => expect(api.requestsFor("GET", "/suppliers")).toHaveLength(2),
      { timeout: DEFAULT_DEBOUNCE_MS * 4 }
    );
    expect(api.requestsFor("GET", "/suppliers")[1].params).toMatchObject({ search: "Acme" });
  });

  it("keeps the previous rows on screen while the next search runs", async () => {
    api.on("GET", "/suppliers", page([acme, bolt]), page([acme]));
    const { user } = renderPage();
    await screen.findByText("Bolt Wholesale");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Acme");

    expect(screen.getByText("Bolt Wholesale")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Bolt Wholesale")).not.toBeInTheDocument());
  });
});

describe("SuppliersPage archive", () => {
  it("names the supplier in the confirmation before archiving anything", async () => {
    api.on("GET", "/suppliers", page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Acme Roasters")).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/suppliers/s1")).toHaveLength(0);
  });

  it("archives on confirm and refreshes the list", async () => {
    api.on("GET", "/suppliers", page([acme]), page([]));
    api.on("DELETE", "/suppliers/s1", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive supplier" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/suppliers/s1")).toHaveLength(1));
    expect(await screen.findByText("No suppliers yet.")).toBeInTheDocument();
  });

  it("archives nothing when the dialog is cancelled", async () => {
    api.on("GET", "/suppliers", page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/suppliers/s1")).toHaveLength(0);
  });

  it("surfaces a rejected archive rather than failing silently", async () => {
    api.on("GET", "/suppliers", page([acme]));
    api.on("DELETE", "/suppliers/s1", fail(409, "Supplier has open purchase orders"));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive supplier" }));

    expect(await screen.findByText("Supplier has open purchase orders")).toBeInTheDocument();
    expect(screen.getByText("Acme Roasters")).toBeInTheDocument();
  });

  it("restores an archived supplier without a confirmation", async () => {
    api.on("GET", "/suppliers", page([archived]), page([supplier({ id: "s3", name: "Closed Distributor" })]));
    api.on("POST", "/suppliers/s3/restore", ok({}));
    const { user } = renderPage();
    await screen.findByText("Closed Distributor");

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(api.requestsFor("POST", "/suppliers/s3/restore")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("SuppliersPage create", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/suppliers", page([]));
    renderPage();
    await screen.findByText("No suppliers yet.");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("posts only the fields that were filled in", async () => {
    api.on("GET", "/suppliers", page([]), page([bolt]));
    api.on("POST", "/suppliers", ok(bolt, 201));
    const { user } = renderPage();
    await screen.findByText("No suppliers yet.");

    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    await user.type(screen.getByLabelText("Name"), "Bolt Wholesale");
    await user.click(screen.getByRole("button", { name: "Save supplier" }));

    await waitFor(() => expect(api.requestsFor("POST", "/suppliers")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/suppliers")[0].data)).toEqual({ name: "Bolt Wholesale" });
  });

  it("closes the form and shows the new row on success", async () => {
    api.on("GET", "/suppliers", page([]), page([bolt]));
    api.on("POST", "/suppliers", ok(bolt, 201));
    const { user } = renderPage();
    await screen.findByText("No suppliers yet.");

    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    await user.type(screen.getByLabelText("Name"), "Bolt Wholesale");
    await user.click(screen.getByRole("button", { name: "Save supplier" }));

    expect(await screen.findByText("Bolt Wholesale")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    api.on("GET", "/suppliers", page([]));
    api.on("POST", "/suppliers", fail(409, "A supplier with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("No suppliers yet.");

    await user.click(screen.getByRole("button", { name: "Add supplier" }));
    await user.type(screen.getByLabelText("Name"), "Acme Roasters");
    await user.click(screen.getByRole("button", { name: "Save supplier" }));

    expect(await screen.findByText("A supplier with that name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Roasters");
  });
});

describe("SuppliersPage edit", () => {
  it("opens pre-filled with the supplier's current details", async () => {
    api.on("GET", "/suppliers", page([acme]));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Acme Roasters");
    expect(screen.getByLabelText("Email")).toHaveValue("hi@acme.test");
    expect(screen.getByLabelText("Phone")).toHaveValue("555-0100");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("sends the edited fields with a PATCH and refreshes the list", async () => {
    const renamed = supplier({ id: "s1", name: "Acme Coffee Roasters", email: "hi@acme.test", phone: "555-0100" });
    api.on("GET", "/suppliers", page([acme]), page([renamed]));
    api.on("PATCH", "/suppliers/s1", ok(renamed));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const nameField = screen.getByLabelText("Name");
    await user.clear(nameField);
    await user.type(nameField, "Acme Coffee Roasters");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/suppliers/s1")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/suppliers/s1")[0].data)).toEqual({
      name: "Acme Coffee Roasters",
      email: "hi@acme.test",
      phone: "555-0100",
    });
    expect(await screen.findByText("Acme Coffee Roasters")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the edit fails", async () => {
    api.on("GET", "/suppliers", page([acme]));
    api.on("PATCH", "/suppliers/s1", fail(409, "A supplier with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("A supplier with that name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Roasters");
  });

  it("does not offer Edit for an archived supplier", async () => {
    api.on("GET", "/suppliers", page([archived]));
    renderPage();

    const row = (await screen.findByText("Closed Distributor")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("SuppliersPage pagination", () => {
  it("hides the control while everything fits on one page", async () => {
    api.on("GET", "/suppliers", page([acme, bolt]));
    renderPage();
    await screen.findByText("Acme Roasters");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("steps to the next page and asks the API for it", async () => {
    api.on("GET", "/suppliers", page([acme], 60), ok({ items: [bolt], total: 60, page: 2, pageSize: 25 }));
    const { user } = renderPage();
    await screen.findByText("Acme Roasters");

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(api.requestsFor("GET", "/suppliers")).toHaveLength(2));
    expect(api.requestsFor("GET", "/suppliers")[1].params).toMatchObject({ page: 2 });
    expect(await screen.findByText("26–50 of 60 suppliers")).toBeInTheDocument();
  });
});
