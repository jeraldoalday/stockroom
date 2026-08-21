import { hashPassword } from "../auth";
import {
  DEMO_ORGANIZATION_NAME,
  DEMO_OWNER_EMAIL,
  DEMO_PASSWORD,
  DEMO_STAFF_EMAIL,
  SEED_CATEGORIES,
  SEED_CUSTOMERS,
  SEED_LOCATIONS,
  SEED_PRODUCTS,
  SEED_SUPPLIERS,
} from "./catalog";
import { dateDaysAgo, planHistory, productBySku } from "./history";

export * from "./catalog";
export * from "./history";

// Structurally typed against the bits of PrismaClient the seed uses, so the
// same code runs against the real client from prisma/seed.ts and against
// the in-memory client in the test suite. Typing it as PrismaClient itself
// would make it untestable without a live Postgres.
type Row = Record<string, unknown>;
interface Delegate {
  create(args: { data: Row }): Promise<Row>;
  findMany(args?: { where?: Row }): Promise<Row[]>;
  findFirst(args: { where: Row }): Promise<Row | null>;
  deleteMany(args: { where: Row }): Promise<{ count: number }>;
  update(args: { where: Row; data: Row }): Promise<Row>;
}

export interface SeedClient {
  organization: Delegate;
  user: Delegate;
  location: Delegate;
  category: Delegate;
  supplier: Delegate;
  customer: Delegate;
  product: Delegate;
  inventoryItem: Delegate;
  stockMovement: Delegate;
  purchaseOrder: Delegate;
  purchaseOrderLine: Delegate;
  salesOrder: Delegate;
  salesOrderLine: Delegate;
}

export interface SeedOptions {
  /** Anchors every generated timestamp. Injected so a seeded run is
   * reproducible and so tests don't depend on the wall clock. */
  now?: Date;
  days?: number;
  log?: (message: string) => void;
}

export interface SeedSummary {
  organizationId: string;
  ownerEmail: string;
  staffEmail: string;
  password: string;
  counts: {
    locations: number;
    categories: number;
    products: number;
    suppliers: number;
    customers: number;
    stockMovements: number;
    purchaseOrders: number;
    salesOrders: number;
  };
  totalStockValueCents: number;
}

/**
 * Removes a previous run of this seed, and nothing else.
 *
 * Scoped strictly to the demo organization — matched by name — so running
 * `npm run seed` against a database that also holds real signups can't
 * touch them. Deletion order walks children before parents because the
 * schema has no cascade rules.
 */
async function clearExistingDemoOrg(client: SeedClient, log: (message: string) => void) {
  const existing = await client.organization.findFirst({ where: { name: DEMO_ORGANIZATION_NAME } });
  if (!existing) return;

  const organizationId = existing.id as string;
  log(`Removing the previous ${DEMO_ORGANIZATION_NAME} demo data...`);

  const purchaseOrders = await client.purchaseOrder.findMany({ where: { organizationId } });
  const salesOrders = await client.salesOrder.findMany({ where: { organizationId } });

  for (const order of purchaseOrders) {
    await client.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: order.id as string } });
  }
  for (const order of salesOrders) {
    await client.salesOrderLine.deleteMany({ where: { salesOrderId: order.id as string } });
  }

  await client.stockMovement.deleteMany({ where: { organizationId } });
  await client.purchaseOrder.deleteMany({ where: { organizationId } });
  await client.salesOrder.deleteMany({ where: { organizationId } });
  await client.inventoryItem.deleteMany({ where: { organizationId } });
  await client.product.deleteMany({ where: { organizationId } });
  await client.category.deleteMany({ where: { organizationId } });
  await client.supplier.deleteMany({ where: { organizationId } });
  await client.customer.deleteMany({ where: { organizationId } });
  await client.location.deleteMany({ where: { organizationId } });
  await client.user.deleteMany({ where: { organizationId } });
  await client.organization.deleteMany({ where: { id: organizationId } });
}

