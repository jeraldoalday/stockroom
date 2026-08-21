# StockRoom — Product Requirements Document

**Status:** v1 (signed off) · **Owner:** Jeraldo Alday · **Last updated:** 2026-08-19

## 1. Problem

Small and medium businesses (retail shops, cafes, small distributors, home-based
sellers with 1-5 locations) run inventory on spreadsheets or paper. They lose
sales to stockouts, tie up cash in overstock, and have no visibility into which
products actually move. Existing inventory SaaS (Zoho Inventory, inFlow,
Cin7) is priced and featured for mid-market, not for a single shop with one
part-time bookkeeper.

## 2. Target customer

- Independent retail/grocery shops, small cafes, boutique e-commerce sellers.
- 1-5 staff, 1-3 physical locations or a single warehouse + storefront.
- Currently uses Excel/Google Sheets or a point-of-sale system with no real
  inventory intelligence.
- Willing to pay $15-$79/month for something that "just works."

## 3. Goals (v1 / MVP, 14-day build)

1. Track products and stock levels accurately across one or more locations.
2. Record stock movements (receiving, sales, transfers, adjustments) with a
   full audit trail.
3. Alert on low stock before it becomes a stockout.
4. Support purchase orders (supplier → stock in) and sales orders (stock out).
5. Give the owner a dashboard: stock value, low-stock items, top movers.
6. Export/import via CSV so switching from spreadsheets is painless.
7. Multi-tenant from day one (each signup gets an isolated organization).

### Non-goals for v1

- POS/payment processing, barcode hardware integration, accounting
  (QuickBooks/Xero) sync, native mobile apps, multi-currency.
  These are v2+ candidates once there's a paying customer validating v1.

## 4. Personas

- **Owner/Admin** — sets up the org, invites staff, views financial reports,
  manages suppliers and purchase orders.
- **Staff/Clerk** — receives stock, fulfills sales orders, performs stock
  counts/adjustments. No access to cost/margin data by default.

## 5. Core domain model

```
Organization (tenant)
 ├─ User (role: OWNER | STAFF)
 ├─ Location (warehouse / storefront)
 ├─ Category
 ├─ Supplier
 ├─ Product (SKU, name, category, cost, price, reorder point/qty)
 │   └─ InventoryItem (product × location → quantity on hand)
 ├─ StockMovement (product, location, type, qty, reason, actor, timestamp)
 ├─ PurchaseOrder → PurchaseOrderLine (supplier → stock IN)
 ├─ Customer
 └─ SalesOrder → SalesOrderLine (customer → stock OUT)
```

Every table below `Organization` is tenant-scoped; all queries are filtered
by `organizationId` at the middleware layer, never trusted from the client.

## 6. Functional requirements — MVP

| # | Requirement | Priority |
|---|---|---|
| F1 | Email/password signup creates a new Organization + Owner user | P0 |
| F2 | JWT auth, role-based access (OWNER vs STAFF) | P0 |
| F3 | CRUD: Products, Categories, Locations, Suppliers, Customers | P0 |
| F4 | Stock levels per product per location, auto-derived from movements | P0 |
| F5 | Manual stock adjustment with required reason code | P0 |
| F6 | Purchase orders: draft → ordered → received (partial receiving allowed) | P0 |
| F7 | Sales orders: draft → fulfilled (decrements stock, blocks over-sell) | P0 |
| F8 | Low-stock alert list (qty ≤ reorder point) | P0 |
| F9 | Dashboard: total stock value, low-stock count, recent movements | P0 |
| F10 | CSV import (products) and CSV export (products, stock, movements) | P1 |
| F11 | Basic sales/stock report (Python service) with 7/30-day trend | P1 |
| F12 | Simple reorder-quantity suggestion (moving-average demand) | P2 |

## 7. Non-functional requirements

- **Multi-tenancy:** hard isolation by `organizationId`; no tenant can ever
  read another tenant's rows.
- **Auditability:** every stock change is an immutable `StockMovement` row;
  quantity-on-hand is never edited directly.
- **Performance:** P95 API response < 300ms for lists up to 10k SKUs.
- **Security:** bcrypt-hashed passwords, JWT short-lived access + refresh
  token, input validation on every mutating endpoint (Zod/Pydantic).
- **Portability:** runs locally via `docker-compose up`; no cloud lock-in
  for the MVP.

## 8. System architecture

- **Backend API** — Node.js + TypeScript + Express + Prisma ORM +
  PostgreSQL. Owns all writes, auth, and the tenant boundary.
