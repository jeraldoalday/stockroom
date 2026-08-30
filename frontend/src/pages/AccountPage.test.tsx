import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { AccountPage } from "./AccountPage";
import * as client from "../api/client";
import { MockApi, fail, ok } from "../test/mockApi";
import { ownerUser, renderApp } from "../test/render";
import type { Session } from "../api/auth";

// `logout()` (fired after a password change, and when ending the session
// this browser is using) calls `revokeSessionOnServer`, which goes through a
// bare `axios.post` rather than `apiClient` — MockApi swaps `apiClient`'s
// adapter, so that call needs its own spy, the same way AuthContext.test.tsx
// mocks it.
let revoke: ReturnType<typeof vi.spyOn>;

const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    createdAt: "2026-08-20T09:00:00.000Z",
    lastActiveAt: "2026-08-29T09:00:00.000Z",
    expiresAt: "2026-09-05T09:00:00.000Z",
    current: false,
    userAgent: CHROME_LINUX,
    ...overrides,
  } as Session;
}

const thisDevice = session({ id: "s1", current: true });
const otherDevice = session({ id: "s2", userAgent: null });

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
  revoke = vi.spyOn(client, "revokeSessionOnServer").mockResolvedValue(undefined);
});

afterEach(() => {
  api.restore();
});

function renderPage() {
  return renderApp(<AccountPage />, { user: ownerUser });
}

describe("AccountPage profile", () => {
  it("shows the signed-in user's name, email, and role", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice]));
    renderPage();

    // "Dana Owner" and the email both also name the signed-in user in the
    // sidebar footer, so the summary card is one of two matches for each.
    expect(await screen.findAllByText("Dana Owner")).toHaveLength(2);
    expect(screen.getAllByText("owner@northside.test")).toHaveLength(2);
    // Only the summary card spells the role out, though.
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });
});

describe("AccountPage change password", () => {
  it("rejects a mismatched confirmation before calling the API", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice]));
    const { user } = renderPage();
    // "Dana Owner" names the signed-in user in the sidebar too, so waiting on
    // it wouldn't prove the page (specifically its sessions query) settled —
    // wait on something that only ever comes from the loaded session row.
    await screen.findByText("Chrome on Linux");

    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "new-password-1");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-2");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("New password and confirmation do not match")).toBeInTheDocument();
    expect(api.requestsFor("PATCH", "/auth/password")).toHaveLength(0);
  });

  it("posts the current and new password, not the confirmation", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice]));
    api.on("PATCH", "/auth/password", ok(undefined, 204));
    const { user } = renderPage();
    // "Dana Owner" names the signed-in user in the sidebar too, so waiting on
    // it wouldn't prove the page (specifically its sessions query) settled —
    // wait on something that only ever comes from the loaded session row.
    await screen.findByText("Chrome on Linux");

    await user.type(screen.getByLabelText("Current password"), "old-password");
    await user.type(screen.getByLabelText("New password"), "new-password-1");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(api.requestsFor("PATCH", "/auth/password")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("PATCH", "/auth/password")[0].data)).toEqual({
      currentPassword: "old-password",
      newPassword: "new-password-1",
    });
  });

  it("keeps the form up with the server's message when the current password is wrong", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice]));
    api.on("PATCH", "/auth/password", fail(401, "Current password is incorrect"));
    const { user } = renderPage();
    // "Dana Owner" names the signed-in user in the sidebar too, so waiting on
    // it wouldn't prove the page (specifically its sessions query) settled —
    // wait on something that only ever comes from the loaded session row.
    await screen.findByText("Chrome on Linux");

    await user.type(screen.getByLabelText("Current password"), "wrong-password");
    await user.type(screen.getByLabelText("New password"), "new-password-1");
    await user.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
  });

  it(
    "shows a success message, then signs out everywhere a couple of seconds later",
    async () => {
      // A password change revokes every session for the user, this browser
      // included — the whole point of resetting a password someone else may
      // know. The delay is real, not mocked, so this genuinely exercises the
      // timer rather than asserting on a stubbed clock.
      api.on("GET", "/auth/sessions", ok([thisDevice]));
      api.on("PATCH", "/auth/password", ok(undefined, 204));
      const { user } = renderPage();
      // "Dana Owner" names the signed-in user in the sidebar too, so waiting on
    // it wouldn't prove the page (specifically its sessions query) settled —
    // wait on something that only ever comes from the loaded session row.
    await screen.findByText("Chrome on Linux");

      await user.type(screen.getByLabelText("Current password"), "old-password");
      await user.type(screen.getByLabelText("New password"), "new-password-1");
      await user.type(screen.getByLabelText("Confirm new password"), "new-password-1");
      await user.click(screen.getByRole("button", { name: "Update password" }));

      expect(await screen.findByText(/This signed you out everywhere/)).toBeInTheDocument();
      expect(revoke).not.toHaveBeenCalled();

      await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1), { timeout: 4000 });
    },
    6000
  );
});

