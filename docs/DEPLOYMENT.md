# StockRoom — Deployment Guide

Day 14 deliverable (PRD §11). Resolves the hosting-target open question from
PRD §12: **Railway** for the MVP demo. Rationale: three independent
services (Node API, Python service, Postgres) that all need to reach each
other over a private network, one-command Postgres provisioning, and a free
tier sufficient for a demo/design-partner environment — Render and Fly.io
are equally workable and nothing here is Railway-specific beyond the exact
console steps, so switching later is a config change, not a rearchitecture.

## Prerequisites

- A GitHub remote for this repo (Railway deploys from a connected repo or
  the `railway` CLI).
- Three deployable units: `backend/`, `frontend/`, `python-service/`.
- One PostgreSQL 15+ instance shared by `backend` (read/write) and
  `python-service` (intended to be read-only — see "Database user" below).

## 1. Provision Postgres

Create a Railway Postgres plugin (or any managed Postgres 15+). Note the
connection string — call it `RAW_DATABASE_URL`, e.g.
`postgresql://user:pass@host:5432/railway`.

### Database user

PRD §8 specifies the Python service should run against a SELECT-only DB
role, not the same role the Node API uses to write. Local dev now
provisions this automatically (`db/init/01-create-readonly-role.sql`, run
by `docker compose up -d db` or manually against a non-Docker Postgres —
see the README), but that script's role and password are fixed local-dev
values. For a real deployment, create the role with a real secret instead:

```sql
CREATE ROLE stockroom_readonly LOGIN PASSWORD '<generate-a-strong-password>';
GRANT CONNECT ON DATABASE railway TO stockroom_readonly;
GRANT USAGE ON SCHEMA public TO stockroom_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO stockroom_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE <the role backend/'s DATABASE_URL connects as> IN SCHEMA public
  GRANT SELECT ON TABLES TO stockroom_readonly;
```

Run this once against the provisioned database (Railway's Postgres plugin
exposes a `psql` console in its dashboard) — the `ALTER DEFAULT PRIVILEGES
FOR ROLE` clause matters: it must name the role `backend`'s migrations
actually run as, or tables Prisma creates after this script runs (e.g. via
a future migration) won't be visible to `stockroom_readonly`. Use
`stockroom_readonly`'s connection string for `python-service`'s
`DATABASE_URL` and the full read/write role's for `backend`'s.

## 2. Deploy the backend (Node API)

- Root directory: `backend/`
- Build command: `npm ci && npx prisma generate && npm run build`
- Start command: `npx prisma migrate deploy && npm start`
  (running `migrate deploy` on boot is fine at this scale — it's a no-op
  once migrations are applied, and it means a fresh environment self-inits
  without a manual migration step)
- Environment variables (see `backend/.env.example` for local defaults —
  every value below must be a fresh secret in production, not the example
  file's placeholders):
  - `DATABASE_URL` — the read/write connection string from step 1, with
    `?schema=public` appended (Prisma-specific; see the comment in
    `python-service/.env.example` for why this must NOT be on the Python
    side's URL)
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — long random values,
    different from each other and from any local dev secret
  - `JWT_ACCESS_TTL` (`15m`), `JWT_REFRESH_TTL` (`7d`) — defaults are fine
  - `PORT` — Railway injects this; the app already reads `process.env.PORT`
  - `CORS_ORIGIN` — the deployed frontend's origin (step 4), not
    `localhost`
  - `PYTHON_SERVICE_URL` — the deployed python-service's internal/private
    URL (step 3)
  - `PYTHON_SERVICE_INTERNAL_KEY` — must exactly match
    `INTERNAL_API_KEY` on the python-service deployment (step 3); this is
    the shared secret gating `/reports/*`, not a per-service value

## 3. Deploy the Python service (FastAPI)

- Root directory: `python-service/`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment variables (see `python-service/.env.example`):
  - `DATABASE_URL` — the **read-only** role's connection string, no
    `?schema=` suffix
  - `CORS_ORIGIN` — same frontend origin as the backend's
  - `PORT` — injected by the platform
  - `INTERNAL_API_KEY` — must match `PYTHON_SERVICE_INTERNAL_KEY` above

This service should not be publicly reachable if the platform supports
private networking between services (Railway does, via internal DNS) —
only the backend needs to call it. If a private-network URL isn't
available, the `x-internal-key` check (`require_internal_caller` in
`app/main.py`) is still the actual security boundary, so public exposure
is degraded-but-safe, not broken.

## 4. Deploy the frontend

- Root directory: `frontend/`
- Build command: `npm ci && npm run build`
- Output directory: `dist/`
- Serve as a static site (Railway's static/Nginx buildpack, or any static
  host — Vercel/Netlify/Cloudflare Pages all work fine since this is a pure
  client-rendered SPA with no server-side code).
- Build-time environment variable:
  - `VITE_API_URL` — the deployed backend's public URL + `/api`, e.g.
    `https://stockroom-api.up.railway.app/api`. This is baked into the
    build (Vite inlines `import.meta.env.*` at build time), so it must be
    set before running `npm run build`, and changing it requires a
    rebuild, not just a redeploy.
- SPA routing: configure the host to serve `index.html` for all unmatched
  paths (Railway's static buildpack and most static hosts do this by
  default; add an explicit rewrite rule if not, since React Router owns
  client-side routes like `/products` that don't exist as files).

## 5. First-boot checklist

After all three services are up:

1. Hit the backend's `GET /health` endpoint to confirm it's up and
   reachable.
2. Hit the python-service's `/health` endpoint — it explicitly reports
   `"degraded"` rather than crashing if its DB connection is misconfigured
   (this exact failure mode bit local dev once — a stray `?schema=` on the
   URL — see `docs/PROGRESS.md`'s Day 8/10-11 entry), so a `"degraded"`
   response means the deploy succeeded but the DB grant/URL needs fixing.
3. From the deployed frontend, sign up a real account (F1) and confirm the
   dashboard loads.
4. Optionally load demo data instead of a blank org — see
   `docs/DEMO.md`, which runs `npm run prisma:seed` against whichever
   `DATABASE_URL` is currently configured. Only do this against a demo
   database, never a real customer's, since the seed script always inserts
   a fresh "Riverside Goods Co." org rather than checking for one.

## Rollback

Railway (and Render/Fly) keep prior deploys; redeploying an older build is
a dashboard action, no extra tooling needed. The one stateful risk is a
schema migration: `prisma migrate deploy` only applies forward migrations,
so rolling the backend back to a version that predates a migration will
leave the database ahead of the code. For the MVP's migration count (one,
as of this writing) that's not yet a real risk, but it's the reason to
avoid `prisma migrate dev`'s destructive reset workflow against any shared
environment — `migrate deploy` is the only command that should ever run
outside a developer's own machine.
