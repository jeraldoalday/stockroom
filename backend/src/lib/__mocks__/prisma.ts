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

function matchesClause(record: Rec, clause: Rec): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Rec[]).some((sub) => matchesClause(record, sub));
    }
    if (key === "NOT") {
      return !matchesClause(record, expected as Rec);
    }
    if (expected && typeof expected === "object" && "contains" in expected) {
      const haystack = String(record[key] ?? "");
      const needle = String(expected.contains);
      return expected.mode === "insensitive"
        ? haystack.toLowerCase().includes(needle.toLowerCase())
        : haystack.includes(needle);
    }
    return record[key] === expected;
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

  findMany({ where = {}, skip = 0, take }: { where?: Rec; skip?: number; take?: number } = {}) {
    let result = this.rows.filter((r) => matchesClause(r, where));
    if (skip) result = result.slice(skip);
    if (take !== undefined) result = result.slice(0, take);
    return Promise.resolve(result.map((r) => ({ ...r })));
  }

  findFirst({ where = {} }: { where?: Rec } = {}) {
    const row = this.rows.find((r) => matchesClause(r, where));
    return Promise.resolve(row ? { ...row } : null);
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
}

const tables = {
  organization: new Table(),
  user: new Table({ role: "STAFF" }),
  location: new Table({ isDefault: false }),
  category: new Table(),
  supplier: new Table(),
  customer: new Table(),
  product: new Table({ isActive: true, costCents: 0, priceCents: 0, reorderPoint: 0, reorderQty: 0 }),
  inventoryItem: new Table({ quantity: 0 }),
  stockMovement: new Table(),
  purchaseOrder: new Table({ status: "DRAFT" }),
  purchaseOrderLine: new Table({ quantityReceived: 0 }),
  salesOrder: new Table({ status: "DRAFT" }),
};

export const prisma = {
  ...tables,
  $transaction: async (fn: (tx: typeof tables) => Promise<unknown>) => fn(tables),
};

export function __resetPrismaMock() {
  Object.values(tables).forEach((table) => table.reset());
}
