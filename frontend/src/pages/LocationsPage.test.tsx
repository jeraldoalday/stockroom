import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { LocationsPage } from "./LocationsPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Location } from "../api/types";

// LocationsPage follows the same list-page template as CustomersPage, but
// `GET /locations` returns a bare array rather than a paginated envelope
// (see api/locations.ts), so there's no Pagination control here, and it adds
// its own "make default" action the other list pages don't have.

function location(overrides: Partial<Location> & { id: string; name: string }): Location {
  return {
    address: null,
    isDefault: false,
    isActive: true,
    ...overrides,
  } as Location;
}

const warehouse = location({ id: "l1", name: "Main Warehouse", address: "1 Dock Rd", isDefault: true });
const storefront = location({ id: "l2", name: "Storefront" });
const archived = location({ id: "l3", name: "Old Annex", isActive: false });

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<LocationsPage />, { user: ownerUser });
}

describe("LocationsPage list", () => {
  it("shows a loading row, then the locations", async () => {
    api.on("GET", "/locations", ok([warehouse, storefront]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Main Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Storefront")).toBeInTheDocument();
    expect(screen.getByText("1 Dock Rd")).toBeInTheDocument();
  });

  it("dashes out a location with no address", async () => {
    api.on("GET", "/locations", ok([storefront]));
    renderPage();

    const row = (await screen.findByText("Storefront")).closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("asks for the active tab by default", async () => {
    api.on("GET", "/locations", ok([warehouse]));
    renderPage();

    await screen.findByText("Main Warehouse");
    expect(api.requestsFor("GET", "/locations")[0].params).toEqual({ status: "active" });
  });

  it("says the list is empty rather than showing a bare table", async () => {
    api.on("GET", "/locations", ok([]));
    renderPage();
    expect(await screen.findByText("No locations yet.")).toBeInTheDocument();
  });

  it("says the archived tab is empty rather than the account", async () => {
    api.on("GET", "/locations", ok([warehouse]), ok([]));
    const { user } = renderPage();
    await screen.findByText("Main Warehouse");

    await user.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("No archived locations.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/locations", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load locations.")).toBeInTheDocument();
    expect(screen.queryByText("No locations yet.")).not.toBeInTheDocument();
  });

  it("marks an archived row and offers Restore instead of Archive", async () => {
    api.on("GET", "/locations", ok([archived]));
    renderPage();

    const row = (await screen.findByText("Old Annex")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Archived")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("has no pagination control — the endpoint returns every location at once", async () => {
    api.on("GET", "/locations", ok([warehouse, storefront]));
    renderPage();
    await screen.findByText("Main Warehouse");
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

describe("LocationsPage default location", () => {
  it("badges the default location instead of offering to make it one", async () => {
    api.on("GET", "/locations", ok([warehouse]));
    renderPage();

    const row = (await screen.findByText("Main Warehouse")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Default")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Make default" })).not.toBeInTheDocument();
  });

  it("offers to make a non-default active location the default", async () => {
    api.on("GET", "/locations", ok([warehouse, storefront]));
    renderPage();

    const row = (await screen.findByText("Storefront")).closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Make default" })).toBeInTheDocument();
  });

  it("does not offer to make an archived location the default", async () => {
    // An archived location can't take stock, so it can never be proposed
    // by a form and shouldn't be promotable to the one every form defaults to.
    api.on("GET", "/locations", ok([archived]));
    renderPage();

    const row = (await screen.findByText("Old Annex")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Make default" })).not.toBeInTheDocument();
    expect(within(row).queryByText("Default")).not.toBeInTheDocument();
  });

  it("patches isDefault and refreshes the list on click", async () => {
    api.on(
      "GET",
      "/locations",
      ok([warehouse, storefront]),
      ok([{ ...warehouse, isDefault: false }, { ...storefront, isDefault: true }])
    );
    api.on("PATCH", "/locations/l2", ok({ ...storefront, isDefault: true }));
    const { user } = renderPage();
    await screen.findByText("Storefront");

    await user.click(screen.getByRole("button", { name: "Make default" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/locations/l2")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/locations/l2")[0].data)).toEqual({ isDefault: true });
  });

  it("surfaces a rejected default change rather than failing silently", async () => {
    api.on("GET", "/locations", ok([warehouse, storefront]));
    api.on("PATCH", "/locations/l2", fail(400, "Location is archived"));
    const { user } = renderPage();
    await screen.findByText("Storefront");

    await user.click(screen.getByRole("button", { name: "Make default" }));

    expect(await screen.findByText("Location is archived")).toBeInTheDocument();
  });
});

describe("LocationsPage archive", () => {
  it("names the location in the confirmation before archiving anything", async () => {
    api.on("GET", "/locations", ok([storefront]));
    const { user } = renderPage();
    await screen.findByText("Storefront");

    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Storefront")).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/locations/l2")).toHaveLength(0);
  });

  it("archives on confirm and refreshes the list", async () => {
    api.on("GET", "/locations", ok([storefront]), ok([]));
    api.on("DELETE", "/locations/l2", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Storefront");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive location" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/locations/l2")).toHaveLength(1));
    expect(await screen.findByText("No locations yet.")).toBeInTheDocument();
  });

  it("surfaces a rejected archive rather than failing silently", async () => {
    // The backend refuses to archive a location that still holds stock, is
    // the default, or is the org's last one — the message is the whole point.
    api.on("GET", "/locations", ok([storefront]));
    api.on("DELETE", "/locations/l2", fail(409, "Location still holds stock"));
    const { user } = renderPage();
    await screen.findByText("Storefront");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive location" }));

    expect(await screen.findByText("Location still holds stock")).toBeInTheDocument();
    expect(screen.getByText("Storefront")).toBeInTheDocument();
  });

  it("restores an archived location without a confirmation", async () => {
    api.on("GET", "/locations", ok([archived]), ok([location({ id: "l3", name: "Old Annex" })]));
    api.on("POST", "/locations/l3/restore", ok({}));
    const { user } = renderPage();
    await screen.findByText("Old Annex");

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(api.requestsFor("POST", "/locations/l3/restore")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("LocationsPage create", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/locations", ok([]));
    renderPage();
    await screen.findByText("No locations yet.");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("posts only the fields that were filled in, with isDefault false when unchecked", async () => {
    api.on("GET", "/locations", ok([]), ok([storefront]));
    api.on("POST", "/locations", ok(storefront, 201));
    const { user } = renderPage();
    await screen.findByText("No locations yet.");

    await user.click(screen.getByRole("button", { name: "Add location" }));
    await user.type(screen.getByLabelText("Name"), "Storefront");
    await user.click(screen.getByRole("button", { name: "Save location" }));

    await waitFor(() => expect(api.requestsFor("POST", "/locations")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/locations")[0].data)).toEqual({
      name: "Storefront",
      isDefault: false,
    });
  });

  it("sends isDefault true when the checkbox is checked", async () => {
    api.on("GET", "/locations", ok([]), ok([warehouse]));
    api.on("POST", "/locations", ok(warehouse, 201));
    const { user } = renderPage();
    await screen.findByText("No locations yet.");

    await user.click(screen.getByRole("button", { name: "Add location" }));
    await user.type(screen.getByLabelText("Name"), "Main Warehouse");
    await user.click(screen.getByLabelText("Set as default location"));
    await user.click(screen.getByRole("button", { name: "Save location" }));

    await waitFor(() => expect(api.requestsFor("POST", "/locations")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/locations")[0].data)).toMatchObject({ isDefault: true });
  });

  it("closes the form and shows the new row on success", async () => {
    api.on("GET", "/locations", ok([]), ok([storefront]));
    api.on("POST", "/locations", ok(storefront, 201));
    const { user } = renderPage();
    await screen.findByText("No locations yet.");

    await user.click(screen.getByRole("button", { name: "Add location" }));
    await user.type(screen.getByLabelText("Name"), "Storefront");
    await user.click(screen.getByRole("button", { name: "Save location" }));

    expect(await screen.findByText("Storefront")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the save fails", async () => {
    api.on("GET", "/locations", ok([]));
    api.on("POST", "/locations", fail(409, "A location with that name already exists"));
    const { user } = renderPage();
    await screen.findByText("No locations yet.");

    await user.click(screen.getByRole("button", { name: "Add location" }));
    await user.type(screen.getByLabelText("Name"), "Main Warehouse");
    await user.click(screen.getByRole("button", { name: "Save location" }));

    expect(await screen.findByText("A location with that name already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Main Warehouse");
  });
});
