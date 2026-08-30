import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../api/auth";

export function ForgotPasswordPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
    } catch {
      // Swallowed, not just unhandled. A `finally` alone rendered the right
      // thing but let the rejection escape the handler, so every failed
      // request logged an uncaught AxiosError to the console — and any
      // `unhandledrejection` listener would report a bug that isn't one.
    }
    // Always the same confirmation, success or failure: the API itself
    // never reveals whether the email matched an account, so neither can
    // the UI. That is the whole point of the screen.
    setSubmitting(false);
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-lg shadow">
        <h1 className="text-xl font-semibold text-brand-700 mb-6">Reset your password</h1>

        {submitted ? (
          <p role="status" className="text-sm text-gray-700">
            If an account exists for that email, we've sent instructions to reset your password.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor={`${fieldId}-email`} className="block text-sm font-medium text-gray-700">Email</label>
            <input
              id={`${fieldId}-email`}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 mb-6 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-4 text-sm text-gray-600">
          <Link to="/login" className="text-brand-600 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
