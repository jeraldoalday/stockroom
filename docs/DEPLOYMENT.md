# Deploying StockRoom

Status: written for the v1 MVP (Day 14). This describes how to run the
three services somewhere other than a laptop, and — just as importantly —
what is *not* production-ready yet, so nobody has to discover it during an
incident.

## 1. What you are deploying

Three processes and one database:

| Component | Process | Public? |
|---|---|---|
| `backend/` | Node 20, `npm run build` then `npm start` | Yes — the browser talks only to this |
| `frontend/` | Static files from `npm run build` (`dist/`) | Yes — any static host or CDN |
| `python-service/` | `uvicorn app.main:app` | **No** — internal only |
| PostgreSQL 15 | managed or self-hosted | No |

The Python service must not be reachable from the internet. It is
authenticated by a single shared header key (`x-internal-key`), which is
adequate for service-to-service traffic inside a private network and is not
adequate for anything else — it has no per-tenant authorization of its own
and will read any organization's data for whoever asks with the right key.
Bind it to a private interface or put it behind the same network boundary
as the database.

## 2. Environment variables

### backend

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Prisma connection string. Keep the `?schema=public` suffix. |
| `JWT_ACCESS_SECRET` | yes | Generate per environment: `openssl rand -hex 32`. |
| `JWT_REFRESH_SECRET` | yes | **Must differ from the access secret.** They are separate keys so that a leaked access secret can't be used to mint 7-day refresh tokens. |
| `JWT_ACCESS_TTL` | no (`15m`) | Short by design; the frontend refreshes transparently. |
| `JWT_REFRESH_TTL` | no (`7d`) | How long a signed-out-of-nowhere session lasts. |
| `PORT` | no (`4000`) | |
| `CORS_ORIGIN` | yes in production | The exact frontend origin. The default is `http://localhost:5173`; leaving it there in production means the browser blocks every request. |
| `PYTHON_SERVICE_URL` | yes | Private address of the reports service. |
| `PYTHON_SERVICE_INTERNAL_KEY` | yes | Must match the Python service's `INTERNAL_API_KEY`. |
| `NODE_ENV` | yes | Set to `production`. |

The backend refuses to start if `DATABASE_URL`, `JWT_ACCESS_SECRET` or
`JWT_REFRESH_SECRET` is missing (`src/lib/env.ts`), which is deliberate:
failing at boot is better than serving traffic with a default secret.

`PYTHON_SERVICE_INTERNAL_KEY` and `INTERNAL_API_KEY` both default to
`dev-internal-key`. Both defaults must be replaced. If only one is, every
report and CSV export returns 502.

### python-service

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | **No `?schema=` suffix** — that is a Prisma convention and psycopg2 rejects it as an unknown connection option. Point this at the read-only role (below). |
| `INTERNAL_API_KEY` | yes | Must match the backend's `PYTHON_SERVICE_INTERNAL_KEY`. |
| `CORS_ORIGIN` | no | Only matters if this service is ever called from a browser, which it should not be. |
| `PORT` | no (`8000`) | |

### frontend

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | Absolute URL of the backend API, including `/api`. |

Vite inlines this at build time, not at runtime. A container image built
for staging has the staging URL baked into its JavaScript — you cannot
promote the same artifact to production by changing an environment
variable. Build once per environment.

## 3. Database setup

```bash
cd backend
npx prisma migrate deploy        # NOT `migrate dev` — see below
```

Use `migrate deploy` in every non-development environment. `migrate dev` is
interactive, will offer to reset the database when it sees drift, and
generates new migration files — none of which you want on a machine holding
real data.

### Read-only role for the reports service

PRD section 8 specifies a separate SELECT-only database user for the Python
service. Create it once, after the migrations have run:

```bash
psql "$DATABASE_URL" \
  -v role_password="$(openssl rand -hex 24)" \
  -f backend/prisma/sql/readonly_role.sql
```

Then point python-service's `DATABASE_URL` at `stockroom_readonly`.

This matters more than it looks. The Python service builds SQL against the
same multi-tenant tables the API owns, and its queries are the only place in
the system where the tenant filter is written by hand rather than enforced
by middleware. A read-only role means the worst case of a mistake there is
reading the wrong rows, not writing them.

The script also sets `ALTER DEFAULT PRIVILEGES`, so tables created by future
migrations are readable too. Without that, the next migration would leave
the reports service unable to read a new table — and the tempting fix is to
hand it the owner's credentials.

### Seed data

`npm run seed` creates the "Northside Grocery" demo organization. It is for
demos and manual testing. Do not run it against production: it is harmless
to real data (it only ever deletes the demo org it created) but it puts
fake products and 60 days of fake movements into your customers' database.

## 4. Deploy order

Order matters on the first deploy, and on any deploy carrying a migration:

1. **Migrate** — `npx prisma migrate deploy`.
2. **python-service** — it only reads; starting it against a migrated
   database is safe.
3. **backend** — with `PYTHON_SERVICE_URL` pointing at step 2. If the
   reports service is down, `/api/reports/*` returns 503 and every other
   endpoint keeps working; that degradation is intentional.
