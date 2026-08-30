import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { CategoriesPage } from "./CategoriesPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Category } from "../api/types";

// Follows the LocationsPage template — `GET /categories` is also a bare
// array, so there's no Pagination control — but earns its own suite for the
// inline rename, the one action neither Locations nor Customers has.

function category(overrides: Partial<Category> & { id: string; name: string }): Category {
  return { isActive: true, ...overrides } as Category;
}

const beverages = category({ id: "cat1", name: "Beverages" });
const snacks = category({ id: "cat2", name: "Snacks" });
const archived = category({ id: "cat3", name: "Discontinued", isActive: false });

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<CategoriesPage />, { user: ownerUser });
}

describe("CategoriesPage list", () => {
  it("shows a loading row, then the categories", async () => {
    api.on("GET", "/categories", ok([beverages, snacks]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Snacks")).toBeInTheDocument();
  });

  it("asks for the active tab by default", async () => {
    api.on("GET", "/categories", ok([beverages]));
    renderPage();

    await screen.findByText("Beverages");
    expect(api.requestsFor("GET", "/categories")[0].params).toEqual({ status: "active" });
  });

  it("says the list is empty rather than showing a bare table", async () => {
    api.on("GET", "/categories", ok([]));
    renderPage();
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("says the archived tab is empty rather than the account", async () => {
    api.on("GET", "/categories", ok([beverages]), ok([]));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("No archived categories.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/categories", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load categories.")).toBeInTheDocument();
    expect(screen.queryByText("No categories yet.")).not.toBeInTheDocument();
  });

  it("marks an archived row, offers Restore, and hides Rename/Archive", async () => {
    api.on("GET", "/categories", ok([archived]));
    renderPage();

    const row = (await screen.findByText("Discontinued")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
  });

  it("has no pagination control — the endpoint returns every category at once", async () => {
    api.on("GET", "/categories", ok([beverages, snacks]));
    renderPage();
    await screen.findByText("Beverages");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

describe("CategoriesPage rename", () => {
  it("opens an inline input prefilled with the current name", async () => {
    api.on("GET", "/categories", ok([beverages]));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(screen.getByDisplayValue("Beverages")).toBeInTheDocument();
  });

  it("saves the new name and refreshes the list", async () => {
    api.on("GET", "/categories", ok([beverages]), ok([category({ id: "cat1", name: "Drinks" })]));
    api.on("PATCH", "/categories/cat1", ok(category({ id: "cat1", name: "Drinks" })));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Beverages");
    await user.clear(input);
    await user.type(input, "Drinks");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/categories/cat1")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/categories/cat1")[0].data)).toEqual({ name: "Drinks" });
    expect(await screen.findByText("Drinks")).toBeInTheDocument();
  });

  it("closes the inline editor on Cancel without saving", async () => {
    api.on("GET", "/categories", ok([beverages]));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Beverages");
    await user.clear(input);
    await user.type(input, "Drinks");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByDisplayValue("Drinks")).not.toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(api.requestsFor("PATCH", "/categories/cat1")).toHaveLength(0);
  });

  it("surfaces a rejected rename rather than failing silently", async () => {
    api.on("GET", "/categories", ok([beverages]));
    api.on("PATCH", "/categories/cat1", fail(409, "A category with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("Beverages");
    await user.clear(input);
    await user.type(input, "Snacks");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A category with that name already exists")).toBeInTheDocument();
  });
});

describe("CategoriesPage archive", () => {
  it("names the category in the confirmation before archiving anything", async () => {
    api.on("GET", "/categories", ok([beverages]));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Beverages")).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/categories/cat1")).toHaveLength(0);
  });

  it("archives on confirm and refreshes the list", async () => {
    api.on("GET", "/categories", ok([beverages]), ok([]));
    api.on("DELETE", "/categories/cat1", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive category" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/categories/cat1")).toHaveLength(1));
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("surfaces a rejected archive rather than failing silently", async () => {
    api.on("GET", "/categories", ok([beverages]));
    api.on("DELETE", "/categories/cat1", fail(500, "boom"));
    const { user } = renderPage();
    await screen.findByText("Beverages");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive category" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
  });

  it("restores an archived category without a confirmation", async () => {
    api.on("GET", "/categories", ok([archived]), ok([category({ id: "cat3", name: "Discontinued" })]));
    api.on("POST", "/categories/cat3/restore", ok({}));
    const { user } = renderPage();
    await screen.findByText("Discontinued");

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(api.requestsFor("POST", "/categories/cat3/restore")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("CategoriesPage create", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/categories", ok([]));
    renderPage();
    await screen.findByText("No categories yet.");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("creates a category and shows it in the list", async () => {
    api.on("GET", "/categories", ok([]), ok([snacks]));
    api.on("POST", "/categories", ok(snacks, 201));
    const { user } = renderPage();
    await screen.findByText("No categories yet.");

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Name"), "Snacks");
    await user.click(screen.getByRole("button", { name: "Save category" }));

    await waitFor(() => expect(api.requestsFor("POST", "/categories")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/categories")[0].data)).toEqual({ name: "Snacks" });
    expect(await screen.findByText("Snacks")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    api.on("GET", "/categories", ok([]));
    api.on("POST", "/categories", fail(409, "A category with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("No categories yet.");

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Name"), "Beverages");
    await user.click(screen.getByRole("button", { name: "Save category" }));

    expect(await screen.findByText("A category with that name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Beverages");
  });
});
