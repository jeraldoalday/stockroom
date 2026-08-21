import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../api/auth";
import { isApiError } from "../api/errors";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, newPassword);
      navigate("/login", { state: { resetSuccess: true } });
    } catch (err) {
      setError(isApiError(err) ? err.response?.data?.error ?? "Could not reset password" : "Could not reset password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white p-8 rounded-lg shadow">
        <h1 className="text-xl font-semibold text-brand-700 mb-6">Choose a new password</h1>

        {!token ? (
          <p className="text-sm text-red-600">
            This reset link is missing its token. Request a new one from the{" "}
            <Link to="/forgot-password" className="text-brand-600 hover:underline">forgot password</Link> page.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

            <label className="block text-sm font-medium text-gray-700">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />

            <label className="block text-sm font-medium text-gray-700">Confirm new password</label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 mb-6 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "Resetting..." : "Reset password"}
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
