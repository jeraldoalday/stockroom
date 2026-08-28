import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmDialogProps } from "./ConfirmDialog";

function setup(overrides: Partial<ConfirmDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props: ConfirmDialogProps = {
    open: true,
    title: "Archive Acme Supplies?",
    description: "It will stop appearing in pickers. Existing orders keep it.",
    onConfirm,
    onCancel,
    ...overrides,
  };
  const utils = render(<ConfirmDialog {...props} />);
  return { ...utils, onConfirm, onCancel, props, user: userEvent.setup() };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = setup({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("names the record and says what will happen", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Archive Acme Supplies?");
    expect(dialog).toHaveAccessibleDescription(
      "It will stop appearing in pickers. Existing orders keep it."
    );
  });

  it("defaults its buttons to Confirm and Cancel", () => {
    setup();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("uses the caller's labels when given", () => {
    setup({ confirmLabel: "Archive", cancelLabel: "Keep it" });
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeInTheDocument();
  });

  it("moves focus to the confirm button on open", () => {
    // Without this a keyboard user is left focused on the row button behind
    // a modal they can't see the boundaries of.
    setup({ confirmLabel: "Archive" });
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
  });

  it("returns focus to whatever opened it on close", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Archive supplier
          </button>
          <ConfirmDialog
            open={open}
            title="Archive?"
            description="Sure?"
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Archive supplier" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(opener).toHaveFocus();
  });

  it("confirms and cancels through the buttons", async () => {
    const { user, onConfirm, onCancel } = setup();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape", async () => {
    const { user, onCancel } = setup();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on a backdrop click", async () => {
    const { user, onCancel, container } = setup();
    const backdrop = container.querySelector('[aria-hidden="true"]');
    await user.click(backdrop as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and the backdrop while the request is in flight", async () => {
    // Dismissing mid-mutation hides the spinner and, worse, the server
    // error that is about to arrive — "Cannot delete a location that has
    // inventory records" would vanish before anyone read it.
    const { user, onCancel, container } = setup({ busy: true });
    await user.keyboard("{Escape}");
    await user.click(container.querySelector('[aria-hidden="true"]') as Element);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disables both buttons and says so while busy", () => {
    setup({ busy: true, confirmLabel: "Archive" });
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("keeps Tab inside the dialog", async () => {
    // `aria-modal` tells a screen reader the rest of the page is inert; it
    // does nothing at all about the Tab key. Without a trap the next Tab
    // lands on the very row button the dialog is asking about.
    render(
      <>
        <button type="button">Behind the dialog</button>
        <ConfirmDialog open title="Archive?" description="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>
    );
    const user = userEvent.setup();
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    expect(screen.getByRole("button", { name: "Behind the dialog" })).not.toHaveFocus();
  });

  it("wraps backwards too", async () => {
    render(<ConfirmDialog open title="Archive?" description="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("keeps focus inside the dialog while the request is in flight", async () => {
    // Both buttons are disabled mid-request, so there is nothing in the
    // dialog to tab to. Going nowhere beats landing behind it.
    render(
      <>
        <button type="button">Behind the dialog</button>
        <ConfirmDialog open busy title="Archive?" description="Sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>
    );
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Behind the dialog" })).not.toHaveFocus();
  });

  it("does not hand focus back to the page when the request starts", async () => {
    // The bug: `busy` was a dependency of the focus effect, so clicking
    // Confirm re-ran it. The cleanup fired `previouslyFocused.focus()` and
    // dropped the user on the row button behind a modal that was still
    // open, mid-request — and the re-run couldn't take focus back, because
    // by then the confirm button was disabled.
    function Host() {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Archive supplier
          </button>
          <ConfirmDialog
            open={open}
            busy={busy}
            title="Archive?"
            description="Sure?"
            onConfirm={() => setBusy(true)}
            onCancel={vi.fn()}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole("button", { name: "Archive supplier" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByRole("button", { name: "Working..." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive supplier" })).not.toHaveFocus();
  });

  it("styles a danger confirm differently from a neutral one", () => {
    const { unmount } = setup({ tone: "danger", confirmLabel: "Delete" });
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("bg-red-600");
    unmount();

    setup({ tone: "default", confirmLabel: "Restore" });
    expect(screen.getByRole("button", { name: "Restore" }).className).toContain("bg-brand-600");
  });
});
