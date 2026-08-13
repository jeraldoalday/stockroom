# StockRoom — Build Progress Log

Tracks what shipped each day against the 14-day plan in `PRD.md#11`. The
daily autonomous build session reads this file to know where to resume and
appends a new entry when it finishes.

## Day 1 — 2026-08-14

**Planned:** Repo scaffold, PRD, DB schema, auth (F1/F2), Products/Categories CRUD.

**Shipped:**
- Monorepo scaffold: `backend/` (Node/TS/Express/Prisma), `frontend/`
  (React/Vite/TS), `python-service/` (FastAPI), `docs/`.
- PRD v0.1 committed.
- Prisma schema: Organization, User, Category, Supplier, Customer, Location,
  Product, InventoryItem, StockMovement, PurchaseOrder(+Line),
  SalesOrder(+Line) — full multi-tenant model from section 5.
- Auth: signup (creates Organization + Owner User), login, JWT middleware,
  role guard (OWNER/STAFF).
- Products + Categories CRUD, tenant-scoped.
- Backend unit tests for auth and products.
- Python FastAPI service skeleton with a health check and DB read connection.
- React app shell: routing, auth pages, API client, protected routes.

**Next (Day 2):** Locations, Suppliers, Customers CRUD; InventoryItem model
wired to real stock queries per location.

**Blockers/decisions carried forward:** none.
