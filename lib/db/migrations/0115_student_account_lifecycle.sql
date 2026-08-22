-- Phase B1B: student account lifecycle (active/deactivated/deleted).
-- Only "active" and "deactivated" are operationally reachable this phase;
-- "deleted" is reserved for a future tombstone phase and is included only
-- in the CHECK constraint so no later migration has to widen it.
ALTER TABLE "students"
  ADD COLUMN "account_status" text NOT NULL DEFAULT 'active',
  ADD COLUMN "deactivated_at" timestamptz,
  ADD COLUMN "deactivated_by_admin_id" integer;

ALTER TABLE "students"
  ADD CONSTRAINT "students_account_status_check"
  CHECK ("account_status" IN ('active', 'deactivated', 'deleted'));

ALTER TABLE "students"
  ADD CONSTRAINT "students_deactivated_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("deactivated_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

-- No index on account_status: every query that needs this column this phase
-- (auth middleware session check, deactivate/reactivate transactions) looks
-- up a student by primary key `id`, never by status. An index would carry
-- write cost with no query to serve yet; add one later if a status-scan
-- endpoint (e.g. an admin "list deactivated students" view) is built.

-- Manual rollback (not executed by this migration):
--   ALTER TABLE "students" DROP CONSTRAINT "students_deactivated_by_admin_id_system_users_id_fk";
--   ALTER TABLE "students" DROP CONSTRAINT "students_account_status_check";
--   ALTER TABLE "students" DROP COLUMN "deactivated_by_admin_id";
--   ALTER TABLE "students" DROP COLUMN "deactivated_at";
--   ALTER TABLE "students" DROP COLUMN "account_status";
