import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { isApiError } from "../api/errors";

export function SignupPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const auth = await signup({ organizationName, name, email, password });
      setSession(auth);
      navigate("/");
    } catch (err) {
      setError(isApiError(err) ? err.response?.data?.error ?? "Signup failed" : "Signup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white p-8 rounded-lg shadow">
        <h1 className="text-xl font-semibold text-brand-700 mb-6">Create your StockRoom account</h1>

        {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

        <label htmlFor={`${fieldId}-businessName`} className="block text-sm font-medium text-gray-700">Business name</label>
        <input
          id={`${fieldId}-businessName`}
          required
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          className="mt-1 mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <label htmlFor={`${fieldId}-yourName`} className="block text-sm font-medium text-gray-700">Your name</label>
        <input
          id={`${fieldId}-yourName`}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <label htmlFor={`${fieldId}-email`} className="block text-sm font-medium text-gray-700">Email</label>
        <input
          id={`${fieldId}-email`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <label htmlFor={`${fieldId}-password`} className="block text-sm font-medium text-gray-700">Password</label>
        <input
          id={`${fieldId}-password`}
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 mb-6 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>

        <p className="mt-4 text-sm text-gray-600">
          Already have an account? <Link to="/login" className="text-brand-600 hover:underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
