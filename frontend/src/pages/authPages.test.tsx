import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { SignupPage } from "./SignupPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { getStoredRefreshToken, getStoredToken } from "../api/client";
import { MockApi, fail, ok } from "../test/mockApi";
import { renderApp } from "../test/render";

const authBody = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  user: { id: "u1", name: "Dana Owner", email: "owner@northside.test", role: "OWNER", lowStockDigestOptOut: false },
};

let api: MockApi;

beforeEach(() => {
  api = new MockApi();
});

afterEach(() => {
  api.restore();
});

/** The auth page under test, plus the real pages it navigates to. */
function withDestinations(element: JSX.Element) {
  return (
    <Routes>
      <Route path="/" element={element} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard-stub" element={<p>Dashboard</p>} />
    </Routes>
  );
}

describe("LoginPage", () => {
  it("labels every field so it can be reached by name", () => {
    // Until Day 23 the app had 52 <label> tags and one htmlFor between
    // them: clicking a label focused nothing and a screen reader announced
    // "edit text, blank". These queries fail if that regresses.
    renderApp(<LoginPage />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("signs in and stores the session", async () => {
    api.on("POST", "/auth/login", ok(authBody));
    const { user } = renderApp(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.type(screen.getByLabelText("Password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(getStoredToken()).toBe("access-1"));
    expect(getStoredRefreshToken()).toBe("refresh-1");
    expect(api.requestsFor("POST", "/auth/login")[0].data).toBe(
      JSON.stringify({ email: "owner@northside.test", password: "stockroom123" })
    );
  });

  it("shows the server's message when the credentials are wrong", async () => {
    api.on("POST", "/auth/login", fail(401, "Invalid email or password"));
    const { user } = renderApp(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(getStoredToken()).toBeNull();
  });

  it("re-enables the button after a failure so the user can try again", async () => {
    // `submitting` is cleared in a `finally`; leaving it set on the error
    // path would strand the user on a form they cannot resubmit.
    api.on("POST", "/auth/login", fail(401, "Invalid email or password"));
    const { user } = renderApp(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Invalid email or password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("falls back to a generic message when the server sends no body", async () => {
    api.on("POST", "/auth/login", { status: 500 });
    const { user } = renderApp(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.type(screen.getByLabelText("Password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Login failed")).toBeInTheDocument();
  });

  it("shows no reset banner on a plain visit", () => {
    renderApp(<LoginPage />, { route: "/" });
    expect(screen.queryByText(/password has been reset/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your password is set/i)).not.toBeInTheDocument();
  });

  it("offers a way to recover a forgotten password and to sign up", () => {
    renderApp(<LoginPage />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password"
    );
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/signup");
  });
});

describe("SignupPage", () => {
  it("labels every field", () => {
    renderApp(<SignupPage />);
    for (const label of ["Business name", "Your name", "Email", "Password"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("creates the organisation and signs the owner straight in", async () => {
    api.on("POST", "/auth/signup", ok(authBody));
    const { user } = renderApp(withDestinations(<SignupPage />));

    await user.type(screen.getByLabelText("Business name"), "Northside Grocery");
    await user.type(screen.getByLabelText("Your name"), "Dana Owner");
    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.type(screen.getByLabelText("Password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(getStoredToken()).toBe("access-1"));
    expect(JSON.parse(api.requestsFor("POST", "/auth/signup")[0].data)).toEqual({
      organizationName: "Northside Grocery",
      name: "Dana Owner",
      email: "owner@northside.test",
      password: "stockroom123",
    });
  });

  it("surfaces a duplicate-email rejection", async () => {
    api.on("POST", "/auth/signup", fail(409, "An account with that email already exists"));
    const { user } = renderApp(<SignupPage />);

    await user.type(screen.getByLabelText("Business name"), "Northside Grocery");
    await user.type(screen.getByLabelText("Your name"), "Dana Owner");
    await user.type(screen.getByLabelText("Email"), "taken@northside.test");
    await user.type(screen.getByLabelText("Password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("An account with that email already exists")).toBeInTheDocument();
  });

  it("asks the browser to enforce the API's 8-character minimum", () => {
    renderApp(<SignupPage />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("minLength", "8");
  });
});

describe("ForgotPasswordPage", () => {
  it("gives the same answer whether or not the email exists", async () => {
    // The API deliberately never reveals whether an address is registered.
    // A UI that showed "no such account" would hand that back.
    api.on("POST", "/auth/forgot-password", fail(404, "No such user"));
    const { user } = renderApp(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Email"), "nobody@northside.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(/If an account exists for that email/i)).toBeInTheDocument();
    expect(screen.queryByText(/No such user/)).not.toBeInTheDocument();
  });

  it("shows the same confirmation on success", async () => {
    api.on("POST", "/auth/forgot-password", ok({}));
    const { user } = renderApp(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText("Email"), "owner@northside.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText(/If an account exists for that email/i)).toBeInTheDocument();
    // The form is replaced, so there is nothing left to submit twice.
    expect(screen.queryByRole("button", { name: "Send reset link" })).not.toBeInTheDocument();
  });
});

describe("ResetPasswordPage", () => {
  it("refuses to show the form without a token", () => {
    renderApp(<ResetPasswordPage />, { route: "/reset-password" });
    expect(screen.getByText(/reset link is missing its token/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("wording for a missing token differs for an invite", () => {
    // An invitee has never had a password, so "request a new one from the
    // forgot password page" is advice they cannot act on.
    renderApp(<ResetPasswordPage />, { route: "/reset-password?type=invite" });
    expect(screen.getByText(/invite link is missing its token/i)).toBeInTheDocument();
  });

  it("rejects mismatched passwords before calling the API", async () => {
    const { user } = renderApp(<ResetPasswordPage />, { route: "/reset-password?token=t1" });

    await user.type(screen.getByLabelText("New password"), "stockroom123");
    await user.type(screen.getByLabelText("Confirm new password"), "stockroom124");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(api.requests).toHaveLength(0);
  });

  it("sends the token from the query string", async () => {
    api.on("POST", "/auth/reset-password", ok({}));
    const { user } = renderApp(withDestinations(<ResetPasswordPage />), {
      route: "/?token=reset-token-1",
    });

    await user.type(screen.getByLabelText("New password"), "stockroom123");
    await user.type(screen.getByLabelText("Confirm new password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(api.requestsFor("POST", "/auth/reset-password")).toHaveLength(1));
    expect(JSON.parse(api.requestsFor("POST", "/auth/reset-password")[0].data)).toEqual({
      token: "reset-token-1",
      newPassword: "stockroom123",
    });
    // Lands on /login carrying the flag that renders the confirmation, so
    // the user isn't left wondering whether the reset took.
    expect(await screen.findByText(/Your password has been reset/i)).toBeInTheDocument();
  });

  it("tells an invitee their password is set, not reset", async () => {
    api.on("POST", "/auth/reset-password", ok({}));
    const { user } = renderApp(withDestinations(<ResetPasswordPage />), {
      route: "/?token=invite-token-1&type=invite",
    });

    await user.type(screen.getByLabelText("New password"), "stockroom123");
    await user.type(screen.getByLabelText("Confirm new password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText(/Your password is set/i)).toBeInTheDocument();
  });

  it("labels the invite flow as setting a password rather than resetting one", () => {
    renderApp(<ResetPasswordPage />, { route: "/reset-password?token=t1&type=invite" });
    expect(screen.getByRole("heading", { name: /set your password/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set password" })).toBeInTheDocument();
  });

  it("shows a rejected token's message from the server", async () => {
    api.on("POST", "/auth/reset-password", fail(400, "This reset link has expired"));
    const { user } = renderApp(<ResetPasswordPage />, { route: "/reset-password?token=expired" });

    await user.type(screen.getByLabelText("New password"), "stockroom123");
    await user.type(screen.getByLabelText("Confirm new password"), "stockroom123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("This reset link has expired")).toBeInTheDocument();
  });
});

describe("form labelling across the auth pages", () => {
  it("leaves no control without an accessible name", () => {
    // A blunt net for the whole class of bug: every input, select and
    // textarea on these pages must be reachable by its visible label.
    for (const [name, element] of [
      ["LoginPage", <LoginPage key="l" />],
      ["SignupPage", <SignupPage key="s" />],
      ["ForgotPasswordPage", <ForgotPasswordPage key="f" />],
    ] as const) {
      const { container, unmount } = renderApp(element);
      const controls = container.querySelectorAll("input, select, textarea");
      expect(controls.length, `${name} rendered no controls`).toBeGreaterThan(0);
      for (const control of controls) {
        const id = control.getAttribute("id");
        expect(id, `${name}: a control has no id to label`).toBeTruthy();
        expect(
          container.querySelector(`label[for="${CSS.escape(id as string)}"]`),
          `${name}: no label points at #${id}`
        ).not.toBeNull();
      }
      unmount();
    }
  });
});
