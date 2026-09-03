# StockRoom demo script

A 15-minute walkthrough of the v1 MVP, plus the post-v1 features, against
the seeded demo data. It was 10 minutes at v1 sign-off and has grown with
what shipped since; the section timings below are per-step, so drop step 4
or step 8 if you have less time than that. Every
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
  26 products, 4 suppliers, 5 customers
- 1,640 stock movements — 1,422 sales, 196 receipts, 22 adjustments (3 of
  those posted by a completed stocktake)
- 4 purchase orders, one in each status; 4 sales orders covering draft,
  fulfilled and cancelled
- 2 stocktakes: a completed Storefront count from 6 days ago, and a Back
  Room count still in progress
- $2,736.35 of stock on hand at cost
- 4 products at or below their reorder point, 22 comfortably stocked; two of
  those 22 have never sold a single unit, which is what the dead-stock
  report is for

## The walkthrough

### 1. Dashboard — "what do I need to know this morning?" (F8, F9) (2 min)

Sign in as **owner@northside.test**.

Three stat cards, then two panels:

- **Total stock value $2,736.35** — quantity on hand × cost, across every
  location. This card is the one Staff never see.
- **Low stock (4)** — the panel below lists them, lowest first: Mature
  Cheddar 400g, Ground Coffee 500g, Laundry Powder 2kg and Mixed Nuts 300g
  have all run to zero.
- **Top movers, last 30 days** — Butter Croissant (288 units), Bananas
  (286), Avocado (257), Free Range Eggs (204), Whole Milk (200).

The point to make: the first two panels are problems, the third is what's
working. Together they're the argument for setting a reorder point at all —
a croissant selling 288 units a month is worth never running out of.

### 2. Stock movements — the audit trail (F4, F5) (2 min)

Go to **Stock Movements**.

Everything on this screen is derived from immutable movement rows; nothing
ever edits a quantity directly (PRD section 7). Filter by product to
**Butter Croissant** and step through the pages — receipts and sales
alternating as the shop restocks and sells down.

Filter by type to **Adjusted** to find the 22 entries: 11 "Damaged in
handling", 8 "Expired — written off", and 3 tagged **Stock count** — those
last three came from the stocktake in step 4 rather than from anyone
editing stock by hand. Adjustments are the one movement type where a
reason is mandatory, because they're the only ones with no document behind
them; a count supplies its own.

Then record one live:

- **Record movement** → Adjustment, quantity `-2`, product *Sourdough
  Loaf*, location *Storefront*, reason "Dropped a tray".
- Submit, and note the row appears at the top with your name in
  **Recorded by**, and that the Inventory and Dashboard figures move with
  it.

Try the same thing with a quantity larger than what's on the shelf — the
API refuses it ("Insufficient stock at this location") rather than letting
stock go negative.

### 3. Purchase orders — receiving (F6) (2 min)

Go to **Purchase Orders**. Four orders, one per status.

Open the **Meadowlands Dairy** order (Partially received). Half of each
line has arrived. Receive the rest and watch the status roll to *Received*
and the stock land at the chosen location — a receipt posts real movements,
so the audit trail from step 2 shows them.

The **Corner Street Bakery** order is still a draft: it has no effect on
stock at all until it's marked as ordered and received. That distinction is
what makes "stock on order" different from "stock on hand".

### 4. Stocktakes — counting the shelf (F15) (3 min)

Go to **Stocktakes**. Two counts, and they show the two halves of the
feature.

The **Storefront** count under *Completed* is finished. Open its sheet: the
expected column is what the ledger believed when the sheet was generated,
the counted column is what somebody actually found, and the variance column
is what was posted. Three units of bananas and two croissants had gone
missing; one line agreed exactly and says **Matches** rather than showing a
bare zero; one line found four more units than the system thought existed.
The last line was never counted at all, and reads **Not counted** — nothing
was done to that product's stock.

That distinction is the one to dwell on. "Counted zero" writes the shelf
down to empty; "not counted" leaves it entirely alone. A half-finished
count sheet is the normal state of a real one, and treating a blank as a
zero would be catastrophic rather than merely wrong.

The **Back Room** count under *In progress* is live. Type a figure into a
box and tab out — it saves on blur, and the variance appears immediately.
Clear the box again and it goes back to *Not counted*, not to zero. Use
**Found something not on the sheet?** to add a product the sheet never
listed, which is how goods sitting somewhere the ledger thinks is empty
get recorded at all.

Then **Complete count and adjust stock**. The banner reports what it did —
lines counted, lines corrected, units found and lost — and Inventory and
the Dashboard move with it. Go back to Stock Movements and the corrections
are there, tagged **Stock count**, each one an ordinary immutable movement
row like everything else in this system.

Two things to try if asked:

- Start a second count for the same location while one is open. The API
  refuses it: two sheets for one room means two people writing different
  numbers for the same shelf, and whichever is completed second silently
  overwrites the first.
- Sign in as the clerk (step 6). Staff can start a count and fill it in —
  it is warehouse work — but the Complete button is not there. Applying a
  count is when shrinkage hits stock value.

