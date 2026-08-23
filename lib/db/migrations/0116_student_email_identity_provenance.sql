-- Phase B3B0-1A: forward-looking student email-ownership provenance.
--
-- Creates two NEW tables only. Zero UPDATE/backfill statements against any
-- existing table's existing rows (bookings/package_orders/feedback/
-- attendance/credit_transactions/students are untouched by this migration).
-- No raw email is stored anywhere in these tables — only versioned HMAC
-- fingerprints computed by lib/studentEmailProvenance.ts.

CREATE TABLE "provenance_activation" (
  "id" serial PRIMARY KEY,
  "singleton" boolean NOT NULL DEFAULT true,
  "activated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "provenance_activation_singleton_unique" UNIQUE ("singleton")
);

CREATE TABLE "student_email_identity_history" (
  "id" serial PRIMARY KEY,
  "student_id" integer NOT NULL,
  "email_fingerprint" text NOT NULL,
  "valid_from" timestamptz NOT NULL,
  "valid_to" timestamptz,
  "source" text NOT NULL,
  "changed_by_admin_id" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "student_email_identity_history"
  ADD CONSTRAINT "student_email_identity_history_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT;

ALTER TABLE "student_email_identity_history"
  ADD CONSTRAINT "student_email_identity_history_changed_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("changed_by_admin_id") REFERENCES "system_users"("id") ON DELETE SET NULL;

ALTER TABLE "student_email_identity_history"
  ADD CONSTRAINT "student_email_identity_history_interval_check"
  CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from");

ALTER TABLE "student_email_identity_history"
  ADD CONSTRAINT "student_email_identity_history_source_check"
  CHECK ("source" IN ('bootstrap', 'admin_update', 'registration', 'self_service'));

-- Fingerprint format: "v<algo-version>:k<key-id>:<64 lowercase hex>".
-- v = algorithm/payload-format version, k = provenance HMAC key-generation
-- id (see lib/studentEmailProvenance.ts KEY ROTATION MODEL). Never shipped
-- prior to this edit, so no corrective migration is needed — this is the
-- format enforced from the first shipped version of this table.
ALTER TABLE "student_email_identity_history"
  ADD CONSTRAINT "student_email_identity_history_fingerprint_format_check"
  CHECK ("email_fingerprint" ~ '^v[0-9]+:k[0-9]+:[0-9a-f]{64}$');

-- At most one OPEN (current) interval per student.
CREATE UNIQUE INDEX "student_email_identity_history_open_per_student"
  ON "student_email_identity_history" ("student_id")
  WHERE "valid_to" IS NULL;

CREATE INDEX "student_email_identity_history_student_valid_from_idx"
  ON "student_email_identity_history" ("student_id", "valid_from");

CREATE INDEX "student_email_identity_history_fingerprint_valid_from_idx"
  ON "student_email_identity_history" ("email_fingerprint", "valid_from");

-- Manual rollback (not executed by this migration):
--   DROP TABLE "student_email_identity_history";
--   DROP TABLE "provenance_activation";
