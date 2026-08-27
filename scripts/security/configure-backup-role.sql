\set ON_ERROR_STOP on

\if :{?backup_password}
\else
  \echo 'backup_password is required'
  \quit 1
\endif

BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'central_backup') THEN
    CREATE ROLE central_backup LOGIN;
  END IF;
END
$role$;

ALTER ROLE central_backup
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
  NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE central_backup PASSWORD :'backup_password';
ALTER ROLE central_backup SET default_transaction_read_only = on;
ALTER ROLE central_backup SET search_path = pg_catalog, public;

SELECT format('REVOKE ALL ON DATABASE %I FROM central_backup', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO central_backup', current_database())
\gexec

REVOKE ALL ON SCHEMA public, drizzle FROM central_backup;
GRANT USAGE ON SCHEMA public, drizzle TO central_backup;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, drizzle FROM central_backup;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public, drizzle FROM central_backup;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public, drizzle FROM central_backup;

GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO central_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO central_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO central_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO central_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA drizzle
  GRANT SELECT ON TABLES TO central_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA drizzle
  GRANT SELECT ON SEQUENCES TO central_backup;

COMMIT;