### 5. Reports — the Python service (F10, F11, F12, F13) (2 min)

Go to **Reports**. Everything here is computed by the FastAPI service
reading the same database, proxied through the Node API — the browser never
talks to it directly.

- **7 / 30-day trend** — units sold vs received per day, with revenue. Over
  30 days: 3,401 units and $12,944.85. The weekly rhythm is visible —
  weekends materially heavier than midweek. Every seeded sale carries the
  price it went out at, which is what makes the revenue line real rather
  than flat zero.
- **Reorder suggestions** — the four low-stock products, ranked by how soon
  they run out, with a suggested quantity from trailing average daily
  demand over a 14-day coverage target, floored at the product's own
  reorder quantity so a suggestion never undercuts what the owner already
  decided.
- **Dead stock** — the mirror image of the reorder report, and the one that
  usually lands: Novelty Gift Hamper and Sugar-Free Liquorice, $253.20 of
  stock that has never sold a unit. Reorder suggestions say what to buy;
  this says what not to buy again. Owner-only, because every column on it
  is a cost figure.
- **Export CSV** — products, stock or movements. Worth opening the products
  export in a spreadsheet; it's the same column set the importer accepts,
  which is the "switching from spreadsheets is painless" claim in PRD
  section 3, goal 6.

### 6. Permissions — the Staff view (F2) (2 min)

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

### 7. Sales orders — the over-sell guard (F7) (1 min)

Go to **Sales Orders** and create a draft for the Storefront selling more
Mature Cheddar than is on hand there — it's one of the stocked-out products
from step 1. Try to fulfil it: the API refuses. Stock can only leave a
location that has it, and the guard lives in the same transaction as the
movement, so there is no window in which the order succeeds and the stock
goes negative.

Then fulfil a normal in-stock order and watch Inventory drop by exactly the
line quantity.

### 8. Multi-tenancy — the boundary (F1) (1 min)

Sign up a brand-new organization from `/signup` in a second tab. Its
dashboard is completely empty while Northside Grocery, still open in the
first tab, is not — same database, same code path, hard isolation by
`organizationId` on every query (PRD §7). This is the claim in §3 goal 7,
and it's the one worth demonstrating rather than asserting.

## If you have five more minutes

- **CSV import round trip.** Export products as the Owner, change a price
  and a reorder point in a spreadsheet, import it back. The importer
  reports created/updated counts and lists bad rows individually rather
  than failing the whole file — a shop's spreadsheet is rarely clean.
- **Archiving.** Archive a product from the Products screen, show it
  disappear from the catalogue, then find it under the **Archived** tab and
  restore it. Try archiving something on an open purchase order and the API
  refuses, because receiving against it would resurrect stock under a SKU
  no list shows. Locations, suppliers and customers archive the same way —
  archive the Overflow Warehouse (it is empty) and watch it drop out of
  every location picker on the movements and orders screens.
- **Signed-in devices.** On **Account**, the session list shows every
  browser signed into that account, with the one you are using labelled.
  Sign in from a private window, refresh the list, and end that session
  from here — the private window is signed out on its next request. This is
  the answer to "I signed in on the machine at the shop and I'm not there
  any more", which until now needed a password change to fix.
- **Inviting a Staff member.** As the Owner, go to **Team** and invite
  someone by name and email — notice there's no password field. The account
  is created locked; nobody, including the Owner, ever sees a credential for
  it. With no `SMTP_HOST` configured, the invite link is logged to the
  backend's console instead of emailed — open it, and the page reads "Welcome
  to StockRoom — set your password" rather than the reset-flavored copy,
  since the backend and the page treat an invite and a password reset as the
  same action ("prove you hold this link, choose a password") wearing
  different words. Signing in with a guessed password before the link is
  used gets a plain 401: the account is genuinely locked, not just missing a
  UI to set a password from.

## Intentionally out of scope for this demo

- Payment and billing (PRD §12, deferred to v2).
- Per-location reorder points — `reorderPoint` is product-level today
  (decision recorded in `docs/PROGRESS.md`, Day 2-6).

## Known gaps, if asked

Be straight about these; they're all in `docs/DEPLOYMENT.md` in more
detail. Forgot-password and Team invites both work end to end through the
same emailed one-time link (`lib/email.ts`), and the sender is now a real
SMTP client — set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (any
provider that speaks SMTP: SendGrid, Postmark, SES, Mailgun, ...) to send
for real. Left unset — as in this demo sandbox, with no provider
configured — it falls back to logging the link to the server console, so
both flows still work end to end for a demo, just by reading the link out
of the log instead of an inbox. Signing out and any password change now
revoke the session
server-side, though an already-issued access token stays valid for up to
15 minutes. Rate limiting keeps its counters in Postgres now rather than a
per-process Map, so it holds up behind a load balancer. Expired token and
rate-limit rows are swept on a timer inside the API process; that's still
per-process, so two instances both sweep redundantly (harmless, since a
delete on an already-gone row is a no-op) until it moves to a cron job
running `npm run prune:tokens`.
