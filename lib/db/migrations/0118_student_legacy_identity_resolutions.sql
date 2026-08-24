-- Phase B3B2E: Level-B manual resolution decision layer.
--
-- Creates ONE new table only (plus its indexes/constraints). Zero seed rows,
-- zero UPDATE/backfill against any existing table. Does not touch students,
-- package_orders, credit_transactions, attendance, provenance, or finance
-- data in any way.

CREATE TABLE "student_legacy_identity_resolutions" (
  "id" serial PRIMARY KEY,
  "student_id" integer NOT NULL,
  "domain" text NOT NULL,
  "target_record_id" integer NOT NULL,
  "deletion_workflow_id" integer NOT NULL,
  "evidence_level" text NOT NULL,
  "decision" text NOT NULL,
  "evidence_reason_code" text NOT NULL,
  "evidence_snapshot_ref" text NOT NULL,
  -- NOTE (Phase B3B2E storage boundary): this table deliberately has NO
  -- free-text column. Resolution rows may only ever hold internal ids,
  -- system-derived evidence codes, decision/actor/timestamp metadata. An
  -- unrestricted Admin-supplied text column would make the table capable of
  -- persisting raw email/name/phone/payment/child PII, so the capability is
  -- removed at the schema level rather than mitigated by Admin discipline.
  "resolved_by_admin_id" integer,
  "resolved_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_deletion_workflow_id_fk"
  FOREIGN KEY ("deletion_workflow_id") REFERENCES "student_deletion_workflows"("id") ON DELETE RESTRICT;

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_resolved_by_admin_id_fk"
  FOREIGN KEY ("resolved_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_domain_check"
  CHECK ("domain" IN ('package_orders'));

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_evidence_level_check"
  CHECK ("evidence_level" IN ('B'));

ALTER TABLE "student_legacy_identity_resolutions"
  ADD CONSTRAINT "student_legacy_identity_resolutions_decision_check"
  CHECK ("decision" IN ('PROVEN_OWNER', 'NOT_THIS_STUDENT', 'UNRESOLVED'));

CREATE INDEX "student_legacy_identity_resolutions_pair_idx"
  ON "student_legacy_identity_resolutions" ("student_id", "domain", "target_record_id", "resolved_at");

CREATE INDEX "student_legacy_identity_resolutions_workflow_idx"
  ON "student_legacy_identity_resolutions" ("deletion_workflow_id");

-- Manual rollback (not executed by this migration):
--   DROP TABLE "student_legacy_identity_resolutions";
