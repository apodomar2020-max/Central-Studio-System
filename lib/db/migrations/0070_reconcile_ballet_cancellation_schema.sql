-- Migration 0070: Reconcile Ballet cancellation request initiator attribution.
--
-- Production incident: an earlier shape of migration 0068 reached/tracked in
-- production before the final initiator-attribution columns were committed.
-- Drizzle's migrator is timestamp/high-water-mark based, so edited 0068 SQL
-- will not replay. This forward-only migration reconciles only the confirmed
-- production drift:
--
--   - ballet_enrollment_cancellation_requests.initiated_by_type
--   - ballet_enrollment_cancellation_requests.initiated_by_admin_id
--   - initiated_by_admin_id FK to system_users(id) ON DELETE RESTRICT
--   - parent/admin initiator combination CHECK
--
-- The completed read-only production preflight confirmed the rest of the
-- cancellation/refund schema already matches the final expected shape, so this
-- migration deliberately does not touch ballet_refunds, ballet_level_assignments,
-- attendance, ballet_applications indexes, or existing status/timing/FK objects.

ALTER TABLE ballet_enrollment_cancellation_requests
  ADD COLUMN IF NOT EXISTS initiated_by_type text DEFAULT 'parent',
  ADD COLUMN IF NOT EXISTS initiated_by_admin_id integer;

-- Backfill only rows that have no initiator attribution. This preserves any
-- already-valid admin attribution from partially applied environments.
UPDATE ballet_enrollment_cancellation_requests
SET initiated_by_type = 'parent'
WHERE initiated_by_type IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ballet_enrollment_cancellation_requests
    WHERE initiated_by_type = 'parent'
      AND initiated_by_admin_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile ballet cancellation initiator attribution: parent rows must not have initiated_by_admin_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ballet_enrollment_cancellation_requests
    WHERE initiated_by_type = 'admin'
      AND initiated_by_admin_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile ballet cancellation initiator attribution: admin rows must have initiated_by_admin_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ballet_enrollment_cancellation_requests
    WHERE initiated_by_type NOT IN ('parent','admin')
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile ballet cancellation initiator attribution: initiated_by_type must be parent or admin';
  END IF;
END $$;

ALTER TABLE ballet_enrollment_cancellation_requests
  ALTER COLUMN initiated_by_type SET DEFAULT 'parent',
  ALTER COLUMN initiated_by_type SET NOT NULL;

ALTER TABLE ballet_enrollment_cancellation_requests
  DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_initiated_by_type_check,
  DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_initiator_combination_check;

ALTER TABLE ballet_enrollment_cancellation_requests
  ADD CONSTRAINT ballet_enrollment_cancellation_initiator_combination_check
    CHECK (
      (initiated_by_type = 'parent' AND initiated_by_admin_id IS NULL)
      OR
      (initiated_by_type = 'admin' AND initiated_by_admin_id IS NOT NULL)
    );

DO $$
DECLARE
  constraint_name text;
  admin_column_attnum smallint;
BEGIN
  SELECT attnum
    INTO admin_column_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.ballet_enrollment_cancellation_requests'::regclass
    AND attname = 'initiated_by_admin_id'
    AND NOT attisdropped;

  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'ballet_enrollment_cancellation_requests'
      AND con.contype = 'f'
      AND con.conkey = ARRAY[admin_column_attnum]::smallint[]
      AND (
        con.confrelid <> 'public.system_users'::regclass
        OR con.confdeltype <> 'r'
      )
  LOOP
    EXECUTE format('ALTER TABLE ballet_enrollment_cancellation_requests DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'ballet_enrollment_cancellation_requests'
      AND con.contype = 'f'
      AND con.conkey = ARRAY[admin_column_attnum]::smallint[]
      AND con.confrelid = 'public.system_users'::regclass
      AND con.confdeltype = 'r'
  ) THEN
    ALTER TABLE ballet_enrollment_cancellation_requests
      ADD CONSTRAINT ballet_enrollment_cancellation_initiated_by_admin_fk
        FOREIGN KEY (initiated_by_admin_id)
        REFERENCES system_users(id)
        ON DELETE RESTRICT
        ON UPDATE NO ACTION;
  END IF;
END $$;
