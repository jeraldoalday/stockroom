// Static shape of the demo organization. Kept separate from the simulation
// in history.ts so the "what does a plausible small shop look like" data
// can be edited without touching the movement-generation logic.

export const DEMO_ORGANIZATION_NAME = "Northside Grocery";

export const DEMO_OWNER_EMAIL = "owner@northside.test";
export const DEMO_STAFF_EMAIL = "clerk@northside.test";

// Printed by the seed script so a demo has credentials to hand. Only ever
// used for the demo org — never a default anywhere in the application.
export const DEMO_PASSWORD = "stockroom123";

export interface SeedLocation {
  name: string;
  address: string;
  isDefault: boolean;
}

export const SEED_LOCATIONS: SeedLocation[] = [
  { name: "Storefront", address: "412 Northside Ave", isDefault: true },
  { name: "Back Room", address: "412 Northside Ave (rear)", isDefault: false },
  { name: "Overflow Warehouse", address: "88 Depot Road, Unit 3", isDefault: false },
];

export const SEED_CATEGORIES = ["Produce", "Dairy", "Bakery", "Beverages", "Household", "Snacks"];

export interface SeedProduct {
  sku: string;
  name: string;
  category: string;
  costCents: number;
  priceCents: number;
  reorderPoint: number;
  reorderQty: number;
  /** Rough units sold per day, used to drive the sales simulation. */
  dailyDemand: number;
}

// Margins here are deliberately varied (produce thin, household fat) so the
// cost/margin reports and the Owner-vs-Staff redaction have something
// meaningful to show rather than a uniform markup.
export const SEED_PRODUCTS: SeedProduct[] = [
  { sku: "NG-1001", name: "Bananas (per kg)", category: "Produce", costCents: 120, priceCents: 199, reorderPoint: 20, reorderQty: 60, dailyDemand: 9 },
  { sku: "NG-1002", name: "Gala Apples (per kg)", category: "Produce", costCents: 210, priceCents: 349, reorderPoint: 15, reorderQty: 45, dailyDemand: 6 },
  { sku: "NG-1003", name: "Roma Tomatoes (per kg)", category: "Produce", costCents: 180, priceCents: 299, reorderPoint: 12, reorderQty: 36, dailyDemand: 5 },
  { sku: "NG-1004", name: "Baby Spinach 200g", category: "Produce", costCents: 165, priceCents: 329, reorderPoint: 10, reorderQty: 30, dailyDemand: 4 },
  { sku: "NG-1005", name: "Avocado (each)", category: "Produce", costCents: 95, priceCents: 189, reorderPoint: 24, reorderQty: 72, dailyDemand: 8 },
  { sku: "NG-2001", name: "Whole Milk 2L", category: "Dairy", costCents: 245, priceCents: 379, reorderPoint: 18, reorderQty: 48, dailyDemand: 7 },
  { sku: "NG-2002", name: "Salted Butter 250g", category: "Dairy", costCents: 320, priceCents: 529, reorderPoint: 12, reorderQty: 36, dailyDemand: 4 },
  { sku: "NG-2003", name: "Greek Yoghurt 500g", category: "Dairy", costCents: 275, priceCents: 449, reorderPoint: 12, reorderQty: 36, dailyDemand: 5 },
  { sku: "NG-2004", name: "Mature Cheddar 400g", category: "Dairy", costCents: 480, priceCents: 799, reorderPoint: 8, reorderQty: 24, dailyDemand: 3 },
  { sku: "NG-2005", name: "Free Range Eggs (12)", category: "Dairy", costCents: 310, priceCents: 519, reorderPoint: 15, reorderQty: 40, dailyDemand: 6 },
  { sku: "NG-3001", name: "Sourdough Loaf", category: "Bakery", costCents: 190, priceCents: 425, reorderPoint: 10, reorderQty: 28, dailyDemand: 5 },
  { sku: "NG-3002", name: "Wholemeal Rolls (6)", category: "Bakery", costCents: 145, priceCents: 289, reorderPoint: 10, reorderQty: 30, dailyDemand: 4 },
  { sku: "NG-3003", name: "Butter Croissant", category: "Bakery", costCents: 85, priceCents: 210, reorderPoint: 20, reorderQty: 60, dailyDemand: 9 },
  { sku: "NG-4001", name: "Ground Coffee 500g", category: "Beverages", costCents: 620, priceCents: 1099, reorderPoint: 8, reorderQty: 24, dailyDemand: 3 },
  { sku: "NG-4002", name: "English Breakfast Tea (80)", category: "Beverages", costCents: 285, priceCents: 499, reorderPoint: 10, reorderQty: 30, dailyDemand: 3 },
  { sku: "NG-4003", name: "Orange Juice 1L", category: "Beverages", costCents: 210, priceCents: 379, reorderPoint: 14, reorderQty: 36, dailyDemand: 5 },
  { sku: "NG-4004", name: "Sparkling Water 6x330ml", category: "Beverages", costCents: 240, priceCents: 449, reorderPoint: 12, reorderQty: 36, dailyDemand: 4 },
  { sku: "NG-5001", name: "Dish Soap 750ml", category: "Household", costCents: 145, priceCents: 349, reorderPoint: 10, reorderQty: 24, dailyDemand: 2 },
  { sku: "NG-5002", name: "Kitchen Roll (2)", category: "Household", costCents: 165, priceCents: 379, reorderPoint: 12, reorderQty: 30, dailyDemand: 3 },
  { sku: "NG-5003", name: "Bin Liners (30)", category: "Household", costCents: 190, priceCents: 429, reorderPoint: 8, reorderQty: 24, dailyDemand: 2 },
  { sku: "NG-5004", name: "Laundry Powder 2kg", category: "Household", costCents: 540, priceCents: 999, reorderPoint: 6, reorderQty: 18, dailyDemand: 1 },
  { sku: "NG-6001", name: "Salted Crisps 150g", category: "Snacks", costCents: 110, priceCents: 249, reorderPoint: 18, reorderQty: 48, dailyDemand: 6 },
  { sku: "NG-6002", name: "Dark Chocolate 100g", category: "Snacks", costCents: 175, priceCents: 379, reorderPoint: 14, reorderQty: 40, dailyDemand: 4 },
  { sku: "NG-6003", name: "Mixed Nuts 300g", category: "Snacks", costCents: 395, priceCents: 699, reorderPoint: 8, reorderQty: 24, dailyDemand: 2 },
  // Two lines nobody buys, with `dailyDemand: 0` so the simulation receives
  // them and then never sells one. Every other product in this catalogue
  // moves, which left the dead-stock report empty in the demo — a live
  // demonstration of the problem it exists to find. Both are deliberately
  // expensive per unit: dead stock is interesting in proportion to the
  // capital it holds, and a shop's worst offender is usually something
  // pricey that seemed like a good idea once.
  { sku: "NG-5005", name: "Novelty Gift Hamper", category: "Household", costCents: 1450, priceCents: 2499, reorderPoint: 2, reorderQty: 6, dailyDemand: 0 },
  { sku: "NG-6004", name: "Sugar-Free Liquorice 200g", category: "Snacks", costCents: 220, priceCents: 449, reorderPoint: 6, reorderQty: 12, dailyDemand: 0 },
];

