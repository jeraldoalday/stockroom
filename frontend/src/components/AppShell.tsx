import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/products", label: "Products" },
  { to: "/categories", label: "Categories" },
  { to: "/inventory", label: "Inventory" },
  { to: "/stock-movements", label: "Stock Movements" },
  { to: "/stocktakes", label: "Stocktakes" },
  { to: "/purchase-orders", label: "Purchase Orders" },
  { to: "/sales-orders", label: "Sales Orders" },
  { to: "/reports", label: "Reports" },
  { to: "/locations", label: "Locations" },
  { to: "/suppliers", label: "Suppliers" },
  { to: "/customers", label: "Customers" },
];

const ownerOnlyNavItems = [{ to: "/team", label: "Team" }];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const items = user?.role === "OWNER" ? [...navItems, ...ownerOnlyNavItems] : navItems;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 text-lg font-semibold text-brand-700">StockRoom</div>
        <nav className="flex-1 px-2 space-y-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-gray-200 text-sm">
          <div className="font-medium">{user?.name}</div>
          <div className="text-gray-500">{user?.email}</div>
          <NavLink to="/account" className="mt-2 block text-brand-600 hover:underline">
            Account
          </NavLink>
          <button
            onClick={logout}
            className="mt-1 text-brand-600 hover:underline"
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
