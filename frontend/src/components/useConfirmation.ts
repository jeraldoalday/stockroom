import { useCallback, useState } from "react";

/**
 * Tracks which record a confirmation is currently about.
 *
 * Every list page here has the same shape: a row-level destructive button
 * that needs to remember *which* row was clicked while the dialog is open,
 * so the copy can name it ("Delete Acme Supplies?") rather than asking a
 * generic question the user can't verify.
 */
export function useConfirmation<T>() {
  const [target, setTarget] = useState<T | null>(null);

  const cancel = useCallback(() => setTarget(null), []);

  return {
    /** The record awaiting confirmation, or null when the dialog is closed. */
    target,
    isOpen: target !== null,
    request: setTarget,
    cancel,
    /** Runs `action` against the pending target, then closes the dialog. */
    confirm: useCallback(
      (action: (target: T) => void) => {
        if (target === null) return;
        action(target);
        setTarget(null);
      },
      [target]
    ),
  };
}
