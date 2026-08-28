import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useConfirmation } from "./useConfirmation";

interface Supplier {
  id: string;
  name: string;
}

const acme: Supplier = { id: "s1", name: "Acme Supplies" };
const bolt: Supplier = { id: "s2", name: "Bolt & Co" };

describe("useConfirmation", () => {
  it("starts closed with no target", () => {
    const { result } = renderHook(() => useConfirmation<Supplier>());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.target).toBeNull();
  });

  it("remembers which row was clicked", () => {
    // The whole point: the dialog copy names the record ("Archive Acme
    // Supplies?") rather than asking a question the user can't verify.
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.request(acme));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.target).toEqual(acme);
  });

  it("replaces the target when a second row is clicked", () => {
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.request(acme));
    act(() => result.current.request(bolt));
    expect(result.current.target).toEqual(bolt);
  });

  it("closes on cancel without running anything", () => {
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.request(acme));
    act(() => result.current.cancel());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.target).toBeNull();
  });

  it("runs the action against the pending target and closes", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.request(acme));
    act(() => result.current.confirm(action));

    expect(action).toHaveBeenCalledWith(acme);
    expect(result.current.isOpen).toBe(false);
  });

  it("does nothing when confirmed with no target", () => {
    // Reachable by a double-click on the confirm button: the first closes
    // the dialog, the second lands before React has removed it.
    const action = vi.fn();
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.confirm(action));
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps a stable cancel across renders", () => {
    // ConfirmDialog lists `onCancel` in the dependencies of the effect that
    // binds its Escape handler; an identity that changed every render would
    // tear that listener down and rebuild it on every keystroke elsewhere
    // on the page.
    const { result, rerender } = renderHook(() => useConfirmation<Supplier>());
    const first = result.current.cancel;
    rerender();
    expect(result.current.cancel).toBe(first);
  });

  it("gives confirm a fresh target after the pending row changes", () => {
    const action = vi.fn();
    const { result } = renderHook(() => useConfirmation<Supplier>());
    act(() => result.current.request(acme));
    act(() => result.current.request(bolt));
    act(() => result.current.confirm(action));
    expect(action).toHaveBeenCalledWith(bolt);
  });

  it("supports a plain id as the target type", () => {
    const { result } = renderHook(() => useConfirmation<string>());
    act(() => result.current.request("po-17"));
    expect(result.current.target).toBe("po-17");
    expect(result.current.isOpen).toBe(true);
  });
});
