# StockRoom

Inventory management SaaS for small businesses — multi-location stock
tracking, purchase & sales orders, low-stock alerts, and reporting.

- [`docs/PRD.md`](docs/PRD.md) — product spec
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — daily build log
- [`docs/DEMO.md`](docs/DEMO.md) — 10-minute walkthrough of the seeded demo
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — running it somewhere real, and
  what isn't production-ready yet

## Stack

- **backend/** — Node.js + TypeScript + Express + Prisma + PostgreSQL (core API, auth, tenant boundary)
- **frontend/** — React + TypeScript + Vite + TanStack Query + Tailwind
- **python-service/** — FastAPI + Pandas (CSV import/export, reports, demand forecasting — read-only against the same database)

## Local development

Requires Node 20+, Python 3.9+, and PostgreSQL 15 (or `docker compose up db`).

```bash
# 1. Database
docker compose up -d db
# docker compose runs db/init/01-create-readonly-role.sql automatically on
# first init, creating the SELECT-only stockroom_readonly role the Python
# service connects as (PRD §8). No Docker? Start Postgres yourself, create
# a `stockroom` role/db matching backend/.env.example, then run that SQL
# file as a superuser (creating a role needs CREATEROLE, which the plain
# `stockroom` app role doesn't have):
#   sudo -u postgres psql -d stockroom -f db/init/01-create-readonly-role.sql

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run seed           # optional: demo org with 60 days of history
                       # (`npx prisma db seed` runs the same script)
npm run dev            # http://localhost:4000

# 3. Frontend
cd frontend
npm install
npm run dev             # http://localhost:5173

# 4. Python service
cd python-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # DATABASE_URL here uses stockroom_readonly, not stockroom
uvicorn app.main:app --reload --port 8000
```

## Demo data

`cd backend && npm run seed` creates "Northside Grocery" — 24 products, 3
locations, 60 days of stock movements, and purchase/sales orders in every
status. Sign in as `owner@northside.test` or `clerk@northside.test`,
password `stockroom123`. See [`docs/DEMO.md`](docs/DEMO.md).

It is re-runnable and only ever deletes the demo organization, so it is safe
against a database holding other data. Don't point it at production
regardless — it writes fake products into whatever it can reach.

## Checks

Everything CI runs, runnable locally:

```bash
cd backend
npm run typecheck      # includes prisma/seed.ts, which the build config skips
npm run lint
npm test

cd ../python-service
pytest

cd ../frontend
npm run lint
npm run build          # type-checks as part of the build
```

`python-service` runs on Python 3.9+ (CI pins 3.11). Keep its route
signatures on `Optional[X]` rather than `X | None`: FastAPI resolves
parameter annotations at runtime to build the request model, so PEP 604
unions raise at import time on older interpreters — and `from __future__
import annotations` does not save you, which is what makes it a trap.
