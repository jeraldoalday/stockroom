import { describe, expect, it } from "vitest";
import { movementReason } from "./movementReason";

describe("movementReason", () => {
  it("passes a hand-typed reason straight through", () => {
    expect(movementReason({ reason: "Damaged in transit", stocktakeId: null })).toEqual({
      badge: null,
      text: "Damaged in transit",
    });
  });

  it("has nothing to show for a movement with no reason", () => {
    expect(movementReason({ reason: null, stocktakeId: null })).toEqual({ badge: null, text: null });
  });

  it("replaces the generated stocktake reason with a badge", () => {
    expect(movementReason({ reason: "Stocktake ckabc123", stocktakeId: "ckabc123" })).toEqual({
      badge: "Stock count",
      text: null,
    });
  });

  it("keeps a reason somebody wrote on a stocktake adjustment", () => {
    expect(movementReason({ reason: "Recount after flood", stocktakeId: "ckabc123" })).toEqual({
      badge: "Stock count",
      text: "Recount after flood",
    });
  });

  it("badges a stocktake movement even with no reason at all", () => {
    expect(movementReason({ reason: null, stocktakeId: "ckabc123" })).toEqual({
      badge: "Stock count",
      text: null,
    });
  });
});
