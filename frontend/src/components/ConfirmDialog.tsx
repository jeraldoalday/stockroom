import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Tabbable descendants, in document order. `[...]` on the NodeList keeps
 * that order, which is what makes "first" and "last" meaningful.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body copy. Say what will happen, not just "are you sure?". */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for anything that destroys or hides data. */
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation for destructive actions.
 *
 * Deliberately not `window.confirm`: it blocks the whole renderer, can't
 * show the record's name in the app's own voice, and — the practical
 * problem here — it can't stay open while the mutation is in flight, so
 * there's nowhere to put the "Deleting..." state or a server-side error
 * like "Cannot delete a location that has inventory records".
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus moves into the dialog on open and back to whatever opened it on
  // close — otherwise a keyboard user is dropped at the top of the document
  // after every confirmation and has to tab through the whole table again.
  //
  // Keyed on `open` alone, deliberately. With `busy` in here too, clicking
  // Confirm re-ran the effect: the cleanup fired `previouslyFocused.focus()`
  // and sent focus back to the row button *behind the still-open modal*,
  // then the re-run failed to take it back because the confirm button was by
  // then disabled. The user was left tabbing around the page underneath an
  // open dialog.
  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    return () => previouslyFocused.current?.focus();
  }, [open]);

  // Escape cancels, and Tab is confined to the dialog. `aria-modal` tells a
  // screen reader the rest of the page is inert but does nothing about the
  // Tab key, so without this a keyboard user tabs straight out of the
  // dialog and onto the controls it is asking them to confirm.
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        // Everything is disabled mid-request. There is nowhere to go, so
        // going nowhere beats landing behind the dialog.
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.contains(active);

      if (event.shiftKey ? active === first || outside : active === last || outside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClasses =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 focus:ring-red-500"
      : "bg-brand-600 hover:bg-brand-700 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Clicking the backdrop cancels, but never while a request is in
          flight — that would hide the spinner and any error it produces. */}
      <div
        className="absolute inset-0 bg-gray-900/40"
        onClick={() => !busy && onCancel()}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        <div id="confirm-dialog-description" className="mt-2 text-sm text-gray-600">
          {description}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${confirmClasses}`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
