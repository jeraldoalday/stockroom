// Manual Jest mock for the Prisma client. Route tests run against this
// in-memory store instead of a real Postgres instance so `npm test` needs
// no external services; true integration coverage runs in CI against
// docker-compose's Postgres (see backend/README section on testing).

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

type Rec = Record<string, any>;

const KNOWN_OPERATORS = new Set(["contains", "mode", "in", "notIn", "not", "gt", "gte", "lt", "lte", "equals"]);

function matchesOperators(actual: unknown, operators: Rec): boolean {
  for (const operator of Object.keys(operators)) {
    if (!KNOWN_OPERATORS.has(operator)) {
      throw new Error(
        `Prisma mock: unsupported filter operator "${operator}". Add it to matchesOperators() rather than leaving the query untested.`
      );
    }
  }

  if ("contains" in operators) {
    const haystack = String(actual ?? "");
    const needle = String(operators.contains);
    const hit =
      operators.mode === "insensitive"
        ? haystack.toLowerCase().includes(needle.toLowerCase())
        : haystack.includes(needle);
    if (!hit) return false;
  }
  if ("equals" in operators && actual !== operators.equals) return false;
  if ("in" in operators && !(operators.in as unknown[]).includes(actual)) return false;
  if ("notIn" in operators && (operators.notIn as unknown[]).includes(actual)) return false;
  if ("not" in operators && actual === operators.not) return false;
  // A null column never satisfies an ordered comparison in SQL: `NULL <
  // now()` is NULL, which is not true, so the row is not returned. JS
  // disagrees loudly — `null < someDate` coerces null to 0 and comes out
  // true — so every nullable column had to be checked here, or a query like
  // "reset tokens used before this cutoff" would match every unused token
  // in the mock and none of them in Postgres.
  const ordered = ["gt", "gte", "lt", "lte"] as const;
  if (ordered.some((operator) => operator in operators) && actual == null) return false;
  if ("gt" in operators && !((actual as number) > (operators.gt as number))) return false;
  if ("gte" in operators && !((actual as number) >= (operators.gte as number))) return false;
  if ("lt" in operators && !((actual as number) < (operators.lt as number))) return false;
  if ("lte" in operators && !((actual as number) <= (operators.lte as number))) return false;
  return true;
}

function matchesClause(record: Rec, clause: Rec): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Rec[]).some((sub) => matchesClause(record, sub));
    }
    if (key === "NOT") {
      return !matchesClause(record, expected as Rec);
    }
    // Prisma filter operators. Only the ones the routes actually use are
    // implemented; an unrecognised operator throws rather than silently
    // matching everything, which would turn a real query bug into a green
    // test.
    if (expected && typeof expected === "object" && !(expected instanceof Date) && !Array.isArray(expected)) {
      return matchesOperators(record[key], expected as Rec);
    }
    return record[key] === expected;
  });
}

