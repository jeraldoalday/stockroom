import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { TeamPage } from "./TeamPage";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { TeamMember } from "../api/types";

function member(overrides: Partial<TeamMember> & { id: string; name: string; email: string }): TeamMember {
  return { role: "STAFF", createdAt: "2026-08-01T00:00:00.000Z", ...overrides } as TeamMember;
}

// `ownerUser.id` is "user-owner" — the seeded member below shares it, so the
// page's own-row logic (no self-remove, no self-unlock, the "(you)" tag) has
// something real to match against instead of an id that happens not to collide.
const dana = member({ id: ownerUser.id, name: "Dana Owner", email: "owner@northside.test", role: "OWNER" });
const sam = member({ id: "u2", name: "Sam Clerk", email: "clerk@northside.test" });

function team(items: TeamMember[]) {
  return ok({ items });
}

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<TeamPage />, { user: ownerUser });
}

describe("TeamPage list", () => {
  it("shows a loading row, then the members", async () => {
    api.on("GET", "/users", team([dana, sam]));
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // "Dana Owner" also names the signed-in user in the sidebar footer, so
    // waiting on it wouldn't prove the table loaded — "Sam Clerk" only ever
    // comes from the table.
    expect(await screen.findByText("Sam Clerk")).toBeInTheDocument();
    const ownRow = screen.getByText("(you)").closest("tr") as HTMLElement;
    expect(within(ownRow).getByText("Dana Owner")).toBeInTheDocument();
    expect(screen.getByText("clerk@northside.test")).toBeInTheDocument();
  });

  it("labels the signed-in user's own row and spells out their role", async () => {
    api.on("GET", "/users", team([dana, sam]));
    renderPage();
    await screen.findByText("Sam Clerk");

    const ownRow = screen.getByText("(you)").closest("tr") as HTMLElement;
    expect(within(ownRow).getByText("Dana Owner")).toBeInTheDocument();
    expect(within(ownRow).getByText("Owner")).toBeInTheDocument();
    const samRow = screen.getByText("Sam Clerk").closest("tr") as HTMLElement;
    expect(within(samRow).getByText("Staff")).toBeInTheDocument();
    expect(within(samRow).queryByText("(you)")).not.toBeInTheDocument();
  });

  it("reports a failed load instead of an empty table", async () => {
    api.on("GET", "/users", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Failed to load team members.")).toBeInTheDocument();
  });

  it("hides Unlock login and Remove on the signed-in user's own row", async () => {
    api.on("GET", "/users", team([dana, sam]));
    renderPage();
    await screen.findByText("Sam Clerk");

    const ownRow = screen.getByText("(you)").closest("tr") as HTMLElement;
    expect(within(ownRow).queryByRole("button", { name: "Unlock login" })).not.toBeInTheDocument();
    expect(within(ownRow).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    // The role-toggle stays available on every row, including your own.
    expect(within(ownRow).getByRole("button", { name: "Make Staff" })).toBeInTheDocument();
  });

  it("offers Unlock login and Remove on a colleague's row", async () => {
    api.on("GET", "/users", team([dana, sam]));
    renderPage();

    const samRow = (await screen.findByText("Sam Clerk")).closest("tr") as HTMLElement;
    expect(within(samRow).getByRole("button", { name: "Unlock login" })).toBeInTheDocument();
    expect(within(samRow).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});

describe("TeamPage invite", () => {
  it("keeps the form closed until asked", async () => {
    api.on("GET", "/users", team([dana]));
    renderPage();
    // "Dana Owner" also names the signed-in user in the sidebar footer, so
    // "(you)" — table-only — is the honest signal that the row loaded.
    await screen.findByText("(you)");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("has exactly two text inputs — name and email, no password", async () => {
    api.on("GET", "/users", team([dana]));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Invite team member" }));

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/They'll get an email with a link to set their own password/)).toBeInTheDocument();
  });

  it("defaults the role to Staff and posts the chosen role", async () => {
    api.on("GET", "/users", team([dana]), team([dana, sam]));
    api.on("POST", "/users", ok(sam, 201));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Invite team member" }));
    expect(screen.getByLabelText("Role")).toHaveValue("STAFF");
    await user.type(screen.getByLabelText("Name"), "Sam Clerk");
    await user.type(screen.getByLabelText("Email"), "clerk@northside.test");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(api.requestsFor("POST", "/users")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/users")[0].data)).toEqual({
      name: "Sam Clerk",
      email: "clerk@northside.test",
      role: "STAFF",
    });
  });

  it("closes the form and shows the new row on success", async () => {
    api.on("GET", "/users", team([dana]), team([dana, sam]));
    api.on("POST", "/users", ok(sam, 201));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Invite team member" }));
    await user.type(screen.getByLabelText("Name"), "Sam Clerk");
    await user.type(screen.getByLabelText("Email"), "clerk@northside.test");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Sam Clerk")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("keeps the form open with the server's message when the invite fails", async () => {
    api.on("GET", "/users", team([dana]));
    api.on("POST", "/users", fail(409, "A member with that email already exists"));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Invite team member" }));
    await user.type(screen.getByLabelText("Name"), "Sam Clerk");
    await user.type(screen.getByLabelText("Email"), "clerk@northside.test");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("A member with that email already exists")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Sam Clerk");
  });
});

describe("TeamPage role change", () => {
  it("toggles Owner to Staff and back, without a confirmation", async () => {
    api.on("GET", "/users", team([dana, sam]));
    api.on("PATCH", "/users/user-owner", ok({ ...dana, role: "STAFF" }));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Make Staff" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/users/user-owner")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/users/user-owner")[0].data)).toEqual({ role: "STAFF" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("surfaces a rejected role change rather than failing silently", async () => {
    // The backend refuses to demote the org's last Owner — the message here
    // is the whole point.
    api.on("GET", "/users", team([dana]));
    api.on("PATCH", "/users/user-owner", fail(409, "An organization needs at least one Owner"));
    const { user } = renderPage();
    await screen.findByText("(you)");

    await user.click(screen.getByRole("button", { name: "Make Staff" }));

    expect(await screen.findByText("An organization needs at least one Owner")).toBeInTheDocument();
  });
});

describe("TeamPage unlock login", () => {
  it("reports that a lockout was cleared", async () => {
    api.on("GET", "/users", team([dana, sam]));
    api.on("POST", "/users/u2/unlock-login", ok({ wasLockedOut: true }));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Unlock login" }));

    expect(await screen.findByText(/Sam Clerk's login lockout was cleared/)).toBeInTheDocument();
  });

  it("reports a no-op distinctly from an actual clear", async () => {
    api.on("GET", "/users", team([dana, sam]));
    api.on("POST", "/users/u2/unlock-login", ok({ wasLockedOut: false }));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Unlock login" }));

    expect(await screen.findByText("Sam Clerk wasn't locked out.")).toBeInTheDocument();
  });

  it("surfaces a failed unlock rather than failing silently", async () => {
    api.on("GET", "/users", team([dana, sam]));
    api.on("POST", "/users/u2/unlock-login", fail(404, "Member not found"));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Unlock login" }));

    expect(await screen.findByText("Member not found")).toBeInTheDocument();
  });
});

describe("TeamPage remove", () => {
  it("names the member and their email in the confirmation before removing anything", async () => {
    api.on("GET", "/users", team([dana, sam]));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Sam Clerk")).toBeInTheDocument();
    expect(within(dialog).getByText(/clerk@northside\.test/)).toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/users/u2")).toHaveLength(0);
  });

  it("removes on confirm and refreshes the list", async () => {
    api.on("GET", "/users", team([dana, sam]), team([dana]));
    api.on("DELETE", "/users/u2", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove member" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/users/u2")).toHaveLength(1));
    expect(screen.queryByText("Sam Clerk")).not.toBeInTheDocument();
  });

  it("removes nothing when the dialog is cancelled", async () => {
    api.on("GET", "/users", team([dana, sam]));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/users/u2")).toHaveLength(0);
  });

  it("surfaces a rejected removal rather than failing silently", async () => {
    // The backend refuses to remove a member who has recorded stock
    // movements — the message is the whole point.
    api.on("GET", "/users", team([dana, sam]));
    api.on("DELETE", "/users/u2", fail(409, "Member has recorded stock movements"));
    const { user } = renderPage();
    await screen.findByText("Sam Clerk");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove member" }));

    expect(await screen.findByText("Member has recorded stock movements")).toBeInTheDocument();
    expect(screen.getByText("Sam Clerk")).toBeInTheDocument();
  });
});
