import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { StocktakesPage } from "./StocktakesPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp, staffUser } from "../test/render";
import type { Location, Product, Stocktake, StocktakeLine } from "../api/types";

// The page is two levels — a list of counts, and the sheet expanded inline
// under a row — so most of these render the list, open the sheet, and then
// assert on the sheet. `GET /stocktakes/s1` is queued in beforeEach for the
// same reason `GET /locations` is: nearly every test opens a sheet.

const warehouse: Location = {
  id: "l1",
  name: "Main Warehouse",
  address: null,
  isDefault: true,
  isActive: true,
};

function product(id: string, sku: string, name: string): Product {
  return {
    id,
    sku,
    name,
    description: null,
    categoryId: null,
    priceCents: 500,
    reorderPoint: 0,
    reorderQty: 0,
    isActive: true,
  };
}

const applesauce = product("p1", "APP-1", "Apple Sauce");
const flour = product("p2", "FLR-1", "Bread Flour");

function line(overrides: Partial<StocktakeLine> & { id: string }): StocktakeLine {
  return {
    productId: "p1",
    expectedQty: 10,
    countedQty: null,
    appliedDelta: null,
    countedAt: null,
    product: applesauce,
    countedBy: null,
    ...overrides,
  };
}

function stocktake(overrides: Partial<Stocktake> & { id: string }): Stocktake {
  return {
    locationId: "l1",
    status: "OPEN",
    notes: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    completedAt: null,
    location: warehouse,
    createdBy: null,
    completedBy: null,
    lineCount: 1,
    countedCount: 0,
    ...overrides,
  };
}

const openSheet = stocktake({ id: "s1", lines: [line({ id: "ln1" })] });

function listPage(items: Stocktake[], total = items.length) {
  return ok({ items, total, page: 1, pageSize: 25 });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
  api.on("GET", "/locations", ok([warehouse]));
  api.on("GET", "/products", ok({ items: [applesauce, flour], total: 2, page: 1, pageSize: 100 }));
  api.on("GET", "/stocktakes", listPage([openSheet]));
  api.on("GET", "/stocktakes/s1", ok(openSheet));
});

afterEach(() => {
  api.restore();
});

function renderPage(user = ownerUser) {
  return renderApp(<StocktakesPage />, { user });
}

async function openTheSheet(user: ReturnType<typeof renderPage>["user"]) {
  await user.click(await screen.findByRole("button", { name: "Open sheet" }));
  return screen.findByRole("spinbutton", { name: /counted quantity for apple sauce/i });
}

describe("StocktakesPage list", () => {
  it("shows a loading row, then the counts in progress", async () => {
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText("Main Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Counting")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 counted")).toBeInTheDocument();
  });

  it("defaults to in-progress counts, and asks the API for only those", async () => {
    renderPage();
    await screen.findByText("Main Warehouse");

    const [request] = api.requestsFor("GET", "/stocktakes");
    expect(request.params).toMatchObject({ status: "OPEN" });
    expect(screen.getByRole("button", { name: "In progress" })).toHaveAttribute("aria-pressed", "true");
  });

  it("drops the status filter entirely on the All tab", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "All" }));

    await waitFor(() => {
      const requests = api.requestsFor("GET", "/stocktakes");
      expect(requests[requests.length - 1]?.params?.status).toBeUndefined();
    });
  });

  it("explains an empty in-progress list rather than blaming the account", async () => {
    api.on("GET", "/stocktakes", listPage([]));
    renderPage();

    expect(await screen.findByText(/no counts in progress/i)).toBeInTheDocument();
  });

  it("reports a failed list load", async () => {
    api.on("GET", "/stocktakes", fail(500));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load stocktakes/i);
  });

  it("paginates when there is more than one page", async () => {
    api.on("GET", "/stocktakes", ok({ items: [openSheet], total: 30, page: 1, pageSize: 25 }));
    renderPage();

    expect(await screen.findByText("1–25 of 30 stocktakes")).toBeInTheDocument();
  });
});

