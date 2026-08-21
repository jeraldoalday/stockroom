import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { fetchTeamMembers, inviteTeamMember, removeTeamMember, updateTeamMemberRole } from "../api/users";
import { isApiError } from "../api/errors";
import { ConfirmDialog, useConfirmation } from "../components/ConfirmDialog";
import type { TeamMember } from "../api/types";
import type { UserRole } from "../api/types";

export function TeamPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const membersQuery = useQuery({ queryKey: ["team"], queryFn: fetchTeamMembers });

  const inviteMutation = useMutation({
    mutationFn: inviteTeamMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      setShowForm(false);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not invite team member" : "Could not invite team member");
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => updateTeamMemberRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not change role" : "Could not change role");
    },
  });

  const pendingRemove = useConfirmation<TeamMember>();

  const removeMutation = useMutation({
    mutationFn: removeTeamMember,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not remove team member" : "Could not remove team member");
    },
  });

  function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    inviteMutation.mutate({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      role: (form.get("role") as UserRole) || "STAFF",
    });
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Invite team member"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input name="email" type="email" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Temporary password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select name="role" defaultValue="STAFF" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="STAFF">Staff</option>
              <option value="OWNER">Owner</option>
            </select>
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {inviteMutation.isPending ? "Saving..." : "Send invite"}
            </button>
          </div>
        </form>
      )}

      {rowError && <div className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {membersQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {membersQuery.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-red-600">Failed to load team members.</td>
              </tr>
            )}
            {membersQuery.data?.items.map((member) => {
              const isSelf = member.id === user?.id;
              return (
                <tr key={member.id}>
                  <td className="px-4 py-2">
                    {member.name}
                    {isSelf && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{member.email}</td>
                  <td className="px-4 py-2">{member.role === "OWNER" ? "Owner" : "Staff"}</td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() =>
                        roleMutation.mutate({ id: member.id, role: member.role === "OWNER" ? "STAFF" : "OWNER" })
                      }
                      className="text-xs text-brand-600 hover:underline"
                    >
                      {member.role === "OWNER" ? "Make Staff" : "Make Owner"}
                    </button>
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => {
                          setRowError(null);
                          pendingRemove.request(member);
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingRemove.isOpen}
        title="Remove this team member?"
        description={
          <>
            <strong>{pendingRemove.target?.name}</strong> ({pendingRemove.target?.email}) will lose
            access immediately. Members who have recorded stock movements can't be removed, so the
            audit trail stays intact.
          </>
        }
        confirmLabel="Remove member"
        busy={removeMutation.isPending}
        onCancel={pendingRemove.cancel}
        onConfirm={() => pendingRemove.confirm((member) => removeMutation.mutate(member.id))}
      />
    </AppShell>
  );
}
