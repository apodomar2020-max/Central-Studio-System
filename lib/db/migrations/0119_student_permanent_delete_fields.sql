-- Phase B3B4: Permanent Student tombstone lifecycle fields.
--
-- account_status = 'deleted' has been a reachable CHECK-constraint value
-- since Phase B1B (0115_student_account_lifecycle.sql), but no route could
-- ever set it. This migration adds the two auditability columns the
-- tombstone transition needs (deleted_at / deleted_by_admin_id), mirroring
-- the existing deactivated_at / deactivated_by_admin_id pair exactly. No
-- other schema change. No data mutation of any existing row.

ALTER TABLE "students"
  ADD COLUMN "deleted_at" timestamptz,
  ADD COLUMN "deleted_by_admin_id" integer;

ALTER TABLE "students"
  ADD CONSTRAINT "students_deleted_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("deleted_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

-- Manual rollback (not executed by this migration):
--   ALTER TABLE "students" DROP CONSTRAINT "students_deleted_by_admin_id_system_users_id_fk";
--   ALTER TABLE "students" DROP COLUMN "deleted_by_admin_id";
--   ALTER TABLE "students" DROP COLUMN "deleted_at";