- **Frontend** — React + TypeScript + Vite + TanStack Query + Tailwind.
  Talks only to the Node API.
- **Python service** — FastAPI + Pandas. Stateless, read-only against the
  same PostgreSQL database (separate DB user with SELECT-only grants).
  Owns CSV/report generation and demand-forecast math — jobs that are
  naturally data-science-shaped and better expressed in Python than in
  the Node API.
- **Datastore** — PostgreSQL 15, one schema, `organization_id` on every
  tenant-scoped table.

```
React (Vite)  ─▶  Node/Express API  ─▶  PostgreSQL
                        ▲                    ▲
                        │ internal call      │ read-only
                        └───────── Python/FastAPI (reports, forecasts)
```

## 9. Pricing (draft, for later commercialization)

| Tier | Price | Limits |
|---|---|---|
| Starter | $15/mo | 1 location, 500 SKUs, 2 users |
| Growth | $39/mo | 3 locations, 5,000 SKUs, 10 users |
| Pro | $79/mo | Unlimited locations/SKUs, 25 users, CSV + reports |

## 10. Success metrics (post-launch)

- Time-to-first-value: user creates first product + records first stock
  movement within 10 minutes of signup.
- ≥ 30% of signups record a purchase order or sales order in week 1.
- < 2% monthly churn once past 10 paying customers.

## 11. 14-day build plan

| Day | Focus |
|---|---|
| 1 | Repo scaffold, PRD, DB schema, auth (F1/F2), Products/Categories CRUD |
| 2 | Locations, Suppliers, Customers CRUD; InventoryItem model + stock query |
| 3 | StockMovement engine (receive/sell/transfer/adjust), audit trail |
| 4 | Purchase orders: draft → ordered → received, partial receiving |
| 5 | Sales orders: draft → fulfilled, over-sell guard |
| 6 | Low-stock alerts, dashboard aggregate endpoints |
| 7 | Frontend: auth pages, app shell, products & inventory screens |
| 8 | Frontend: purchase order & sales order flows |
| 9 | Frontend: dashboard, low-stock view, stock movement history |
| 10 | Python service: CSV import/export |
| 11 | Python service: sales/stock trend report |
| 12 | Python service: reorder-quantity suggestion (moving average) |
| 13 | Integration testing, RBAC hardening, seed data, docs |
| 14 | Polish, demo script, deployment docs, PRD v1 sign-off |

This plan is the seed for the daily autonomous build loop; each day's
session updates `docs/PROGRESS.md` with what shipped and what's next.

## 12. Open questions

- Payment processing / billing provider (Stripe likely) — deferred to v2.
- ~~Hosting target (Railway/Render/Fly.io for MVP demo) — decide by day
  12.~~ **Resolved (Day 14):** Railway, documented in `docs/DEPLOYMENT.md`.
  Decided later than the original "by day 12" target since deployment
  wasn't the critical path while F1-F12 were still landing; nothing in the
  build depended on this choice until the demo/deploy step itself.
- Whether STAFF role needs per-location scoping — revisit after first
  design partner feedback. Still open; not needed for any MVP requirement.

## 13. v1 sign-off (Day 14)

All P0/P1 functional requirements (F1-F11) and the P2 stretch requirement
(F12) are implemented and covered by automated tests (95 backend, 10
python-service) plus manual browser verification every build session. RBAC
(F2's OWNER/STAFF split, including field-level cost/margin redaction per
§4) is enforced end-to-end, not just on paper. See `docs/PROGRESS.md` for
the full day-by-day build log and every architectural decision made along
the way, and `docs/DEMO.md` for a walkthrough exercising every requirement
against seeded data.

Known gaps carried into v1, none blocking for a design-partner pilot:
- No real transactional email provider is configured — forgot-password
  (post-Day-15) works end-to-end against a pluggable `EmailSender`
  interface, but the shipped implementation just logs the reset link to
  the server console rather than actually emailing it, and the Team page's
  invite flow still uses an Owner-set temporary password rather than an
  emailed invite link. Both are one `EmailSender` implementation away from
  the real thing once a provider (SendGrid/Postmark/SES/...) is picked.
- The Python service's DB role is documented as read-only
  (`docs/DEPLOYMENT.md`) and, as of post-Day-15, actually is in local dev
  too (`db/init/01-create-readonly-role.sql`) — a production deploy still
  needs to create the restricted role there per that doc.
- Per-location reorder points, per-location STAFF scoping: both explicitly
  deferred (§12).
