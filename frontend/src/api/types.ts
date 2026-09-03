export type UserRole = "OWNER" | "STAFF";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  lowStockDigestOptOut: boolean;
}

export interface Organization {
  id: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  organization?: Organization;
}

export interface Category {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  category?: Category | null;
  // Omitted entirely for a STAFF principal — cost/margin data is Owner-only
  // (PRD §4), stripped server-side rather than sent and hidden client-side.
  costCents?: number;
  priceCents: number;
  reorderPoint: number;
  reorderQty: number;
  isActive: boolean;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Location {
  id: string;
  name: string;
  address: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface SupplierListResponse {
  items: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryItem {
  id: string;
  productId: string;
  locationId: string;
  quantity: number;
  updatedAt: string;
  product?: Product;
  location?: Location;
}

export interface InventoryListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type MovementType = "RECEIVE" | "SALE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";

export interface MovementActor {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface StockMovement {
  id: string;
  type: MovementType;
  quantity: number;
  // Set on SALE movements only — what the goods actually sold for. Visible
  // to STAFF, unlike cost: PRD §4 withholds margin data, not prices.
  unitPriceCents: number | null;
  reason: string | null;
  // Set on the ADJUSTMENT movements a completed stocktake posts, so a batch
  // of corrections reads as one reconciliation rather than as a clerk
  // making a dozen unrelated edits in the same second.
  stocktakeId: string | null;
  createdAt: string;
  product?: Product;
  location?: Location;
  // Narrowed server-side to the public user fields; never the whole User row.
  actor?: MovementActor;
}

export interface StockMovementListResponse {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardSummary {
  // Omitted for STAFF — see Product.costCents.
  totalStockValueCents?: number;
  activeProductCount: number;
  lowStockCount: number;
  recentMovements: StockMovement[];
}

export interface LowStockEntry {
  product: Product;
  quantity: number;
}

export interface LowStockResponse {
  items: LowStockEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  quantityOrdered: number;
  quantityReceived: number;
  // Omitted for STAFF — see Product.costCents.
  unitCostCents?: number;
  product?: Product;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  createdAt: string;
  supplier?: Supplier;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export type SalesOrderStatus = "DRAFT" | "FULFILLED" | "CANCELLED";

export interface SalesOrderLine {
  id: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  product?: Product;
}

export interface SalesOrder {
  id: string;
  customerId: string | null;
  locationId: string;
  status: SalesOrderStatus;
  notes: string | null;
  createdAt: string;
  customer?: Customer;
  lines?: SalesOrderLine[];
}

export interface SalesOrderListResponse {
  items: SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface TeamMemberListResponse {
  items: TeamMember[];
}

export type StocktakeStatus = "OPEN" | "COMPLETED" | "CANCELLED";

/** Which products the server puts on a new count sheet. */
export type StocktakeScope = "with-stock" | "all-products";

export interface StocktakeLine {
  id: string;
  productId: string;
  /** What the system believed when the sheet was created — a snapshot. */
  expectedQty: number;
  /** Null until somebody counts it; 0 means "counted, and it's empty". */
  countedQty: number | null;
  /** The signed correction posted at completion; null until then. */
  appliedDelta: number | null;
  countedAt: string | null;
  product?: Product | null;
  countedBy?: MovementActor | null;
}

export interface StocktakeVariance {
  lineId: string;
  productId: string;
  expectedQty: number;
  countedQty: number;
  /** Counted against the sheet the counter was given. */
  variance: number;
  /** What was really posted to stock, measured against live quantity. */
  appliedDelta: number;
}

export interface StocktakeSummary {
  countedLines: number;
  adjustedLines: number;
  unitsFound: number;
  unitsLost: number;
  variances: StocktakeVariance[];
}

export interface Stocktake {
  id: string;
  locationId: string;
  status: StocktakeStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  location?: Location | null;
  createdBy?: MovementActor | null;
  completedBy?: MovementActor | null;
  lineCount: number;
  countedCount: number;
  lines?: StocktakeLine[];
  /** Present only on the response to completing a count. */
  summary?: StocktakeSummary;
}

export interface StocktakeListResponse {
  items: Stocktake[];
  total: number;
  page: number;
  pageSize: number;
}