/** SKUs the simulation never sells — see the comment above them. */
export const DEAD_STOCK_SKUS = ["NG-5005", "NG-6004"];

export interface SeedSupplier {
  name: string;
  email: string;
  phone: string;
  /** Categories this supplier is used for when generating purchase orders. */
  categories: string[];
}

export const SEED_SUPPLIERS: SeedSupplier[] = [
  { name: "Valley Fresh Produce", email: "orders@valleyfresh.test", phone: "555-0142", categories: ["Produce"] },
  { name: "Meadowlands Dairy", email: "sales@meadowlands.test", phone: "555-0177", categories: ["Dairy"] },
  { name: "Corner Street Bakery", email: "hello@cornerstreet.test", phone: "555-0104", categories: ["Bakery"] },
  { name: "Harbour Wholesale", email: "trade@harbourwholesale.test", phone: "555-0198", categories: ["Beverages", "Household", "Snacks"] },
];

export interface SeedCustomer {
  name: string;
  email: string;
  phone: string;
}

export const SEED_CUSTOMERS: SeedCustomer[] = [
  { name: "Northside Café", email: "orders@northsidecafe.test", phone: "555-0231" },
  { name: "Maple Street Deli", email: "buying@maplestreetdeli.test", phone: "555-0288" },
  { name: "Riverside Bed & Breakfast", email: "stay@riversidebnb.test", phone: "555-0219" },
  { name: "Hillcrest Nursery", email: "admin@hillcrestnursery.test", phone: "555-0265" },
  { name: "Walk-in customer", email: "", phone: "" },
];
