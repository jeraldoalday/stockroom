// Field-level RBAC (PRD §4: "Staff/Clerk ... No access to cost/margin data
// by default"). Rather than scrubbing cost fields in each route individually
// — the approach every prior PROGRESS.md entry flagged as inconsistent and
// easy to half-apply — every JSON response for a STAFF principal is
// recursively stripped of these keys in one place (see requireAuth).
export const COST_FIELD_KEYS = new Set(["costCents", "unitCostCents", "totalStockValueCents"]);

export function redactCostFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactCostFields(item)) as unknown as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (COST_FIELD_KEYS.has(key)) continue;
      out[key] = redactCostFields(entry);
    }
    return out as T;
  }
  return value;
}
