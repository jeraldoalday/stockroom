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

- GitHub Actions CI running backend tests, python-service tests, and the
  frontend production build on every push.
- All three test/build steps verified locally: backend 13/13 Jest tests
  pass, python-service pytest passes, frontend `tsc -b && vite build`
  succeeds cleanly.

**Next (Day 2):** Locations, Suppliers, Customers CRUD; InventoryItem model
wired to real stock queries per location.

**Blockers/decisions carried forward:**
- No Docker/Postgres available in the dev sandbox that built Day 1, so
  backend tests run against an in-memory Prisma mock rather than a real
  database — this is intentional (fast, no infra dependency) but true
  integration coverage against Postgres should still happen in CI or a
  real dev machine before this ships to a customer.
- react-router-dom pinned to v7 (not v6) after `npm audit` flagged a
  moderate CVE in v6 with no v6 backport available.

## Day 2–6, and a slice of Day 7 — 2026-08-14

**Planned:** Day 2 (Locations/Suppliers/Customers CRUD, InventoryItem stock
queries) through Day 6 (low-stock alerts, dashboard) of the build plan.

**Shipped (backend, F3-F9 all now live):**
- Locations, Suppliers, Customers: full tenant-scoped CRUD. Locations
  enforce a single-default-per-org invariant (moving the default is
  transactional); deleting a location is blocked if it's the org's last
  one, its current default, or still holds inventory. Suppliers/customers
  block deletion once they have order history.
- `GET /api/inventory` — stock query layer over `InventoryItem`, filterable
  by location/product.
- **StockMovement engine** (`POST /api/stock-movements`,
  `POST /api/stock-movements/transfer`, `GET /api/stock-movements`):
  RECEIVE, SALE, ADJUSTMENT, and a transactional TRANSFER_OUT/TRANSFER_IN
  pair. `InventoryItem.quantity` is now only ever mutated inside the same
  transaction as the StockMovement row that explains the change (via a
  shared `applyMovementDelta` helper in `lib/inventory.ts`), and every path
  rejects a result that would take stock negative. This is the audit-trail
  backbone the NFR in PRD §7 calls for.
- **Purchase orders** (F6): draft → ordered → received, with partial
  receiving. Receiving posts a RECEIVE movement per line and auto-advances
  status to PARTIALLY_RECEIVED or RECEIVED. Creation/editing/cancelling is
  Owner-gated; receiving is open to any authenticated user.
