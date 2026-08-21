import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { isApiError } from "../api/errors";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const resetSuccess = Boolean((location.state as { resetSuccess?: boolean } | null)?.resetSuccess);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const auth = await login({ email, password });
      setSession(auth);
      navigate("/");
    } catch (err) {
      setError(isApiError(err) ? err.response?.data?.error ?? "Login failed" : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-8 rounded-lg shadow">
        <h1 className="text-xl font-semibold text-brand-700 mb-6">Sign in to StockRoom</h1>

        {resetSuccess && (
          <div className="mb-4 text-sm text-green-700">
            Your password has been reset. Sign in with your new password.
          </div>
        )}
        {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

        <label className="block text-sm font-medium text-gray-700">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="block text-sm font-medium text-gray-700">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <p className="mb-4 text-right text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link>
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <p className="mt-4 text-sm text-gray-600">
          No account? <Link to="/signup" className="text-brand-600 hover:underline">Create one</Link>
        </p>
      </form>
    </div>
  );
}
