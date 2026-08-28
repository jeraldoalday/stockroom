import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import * as client from "../api/client";
import { ownerUser, renderApp, staffUser } from "../test/render";

describe("AppShell", () => {
  it("shows the signed-in user's name and email", () => {
    renderApp(<AppShell><p>Body</p></AppShell>, { user: ownerUser });
    expect(screen.getByText("Dana Owner")).toBeInTheDocument();
    expect(screen.getByText("owner@northside.test")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("hides the Team link from Staff", () => {
    renderApp(<AppShell><p>Body</p></AppShell>, { user: staffUser });
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Products" })).toBeInTheDocument();
  });

  it("shows the Team link to an Owner", () => {
    renderApp(<AppShell><p>Body</p></AppShell>, { user: ownerUser });
    expect(screen.getByRole("link", { name: "Team" })).toBeInTheDocument();
  });

  it("marks only the current page as active", () => {
    // "/" is an exact match (`end`), or every route would light up the
    // Dashboard link as well as its own.
    renderApp(<AppShell><p>Body</p></AppShell>, { user: ownerUser, route: "/products" });
    expect(screen.getByRole("link", { name: "Products" }).className).toContain("text-brand-700");
    expect(screen.getByRole("link", { name: "Dashboard" }).className).not.toContain("text-brand-700");
  });

  it("marks Dashboard active on the root route only", () => {
    renderApp(<AppShell><p>Body</p></AppShell>, { user: ownerUser, route: "/" });
    expect(screen.getByRole("link", { name: "Dashboard" }).className).toContain("text-brand-700");
  });

  it("signs the user out from the sidebar", async () => {
    const revoke = vi.spyOn(client, "revokeSessionOnServer").mockResolvedValue(undefined);
    const { user } = renderApp(<AppShell><p>Body</p></AppShell>, { user: ownerUser });

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(client.getStoredToken()).toBeNull();
    expect(localStorage.getItem("stockroom_user")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
