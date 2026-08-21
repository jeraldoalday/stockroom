# StockRoom

Inventory management SaaS for small businesses — multi-location stock
tracking, purchase & sales orders, low-stock alerts, and reporting.

See [`docs/PRD.md`](docs/PRD.md) for the product spec,
[`docs/PROGRESS.md`](docs/PROGRESS.md) for the daily build log,
[`docs/DEMO.md`](docs/DEMO.md) for a guided walkthrough using seed data, and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deploying beyond local dev.

## Stack

- **backend/** — Node.js + TypeScript + Express + Prisma + PostgreSQL (core API, auth, tenant boundary)
- **frontend/** — React + TypeScript + Vite + TanStack Query + Tailwind
- **python-service/** — FastAPI + Pandas (CSV import/export, reports, demand forecasting — read-only against the same database)

## Local development

Requires Node 20+, Python 3.11+, and PostgreSQL 15 (or `docker compose up db`).

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
npx prisma db seed     # optional: loads a demo org, see docs/DEMO.md
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

## Testing

```bash
cd backend && npm test
cd python-service && pytest
```
