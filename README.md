# StockRoom

Inventory management SaaS for small businesses — multi-location stock
tracking, purchase & sales orders, low-stock alerts, and reporting.

See [`docs/PRD.md`](docs/PRD.md) for the product spec and
[`docs/PROGRESS.md`](docs/PROGRESS.md) for the daily build log.

## Stack

- **backend/** — Node.js + TypeScript + Express + Prisma + PostgreSQL (core API, auth, tenant boundary)
- **frontend/** — React + TypeScript + Vite + TanStack Query + Tailwind
- **python-service/** — FastAPI + Pandas (CSV import/export, reports, demand forecasting — read-only against the same database)

## Local development

Requires Node 20+, Python 3.11+, and PostgreSQL 15 (or `docker compose up db`).

```bash
# 1. Database
docker compose up -d db

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev            # http://localhost:4000

# 3. Frontend
cd frontend
npm install
npm run dev             # http://localhost:5173

# 4. Python service
cd python-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Testing

```bash
cd backend && npm test
cd python-service && pytest
```