/**
 * Prisma's orderBy, which the store used to ignore outright: every route
 * asks for one and every route test was silently asserting on insertion
 * order instead. A route that dropped its orderBy, or sorted by the wrong
 * column, would have passed.
 *
 * Accepts the single-key and array forms Prisma accepts. Nested relation
 * ordering and aggregate ordering (`{ _sum: { quantity: "desc" } }`) are
 * supported one level deep, which is as far as the routes go.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  // Prisma sorts nulls last by default.
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function sortRows(rows: Rec[], orderBy?: Rec | Rec[]): Rec[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        let a = left[field];
        let b = right[field];
        if (direction && typeof direction === "object") {
          // Aggregate ordering: { _sum: { quantity: "desc" } }.
          const [nestedField, nestedDirection] = Object.entries(direction as Rec)[0];
          a = (a as Rec | undefined)?.[nestedField];
          b = (b as Rec | undefined)?.[nestedField];
          const nested = compareValues(a, b);
          if (nested !== 0) return nestedDirection === "desc" ? -nested : nested;
          continue;
        }
        const comparison = compareValues(a, b);
        if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
      }
    }
    return 0;
  });
}

class Table {
  rows: Rec[] = [];

  constructor(private defaults: Rec = {}) {}

  reset() {
    this.rows = [];
  }

  create({ data }: { data: Rec }) {
    // Mirrors the @default(...) values declared in schema.prisma, since
    // this in-memory store doesn't read the schema itself.
    const row = { id: nextId("id"), createdAt: new Date(), updatedAt: new Date(), ...this.defaults, ...data };
    this.rows.push(row);
    return Promise.resolve({ ...row });
  }

  findMany({
    where = {},
    skip = 0,
    take,
    orderBy,
  }: { where?: Rec; skip?: number; take?: number; orderBy?: Rec | Rec[] } = {}) {
    let result = sortRows(this.rows.filter((r) => matchesClause(r, where)), orderBy);
    if (skip) result = result.slice(skip);
    if (take !== undefined) result = result.slice(0, take);
    return Promise.resolve(result.map((r) => ({ ...r })));
  }

  findFirst({ where = {}, orderBy }: { where?: Rec; orderBy?: Rec | Rec[] } = {}) {
    const [row] = sortRows(this.rows.filter((r) => matchesClause(r, where)), orderBy);
    return Promise.resolve(row ? { ...row } : null);
  }

  /**
   * Prisma's groupBy, which compiles to a SQL GROUP BY against a real
   * database. Supports the `_sum` and `_count` aggregates the routes use;
   * anything else throws rather than quietly returning undefined, on the
   * same principle as matchesOperators().
   */
  groupBy({
    by,
    where = {},
    _sum,
    _count,
    orderBy,
  }: {
    by: string[];
    where?: Rec;
    _sum?: Rec;
    _count?: Rec | true;
    orderBy?: Rec | Rec[];
  }) {
    const groups = new Map<string, Rec[]>();
    for (const row of this.rows.filter((r) => matchesClause(r, where))) {
      const key = JSON.stringify(by.map((field) => row[field]));
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    const result = [...groups.values()].map((rows) => {
      const group: Rec = {};
      for (const field of by) group[field] = rows[0][field];
      if (_sum) {
        group._sum = Object.fromEntries(
          Object.keys(_sum).map((field) => [
            field,
            // Prisma returns null, not 0, when every value in the group is
            // null — a distinction the routes have to handle.
            rows.every((row) => row[field] == null)
              ? null
              : rows.reduce((total, row) => total + (Number(row[field]) || 0), 0),
          ])
        );
      }
      if (_count !== undefined) {
        group._count =
          _count === true
            ? rows.length
            : Object.fromEntries(
                Object.keys(_count).map((field) => [
                  field,
                  rows.filter((row) => row[field] != null).length,
                ])
              );
      }
      return group;
    });

    return Promise.resolve(sortRows(result, orderBy));
  }

  aggregate({ where = {}, _sum, _count }: { where?: Rec; _sum?: Rec; _count?: Rec | true } = {}) {
    const rows = this.rows.filter((r) => matchesClause(r, where));
    const result: Rec = {};
    if (_sum) {
      result._sum = Object.fromEntries(
        Object.keys(_sum).map((field) => [
          field,
          rows.every((row) => row[field] == null)
            ? null
            : rows.reduce((total, row) => total + (Number(row[field]) || 0), 0),
        ])
      );
    }
    if (_count !== undefined) {
      result._count =
        _count === true
          ? rows.length
          : Object.fromEntries(
              Object.keys(_count).map((field) => [field, rows.filter((row) => row[field] != null).length])
            );
    }
    return Promise.resolve(result);
  }

  findUnique({ where = {} }: { where?: Rec } = {}) {
    const row = this.rows.find((r) => matchesClause(r, where));
    return Promise.resolve(row ? { ...row } : null);
  }

  count({ where = {} }: { where?: Rec } = {}) {
    return Promise.resolve(this.rows.filter((r) => matchesClause(r, where)).length);
  }

  update({ where, data }: { where: Rec; data: Rec }) {
    const row = this.rows.find((r) => matchesClause(r, where));
    if (!row) throw new Error("Record to update not found");
    Object.assign(row, data, { updatedAt: new Date() });
    return Promise.resolve({ ...row });
  }

  delete({ where }: { where: Rec }) {
    const index = this.rows.findIndex((r) => matchesClause(r, where));
    if (index === -1) throw new Error("Record to delete not found");
    const [removed] = this.rows.splice(index, 1);
    return Promise.resolve({ ...removed });
  }

  deleteMany({ where = {} }: { where?: Rec } = {}) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matchesClause(r, where));
    return Promise.resolve({ count: before - this.rows.length });
  }

  updateMany({ where = {}, data }: { where?: Rec; data: Rec }) {
    const matched = this.rows.filter((r) => matchesClause(r, where));
    matched.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }));
    return Promise.resolve({ count: matched.length });
  }
}