describe("AccountPage sessions", () => {
  it("shows a loading message, then the session rows", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    renderPage();

    expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
    expect(await screen.findByText("Chrome on Linux")).toBeInTheDocument();
    expect(screen.getByText("Unknown device")).toBeInTheDocument();
  });

  it("badges the session this browser is using", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    renderPage();

    const row = (await screen.findByText("This device")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Chrome on Linux")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("offers End session, not Sign out, on another device's row", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    renderPage();

    const row = (await screen.findByText("Unknown device")).closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: "End session" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("says there are no other sessions rather than showing a bare table", async () => {
    api.on("GET", "/auth/sessions", ok([]));
    renderPage();
    expect(await screen.findByText("No other sessions.")).toBeInTheDocument();
  });

  it("reports a failed load instead of an empty list", async () => {
    api.on("GET", "/auth/sessions", fail(500, "boom"));
    renderPage();
    expect(await screen.findByText("Could not load your sessions.")).toBeInTheDocument();
  });

  it("ends another device's session on confirm and refreshes the list", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]), ok([thisDevice]));
    api.on("DELETE", "/auth/sessions/s2", ok(undefined, 204));
    const { user } = renderPage();
    await screen.findByText("Unknown device");

    await user.click(screen.getByRole("button", { name: "End session" }));
    // The row's trigger and the dialog's confirm button share the exact same
    // label for a non-current session, so the confirm click has to be
    // scoped to the dialog.
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/auth/sessions/s2")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("Unknown device")).not.toBeInTheDocument());
    expect(revoke).not.toHaveBeenCalled();
  });

  it("names the device and when it was last active in the confirmation", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    const { user } = renderPage();
    await screen.findByText("Unknown device");

    await user.click(screen.getByRole("button", { name: "End session" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("End this session?")).toBeInTheDocument();
    expect(within(dialog).getByText(/last active on/)).toBeInTheDocument();
  });

  it("ends nothing when the dialog is cancelled", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    const { user } = renderPage();
    await screen.findByText("Unknown device");

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.requestsFor("DELETE", "/auth/sessions/s2")).toHaveLength(0);
  });

  it("surfaces a rejected end-session rather than failing silently", async () => {
    api.on("GET", "/auth/sessions", ok([thisDevice, otherDevice]));
    api.on("DELETE", "/auth/sessions/s2", fail(404, "Session not found"));
    const { user } = renderPage();
    await screen.findByText("Unknown device");

    await user.click(screen.getByRole("button", { name: "End session" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "End session" }));

    expect(await screen.findByText("Session not found")).toBeInTheDocument();
  });

  it("signs this browser out immediately when its own session is ended", async () => {
    // Ending the current session leaves this browser holding a dead refresh
    // token — that is signing out, so it happens right away rather than
    // waiting for the access token to expire and every request to start
    // failing with no explanation.
    api.on("GET", "/auth/sessions", ok([thisDevice]));
    api.on("DELETE", "/auth/sessions/s1", ok(undefined, 204));
    const { user } = renderPage();
    const row = (await screen.findByText("This device")).closest("tr") as HTMLElement;

    // The sidebar has its own always-present "Sign out" button, so the
    // row's trigger has to be scoped to the row.
    await user.click(within(row).getByRole("button", { name: "Sign out" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(api.requestsFor("DELETE", "/auth/sessions/s1")).toHaveLength(1));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
  });
});
