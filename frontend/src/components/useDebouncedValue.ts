import { useEffect, useState } from "react";

/** Long enough to swallow a typed word, short enough to feel immediate. */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Follows `value`, but only after it has stopped changing for `delayMs`.
 *
 * The search boxes on the list pages put their input straight into a
 * TanStack query key, which means one HTTP request per keystroke: typing
 * "Northside" fired nine searches, cached nine results nobody would ask for
 * again, and let a slow early response land after a later one. Keeping the
 * input controlled by the raw value and the *query* keyed on the debounced
 * one gives instant typing feedback and a single request.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return undefined;

    // Clearing the box should be immediate: the user is asking to see the
    // full list again, and making them wait for a timer to expire before
    // anything happens reads as the page having hung.
    if (!value) {
      setSettled(value);
      return undefined;
    }

    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
    // `settled` is deliberately not a dependency: it changes as a *result*
    // of this effect, and depending on it would schedule a second, pointless
    // timer on every settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs]);

  return settled;
}