const tables = {
  organization: new Table(),
  user: new Table({ role: "STAFF", lowStockDigestOptOut: false }),
  location: new Table({ isDefault: false, isActive: true }),
  category: new Table({ isActive: true }),
  supplier: new Table({ isActive: true }),
  customer: new Table({ isActive: true }),
  product: new Table({ isActive: true, costCents: 0, priceCents: 0, reorderPoint: 0, reorderQty: 0 }),
  inventoryItem: new Table({ quantity: 0 }),
  stockMovement: new Table(),
  purchaseOrder: new Table({ status: "DRAFT" }),
  purchaseOrderLine: new Table({ quantityReceived: 0 }),
  salesOrder: new Table({ status: "DRAFT" }),
  salesOrderLine: new Table(),
  passwordResetToken: new Table({ usedAt: null }),
  refreshToken: new Table({ revokedAt: null, replacedById: null }),
  rateLimitBucket: new Table(),
};

// `lib/dashboardStats.ts` pushes the low-stock predicate (a comparison
// between an aggregate of one table and a column on another, which Prisma's
// query builder can't express) into two raw SQL queries. There is no SQL
// engine here to run them against, so each is re-derived directly from the
// in-memory tables instead — matched by the marker comment
// (`-- dashboardStats.xxx`) each query carries for exactly this purpose,
// the same way a real query planner would use the SQL's own shape. This has
// to be kept in step by hand with dashboardStats.ts; there is no way around
// that short of embedding a real SQL engine in a test double.
function sumQuantityByProductId(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of tables.inventoryItem.rows) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
  }
  return totals;
}

function mockStockSummary(organizationId: string): Rec[] {
  const quantityByProduct = sumQuantityByProductId();
  const products = tables.product.rows.filter((p) => p.organizationId === organizationId && p.isActive);

  let totalStockValueCents = 0;
  let lowStockCount = 0;
  for (const product of products) {
    const quantity = quantityByProduct.get(product.id) ?? 0;
    totalStockValueCents += quantity * (product.costCents ?? 0);
    if (quantity <= product.reorderPoint) lowStockCount += 1;
  }

  return [{ activeProductCount: products.length, totalStockValueCents, lowStockCount }];
}

function mockLowStockPage(organizationId: string, pageSize: number, offset: number): Rec[] {
  const quantityByProduct = sumQuantityByProductId();
  const products = tables.product.rows.filter((p) => p.organizationId === organizationId && p.isActive);

  const lowStock = products
    .map((product): Rec => ({ ...product, quantity: quantityByProduct.get(product.id) ?? 0 }))
    .filter((product) => product.quantity <= product.reorderPoint)
    .sort((a, b) => a.quantity - b.quantity || String(a.name).localeCompare(String(b.name)));

  const total = lowStock.length;
  return lowStock.slice(offset, offset + pageSize).map((row) => ({ ...row, totalCount: total }));
}

