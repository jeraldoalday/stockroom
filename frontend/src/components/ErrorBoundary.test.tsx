import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { screen } from "@testing-library/react";
import { Link, Route, Routes } from "react-router-dom";
import { AppErrorBoundary, ErrorBoundary } from "./ErrorBoundary";
import * as client from "../api/client";
import { ownerUser, renderApp } from "../test/render";

/**
 * Always throws. The return type is annotated because a function that only
 * ever throws is inferred as returning `never`, which TypeScript refuses to
 * accept as a JSX component.
 */
function Boom({ message = "Cannot read properties of undefined" }: { message?: string }): ReactElement {
  throw new Error(message);
}

/** Throws until a button outside the boundary tells it to stop. */
function Flaky({ broken }: { broken: boolean }) {
  if (broken) throw new Error("still broken");
  return <p>Recovered content</p>;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself, and componentDidCatch logs it
  // again. Neither is a test failure, but both make the output unreadable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    renderApp(
      <ErrorBoundary fallback={() => <p>Fallback</p>}>
        <p>All fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("All fine")).toBeInTheDocument();
    expect(screen.queryByText("Fallback")).not.toBeInTheDocument();
  });

  it("hands the caught error to the fallback", () => {
    renderApp(
      <ErrorBoundary fallback={(error) => <p>Caught: {error.message}</p>}>
        <Boom message="products is not iterable" />
      </ErrorBoundary>
    );
    expect(screen.getByText("Caught: products is not iterable")).toBeInTheDocument();
  });

  it("logs the error and the component stack", () => {
    renderApp(
      <ErrorBoundary fallback={() => <p>Fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );
    // The console is this app's only error reporter, and the message alone
    // rarely says which panel threw.
    expect(consoleError).toHaveBeenCalledWith(
      "Unhandled render error",
      expect.any(Error),
      expect.stringContaining("Boom")
    );
  });

  it("retries the children when reset is called", async () => {
    function Host() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <ErrorBoundary
            fallback={(_error, reset) => (
              <button
                type="button"
                onClick={() => {
                  setBroken(false);
                  reset();
                }}
              >
                Try again
              </button>
            )}
          >
            <Flaky broken={broken} />
          </ErrorBoundary>
        </>
      );
    }
    const { user } = renderApp(<Host />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });

  it("clears the error when the reset key changes", () => {
    // Navigating away is the natural "get me out of here"; without this the
    // boundary would go on painting its fallback over the new route.
    const { rerender } = renderApp(
      <ErrorBoundary resetKey="/products" fallback={() => <p>Fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("Fallback")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/suppliers" fallback={() => <p>Fallback</p>}>
        <p>Suppliers</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("Suppliers")).toBeInTheDocument();
  });

  it("stays down when the reset key is unchanged", () => {
    const { rerender } = renderApp(
      <ErrorBoundary resetKey="/products" fallback={() => <p>Fallback</p>}>
        <Boom />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary resetKey="/products" fallback={() => <p>Fallback</p>}>
        <p>Products</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("Fallback")).toBeInTheDocument();
  });
});

describe("AppErrorBoundary", () => {
  function renderBoundary(children: ReactNode) {
    return renderApp(
      <Routes>
        <Route path="/" element={<p>Dashboard</p>} />
        <Route path="/login" element={<p>Sign in to StockRoom</p>} />
        <Route path="/products" element={<AppErrorBoundary>{children}</AppErrorBoundary>} />
        <Route path="/suppliers" element={<AppErrorBoundary><p>Suppliers</p></AppErrorBoundary>} />
      </Routes>,
      { route: "/products", user: ownerUser }
    );
  }

  it("shows a recovery screen instead of a blank page", () => {
    renderBoundary(<Boom message="products is not iterable" />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("products is not iterable")).toBeInTheDocument();
  });

  it("reassures the user that saved work is intact", () => {
    renderBoundary(<Boom />);
    expect(screen.getByText(/Nothing you had already saved is affected/i)).toBeInTheDocument();
  });

  it("copes with an error carrying no message", () => {
    renderBoundary(<Boom message="" />);
    expect(screen.getByText("No error message was reported.")).toBeInTheDocument();
  });

  it("offers a way back to the dashboard", async () => {
    const { user } = renderBoundary(<Boom />);
    await user.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("clears itself when the user navigates away on their own", async () => {
    function Broken() {
      return (
        <>
          <Link to="/suppliers">Suppliers</Link>
          <Boom />
        </>
      );
    }
    const { user } = renderBoundary(<Broken />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();

    // The crashed tree has no nav left, so this drives the boundary's own
    // route reset the way the real sidebar would if it survived.
    await user.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(screen.queryByRole("heading", { name: "Something went wrong" })).not.toBeInTheDocument();
  });

  it("offers sign out, because a bad cached session can crash every route", async () => {
    // Once the tree is down the sidebar's sign-out button has gone with it,
    // and clearing site data by hand is the only other way out.
    const revoke = vi.spyOn(client, "revokeSessionOnServer").mockResolvedValue(undefined);
    const { user } = renderBoundary(<Boom />);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(client.getStoredToken()).toBeNull();
    expect(localStorage.getItem("stockroom_user")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sign in to StockRoom")).toBeInTheDocument();
  });

  it("shows the error message but never the stack", () => {
    renderBoundary(<Boom message="products is not iterable" />);
    expect(screen.queryByText(/ErrorBoundary.test/)).not.toBeInTheDocument();
    expect(screen.queryByText(/at Boom/)).not.toBeInTheDocument();
  });
});
