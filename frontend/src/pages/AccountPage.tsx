import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { changePassword } from "../api/auth";
import { isApiError } from "../api/errors";

export function AccountPage() {
  const { user } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setSuccess(true);
      setFormError(null);
    },
    onError: (err) => {
      setSuccess(false);
      setFormError(
        isApiError(err) ? err.response?.data?.error ?? "Could not change password" : "Could not change password"
      );
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccess(false);
    // Captured before the async mutate: React clears `currentTarget` once
    // the handler returns, so the success callback can't read it.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword"));
    const confirmPassword = String(form.get("confirmPassword"));
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation do not match");
      return;
    }
    changePasswordMutation.mutate(
      { currentPassword: String(form.get("currentPassword")), newPassword },
      { onSuccess: () => formEl.reset() }
    );
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Account</h1>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="font-medium text-gray-900">{user?.name}</div>
        <div className="text-gray-500">{user?.email}</div>
        <div className="text-gray-500">{user?.role === "OWNER" ? "Owner" : "Staff"}</div>
      </div>

      <h2 className="mb-3 text-lg font-medium text-gray-900">Change password</h2>
      <form
        onSubmit={handleSubmit}
        className="grid max-w-md grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-4"
      >
        {formError && <div className="text-sm text-red-600">{formError}</div>}
        {success && <div className="text-sm text-green-700">Password updated.</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700">Current password</label>
          <input
            name="currentPassword"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">New password</label>
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Confirm new password</label>
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={changePasswordMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {changePasswordMutation.isPending ? "Saving..." : "Update password"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