// lib/rateLimit.ts's atomic "increment, or reset if the window has rolled
// over" upsert. There's no SQL engine here to run the real
// `INSERT ... ON CONFLICT DO UPDATE` against, so it's re-derived directly
// against the in-memory table — matched by marker comment, same trade as
// the dashboard queries above. Single-threaded JS makes this trivially
// atomic where the real query needs Postgres to serialize it; that's the
// one behaviour a mock can't exercise; see rateLimit.test.ts for a
// real-Postgres-only note on the concurrent case.
function mockRateLimitHit(key: string, freshResetAt: Date, now: Date): Rec[] {
  let row = tables.rateLimitBucket.rows.find((r) => r.key === key);
  if (!row) {
    row = { key, count: 1, resetAt: freshResetAt };
    tables.rateLimitBucket.rows.push(row);
  } else if (row.resetAt <= now) {
    row.count = 1;
    row.resetAt = freshResetAt;
  } else {
    row.count += 1;
  }
  return [{ count: row.count, resetAt: row.resetAt }];
}

// lib/rateLimit.ts's "clear every login bucket for this email, whichever IP
// tripped it" delete. Re-derived the same way mockRateLimitHit is: JS's own
// startsWith/endsWith stand in for the real query's left()/right() string
// comparison, since there's no SQL engine here to run it against.
function mockResetLoginLockout(suffix: string): Rec[] {
  const table = tables.rateLimitBucket;
  const removed = table.rows.filter((r) => typeof r.key === "string" && r.key.startsWith("login:") && r.key.endsWith(suffix));
  table.rows = table.rows.filter((r) => !removed.includes(r));
  return removed.map((r) => ({ key: r.key }));
}

// Dispatches a tagged-template $queryRaw call to its hand-written
// equivalent above by marker comment. The dashboard queries interpolate
// organizationId as their first value (possibly more than once, always the
// same value), so `values[0]` is always safe to read as it regardless of
// how many times it repeats later in the array; rateLimit.hit follows the
// same convention for its own first two distinct values.
function $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<Rec[]> {
  const sql = strings.join("");

  if (sql.includes("rateLimit.hit")) {
    const [key, freshResetAt, now] = values as [string, Date, Date];
    return Promise.resolve(mockRateLimitHit(key, freshResetAt, now));
  }
  if (sql.includes("rateLimit.resetLoginLockout")) {
    // values are [suffix.length, suffix] in that order — see rateLimit.ts.
    const suffix = values[1] as string;
    return Promise.resolve(mockResetLoginLockout(suffix));
  }

  const organizationId = values[0] as string;

  if (sql.includes("dashboardStats.stockSummary")) {
    return Promise.resolve(mockStockSummary(organizationId));
  }
  if (sql.includes("dashboardStats.lowStockPage")) {
    const pageSize = Number(values[values.length - 2]);
    const offset = Number(values[values.length - 1]);
    return Promise.resolve(mockLowStockPage(organizationId, pageSize, offset));
  }

  throw new Error(
    `Prisma mock: unrecognised $queryRaw call — add a marker comment and a matching mock branch rather than leaving the query untested.\nSQL: ${sql}`
  );
}

// `__reset` hangs off the mocked client itself rather than being a separate
// named export, because a test file only ever holds a reference to *this*
// module instance through `jest.mock("../lib/prisma")`. Importing
// "../lib/__mocks__/prisma" by path instead registers a second, independent
// copy of this module — with its own `tables` — so a reset called on that
// copy silently leaves the store the routes actually use untouched. That is
// exactly the trap the previous `__resetPrismaMock` named export fell into;
// see __tests__/testUtils/prismaMock.ts.
export const prisma = {
  ...tables,
  $queryRaw,
  $transaction: async (fn: (tx: typeof tables) => Promise<unknown>) => fn(tables),
  __reset() {
    Object.values(tables).forEach((table) => table.reset());
  },
};
