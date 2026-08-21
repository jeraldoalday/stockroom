-- Creates the SELECT-only role python-service should connect as (PRD §8).
-- Run once per database. docker-compose mounts this into
-- /docker-entrypoint-initdb.d so it runs automatically on first container
-- init, as the POSTGRES_USER (stockroom) — that's also the role Prisma
-- migrations run as, so the ALTER DEFAULT PRIVILEGES below covers every
-- table Prisma creates later, not just ones that exist at run time.
--
-- Non-Docker local dev (no docker-entrypoint-initdb.d hook): run this
-- manually as a Postgres superuser (creating a role requires CREATEROLE,
-- which the plain `stockroom` app role from backend/.env.example doesn't
-- have), e.g.
--   sudo -u postgres psql -d stockroom -f db/init/01-create-readonly-role.sql
--
-- The password below is a fixed local-dev value, same convention as the
-- other placeholder secrets in backend/.env.example and
-- python-service/.env.example. Production must generate a real one — see
-- docs/DEPLOYMENT.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stockroom_readonly') THEN
    CREATE ROLE stockroom_readonly LOGIN PASSWORD 'stockroom_readonly';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE stockroom TO stockroom_readonly;
GRANT USAGE ON SCHEMA public TO stockroom_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO stockroom_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE stockroom IN SCHEMA public
  GRANT SELECT ON TABLES TO stockroom_readonly;
