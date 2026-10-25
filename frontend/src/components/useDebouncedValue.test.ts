import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_DEBOUNCE_MS, useDebouncedValue } from "./useDebouncedValue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useDebouncedValue", () => {
  it("returns the initial value straight away", () => {
    const { result } = renderHook(() => useDebouncedValue("widget"));
    expect(result.current).toBe("widget");
  });

  it("holds the old value until the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });

    rerender({ v: "w" });
    expect(result.current).toBe("");

    advance(DEFAULT_DEBOUNCE_MS - 1);
    expect(result.current).toBe("");

    advance(1);
    expect(result.current).toBe("w");
  });

  it("emits once for a word typed a character at a time", () => {
    // The bug this exists for: nine keystrokes used to be nine searches.
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "" },
    });

    for (const v of ["N", "No", "Nor", "Nort", "North"]) {
      rerender({ v });
      advance(50);
    }
    expect(result.current).toBe("");

    advance(DEFAULT_DEBOUNCE_MS);
    expect(result.current).toBe("North");
  });

  it("honours a caller's delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 1000), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });

    advance(DEFAULT_DEBOUNCE_MS);
    expect(result.current).toBe("a");

    advance(700);
    expect(result.current).toBe("b");
  });

  it("settles back without firing when the value returns to where it started", () => {
    // Type a character and delete it inside the window: nothing changed, so
    // nothing should refetch.
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "widget" },
    });
    rerender({ v: "widgets" });
    advance(100);
    rerender({ v: "widget" });

    advance(DEFAULT_DEBOUNCE_MS * 2);
    expect(result.current).toBe("widget");
  });

  it("settles immediately when the box is cleared", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "North" },
    });

    rerender({ v: "" });
    expect(result.current).toBe("");
  });

  it("works for values other than strings", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    advance(DEFAULT_DEBOUNCE_MS);
    expect(result.current).toBe(2);
  });

  it("cancels its pending timer on unmount", () => {
    // A timer firing into an unmounted tree is a React state-update warning
    // and, on a page the user has already navigated away from, a wasted
    // request.
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
