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
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  costCents: number;
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
}

export type MovementType = "RECEIVE" | "SALE" | "TRANSFER_IN" | "TRANSFER_OUT" | "ADJUSTMENT";

export interface StockMovement {
  id: string;
  type: MovementType;
  quantity: number;
  reason: string | null;
  createdAt: string;
  product?: Product;
  location?: Location;
}

export interface DashboardSummary {
  totalStockValueCents: number;
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