export async function seedDemoData(client: SeedClient, options: SeedOptions = {}): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => undefined);

  await clearExistingDemoOrg(client, log);

  log(`Creating ${DEMO_ORGANIZATION_NAME}...`);
  const organization = await client.organization.create({ data: { name: DEMO_ORGANIZATION_NAME } });
  const organizationId = organization.id as string;

  // One hash for both demo users: bcrypt is deliberately slow, and hashing
  // the same throwaway password twice doubles the seed's runtime for no
  // benefit.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const owner = await client.user.create({
    data: {
      organizationId,
      email: DEMO_OWNER_EMAIL,
      name: "Dana Okafor",
      passwordHash,
      role: "OWNER",
    },
  });
  const staff = await client.user.create({
    data: {
      organizationId,
      email: DEMO_STAFF_EMAIL,
      name: "Sam Whitfield",
      passwordHash,
      role: "STAFF",
    },
  });

  const locationsByName = new Map<string, string>();
  for (const location of SEED_LOCATIONS) {
    const created = await client.location.create({
      data: {
        organizationId,
        name: location.name,
        address: location.address,
        isDefault: location.isDefault,
      },
    });
    locationsByName.set(location.name, created.id as string);
  }

  const categoriesByName = new Map<string, string>();
  for (const name of SEED_CATEGORIES) {
    const created = await client.category.create({ data: { organizationId, name } });
    categoriesByName.set(name, created.id as string);
  }

  const productsBySku = new Map<string, string>();
  for (const product of SEED_PRODUCTS) {
    const created = await client.product.create({
      data: {
        organizationId,
        categoryId: categoriesByName.get(product.category),
        sku: product.sku,
        name: product.name,
        costCents: product.costCents,
        priceCents: product.priceCents,
        reorderPoint: product.reorderPoint,
        reorderQty: product.reorderQty,
        isActive: true,
      },
    });
    productsBySku.set(product.sku, created.id as string);
  }

  const suppliersByName = new Map<string, string>();
  for (const supplier of SEED_SUPPLIERS) {
    const created = await client.supplier.create({
      data: {
        organizationId,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
      },
    });
    suppliersByName.set(supplier.name, created.id as string);
  }

  const customerIds: string[] = [];
  for (const customer of SEED_CUSTOMERS) {
    const created = await client.customer.create({
      data: {
        organizationId,
        name: customer.name,
        email: customer.email || null,
        phone: customer.phone || null,
      },
    });
    customerIds.push(created.id as string);
  }

  log(`Simulating ${options.days ?? 60} days of trading...`);
  const history = planHistory({ days: options.days });

  // Movements are written with an explicit createdAt rather than posted
  // through the API, because the whole point is a *backdated* history the
  // trend and moving-average reports can chew on.
  for (const movement of history.movements) {
    await client.stockMovement.create({
      data: {
        organizationId,
        productId: productsBySku.get(movement.sku),
        locationId: locationsByName.get(movement.locationName),
        type: movement.type,
        quantity: movement.quantity,
        reason: movement.reason ?? null,
        // Receiving is the storekeeper's job; adjustments and the daily
        // sales ring-up land on whoever is on the floor.
        actorId: movement.type === "RECEIVE" ? owner.id : staff.id,
        createdAt: dateDaysAgo(now, movement.daysAgo),
      },
    });
  }

  // InventoryItem is a derived cache the movement engine keeps in step
  // inside each transaction; seeding writes the settled totals directly
  // from the same simulation that produced the movements, so the two agree
  // by construction rather than by replaying 2,000 inserts through the API.
  let totalStockValueCents = 0;
  for (const [key, quantity] of history.quantities) {
    const [sku, locationName] = key.split("::");
    await client.inventoryItem.create({
      data: {
        organizationId,
        productId: productsBySku.get(sku),
        locationId: locationsByName.get(locationName),
        quantity,
      },
    });
    totalStockValueCents += quantity * productBySku(sku).costCents;
  }

  log("Creating purchase and sales orders...");

  // One order in each interesting state, so every status filter and every
  // status transition in the UI has something to act on.
  const purchaseOrderPlans = [
    { supplier: "Valley Fresh Produce", status: "RECEIVED", skus: ["NG-1001", "NG-1002", "NG-1005"], daysAgo: 12, receivedRatio: 1 },
    { supplier: "Meadowlands Dairy", status: "PARTIALLY_RECEIVED", skus: ["NG-2001", "NG-2003"], daysAgo: 5, receivedRatio: 0.5 },
    { supplier: "Harbour Wholesale", status: "ORDERED", skus: ["NG-4001", "NG-6001", "NG-5002"], daysAgo: 2, receivedRatio: 0 },
    { supplier: "Corner Street Bakery", status: "DRAFT", skus: ["NG-3001", "NG-3003"], daysAgo: 0, receivedRatio: 0 },
  ];

  for (const plan of purchaseOrderPlans) {
    const order = await client.purchaseOrder.create({
      data: {
        organizationId,
        supplierId: suppliersByName.get(plan.supplier),
        status: plan.status,
        notes: plan.status === "DRAFT" ? "Weekly bakery order — not sent yet" : null,
        createdAt: dateDaysAgo(now, plan.daysAgo),
      },
    });

    for (const sku of plan.skus) {
      const product = productBySku(sku);
      const quantityOrdered = product.reorderQty;
      await client.purchaseOrderLine.create({
        data: {
          purchaseOrderId: order.id,
          productId: productsBySku.get(sku),
          quantityOrdered,
          quantityReceived: Math.floor(quantityOrdered * plan.receivedRatio),
          unitCostCents: product.costCents,
        },
      });
    }
  }

  const salesOrderPlans = [
    { customerIndex: 0, status: "FULFILLED", skus: ["NG-2001", "NG-3003"], daysAgo: 9 },
    { customerIndex: 1, status: "FULFILLED", skus: ["NG-2004", "NG-3001", "NG-6003"], daysAgo: 4 },
    { customerIndex: 2, status: "DRAFT", skus: ["NG-4003", "NG-2005"], daysAgo: 1 },
    { customerIndex: 3, status: "CANCELLED", skus: ["NG-5004"], daysAgo: 7 },
  ];

  for (const plan of salesOrderPlans) {
    const order = await client.salesOrder.create({
      data: {
        organizationId,
        customerId: customerIds[plan.customerIndex],
        locationId: locationsByName.get("Storefront"),
        status: plan.status,
        notes: null,
        createdAt: dateDaysAgo(now, plan.daysAgo),
      },
    });

    for (const sku of plan.skus) {
      const product = productBySku(sku);
      await client.salesOrderLine.create({
        data: {
          salesOrderId: order.id,
          productId: productsBySku.get(sku),
          quantity: 2 + (product.dailyDemand % 3),
          unitPriceCents: product.priceCents,
        },
      });
    }
  }

  return {
    organizationId,
    ownerEmail: DEMO_OWNER_EMAIL,
    staffEmail: DEMO_STAFF_EMAIL,
    password: DEMO_PASSWORD,
    counts: {
      locations: SEED_LOCATIONS.length,
      categories: SEED_CATEGORIES.length,
      products: SEED_PRODUCTS.length,
      suppliers: SEED_SUPPLIERS.length,
      customers: SEED_CUSTOMERS.length,
      stockMovements: history.movements.length,
      purchaseOrders: purchaseOrderPlans.length,
      salesOrders: salesOrderPlans.length,
    },
    totalStockValueCents,
  };
}
