import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute";
import { ownerUser, renderApp, staffUser } from "../test/render";

function Guarded({ ownerOnly = false }: { ownerOnly?: boolean }) {
  return (
    <Routes>
      <Route path="/login" element={<p>Sign in to StockRoom</p>} />
      <Route path="/" element={<p>Dashboard</p>} />
      <Route
        path="/team"
        element={
          <ProtectedRoute ownerOnly={ownerOnly}>
            <p>Team settings</p>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

describe("ProtectedRoute", () => {
  it("redirects a signed-out visitor to the login page", () => {
    renderApp(<Guarded />, { route: "/team" });
    expect(screen.getByText("Sign in to StockRoom")).toBeInTheDocument();
    expect(screen.queryByText("Team settings")).not.toBeInTheDocument();
  });

  it("renders the page for a signed-in user", () => {
    renderApp(<Guarded />, { route: "/team", user: staffUser });
    expect(screen.getByText("Team settings")).toBeInTheDocument();
  });

  it("bounces a signed-in Staff member off an owner-only page", () => {
    // The nav hides /team from Staff, but the URL is still typeable and
    // the route is the only thing that actually enforces the rule.
    renderApp(<Guarded ownerOnly />, { route: "/team", user: staffUser });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Team settings")).not.toBeInTheDocument();
  });

  it("lets an Owner through an owner-only page", () => {
    renderApp(<Guarded ownerOnly />, { route: "/team", user: ownerUser });
    expect(screen.getByText("Team settings")).toBeInTheDocument();
  });

  it("sends a signed-out visitor to login rather than the dashboard, even on an owner-only route", () => {
    // Order matters: checking the role first would redirect to "/", which
    // is itself protected, and the second redirect would land on /login
    // anyway — but only after a visible flash of the wrong destination.
    renderApp(<Guarded ownerOnly />, { route: "/team" });
    expect(screen.getByText("Sign in to StockRoom")).toBeInTheDocument();
  });

  it("treats a cached user with no access token as signed out", () => {
    // localStorage keeps the user object after the interceptor clears a
    // dead token, so this is the state a tab is left in when its refresh
    // token expires overnight.
    localStorage.setItem("stockroom_user", JSON.stringify(ownerUser));
    renderApp(<Guarded />, { route: "/team" });
    expect(screen.getByText("Sign in to StockRoom")).toBeInTheDocument();
  });
});
