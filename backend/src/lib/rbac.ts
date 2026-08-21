import type { UserRole } from "@prisma/client";

// Response-shaping rules that apply to every authenticated JSON response,
// enforced in one place (see requireAuth) rather than route by route.
//
// Two separate concerns share the same mechanism:
//
//  1. `SECRET_FIELD_KEYS` — fields that must never leave the process for
//     *anyone*. These leak through Prisma relation includes: a route that
//     writes `include: { actor: true }` gets the whole User row, password
//     hash and all, without ever naming the field. Narrow `select`s on each
//     include are the primary fix, but this is the backstop that makes a
//     forgotten one non-exploitable.
//  2. `COST_FIELD_KEYS` — cost/margin data, which is Owner-only
//     (PRD §4: Staff/Clerk has "no access to cost/margin data by default").
export const SECRET_FIELD_KEYS = new Set(["passwordHash"]);
export const COST_FIELD_KEYS = new Set(["costCents", "unitCostCents", "totalStockValueCents"]);

function redact<T>(value: T, keys: Set<string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keys)) as unknown as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key)) continue;
      out[key] = redact(entry, keys);
    }
    return out as T;
  }
  return value;
}

export function redactCostFields<T>(value: T): T {
  return redact(value, COST_FIELD_KEYS);
}

export function redactSecretFields<T>(value: T): T {
  return redact(value, SECRET_FIELD_KEYS);
}

// The single entry point requireAuth uses: secrets always, cost fields only
// for a STAFF principal. Both passes are folded into one walk of the body so
// a large list response isn't copied twice.
export function redactForRole<T>(value: T, role: UserRole): T {
  const keys = role === "STAFF" ? new Set([...SECRET_FIELD_KEYS, ...COST_FIELD_KEYS]) : SECRET_FIELD_KEYS;
  return redact(value, keys);
}

// Prisma `select` for the User relation wherever a user is embedded in
// another resource (a stock movement's actor, an order's creator). Use this
// instead of `include: { actor: true }` so the sensitive columns are never
// read out of the database in the first place.
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;
