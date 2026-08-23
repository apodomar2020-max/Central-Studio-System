-- Phase B3B0-2: deletion-preparation freeze foundation.
--
-- Creates ONE new table only. Zero UPDATE/backfill statements against any
-- existing table's existing rows (students, provenance tables, etc. are
-- untouched). Creates zero preparation rows itself (no bootstrap), matching
-- the provenance migration's own zero-bootstrap precedent. Does not alter
-- account_status, does not touch email/provenance data.

CREATE TABLE "student_deletion_workflows" (
  "id" serial PRIMARY KEY,
  "student_id" integer NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "started_by_admin_id" integer,
  "cancelled_at" timestamptz,
  "cancelled_by_admin_id" integer,
  "policy_version" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "student_deletion_workflows"
  ADD CONSTRAINT "student_deletion_workflows_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;

ALTER TABLE "student_deletion_workflows"
  ADD CONSTRAINT "student_deletion_workflows_started_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("started_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

ALTER TABLE "student_deletion_workflows"
  ADD CONSTRAINT "student_deletion_workflows_cancelled_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("cancelled_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

ALTER TABLE "student_deletion_workflows"
  ADD CONSTRAINT "student_deletion_workflows_status_check"
  CHECK ("status" IN ('PREPARING', 'CANCELLED'));

ALTER TABLE "student_deletion_workflows"
  ADD CONSTRAINT "student_deletion_workflows_cancelled_consistency_check"
  CHECK (("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL) OR ("status" = 'PREPARING' AND "cancelled_at" IS NULL));

-- At most one ACTIVE (PREPARING) preparation per student.
CREATE UNIQUE INDEX "student_deletion_workflows_active_per_student"
  ON "student_deletion_workflows" ("student_id")
  WHERE "status" = 'PREPARING';

CREATE INDEX "student_deletion_workflows_student_idx"
  ON "student_deletion_workflows" ("student_id", "started_at");

-- Manual rollback (not executed by this migration):
--   DROP TABLE "student_deletion_workflows";