4. **frontend** — built against the backend's public URL.

## 5. Health checks

- `GET /health` on the backend returns `{"status":"ok"}`. It does not touch
  the database, so it answers "is the process up", not "can it serve
  traffic". Fine as a liveness probe; not sufficient as a readiness probe.
- `GET /health` on the python-service *does* run `SELECT 1` and reports
  `degraded` with `"database":"unreachable"` when that fails — but still
  returns HTTP 200. A platform that only looks at the status code will
  consider a database-less reports service healthy. Check the body.

## 6. Known limitations before you scale out

These are real and currently unaddressed. They are listed here rather than
in an issue tracker because each one silently changes behaviour when you
add a second instance.

- **Rate limiting is per-process.** The login and signup limiters
  (`src/lib/rateLimit.ts`) keep counters in an in-memory Map. Two API
  instances behind a load balancer means an attacker gets 2× the attempts,
  and counters reset on every deploy. This is an accepted trade for a
  single-container MVP; moving to more than one instance means moving the
  counters to Redis or the database first.
- **Refresh tokens are not rotated or revocable.** A refresh token is valid
  for its full 7 days, `/api/auth/refresh` does not issue a new one, and
  there is no server-side token store — so signing out clears the browser
  but does not invalidate anything. A stolen refresh token works until it
  expires. Rotation needs server-side state that this build does not have.
- **No password reset and no email.** There is no SMTP or provider
  configuration anywhere in the stack. Adding a staff member means an Owner
  choosing a temporary password and telling them directly. A user who
  forgets their password needs an Owner or a database change.
- **Dashboard aggregates run in application code.** `/api/dashboard/summary`
  and `/top-movers` fetch rows and sum them in JavaScript rather than using
  SQL aggregates, because the in-memory test client has no `groupBy`. The
  NFR target is 10k SKUs and this is fine there; past that, move them to
  SQL before adding more instances, because each instance is doing the whole
  computation.
- **No structured logging, metrics or error reporting.** Errors go to
  `console.error` and unhandled 500s carry no request id, so a production
  failure is only diagnosable if you happen to be tailing the logs.
- **No backups configured.** The `docker-compose.yml` in this repository is
  for local development: its Postgres has no backup, no WAL archiving and
  default credentials. Use a managed database in production.

## 7. Local production-like run

To check a build the way it will actually run, rather than through the Vite
dev server:

```bash
docker compose up -d db

cd backend
npx prisma migrate deploy
npm run build
NODE_ENV=production npm start

cd ../python-service
source .venv/bin/activate
uvicorn app.main:app --port 8000

cd ../frontend
npm run build
npm run preview          # serves dist/ on http://localhost:4173
```

Set `CORS_ORIGIN=http://localhost:4173` for the backend and
`VITE_API_URL=http://localhost:4000/api` before the frontend build,
otherwise the preview server's requests are blocked by CORS — which is the
same class of misconfiguration as pointing a real deployment at the wrong
origin, and worth seeing once locally.

## 8. Deploying to Railway

Day 14 deliverable (PRD §11). Resolves the hosting-target open question from
PRD §12: **Railway** for the MVP demo. Rationale: three independent
services (Node API, Python service, Postgres) that all need to reach each
other over a private network, one-command Postgres provisioning, and a free
tier sufficient for a demo/design-partner environment — Render and Fly.io
are equally workable and nothing here is Railway-specific beyond the exact
console steps, so switching later is a config change, not a rearchitecture.

### Prerequisites

- A GitHub remote for this repo (Railway deploys from a connected repo or
  the `railway` CLI).
- Three deployable units: `backend/`, `frontend/`, `python-service/`.
- One PostgreSQL 15+ instance shared by `backend` (read/write) and
  `python-service` (read-only — see §3).

Create a Railway Postgres plugin (or any managed Postgres 15+) and note the
connection string. Then create the read-only role as described in §3, using
`backend/prisma/sql/readonly_role.sql` rather than the fixed local-dev
credentials in `db/init/01-create-readonly-role.sql`.

### Deploy the backend (Node API)

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

### Deploy the Python service (FastAPI)

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

### Deploy the frontend

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

## 9. First-boot checklist

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
4. Optionally load demo data instead of a blank org — see `docs/DEMO.md`,
   which runs `npm run seed` against whichever `DATABASE_URL` is currently
   configured. The seed is idempotent and scoped to the demo organization
   by name, so re-running it resets the demo rather than stacking a second
   copy, and it will not touch a real signup. Still only point it at a demo
   database: it writes fake products and 60 days of fake movements into
   whatever it can reach.

## 10. Rollback

Railway (and Render/Fly) keep prior deploys; redeploying an older build is
a dashboard action, no extra tooling needed. The one stateful risk is a
schema migration: `prisma migrate deploy` only applies forward migrations,
so rolling the backend back to a version that predates a migration will
leave the database ahead of the code. For the MVP's migration count (one,
as of this writing) that's not yet a real risk, but it's the reason to
avoid `prisma migrate dev`'s destructive reset workflow against any shared
environment — `migrate deploy` is the only command that should ever run
outside a developer's own machine.
