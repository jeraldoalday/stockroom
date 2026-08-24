export type UserRole = "OWNER" | "STAFF";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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