describe("StocktakesPage starting a count", () => {
  it("sends the location and scope, and opens the new sheet", async () => {
    const { user } = renderPage();
    await screen.findByText("Main Warehouse");

    await user.click(screen.getByRole("button", { name: "Start a count" }));
    await user.selectOptions(screen.getByLabelText("Location"), "l1");
    await user.selectOptions(screen.getByLabelText("Count sheet"), "all-products");
    api.on("POST", "/stocktakes", ok(openSheet, 201));
    await user.click(screen.getByRole("button", { name: "Start counting" }));

    await waitFor(() => {
      expect(api.requestsFor("POST", "/stocktakes")).toHaveLength(1);
    });
    expect(JSON.parse(api.requestsFor("POST", "/stocktakes")[0].data)).toMatchObject({
      locationId: "l1",
      scope: "all-products",
    });
    // Straight into the sheet, without a second click.
    expect(await screen.findByRole("button", { name: "Hide sheet" })).toBeInTheDocument();
  });

  it("surfaces the API's reason for refusing a second count", async () => {
    const { user } = renderPage();
    await screen.findByText("Main Warehouse");

    await user.click(screen.getByRole("button", { name: "Start a count" }));
    await user.selectOptions(screen.getByLabelText("Location"), "l1");
    api.on("POST", "/stocktakes", fail(409, "Main Warehouse already has an open stocktake"));
    await user.click(screen.getByRole("button", { name: "Start counting" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already has an open stocktake/i);
  });
});

describe("StocktakesPage count sheet", () => {
  it("shows the expected quantity and an uncounted line", async () => {
    const { user } = renderPage();
    await openTheSheet(user);

    expect(screen.getByText("APP-1", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Not counted")).toBeInTheDocument();
  });

  it("records a counted figure when the box loses focus", async () => {
    const { user } = renderPage();
    const input = await openTheSheet(user);

    api.on("PATCH", "/stocktakes/s1/lines/ln1", ok(openSheet));
    await user.type(input, "8");
    await user.tab();

    await waitFor(() => {
      expect(api.requestsFor("PATCH", "/stocktakes/s1/lines/ln1")).toHaveLength(1);
    });
    expect(JSON.parse(api.requestsFor("PATCH", "/stocktakes/s1/lines/ln1")[0].data)).toEqual({
      countedQty: 8,
    });
  });

  it("sends null, not zero, when a counted figure is cleared", async () => {
    const counted = stocktake({
      id: "s1",
      countedCount: 1,
      lines: [line({ id: "ln1", countedQty: 8 })],
    });
    api.on("GET", "/stocktakes/s1", ok(counted));
    const { user } = renderPage();
    const input = await openTheSheet(user);

    api.on("PATCH", "/stocktakes/s1/lines/ln1", ok(counted));
    await user.clear(input);
    await user.tab();

    await waitFor(() => {
      expect(api.requestsFor("PATCH", "/stocktakes/s1/lines/ln1")).toHaveLength(1);
    });
    expect(JSON.parse(api.requestsFor("PATCH", "/stocktakes/s1/lines/ln1")[0].data)).toEqual({
      countedQty: null,
    });
  });

  it("does not re-send a figure that has not changed", async () => {
    api.on("GET", "/stocktakes/s1", ok(stocktake({
      id: "s1",
      countedCount: 1,
      lines: [line({ id: "ln1", countedQty: 8 })],
    })));
    const { user } = renderPage();
    const input = await openTheSheet(user);

    await user.click(input);
    await user.tab();

    expect(api.requestsFor("PATCH", "/stocktakes/s1/lines/ln1")).toHaveLength(0);
  });

  it("shows the live variance for a counted line", async () => {
    api.on("GET", "/stocktakes/s1", ok(stocktake({
      id: "s1",
      countedCount: 1,
      lines: [line({ id: "ln1", expectedQty: 10, countedQty: 7 })],
    })));
    const { user } = renderPage();
    await openTheSheet(user);

    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("says a line matches rather than showing a bare zero", async () => {
    api.on("GET", "/stocktakes/s1", ok(stocktake({
      id: "s1",
      countedCount: 1,
      lines: [line({ id: "ln1", expectedQty: 10, countedQty: 10 })],
    })));
    const { user } = renderPage();
    await openTheSheet(user);

    expect(screen.getByText("Matches")).toBeInTheDocument();
  });

  it("adds a product that was not on the sheet", async () => {
    const { user } = renderPage();
    await openTheSheet(user);

    // Apple Sauce is already on the sheet, so only Bread Flour is offered.
    const picker = screen.getByLabelText(/found something not on the sheet/i);
    expect(within(picker).queryByRole("option", { name: /Apple Sauce/ })).not.toBeInTheDocument();

    api.on("POST", "/stocktakes/s1/lines", ok(openSheet, 201));
    await user.selectOptions(picker, "p2");
    await user.click(screen.getByRole("button", { name: "Add to sheet" }));

    await waitFor(() => {
      expect(api.requestsFor("POST", "/stocktakes/s1/lines")).toHaveLength(1);
    });
    expect(JSON.parse(api.requestsFor("POST", "/stocktakes/s1/lines")[0].data)).toEqual({ productId: "p2" });
  });

  it("reports a failed sheet load without breaking the list", async () => {
    api.on("GET", "/stocktakes/s1", fail(500));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Open sheet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to load this count sheet/i);
    expect(screen.getByText("Main Warehouse")).toBeInTheDocument();
  });
});

describe("StocktakesPage exporting a count sheet", () => {
  it("downloads the sheet as CSV", async () => {
    api.on("GET", "/stocktakes/s1/export", ok("SKU,Product\nAPP-1,Apple Sauce\n"));
    const { user } = renderPage();
    await openTheSheet(user);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(api.requestsFor("GET", "/stocktakes/s1/export")).toHaveLength(1);
    });
  });

  it("surfaces a failed export rather than failing silently", async () => {
    api.on("GET", "/stocktakes/s1/export", fail(500, "boom"));
    const { user } = renderPage();
    await openTheSheet(user);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("is available on a completed sheet too, not only while counting", async () => {
    const completed = stocktake({
      id: "s1",
      status: "COMPLETED",
      countedCount: 1,
      lines: [line({ id: "ln1", countedQty: 10, appliedDelta: 0 })],
    });
    api.on("GET", "/stocktakes", listPage([completed]));
    api.on("GET", "/stocktakes/s1", ok(completed));
    api.on("GET", "/stocktakes/s1/export", ok("SKU,Product\nAPP-1,Apple Sauce\n"));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Open sheet" }));

    await user.click(await screen.findByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(api.requestsFor("GET", "/stocktakes/s1/export")).toHaveLength(1);
    });
  });
});

describe("StocktakesPage completing", () => {
  const countedSheet = stocktake({
    id: "s1",
    countedCount: 1,
    lines: [line({ id: "ln1", expectedQty: 10, countedQty: 7 })],
  });

  it("applies the count and reports what it changed", async () => {
    api.on("GET", "/stocktakes/s1", ok(countedSheet));
    const { user } = renderPage();
    await openTheSheet(user);

    api.on("POST", "/stocktakes/s1/complete", ok({
      ...countedSheet,
      status: "COMPLETED",
      summary: { countedLines: 1, adjustedLines: 1, unitsFound: 0, unitsLost: 3, variances: [] },
    }));
    await user.click(screen.getByRole("button", { name: /complete count and adjust stock/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/1 line counted, 1 corrected/i);
    expect(screen.getByRole("status")).toHaveTextContent(/found 0 units, lost 3/i);
  });

  it("will not let an Owner complete a sheet nobody has counted", async () => {
    const { user } = renderPage();
    await openTheSheet(user);

    expect(screen.getByRole("button", { name: /complete count and adjust stock/i })).toBeDisabled();
    expect(screen.getByText(/count at least one line first/i)).toBeInTheDocument();
  });

  it("surfaces a rejected completion", async () => {
    api.on("GET", "/stocktakes/s1", ok(countedSheet));
    const { user } = renderPage();
    await openTheSheet(user);

    api.on("POST", "/stocktakes/s1/complete", fail(400, "Only an open stocktake can be completed"));
    await user.click(screen.getByRole("button", { name: /complete count and adjust stock/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/only an open stocktake/i);
  });

  it("shows what was applied, not the sheet variance, on a completed sheet", async () => {
    const completed = stocktake({
      id: "s1",
      status: "COMPLETED",
      countedCount: 1,
      completedAt: "2026-09-02T09:00:00.000Z",
      // Counted 9 against a sheet that said 10, but only +1 was posted
      // because a sale had already taken the shelf to 8.
      lines: [line({ id: "ln1", expectedQty: 10, countedQty: 9, appliedDelta: 1 })],
    });
    api.on("GET", "/stocktakes", listPage([completed]));
    api.on("GET", "/stocktakes/s1", ok(completed));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Open sheet" }));

    expect(await screen.findByText("+1")).toBeInTheDocument();
    // No editable boxes once a count is closed.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("StocktakesPage cancelling", () => {
  it("names the location in the confirmation, then cancels", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Main Warehouse")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/without changing any stock/i);

    api.on("POST", "/stocktakes/s1/cancel", ok({ ...openSheet, status: "CANCELLED" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel count" }));

    await waitFor(() => {
      expect(api.requestsFor("POST", "/stocktakes/s1/cancel")).toHaveLength(1);
    });
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep counting" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(api.requestsFor("POST", "/stocktakes/s1/cancel")).toHaveLength(0);
  });
});

describe("StocktakesPage roles", () => {
  it("lets Staff count but not apply or cancel", async () => {
    const { user } = renderPage(staffUser);
    await openTheSheet(user);

    expect(screen.queryByRole("button", { name: /complete count and adjust stock/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByText(/an owner applies the count/i)).toBeInTheDocument();
  });

  it("still lets Staff start a count", async () => {
    renderPage(staffUser);
    expect(await screen.findByRole("button", { name: "Start a count" })).toBeInTheDocument();
  });
});
