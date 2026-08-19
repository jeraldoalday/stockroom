# StockRoom — Demo Script

Day 14 deliverable (PRD §11). A ~10 minute walkthrough covering every P0/P1
functional requirement (F1-F11) plus F12, using the seeded demo org so
there's no dead air waiting on data entry. Run locally (see `README.md`) or
against a deployed environment (`docs/DEPLOYMENT.md`).

## Setup: load demo data

```bash
cd backend
npx prisma migrate deploy   # if not already applied
npx prisma db seed          # runs prisma/seed.ts
```

This creates one organization, **Riverside Goods Co.**, with two locations,
three products (one deliberately under its reorder point), a supplier, a
customer, a draft purchase order, a fulfilled sales order, and a mix of
RECEIVE/TRANSFER/SALE stock movements. Two logins:

| Role  | Email                  | Password    |
|-------|------------------------|-------------|
| Owner | owner@riverside.demo   | demo12345   |
| Staff | staff@riverside.demo   | demo12345   |

`npx prisma db seed` always inserts a fresh org — don't run it twice
against the same database expecting idempotency; it's meant for a
throwaway demo/dev database (see `docs/DEPLOYMENT.md`'s first-boot
checklist for the production-safety note on this).

## Script

**1. Multi-tenant signup (F1, F2)**
Sign up a brand-new account instead of logging into the seed data first —
"every signup gets its own isolated organization" (PRD §3.7). Show that the
new org's dashboard is empty while the seeded org (logged into in a second
tab or after logging out) is not: same code path, hard tenant boundary.

**2. Log in as Owner, tour the dashboard (F9)**
`owner@riverside.demo`. Point out total stock value, active product count,
low-stock count (Dish Soap should already be flagged — it was seeded at 8
units against a reorder point of 10), and the recent-movements feed.

**3. Products & Categories (F3)**
Products page: three SKUs across three categories, cost/price/reorder
fields. Show the CSV export (Reports page) and CSV import (Products page's
"Import CSV" button) round-tripping the same data — this is the
spreadsheet-migration story from PRD §1's problem statement.

**4. Inventory across locations (F3, F4)**
Inventory page, filter by location: Main Warehouse vs. Downtown Storefront
carry different quantities of the same SKUs (the seed transferred stock
between them). This is the "1-5 locations" persona from PRD §2.

**5. Record a stock movement + audit trail (F5)**
Stock Movements page: record a manual ADJUSTMENT (reason required — try
submitting without one to show the validation). Then look at the history
table immediately below — the new row appears at the top with your name as
actor, timestamped. Every quantity change on this page is explained by a
row here; nothing mutates silently (PRD §7's auditability NFR).

**6. Purchase order: draft → ordered → received (F6)**
Purchase Orders page: expand the seeded draft PO for Cascade Wholesale.
Mark it Ordered, then receive it — partially, entering fewer units than
ordered for one line, to show `PARTIALLY_RECEIVED` before completing the
rest to `RECEIVED`. Flip back to the Inventory page to confirm the
warehouse quantity increased.

**7. Sales order: draft → fulfilled with an over-sell guard (F7)**
Sales Orders page: create a new draft order for the Downtown Storefront
selling more Dish Soap than is on hand there. Attempt to fulfill it — show
the rejection (over-sell guard). Then create a normal in-stock order and
fulfill it for real; confirm the Inventory page reflects the decrease.

**8. Reports: trend + reorder suggestions (F11, F12)**
Reports page: toggle the 7-day/30-day sales trend (the seeded sales order
gives it non-zero data). Scroll to "Reorder suggestions" — Dish Soap should
surface near the top with a computed `suggestedQty`, demonstrating the
moving-average demand math over the seeded RECEIVE/SALE history.

**9. Team management + RBAC (Day 13 hardening)**
Team page (Owner-only nav item): the seeded org already has a Staff user.
Log out, log in as `staff@riverside.demo`, and show what's *absent*: no
Team nav link, no cost figures on the product form or dashboard, no "Unit
cost" column on the PO detail panel — while price, quantities, and every
operational action (recording movements, fulfilling orders) still work.
This is PRD §4's persona split made concrete: Staff runs the floor, Owner
sees the financials.

**10. Wrap: multi-tenancy proof**
Switch back to the very first tab (the fresh signup from step 1). Nothing
from Riverside Goods Co. is visible — different organization, same
database, hard isolation by `organizationId` on every query (PRD §7).

## What's intentionally out of scope for this demo

- Payment/billing (PRD §12, deferred to v2).
- Email-based invites — the Team page issues a plain temporary password the
  Owner shares directly (documented decision, `docs/PROGRESS.md` Day 13).
- Per-location reorder points — `reorderPoint` is product-level today
  (documented decision, `docs/PROGRESS.md` Day 2-6).
