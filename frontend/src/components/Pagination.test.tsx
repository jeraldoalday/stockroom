import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Pagination } from "./Pagination";
import { renderApp } from "../test/render";

describe("Pagination", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = renderApp(
      <Pagination page={1} pageSize={25} total={4} onPageChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the total exactly fills one page", () => {
    // The boundary the `Math.ceil` is there for: 25 of 25 is one page, and
    // an off-by-one would show a "Page 1 of 1" control with both buttons
    // disabled.
    const { container } = renderApp(
      <Pagination page={1} pageSize={25} total={25} onPageChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises the visible range using the caller's noun", () => {
    renderApp(<Pagination page={1} pageSize={25} total={312} onPageChange={vi.fn()} label="movements" />);
    expect(screen.getByText("1–25 of 312 movements")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 13")).toBeInTheDocument();
  });

  it("defaults the noun to 'results'", () => {
    renderApp(<Pagination page={1} pageSize={10} total={30} onPageChange={vi.fn()} />);
    expect(screen.getByText("1–10 of 30 results")).toBeInTheDocument();
  });

  it("clamps the last item of a short final page to the total", () => {
    // Page 3 of 3 with pageSize 25 and 60 rows shows 51–60, not 51–75.
    renderApp(<Pagination page={3} pageSize={25} total={60} onPageChange={vi.fn()} />);
    expect(screen.getByText("51–60 of 60 results")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", async () => {
    const onPageChange = vi.fn();
    const { rerender } = renderApp(
      <Pagination page={1} pageSize={10} total={30} onPageChange={onPageChange} />
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    rerender(<Pagination page={3} pageSize={10} total={30} onPageChange={onPageChange} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("steps one page at a time in each direction", async () => {
    const onPageChange = vi.fn();
    const { user } = renderApp(
      <Pagination page={2} pageSize={10} total={30} onPageChange={onPageChange} />
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
