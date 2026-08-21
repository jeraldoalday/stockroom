# StockRoom demo script

A 10-minute walkthrough of the v1 MVP against the seeded demo data. Every
number quoted below is real: the seed is deterministic (a fixed PRNG, not
`Math.random()`), so these figures are the same on every machine and will
still be right next month.

## Setup

```bash
docker compose up -d db

cd backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed          # ~15 seconds
npm run dev           # :4000

cd ../python-service
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev           # :5173
```

Two accounts, both password `stockroom123`:

| Account | Role | Use it for |
|---|---|---|
| `owner@northside.test` | Owner | Everything |
| `clerk@northside.test` | Staff | The permissions part of the demo |

`npm run seed` is re-runnable and resets the demo to this exact state. It
only ever deletes the demo organization, so it is safe to run against a
database holding other data.

## What the seed contains

Northside Grocery, a small shop with 60 days of trading behind it:

- 3 locations (Storefront, Back Room, Overflow Warehouse), 6 categories,
  24 products, 4 suppliers, 5 customers
- 1,622 stock movements — 1,417 sales, 194 receipts, 11 adjustments
- 4 purchase orders, one in each status; 4 sales orders covering draft,
  fulfilled and cancelled
- $2,686.00 of stock on hand at cost
- 4 products at or below their reorder point, 20 comfortably stocked

## The walkthrough

### 1. Dashboard — "what do I need to know this morning?" (2 min)

Sign in as **owner@northside.test**.

Three stat cards, then two panels:

- **Total stock value $2,686.00** — quantity on hand × cost, across every
  location. This card is the one Staff never see.
- **Low stock (4)** — the panel below lists them, lowest first: Mature
  Cheddar 400g, Ground Coffee 500g and Mixed Nuts 300g are at zero;
  Laundry Powder 2kg is at 5 against a reorder point of 6.
- **Top movers, last 30 days** — Butter Croissant (281 units), Bananas
  (267), Avocado (255), Whole Milk (229), Salted Crisps (183).

The point to make: the first two panels are problems, the third is what's
working. Together they're the argument for setting a reorder point at all —
a croissant selling 281 units a month is worth never running out of.

### 2. Stock movements — the audit trail (2 min)

Go to **Stock Movements**.

Everything on this screen is derived from immutable movement rows; nothing
ever edits a quantity directly (PRD section 7). Filter by product to
**Butter Croissant** and step through the pages — receipts and sales
alternating as the shop restocks and sells down.

Filter by type to **Adjusted** to find the 11 shrinkage entries: "Damaged in
handling", "Expired — written off". Adjustments are the one movement type
where a reason is mandatory, because they're the only ones with no
document behind them.

Then record one live:

- **Record movement** → Adjustment, quantity `-2`, product *Sourdough
  Loaf*, location *Storefront*, reason "Dropped a tray".
- Submit, and note the row appears at the top with your name in
  **Recorded by**, and that the Inventory and Dashboard figures move with
  it.

Try the same thing with a quantity larger than what's on the shelf — the
API refuses it ("Insufficient stock at this location") rather than letting
stock go negative.

### 3. Purchase orders — receiving (2 min)

Go to **Purchase Orders**. Four orders, one per status.

Open the **Meadowlands Dairy** order (Partially received). Half of each
line has arrived. Receive the rest and watch the status roll to *Received*
and the stock land at the chosen location — a receipt posts real movements,
so the audit trail from step 2 shows them.

The **Corner Street Bakery** order is still a draft: it has no effect on
stock at all until it's marked as ordered and received. That distinction is
what makes "stock on order" different from "stock on hand".

### 4. Reports — the Python service (2 min)

Go to **Reports**. Everything here is computed by the FastAPI service
reading the same database, proxied through the Node API — the browser never
talks to it directly.

- **7 / 30-day trend** — units sold vs received per day. The weekly rhythm
  is visible: weekends materially heavier than midweek.
- **Reorder suggestions** — the four low-stock products, ranked by how soon
  they run out, with a suggested quantity from trailing average daily
  demand over a 14-day coverage target, floored at the product's own
  reorder quantity so a suggestion never undercuts what the owner already
  decided.
- **Export CSV** — products, stock or movements. Worth opening the products
  export in a spreadsheet; it's the same column set the importer accepts,
  which is the "switching from spreadsheets is painless" claim in PRD
  section 3, goal 6.

### 5. Permissions — the Staff view (2 min)

Sign out and back in as **clerk@northside.test**.

Walk the same screens and note what changed:

- The dashboard has no **Total stock value** card.
- Products has no **Cost** column or input.
- The purchase order detail panel has no **Unit cost** column.
- There is no **Team** item in the navigation, and `/team` redirects home.
- The products CSV export downloads without a cost column at all.

The important part is *where* this happens. It is not the UI hiding fields
it received: cost data never reaches a Staff session. Every authenticated
JSON response is stripped of cost keys in one place before it is sent
(`middleware/auth.ts`), so a new endpoint cannot reintroduce the leak by
forgetting to handle it. Check the network tab if the audience is
technical — the fields are simply absent.

Staff can still do the job: record movements, receive stock, fulfil sales
orders. It's margin they can't see.

## If you have five more minutes

- **CSV import round trip.** Export products as the Owner, change a price
  and a reorder point in a spreadsheet, import it back. The importer
  reports created/updated counts and lists bad rows individually rather
  than failing the whole file — a shop's spreadsheet is rarely clean.
- **Archiving.** Archive a product from the Products screen, show it
  disappear from the catalogue, then find it under the **Archived** tab and
  restore it. Try archiving something on an open purchase order and the API
  refuses, because receiving against it would resurrect stock under a SKU
  no list shows.
- **Multi-tenancy.** Sign up a brand-new organization from `/signup`. It
  starts completely empty — same database, no visibility into Northside
  Grocery at all.

## Known gaps, if asked

Be straight about these; they're all in `docs/DEPLOYMENT.md` in more
detail. No password reset or invite emails (an Owner sets a temporary
password directly). Refresh tokens can't be revoked, so signing out clears
the browser but not the token. Rate limiting is per-process and weakens
behind a load balancer. Revenue in the trend report is only attributed for
sales made through a sales order — a SALE recorded directly on the stock
movements screen has no line price to read, and so contributes units but
not revenue.
