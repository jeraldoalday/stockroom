import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import {
  archiveCategory,
  createCategory,
  fetchCategories,
  renameCategory,
  restoreCategory,
} from "../api/categories";
import type { CategoryStatusFilter } from "../api/categories";
import { isApiError } from "../api/errors";
import { emptyListMessage } from "../components/emptyListMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import type { Category } from "../api/types";

const STATUS_TABS: { value: CategoryStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function describeError(err: unknown, fallback: string): string {
  return isApiError(err) ? err.response?.data?.error ?? fallback : fallback;
}

export function CategoriesPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CategoryStatusFilter>("active");
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const categoriesQuery = useQuery({
    queryKey: ["categories", status],
    queryFn: () => fetchCategories(status),
    placeholderData: (previous) => previous,
  });
  const pendingArchive = useConfirmation<Category>();

  const createMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setShowForm(false);
    },
    onError: (err) => setFormError(describeError(err, "Could not create category")),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameCategory(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setEditingId(null);
    },
    onError: (err) => setRowError(describeError(err, "Could not rename category")),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
    onError: (err) => setRowError(describeError(err, "Could not archive category")),
  });

  const restoreMutation = useMutation({
    mutationFn: restoreCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
    onError: (err) => setRowError(describeError(err, "Could not restore category")),
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") || "").trim();
    if (!name) return;
    createMutation.mutate(name);
  }

  function startEditing(category: Category) {
    setRowError(null);
    setEditingId(category.id);
    setEditingName(category.name);
  }

  function submitRename(id: string) {
    const name = editingName.trim();
    if (!name) return;
    renameMutation.mutate({ id, name });
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Categories</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Add category"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 flex items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div role="alert" className="w-full text-sm text-red-600">{formError}</div>}
          <div className="flex-1">
            <label htmlFor={`${fieldId}-name`} className="block text-sm font-medium text-gray-700">Name</label>
            <input id={`${fieldId}-name`} name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Saving..." : "Save category"}
          </button>
        </form>
      )}

      <div className="mb-4 flex w-fit gap-1 rounded-md border border-gray-200 bg-white p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setRowError(null);
              setEditingId(null);
              setStatus(tab.value);
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === tab.value ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {rowError && <div role="alert" className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categoriesQuery.isLoading && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {categoriesQuery.isError && (
              <tr>
                <td colSpan={2} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load categories.</td>
              </tr>
            )}
            {categoriesQuery.data?.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                  {emptyListMessage({ noun: "categories", status })}
                </td>
              </tr>
            )}
            {categoriesQuery.data?.map((category) => (
              <tr key={category.id} className={category.isActive ? undefined : "bg-gray-50 text-gray-500"}>
                <td className="px-4 py-2">
                  {editingId === category.id ? (
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                      className="w-full max-w-xs rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  ) : (
                    <>
                      {category.name}
                      {!category.isActive && (
                        <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Archived
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2 text-right space-x-3">
                  {editingId === category.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => submitRename(category.id)}
                        disabled={renameMutation.isPending}
                        className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {category.isActive && (
                        <button
                          type="button"
                          onClick={() => startEditing(category)}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          Rename
                        </button>
                      )}
                      {category.isActive ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRowError(null);
                            pendingArchive.request(category);
                          }}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRowError(null);
                            restoreMutation.mutate(category.id);
                          }}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Restore
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingArchive.isOpen}
        title="Archive this category?"
        description={
          <>
            <strong>{pendingArchive.target?.name}</strong> will be hidden from the product form's
            category picker. Products already filed under it keep their category, and you can
            restore it from the Archived tab at any time.
          </>
        }
        confirmLabel="Archive category"
        busy={archiveMutation.isPending}
        onCancel={pendingArchive.cancel}
        onConfirm={() => pendingArchive.confirm((category) => archiveMutation.mutate(category.id))}
      />
    </AppShell>
  );
}
