// Demo data for local dev and the Day 14 demo script (docs/DEMO.md).
// Safe to re-run: upserts by the same natural keys the schema already
// uniques on (org name is not unique, so this always creates one fresh
// "Riverside Goods Co." org rather than reusing a prior run's).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

async function main() {
  const passwordHash = await hashPassword("demo12345");

  const organization = await prisma.organization.create({
    data: { name: "Riverside Goods Co." },
  });

  const owner = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: "owner@riverside.demo",
      passwordHash,
      name: "Riley Owner",
      role: "OWNER",
    },
  });

  const staff = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: "staff@riverside.demo",
      passwordHash,
      name: "Sam Staff",
      role: "STAFF",
    },
  });

  const warehouse = await prisma.location.create({
    data: { organizationId: organization.id, name: "Main Warehouse", isDefault: true },
  });
  const storefront = await prisma.location.create({
    data: { organizationId: organization.id, name: "Downtown Storefront" },
  });

  const [beverages, snacks, household] = await Promise.all([
    prisma.category.create({ data: { organizationId: organization.id, name: "Beverages" } }),
    prisma.category.create({ data: { organizationId: organization.id, name: "Snacks" } }),
    prisma.category.create({ data: { organizationId: organization.id, name: "Household" } }),
  ]);

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: organization.id,
      name: "Cascade Wholesale",
      email: "orders@cascadewholesale.demo",
      phone: "555-0101",
    },
  });

  const customer = await prisma.customer.create({
    data: {
      organizationId: organization.id,
      name: "Corner Cafe",
      email: "purchasing@cornercafe.demo",
      phone: "555-0202",
    },
  });

  const products = await Promise.all([
    prisma.product.create({
      data: {
        organizationId: organization.id,
        categoryId: beverages.id,
        sku: "BEV-001",
        name: "Sparkling Water 12pk",
        costCents: 450,
        priceCents: 899,
        reorderPoint: 20,
        reorderQty: 40,
      },
    }),
    prisma.product.create({
      data: {
        organizationId: organization.id,
        categoryId: snacks.id,
        sku: "SNK-001",
        name: "Trail Mix 8oz",
        costCents: 180,
        priceCents: 399,
        reorderPoint: 15,
        reorderQty: 30,
      },
    }),
    prisma.product.create({
      data: {
        organizationId: organization.id,
        categoryId: household.id,
        sku: "HH-001",
        name: "Dish Soap 16oz",
        costCents: 120,
        priceCents: 349,
        reorderPoint: 10,
        reorderQty: 25,
      },
    }),
  ]);
  const [sparklingWater, trailMix, dishSoap] = products;

  // Receive initial stock at the warehouse, matching how the app itself
  // records a RECEIVE movement (via applyMovementDelta) rather than
  // writing InventoryItem rows directly.
  const receiveQuantities: [typeof products[number], number][] = [
    [sparklingWater, 120],
    [trailMix, 80],
    [dishSoap, 8], // intentionally under its reorder point, for the low-stock/reorder demo
  ];
  for (const [product, quantity] of receiveQuantities) {
    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          locationId: warehouse.id,
          quantity,
        },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          locationId: warehouse.id,
          type: "RECEIVE",
          quantity,
          actorId: owner.id,
        },
      });
    });
  }

  // Transfer some sparkling water and trail mix out to the storefront.
  const transfers: [typeof products[number], number][] = [
    [sparklingWater, 30],
    [trailMix, 20],
  ];
  for (const [product, quantity] of transfers) {
    await prisma.$transaction(async (tx) => {
      const warehouseItem = await tx.inventoryItem.findFirst({
        where: { productId: product.id, locationId: warehouse.id },
      });
      await tx.inventoryItem.update({
        where: { id: warehouseItem!.id },
        data: { quantity: warehouseItem!.quantity - quantity },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          locationId: warehouse.id,
          type: "TRANSFER_OUT",
          quantity,
          actorId: staff.id,
        },
      });
      await tx.inventoryItem.upsert({
        where: { productId_locationId: { productId: product.id, locationId: storefront.id } },
        create: {
          organizationId: organization.id,
          productId: product.id,
          locationId: storefront.id,
          quantity,
        },
        update: { quantity: { increment: quantity } },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          locationId: storefront.id,
          type: "TRANSFER_IN",
          quantity,
          actorId: staff.id,
        },
      });
    });
  }

  // A fulfilled sales order out of the storefront, for F11/F12's trend and
  // reorder-suggestion reports to have demand to compute against.
  const salesOrder = await prisma.salesOrder.create({
    data: {
      organizationId: organization.id,
      customerId: customer.id,
      locationId: storefront.id,
      status: "FULFILLED",
      lines: {
        create: [
          { productId: sparklingWater.id, quantity: 12, unitPriceCents: sparklingWater.priceCents },
          { productId: trailMix.id, quantity: 8, unitPriceCents: trailMix.priceCents },
        ],
      },
    },
  });
  for (const [product, quantity] of [
    [sparklingWater, 12],
    [trailMix, 8],
  ] as [typeof products[number], number][]) {
    await prisma.$transaction(async (tx) => {
      const storefrontItem = await tx.inventoryItem.findFirst({
        where: { productId: product.id, locationId: storefront.id },
      });
      await tx.inventoryItem.update({
        where: { id: storefrontItem!.id },
        data: { quantity: storefrontItem!.quantity - quantity },
      });
      await tx.stockMovement.create({
        data: {
          organizationId: organization.id,
          productId: product.id,
          locationId: storefront.id,
          type: "SALE",
          quantity: -quantity,
          actorId: staff.id,
          salesOrderId: salesOrder.id,
        },
      });
    });
  }

  // An open purchase order (draft), so the PO screen has something besides
  // history to show.
  await prisma.purchaseOrder.create({
    data: {
      organizationId: organization.id,
      supplierId: supplier.id,
      status: "DRAFT",
      notes: "Restock ahead of the weekend rush",
      lines: {
        create: [
          { productId: dishSoap.id, quantityOrdered: 25, unitCostCents: dishSoap.costCents },
        ],
      },
    },
  });

  console.log("Seeded demo org:", organization.name);
  console.log("  Owner login: owner@riverside.demo / demo12345");
  console.log("  Staff login: staff@riverside.demo / demo12345");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
