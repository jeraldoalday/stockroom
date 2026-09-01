import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import { useAuth } from "../context/AuthContext";
import { changePassword, endSession, fetchSessions, setLowStockDigestOptOut } from "../api/auth";
import type { Session } from "../api/auth";
import { isApiError } from "../api/errors";

// Long enough to read the confirmation, short enough that nobody starts
// clicking around a session the server has already ended.
const SIGN_OUT_DELAY_MS = 2500;

function describeError(err: unknown, fallback: string): string {
  return isApiError(err) ? err.response?.data?.error ?? fallback : fallback;
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// A raw User-Agent string is long and not what anyone actually wants to
// read ("Mozilla/5.0 (Macintosh; ...) AppleWebKit/537.36 ..."); this reduces
// it to the two facts a person scanning their own session list cares about.
// Heuristic and not exhaustive — good enough for "which one is my phone",
// not a fingerprinting library this app has no other use for.
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";

  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;

  return os ? `${browser} on ${os}` : browser;
}

export function AccountPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  // Changing a password revokes every session for the user, this one
  // included — that is the point of it, since a password is usually changed
  // to lock someone else out. So the page can't carry on as if nothing
  // happened: the access token keeps working for up to its 15-minute life
  // and then every request starts failing with no explanation. Signing out
  // deliberately, with a message, beats decaying into a broken session.
  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => {
      logout();
      navigate("/login", { replace: true });
    }, SIGN_OUT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [success, logout, navigate]);

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setSuccess(true);
      setFormError(null);
    },
    onError: (err) => {
      setSuccess(false);
      setFormError(describeError(err, "Could not change password"));
    },
  });

  const digestMutation = useMutation({
    mutationFn: setLowStockDigestOptOut,
    onSuccess: (updatedUser) => {
      setDigestError(null);
      updateUser(updatedUser);
    },
    onError: (err) => setDigestError(describeError(err, "Could not update this preference")),
  });

  const sessionsQuery = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions });
  const pendingEnd = useConfirmation<Session>();

  const endSessionMutation = useMutation({
    mutationFn: endSession,
    onSuccess: (_result, id) => {
      setSessionError(null);
      // Ending the session this browser is using leaves it holding a dead
      // refresh token: the access token keeps working until it expires and
      // then every request fails. That is signing out, so do it properly
      // rather than waiting for the app to break in fifteen minutes.
      if (sessionsQuery.data?.find((session) => session.id === id)?.current) {
        logout();
        navigate("/login", { replace: true });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => setSessionError(describeError(err, "Could not end that session")),
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
        {formError && <div role="alert" className="text-sm text-red-600">{formError}</div>}
        {success && (
          <div role="status" className="text-sm text-green-700">
            Password updated. This signed you out everywhere, including here — taking you to the
            sign-in page...
          </div>
        )}
        <div>
          <label htmlFor={`${fieldId}-currentPassword`} className="block text-sm font-medium text-gray-700">Current password</label>
          <input
            id={`${fieldId}-currentPassword`}
            name="currentPassword"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-newPassword`} className="block text-sm font-medium text-gray-700">New password</label>
          <input
            id={`${fieldId}-newPassword`}
            name="newPassword"
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-confirmPassword`} className="block text-sm font-medium text-gray-700">Confirm new password</label>
          <input
            id={`${fieldId}-confirmPassword`}
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

      {user?.role === "OWNER" && (
        <>
          <h2 className="mb-1 mt-8 text-lg font-medium text-gray-900">Email notifications</h2>
          <p className="mb-3 max-w-2xl text-sm text-gray-500">
            StockRoom emails every Owner once a day when a product is at or below its reorder
            point. See what that looks like on the{" "}
            <Link to="/dashboard" className="text-brand-600 hover:underline">
              Dashboard&apos;s low-stock panel
            </Link>
            .
          </p>
          <div className="max-w-md rounded-lg border border-gray-200 bg-white p-4">
            {digestError && (
              <div role="alert" className="mb-3 text-sm text-red-600">
                {digestError}
              </div>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!user.lowStockDigestOptOut}
                disabled={digestMutation.isPending}
                onChange={(e) => digestMutation.mutate(!e.target.checked)}
              />
              <span>
                <span className="font-medium text-gray-900">Daily low-stock digest</span>
                <br />
                <span className="text-gray-500">
                  Email me once a day when something needs reordering.
                </span>
              </span>
            </label>
          </div>
        </>
      )}

      <h2 className="mb-1 mt-8 text-lg font-medium text-gray-900">Signed-in devices</h2>
      <p className="mb-3 max-w-2xl text-sm text-gray-500">
        Every browser you have signed in from stays signed in for up to seven days. End a session
        to sign that device out immediately — useful if you have signed in somewhere you no longer
        have to hand.
      </p>

      {sessionError && <div role="alert" className="mb-3 text-sm text-red-600">{sessionError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {sessionsQuery.isLoading && <div className="p-4 text-sm text-gray-500">Loading sessions...</div>}
        {sessionsQuery.isError && (
          <div role="alert" className="p-4 text-sm text-red-600">Could not load your sessions.</div>
        )}
        {sessionsQuery.data && sessionsQuery.data.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No other sessions.</div>
        )}
        {sessionsQuery.data && sessionsQuery.data.length > 0 && (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2">Device</th>
                <th scope="col" className="px-4 py-2">Signed in</th>
                <th scope="col" className="px-4 py-2">Last active</th>
                <th scope="col" className="px-4 py-2">Expires</th>
                <th scope="col" className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessionsQuery.data.map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-2 text-gray-900">
                    {describeUserAgent(session.userAgent)}
                    {session.current && (
                      <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        This device
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{formatMoment(session.createdAt)}</td>
                  <td className="px-4 py-2 text-gray-500">{formatMoment(session.lastActiveAt)}</td>
                  <td className="px-4 py-2 text-gray-500">{formatMoment(session.expiresAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => pendingEnd.request(session)}
                      className="text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      {session.current ? "Sign out" : "End session"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={pendingEnd.isOpen}
        title={pendingEnd.target?.current ? "Sign out of this device?" : "End this session?"}
        description={
          pendingEnd.target?.current
            ? "You will be returned to the sign-in page."
            : `That device will be signed out immediately. It was last active on ${
                pendingEnd.target ? formatMoment(pendingEnd.target.lastActiveAt) : ""
              }.`
        }
        confirmLabel={pendingEnd.target?.current ? "Sign out" : "End session"}
        busy={endSessionMutation.isPending}
        onCancel={pendingEnd.cancel}
        onConfirm={() => pendingEnd.confirm((session) => endSessionMutation.mutate(session.id))}
      />
    </AppShell>
  );
}