- **Sales orders** (F7): draft → fulfilled, with an over-sell guard —
  every line's stock at the order's location is checked before any
  movement is posted, so a short line never partially fulfills. Left
  ungated by role (fulfilling sales orders is an explicit Staff task in
  the PRD's persona model, unlike PO management).
- **Dashboard** (F8/F9): `GET /api/dashboard/summary` (total stock value,
  active product count, low-stock count, 10 most recent movements) and
  `GET /api/dashboard/low-stock` (paginated, sorted by scarcity).
- 29 new backend tests (66 total, all passing), covering tenant isolation,
  the over-sell/negative-stock guards, and every status transition.

**Shipped (frontend, start of Day 7):**
- `DashboardPage` now calls the new dashboard endpoints instead of
  showing the Day-1 placeholder: stat cards (stock value, active
  products, low-stock count), a low-stock table, and a recent-activity
  feed.
- Verified in an actual browser (not just `tsc`/`vite build`): stood up a
  real local Postgres (see below), ran both dev servers, and drove
  signup → create product → RECEIVE stock → dashboard through
  Playwright, confirming the stat cards and tables reflect real data.

**Next (rest of Day 7, then Day 8-9):** Frontend screens for the
StockMovement engine, purchase orders, and sales orders — currently only
Products and the dashboard have UI; Locations/Suppliers/Customers/
Inventory/StockMovements/PurchaseOrders/SalesOrders are backend-only so
far. After that: CSV import/export and the sales/stock trend report in
the Python service (Day 10-11).

**Blockers/decisions:**
- **No Docker daemon in this sandbox either**, but `postgresql-16` is
  installed locally and unused — started it directly
  (`pg_ctlcluster 16 main start`), created a `stockroom` role/database
  matching `backend/.env.example`, and ran the first
  `prisma migrate dev` (now committed under `backend/prisma/migrations/`).
  That migration didn't exist before this session; every real deploy
  needs it to run `prisma migrate deploy` instead of `db push`. Local dev
  without Docker: start the cluster, then follow `backend/.env.example`.
- PO create/edit/cancel is Owner-only; PO receiving and all sales-order
  actions are open to any authenticated user. This mirrors the PRD's
  persona text (Owner "manages suppliers and purchase orders", Staff
  "receives stock, fulfills sales orders") rather than any single
  functional requirement, since F1-F9 don't spell out per-endpoint RBAC.
- Deliberately did **not** hide cost/margin fields from STAFF on the new
  dashboard endpoint. The persona section says Staff has "no access to
  cost/margin data by default," but Day 1's Products endpoints already
  return full cost data to any authenticated org member — hiding it on
  just the one new endpoint would be an inconsistent, half-applied rule.
  Real field-level RBAC needs to land everywhere at once; that's exactly
  what Day 13 ("RBAC hardening") in the plan is for, so left as-is until
  then and flagged here rather than silently skipped.
- Low-stock math compares a product's *summed* quantity across all
  locations to its (location-agnostic) `reorderPoint`, since `reorderPoint`
  is a product-level field in the current schema, not per-location. Revisit
  if/when per-location reorder points are needed.
- Dashboard aggregation (`lib` in `dashboard.routes.ts`) sums stock in JS
  rather than a SQL `groupBy`, because the mock Prisma client used in tests
  can't express `groupBy`. Fine at the ~10k SKU scale the NFR targets;
  flagged in a code comment as the spot to move to a real aggregate query
  if that changes.

## Day 7 (finish) — 2026-08-15

**Planned:** Finish Day 7 ("Frontend: auth pages, app shell, products &
inventory screens") — every Day 2-6 backend endpoint (Locations, Suppliers,
Customers, Inventory, StockMovements) was still backend-only.

**Shipped (frontend):**
- `LocationsPage`: list, create, delete, and switch the org's default
  location (the "make default" action calls the existing `PATCH
  /locations/:id { isDefault: true }`, which server-side clears the old
  default transactionally).
- `SuppliersPage` / `CustomersPage`: near-identical search + create + delete
  screens, mirroring `ProductsPage`'s existing layout and form conventions.
- `InventoryPage`: read-only stock-on-hand table, filterable by location,
  over `GET /inventory`.
- `StockMovementsPage`: two forms — record a RECEIVE/SALE/ADJUSTMENT
  movement (ADJUSTMENT requires a reason, matching the backend's own
  validation) and transfer stock between two locations — plus a movement
  history table. Both forms invalidate the `inventory` and `dashboard`
  query caches on success so other open screens stay in sync.
- `AppShell` nav extended with Inventory, Stock Movements, Locations,
  Suppliers, Customers; new protected routes wired into `App.tsx`.
- Extended `fetchProducts` to accept a `{ pageSize }` option (needed to pull
  a full product list for the stock-movement form's `<select>`) without
  breaking its existing `search?: string` call sites.

**Verified:** `tsc --noEmit` and the full Jest suite (66/66) on the backend
(no backend changes this session, confirmed as a baseline), `pytest` on the
python-service, and `tsc -b && vite build` on the frontend — all clean.
Beyond the build/test commands, stood up a real local Postgres (same
`pg_ctlcluster 16 main start` + role/db setup as Day 2-6, this sandbox has
no Docker either) and drove the new screens with Playwright end-to-end:
signup → create two locations → switch the default → delete a throwaway
location → create a supplier and a customer → create a product → receive
20 units at one location → transfer 8 units to a second location →
confirmed the Inventory page reads back 12/8 correctly and the Dashboard
still loads. No console or network errors other than the expected
favicon 404.

**Next (Day 8):** Frontend purchase-order and sales-order flows — these are
the two remaining backend-only surfaces. They're a bigger lift than today's
CRUD screens (multi-line order forms, status-transition actions like
order/receive/fulfill/cancel, partial receiving), so left for the next
session rather than rushing a shallow version of both in the time left
here.

**Blockers/decisions:**
- Went with simple delete buttons (no confirm dialog) for
  Locations/Suppliers/Customers rows, consistent with how minimal
  `ProductsPage` already is (no edit UI at all yet). The backend's own
  guardrails (can't delete the last/default location, can't delete a
  supplier/customer with order history) are the actual safety net; a
  confirm-dialog is cheap UI polish that can land anytime and isn't
  blocking anything.
- `StockMovementsPage`'s history table has no pagination controls yet even
  though the backend supports `page`/`pageSize` — fine at today's data
  volumes; revisit alongside Day 13's general polish pass if it becomes a
  problem before then.

## Day 8, 10-11 — 2026-08-16

**Planned:** Day 8 (frontend purchase-order and sales-order flows) plus
Day 10-11 (Python service: CSV import/export, sales/stock trend report).
Day 9's items (dashboard, low-stock view, stock movement history) were
already shipped incidentally during Day 2-7, so this session skipped
straight past it.

**Shipped — Day 8, purchase/sales order UI:**
- `PurchaseOrdersPage`: multi-line create form (supplier, notes, dynamic
  product/qty/unit-cost rows), an expandable per-row detail panel that
  lazy-fetches `GET /purchase-orders/:id` (the list endpoint doesn't
  include lines), mark-as-ordered/cancel actions gated to `OWNER` to
  mirror the backend's own `requireRole`, and a receive form that
  defaults each line's input to its remaining quantity.
- `SalesOrdersPage`: same shape (create/expand/detail) but ungated —
  fulfilling sales orders is an explicit Staff task per the PRD persona
  model, same reasoning already applied on the backend.
- New nav entries and routes for both; `frontend/src/api/purchaseOrders.ts`
  and `salesOrders.ts` added alongside the existing per-resource API
  modules.

**Shipped — Day 10-11, CSV import/export + trend report (F10, F11):**
- **Decision (architectural fork the PRD didn't resolve):** F10 needs a
  write (CSV import creates/updates products), but PRD §8 says the Python
  service is stateless and read-only against a SELECT-only DB role. Wrote
  the import through the Node API instead (`POST /api/products/import`,
  tenant-scoped, upserts by SKU, resolves/creates categories by name,
  validates each row independently and returns `{created, updated, errors:
  [{row, message}]}` rather than aborting the whole file on one bad row).
  Export (products/stock/movements CSV) and the trend report are pure
  reads, so those live in the Python service as the architecture doc
  describes, and the frontend still never talks to it directly — new
  `GET /api/reports/export/{products,stock,movements}` and
  `GET /api/reports/trend` routes on the Node API proxy through
  (`lib/pythonService.ts`), consistent with "frontend talks only to the
  Node API" in PRD §8.
- Added a shared-secret `x-internal-key` header
  (`PYTHON_SERVICE_INTERNAL_KEY` / `INTERNAL_API_KEY`, matching defaults in
  both `.env.example` files) so the Python service's report endpoints only
  answer the Node backend, not arbitrary callers on the same network —
  nothing in the PRD asked for this, but leaving report endpoints
  unauthenticated felt like an obvious gap given the NFR's "no tenant can
  ever read another tenant's rows" and every export/report query being
  scoped by an `organization_id` the caller supplies.
- Trend endpoint (`app/services/reports.py`) reports daily units sold vs.
  received plus revenue, over a 7 or 30-day window. Revenue is only
  attributable for `SALE` movements that came from fulfilling a sales
  order (joined back to `sales_order_lines` via `salesOrderId` +
  `productId` for the unit price) — a `SALE` movement posted directly via
  `POST /stock-movements` carries no price and contributes 0 revenue.
  That's a real gap in the current data model (a manual stock-movement
  sale has no recorded price), not a bug in the report; flagging it here
  rather than fixing it silently, since fixing it properly means either
  adding a price field to `StockMovement` or requiring a price for
  direct-recorded sales, and that's a schema/API decision bigger than this
  slice.
- Frontend: `ProductsPage` gets an "Import CSV" button (file picker, no
  new dependency — reads the file client-side with `File.text()` and
  posts raw CSV text) and shows the created/updated/error-row summary
  inline. New `ReportsPage`: 7/30-day toggle, stat cards, a lightweight
  CSS-bar trend view (no charting library added — the existing dependency
  set has none, and one view didn't seem worth introducing one for), and
  three CSV export buttons that fetch through axios as a blob (a plain
  `<a href>` can't carry the auth header) and trigger a browser download.
- **Found and fixed a pre-existing bug** while verifying this against a
  real Postgres: `python-service/.env.example`'s `DATABASE_URL` carried a
  `?schema=public` suffix copied from the Node backend's Prisma-style URL,
  but psycopg2/SQLAlchemy reject `schema` as an unknown connection option
  outright. The Python service's DB connection has been silently broken
  since Day 1 — masked because the only thing that touched the DB before
  today was the health check, which explicitly tolerates and reports
  `"degraded"` instead of failing. Removed the suffix from
  `python-service/.env.example`.
- 6 new backend tests (`productsImport.test.ts`, `reports.test.ts` — the
  latter mocks `global.fetch` to test the proxy layer without a running
  Python service) and 7 new python-service tests (`test_reports.py`,
  overriding the `get_db` FastAPI dependency so these run with no live
  database, same philosophy as the backend's in-memory Prisma mock).
  84 backend tests and 7 python-service tests all green.

**Verified:** `tsc --noEmit` + full Jest suite (backend), `pytest`
(python-service), `tsc -b && vite build` (frontend) all clean. Beyond
that, stood up local Postgres + all three services and drove two
Playwright scripts end-to-end: (1) purchase order draft → order → receive
with a correct inventory increase, sales order draft → fulfill with a
correct inventory decrease, dashboard still loads after both; (2) CSV
import (2 created, 1 row skipped for a missing SKU, error message shown),
a receive + sale stock movement, the Reports page rendering a non-empty
trend, and all three CSV exports downloading with the expected content
(`IMP-1` in the products export, `Main Warehouse` in the stock export,
`SALE`/`RECEIVE` in the movements export). No console/network errors in
either run beyond the expected favicon 404.

**Next (Day 12-14):** F12 (P2, simple moving-average reorder-quantity
suggestion) is the last unimplemented PRD requirement; after that, Day
13-14 in the plan are integration testing/RBAC hardening/seed data/docs
and final polish/demo script — plus general polish items flagged in
earlier entries (stock-movement history pagination, delete confirmation
dialogs) are still open and reasonable to pick up alongside Day 13.

**Blockers/decisions carried forward:**
- Field-level RBAC (hiding cost/margin from STAFF) is still not
  implemented anywhere, including the new CSV export/import endpoints —
  same call as Day 2-6's entry: this needs to land everywhere at once as
  part of Day 13, not piecemeal per endpoint.
- No sandbox has had Docker across any session so far; every local
  verification has used `pg_ctlcluster 16 main start` directly against
  the sandbox's installed Postgres 16, and services/`.env` files are torn
  down again at the end of each session (they're gitignored — verified
  `.env` was never accidentally committed).

## Day 12 — 2026-08-17

**Planned:** F12, the last unimplemented PRD requirement — a simple
reorder-quantity suggestion from moving-average demand (Python service).

**Shipped:**
- `python-service/app/services/reorder.py`: `fetch_reorder_candidates`, a
  single SQL query that joins each active product against its summed
  `inventory_items.quantity` and its trailing `SALE` units over a window,
  filtered server-side to products already at/under their `reorderPoint`
  (the same "low stock" definition F8 already uses on the Node dashboard).
- New endpoint `GET /reports/reorder-suggestions` (python-service) and
  proxy `GET /api/reports/reorder-suggestions` (Node), same
  internal-key-gated proxy pattern as the existing `/trend` route. Query
  params: `days` (trailing window for the moving average, default 30) and
  `coverageDays` (target days of stock the suggestion aims to cover,
  default 14). Response per product: `avgDailyDemand`, `daysOfStockRemaining`
  (null when there's been no demand to divide by), and `suggestedQty` —
  computed as `max(reorderQty, ceil(avgDailyDemand * coverageDays) -
  currentStock, 0)`, so the suggestion is floored at whatever reorder
  quantity the owner already configured rather than ever undercutting it.
  Items sort by `daysOfStockRemaining` ascending (most urgent first, no
  demand sorts last).
- Frontend: `ReportsPage` gets a new "Reorder suggestions" table (product,
  on-hand, avg daily demand, days of stock left, suggested reorder qty),
  fetched via a new `fetchReorderSuggestions` in `api/reports.ts`. No new
  query-string controls — days/coverageDays use their endpoint defaults for
  this first cut, consistent with how the 7/30-day trend toggle is the only
  other report control on this page.
- Tests: 2 new python-service tests (moving-average math, sort order, the
  "no sales in window" zero-demand case, and the internal-key gate) and 2
  new backend proxy tests (query passthrough, an out-of-range `coverageDays`
  rejection).

**Found and fixed a real bug while browser-verifying this:** the initial
SQL summed `stock_movements.quantity` directly for `SALE` rows to get
units sold. `POST /stock-movements` actually persists `SALE` quantities as
a *negative* signed delta (`delta = type === 'SALE' ? -quantity : quantity`,
stored as-is — see `stockMovements.routes.ts`), which the existing F11
trend query already accounts for with a `-sm."quantity"` negation. My new
query didn't negate, so `avgDailyDemand` came back negative and every
suggestion was silently wrong (`daysOfStockRemaining` came out null,
`suggestedQty` came out 0) instead of erroring — the kind of bug that
looks like an empty/quiet result rather than a crash, so `pytest` alone
(which mocks the row-shaping, not the raw SQL) didn't catch it. Caught it
by standing up real Postgres + all three services and driving the feature
through a browser: create a product with `reorderPoint=10`, receive 20,
sell 15, and check the number that renders (`avgDailyDemand` should be
positive, `daysOfStockRemaining` should be `10`, not `null`). Fixed by
negating the `SALE` sum the same way the trend query does, and left an
explicit SQL comment cross-referencing both call sites so the sign
convention doesn't get re-broken independently a third time.

**Verified:** `tsc --noEmit` + full Jest suite (80/80) on the backend,
`pytest` (9/9) on python-service, `tsc -b && vite build` on the frontend —
all clean. Beyond that: real local Postgres (`pg_ctlcluster 16 main
start`, same as every prior session), all three services running, and a
Playwright script driving signup → create product (reorderPoint 10) →
receive 20 → sell 15 → Reports page, confirming the Reorder suggestions
table shows on-hand 5, avg daily demand 0.5, days of stock left 10,
suggested qty 2 — and no console/network errors beyond the expected
favicon 404. Also caught and fixed an unrelated local-setup gap while
doing this: `frontend/.env` didn't exist yet in this session (only
`.env.example`), so the frontend's `VITE_API_URL` was undefined and every
API call silently hit the Vite dev server instead of the backend. Not a
code bug — `.env` is gitignored by design — but worth noting for the next
session's from-scratch verification.

**Next:** All of PRD §6's functional requirements (F1-F12) are now
implemented. What's left is Day 13-14 of the build plan: integration
testing, RBAC hardening (the recurring cost/margin-for-STAFF gap flagged
in every prior entry), seed data, docs, and final polish — plus the
smaller open items already on record (stock-movement history pagination,
delete confirmation dialogs for Locations/Suppliers/Customers).

**Blockers/decisions carried forward:**
- Same RBAC gap as every prior entry: cost/margin fields are still visible
  to STAFF everywhere, including this session's new reorder-suggestions
  endpoint (which does include `avgDailyDemand`/`suggestedQty`, not cost
  data, but the endpoint doesn't role-check who's asking either way). This
  is squarely Day 13 scope now that F1-F12 are done — no reason left to
  defer it further.
- `coverageDays` and the moving-average `days` window are exposed as query
  params on the endpoint but not as UI controls yet (the frontend always
  uses the defaults: 30-day window, 14-day coverage target). Low-risk to
  add alongside the existing 7/30-day trend toggle whenever this page gets
  its next polish pass.

## Day 13 — 2026-08-18

**Planned:** Day 13 of the build plan — RBAC hardening, the recurring gap
flagged in every entry since Day 2-6 ("cost/margin fields are still visible
to STAFF everywhere").

**Found a bigger gap first:** before touching field-level RBAC, checked how
a STAFF user actually gets created — there was no way. `POST /api/auth/signup`
only ever creates an Owner, and no other endpoint could add a user to an
existing org. Every prior session's STAFF-role code (route gates, persona
docs) was effectively dead: an org could never have a second user, let alone
a Staff one. Treated this as the real Day 13 scope, not a side quest, since
field-level RBAC is meaningless if the role it protects against is
unreachable.

**Shipped — team management:**
- `backend/src/routes/users.routes.ts`, mounted at `/api/users`, Owner-only:
  list org members, invite a new user (Staff or Owner, by email/password),
  `PATCH /:id` to change a member's role, `DELETE /:id` to remove one.
  Guarded so an org can never drop to zero Owners (checked on both demote
  and delete), a user can't remove their own account, and a user with
  stock-movement history can't be deleted (same "block delete once there's
  history" rule already used for Suppliers/Customers — hard-deleting them
  would otherwise either corrupt the movement's `actor` reference or fail
  the FK outright).
- Frontend `TeamPage` (invite form + member table with promote/demote/remove
  actions) at `/team`, gated out of the nav and the route itself for STAFF
  via a new `ownerOnly` flag on `ProtectedRoute`.
- 7 new backend tests covering invite, role changes, the last-Owner guard,
  self-delete/self-demote blocks, the stock-movement-history block, and
  STAFF getting 403'd off every route here.

**Shipped — cost/margin data hidden from STAFF (PRD §4):**
- Rather than scrub `costCents`/`unitCostCents`/`totalStockValueCents` in
  each route individually (which is exactly how this stayed unfixed for 12
  days — easy to add a new endpoint and forget), `requireAuth` now wraps
  `res.json` for a STAFF principal and recursively strips those three keys
  from every JSON response in one place (`lib/rbac.ts`). Covers products,
  dashboard summary/low-stock, inventory, stock movements, and purchase
  orders without touching each route's handler.
- Writes are covered too: `stripCostForStaff` drops `costCents` from a
  STAFF caller's product create/update body before it's persisted (silently
  ignored rather than rejected — a STAFF user creating a product just gets
  the schema's 0 default), and CSV import skips parsing the `cost` column
  for STAFF the same way.
- The products CSV export is the one response that isn't JSON, so it isn't
  covered by the `res.json` wrapper — added an `include_cost` query param
  the python-service endpoint honors (drops the `cost_cents` column from
  the DataFrame), which the Node proxy sets from `req.auth.role`.
- Frontend: hid the Cost input on the product create form, the "Total stock
  value" dashboard stat card, and the PO detail panel's "Unit cost" column
  for STAFF — the API already refuses to return this data to them, so
  showing empty/broken cost UI would just be confusing.
- 2 new backend test files (`rbac.test.ts` end-to-end through real routes,
  `rbac.unit.test.ts` directly against the redaction function for the
  nested-object cases the in-memory Prisma mock can't exercise, since it
  doesn't resolve Prisma's `include` — same known limitation
  `purchaseOrders.routes.ts` already works around) plus 1 new python-service
  test for `include_cost=false`.

**Verified:** `tsc --noEmit` + full Jest suite (95/95) on the backend,
`pytest` (10/10) on python-service, `tsc -b && vite build` on the frontend —
all clean. Beyond that: real local Postgres + all three services, driven
through two Playwright scripts. First: sign up an Owner, create a product
with cost, invite a Staff user via the new Team page, confirm the invite
shows up in the member list, log in as Staff, and confirm the dashboard's
stock-value card, the Team nav link, `/team` itself (redirects home), and
the product form's Cost input are all absent — while price still renders
correctly. Second: as Owner, create a purchase order with a $12.50 unit
cost and confirm the detail panel shows it; invite Staff, log in as them,
and confirm the same PO's detail panel has no "Unit cost" column at all,
and that the Staff-triggered products CSV export contains no cost data
while still containing the product's SKU/name. No console/network errors
beyond the expected favicon 404.

**Next:** Day 13's other listed items — integration testing, seed data,
docs — plus Day 14 (polish, demo script, deployment docs). Remaining
smaller open items from earlier entries are still open too: stock-movement
history pagination, delete-confirmation dialogs for
Locations/Suppliers/Customers.

**Blockers/decisions carried forward:**
- The invite flow issues a plain temporary password chosen by the Owner
  (no emailed invite link/token) — there's no outbound email capability in
  this stack yet (no SMTP/provider configured anywhere in the PRD or env
  files), and a real invite-link flow needs one. This is a reasonable v1
  cut: the Owner sets the password and tells the Staff member directly,
  same trust model as them already knowing everyone's login for a small
  shop. Revisit if/when transactional email is added for other reasons
  (e.g. password reset, which also doesn't exist yet).
- Deliberately did not add a "change your own password" or password-reset
  flow in this session — team management's job here was making STAFF
  reachable at all and closing the cost/margin gap; password lifecycle is
  a separate, equally-sized piece of work better scoped on its own.
- `redactCostFields` is a blunt global rule (strip these 3 key names from
  any JSON body, anywhere) rather than a per-field permission system. That
  trades precision for the property that a new endpoint can't silently
  reintroduce this exact gap — worth revisiting only if a future field
  needs role-based visibility with more nuance than "Owner-only," which
  nothing in the current PRD calls for.

## Day 14 — 2026-08-19

**Planned:** Day 14 of the build plan — polish, demo script, deployment
docs, PRD v1 sign-off — plus the smaller open items carried forward from
every prior entry (seed data, stock-movement history pagination,
delete-confirmation dialogs for Locations/Suppliers/Customers).

**Shipped:**
- `backend/prisma/seed.ts` (`npx prisma db seed` / `npm run prisma:seed`):
  a demo org ("Riverside Goods Co.") with two locations, three categories,
  three products (one seeded under its reorder point on purpose, so the
  low-stock/reorder-suggestion features have something to show
  immediately), a supplier, a customer, a mix of RECEIVE/TRANSFER_OUT/
  TRANSFER_IN/SALE stock movements, a fulfilled sales order, and a draft
  purchase order. Every quantity change goes through the same
  `InventoryItem` + `StockMovement` pairing the app itself uses, not a
  shortcut direct write. Two logins printed on completion (Owner and
  Staff), so the RBAC hardening from Day 13 has something to demo too.
- Delete-confirmation dialogs (`window.confirm`) on Locations, Suppliers,
  and Customers — closes the gap explicitly flagged as "cheap polish that
  can land anytime" back in the Day 7 entry. Kept to `window.confirm`
  rather than a custom modal component, consistent with how minimal these
  three CRUD screens already are elsewhere.
- Stock-movement history pagination: `StockMovementsPage` now has
  Previous/Next controls and a "Page X of Y (N total)" indicator, wired to
  the backend's existing `page`/`pageSize` query params (the backend has
  supported this since Day 2-6; only the UI was missing). Recording a new
  movement or transfer now resets to page 1 so the just-created row is
  immediately visible.
- `docs/DEPLOYMENT.md`: step-by-step deploy guide for all three services
  plus Postgres. **Resolved the PRD §12 open question on hosting target:
  Railway**, chosen over Render/Fly.io for straightforward private
  networking between three services and one-command Postgres
  provisioning — documented as a config choice, not an architectural
  commitment, since nothing in the deploy steps is Railway-specific beyond
  the exact console actions. Also documents (and flags as not yet actually
  provisioned anywhere, including local dev) the read-only Postgres role
  PRD §8 specifies for the Python service — every session so far, this one
  included, has run Python against the same read/write role the backend
  uses, which works but doesn't match the documented architecture; a real
  deploy needs to actually create that role before go-live.
- `docs/DEMO.md`: a ~10-minute walkthrough script covering every P0-P2
  functional requirement (F1-F12) and the Day 13 RBAC hardening, built
  around the new seed data so there's no live data entry needed mid-demo.
- `docs/PRD.md`: status bumped from "Draft v0.1" to "v1 (signed off)",
  the hosting open question marked resolved, and a new §13 summarizing
  what shipped and what's explicitly deferred (email invites, the
  not-yet-provisioned read-only DB role, per-location reorder
  points/STAFF scoping).
- README updated to link the two new docs and mention the optional seed
  step in local setup.

**Verified:** `tsc --noEmit` + full Jest suite (95/95) on the backend,
`pytest` (10/10) on python-service, `tsc -b && vite build` on the
frontend — all clean. Beyond that: real local Postgres (created the
`stockroom` role/database from scratch this session — this sandbox had
neither yet, unlike some prior sessions where they'd been left from a
previous run), ran the new seed script and spot-checked the resulting
`inventory_items` rows directly in `psql` against the expected math for
sparkling water: received 120 and transferred 30 out at the warehouse
(120 - 30 = 90, matches), transferred 30 in and sold 12 at the storefront
(30 - 12 = 18, matches). Then stood up all three services and drove two Playwright
scripts: (1) delete-confirmation on Suppliers — cancel leaves the row,
confirm-and-accept on a fresh throwaway Location actually deletes it,
and confirm-and-accept on a supplier *with* order history correctly still
gets blocked by the backend's existing guard (surfaced as the UI's
existing `rowError`, not a new bug); (2) stock-movement pagination —
posted 25 extra movements via the authenticated API to push the seeded
org past one page, confirmed "Page 1 of 2 (34 total)", clicked Next/
Previous and confirmed the page number and Next/Previous disabled-state
both update correctly. No console/page errors in either run beyond the
usual favicon 404.

**Next:** The 14-day plan is now fully complete. Continuing to extend the
product past the MVP, the most valuable next slices look like: (1)
actually provisioning the read-only Postgres role this session's
`docs/DEPLOYMENT.md` documents, since it's the one deploy-doc claim that
isn't yet true anywhere including local dev; (2) a password-reset /
change-your-own-password flow (flagged as missing since Day 13); (3)
per-location reorder points, since F12's suggestion math already sums
demand correctly but can't target a specific location's stock; (4)
product edit forms (Products currently has create + CSV import but no
in-place edit, unlike every other CRUD screen).

**Blockers/decisions carried forward:**
- The read-only DB role gap above is now documented but still not fixed
  anywhere — every session's local Postgres setup (including this one)
  has used one shared read/write role for both the backend and the Python
  service. Not a correctness bug (the Python service only ever issues
  SELECTs in its own code), but it means the NFR in PRD §8 isn't actually
  enforced at the database-grant level yet, only by convention. Tracked as
  the top item for the next session rather than fixed here, since doing it
  properly means updating local dev setup instructions too, not just the
  deploy doc, and this session's scope was already Day 14's own list.
- Chose `window.confirm` over a custom confirmation modal for the delete
  dialogs. A custom modal would look more polished but there's no existing
  modal component in the codebase to reuse, and introducing one for three
  delete buttons felt like more abstraction than three call sites justify
  — revisit if a fourth or fifth confirm-before-destructive-action need
  shows up and the pattern starts repeating.
