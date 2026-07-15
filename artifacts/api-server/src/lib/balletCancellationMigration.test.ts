import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "lib/db/migrations/0068_ballet_cancellations_refunds.sql"),
  "utf8",
);

test("migration preserves cancellation core references", () => {
  assert.match(migration, /application_id integer NOT NULL REFERENCES ballet_applications\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /level_assignment_id integer NOT NULL REFERENCES ballet_level_assignments\(id\) ON DELETE RESTRICT/);
});

test("migration prevents nullable refund uniqueness bypass", () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ballet_refunds_open_payment_idx\s+ON ballet_refunds\(payment_id\)\s+WHERE status IN \('underReview','approved','processing'\)/);
});

test("migration restricts assignment and attendance history deletion", () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS ballet_level_assignments_application_id_ballet_applications_id_fk/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS ballet_level_assignments_application_id_fkey/);
  assert.match(migration, /ADD CONSTRAINT ballet_level_assignments_application_id_ballet_applications_id_fk\s+FOREIGN KEY \(application_id\) REFERENCES ballet_applications\(id\) ON DELETE RESTRICT ON UPDATE NO ACTION/);
  assert.doesNotMatch(migration, /FOREIGN KEY \(application_id\) REFERENCES ballet_applications\(id\) ON DELETE CASCADE/);
  assert.match(migration, /FOREIGN KEY \(ballet_level_assignment_id\) REFERENCES ballet_level_assignments\(id\) ON DELETE RESTRICT/);
});

test("migration includes status, timing, method, and positive amount checks", () => {
  assert.match(migration, /ballet_enrollment_cancellation_status_check/);
  assert.match(migration, /ballet_enrollment_cancellation_requested_timing_check/);
  assert.match(migration, /ballet_enrollment_cancellation_approved_timing_check/);
  assert.match(migration, /ballet_refunds_status_check/);
  assert.match(migration, /ballet_refunds_supported_method/);
  assert.match(migration, /ballet_refunds_requested_amount_positive/);
  assert.match(migration, /ballet_refunds_approved_amount_positive/);
  assert.match(migration, /ballet_refunds_refunded_amount_positive/);
});

test("withdrawn remains terminal for duplicate-application predicates", () => {
  assert.match(migration, /status IN \('pending','needsFollowUp','accepted','assignedToLevel','active'\)/);
  assert.doesNotMatch(migration, /status IN \('pending','needsFollowUp','accepted','assignedToLevel','active','withdrawn'\)/);
});
