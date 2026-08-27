\set ON_ERROR_STOP on

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'central_runtime') THEN
    CREATE ROLE central_runtime NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'central_migrator') THEN
    CREATE ROLE central_migrator NOLOGIN;
  END IF;
END
$roles$;

ALTER ROLE central_runtime
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE central_migrator
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

SELECT format('GRANT CONNECT ON DATABASE %I TO central_runtime, central_migrator', current_database())
\gexec
SELECT format('GRANT CREATE ON DATABASE %I TO central_migrator', current_database())
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC, central_runtime;
GRANT USAGE ON SCHEMA public TO central_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO central_migrator;

ALTER SCHEMA drizzle OWNER TO central_migrator;
GRANT USAGE, CREATE ON SCHEMA drizzle TO central_migrator;
REVOKE ALL ON SCHEMA drizzle FROM central_runtime;

DO $ownership$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT c.oid::regclass AS identity, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND pg_get_userbyid(c.relowner) <> 'central_migrator'
  LOOP
    EXECUTE format(
      'ALTER %s %s OWNER TO central_migrator',
      CASE object.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      object.identity
    );
  END LOOP;

  -- Identity/serial sequences follow their table owner automatically. Query
  -- sequences only after the table pass so linked sequences are not altered
  -- independently (which PostgreSQL rejects).
  FOR object IN
    SELECT c.oid::regclass AS identity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'drizzle')
      AND c.relkind = 'S'
      AND pg_get_userbyid(c.relowner) <> 'central_migrator'
  LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO central_migrator', object.identity);
  END LOOP;

  FOR object IN
    SELECT p.oid::regprocedure AS identity
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
      ON d.classid = 'pg_proc'::regclass
     AND d.objid = p.oid
     AND d.deptype = 'e'
    WHERE n.nspname IN ('public', 'drizzle')
      AND d.objid IS NULL
      AND pg_get_userbyid(p.proowner) <> 'central_migrator'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO central_migrator', object.identity);
  END LOOP;

  FOR object IN
    SELECT t.oid::regtype AS identity
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    LEFT JOIN pg_depend d
      ON d.classid = 'pg_type'::regclass
     AND d.objid = t.oid
     AND d.deptype = 'e'
    WHERE n.nspname IN ('public', 'drizzle')
      AND t.typtype IN ('d', 'e')
      AND d.objid IS NULL
      AND pg_get_userbyid(t.typowner) <> 'central_migrator'
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO central_migrator', object.identity);
  END LOOP;
END
$ownership$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO central_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO central_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO central_runtime;

REVOKE UPDATE, DELETE, TRUNCATE
  ON TABLE public.admin_activity_logs,
           public.promotion_audit_logs,
           public.notification_delivery_logs
  FROM central_runtime;
GRANT SELECT, INSERT
  ON TABLE public.admin_activity_logs,
           public.promotion_audit_logs,
           public.notification_delivery_logs
  TO central_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO central_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO central_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE central_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO central_runtime;

COMMIT;
