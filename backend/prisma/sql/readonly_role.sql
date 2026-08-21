-- Read-only database role for the Python reports service.
--
-- PRD section 8: "Python service — FastAPI + Pandas. Stateless, read-only
-- against the same PostgreSQL database (separate DB user with SELECT-only
-- grants)." That constraint has been architectural intent since Day 1 with
-- nothing enforcing it: both services have been pointed at the same
-- superuser connection string in every .env.example, so "read-only" has
-- been a convention the code happens to follow rather than something the
-- database would refuse to break.
--
-- Run once, as a superuser, against the application database, after the
-- Prisma migrations have created the tables:
--
--   psql "$DATABASE_URL" -v role_password="$(openssl rand -hex 24)" \
--        -f prisma/sql/readonly_role.sql
--
-- Then point python-service's DATABASE_URL at stockroom_readonly.
--
-- Re-runnable: creating the role is guarded, and the GRANTs are idempotent.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockroom_readonly') THEN
    EXECUTE format('CREATE ROLE stockroom_readonly LOGIN PASSWORD %L', :'role_password');
  ELSE
    EXECUTE format('ALTER ROLE stockroom_readonly WITH LOGIN PASSWORD %L', :'role_password');
  END IF;
END
$$;

-- Connect and look, nothing else. Note there is no CREATE on the schema,
-- so the role cannot add tables of its own either.
GRANT CONNECT ON DATABASE CURRENT_CATALOG TO stockroom_readonly;
GRANT USAGE ON SCHEMA public TO stockroom_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO stockroom_readonly;

-- Prisma migrations create new tables as the migration role, and a grant
-- issued today says nothing about a table created next month. This makes
-- the SELECT grant apply to those too, so a future migration can't silently
-- leave the reports service unable to read a new table — or, worse, prompt
-- someone to "fix it" by handing the service the owner's credentials.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO stockroom_readonly;

-- Explicitly withheld, so that a later reader doesn't have to infer it from
-- absence: no INSERT/UPDATE/DELETE, no sequence usage (which would allow
-- generating ids for inserts), and no rights on future functions.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM stockroom_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM stockroom_readonly;
