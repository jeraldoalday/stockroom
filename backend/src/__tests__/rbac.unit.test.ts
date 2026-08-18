import { redactCostFields } from "../lib/rbac";

describe("redactCostFields", () => {
  it("strips cost keys at any nesting depth without touching other fields", () => {
    const input = {
      totalStockValueCents: 5000,
      activeProductCount: 2,
      recentMovements: [
        {
          id: "mov_1",
          quantity: 3,
          product: { id: "p1", sku: "SKU-1", costCents: 400, priceCents: 999 },
        },
      ],
      lines: [{ id: "l1", unitCostCents: 250, quantityOrdered: 5 }],
    };

    const result = redactCostFields(input);

    expect(result).toEqual({
      activeProductCount: 2,
      recentMovements: [{ id: "mov_1", quantity: 3, product: { id: "p1", sku: "SKU-1", priceCents: 999 } }],
      lines: [{ id: "l1", quantityOrdered: 5 }],
    });
  });

  it("leaves Date instances and primitives untouched", () => {
    const now = new Date();
    expect(redactCostFields(now)).toBe(now);
    expect(redactCostFields(42)).toBe(42);
    expect(redactCostFields(null)).toBe(null);
    expect(redactCostFields("costCents")).toBe("costCents");
  });
});
