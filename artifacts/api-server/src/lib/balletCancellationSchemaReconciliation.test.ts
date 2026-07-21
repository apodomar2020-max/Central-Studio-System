import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migration0068 = read("lib/db/migrations/0068_ballet_cancellations_refunds.sql");
const migration0069 = read("lib/db/migrations/0069_restore_ballet_schedule_capacity.sql");
const migration0070 = read("lib/db/migrations/0070_reconcile_ballet_cancellation_schema.sql");
const journal = JSON.parse(read("lib/db/migrations/meta/_journal.json")) as {
  entries: Array<{ idx: number; when: number; tag: string; version: string; breakpoints: boolean }>;
};

test("migration 0070 remains the next unique journal entry after 0069", () => {
  const migration0070Entry = journal.entries.find((entry) => entry.tag === "0070_reconcile_ballet_cancellation_schema");
  const previous = journal.entries.find((entry) => entry.idx === 69);

  assert.deepEqual(migration0070Entry, {
    idx: 70,
    version: "7",
    when: 1784462424000,
    tag: "0070_reconcile_ballet_cancellation_schema",
    breakpoints: true,
  });
  assert.equal(previous?.idx, 69);
  assert.ok(migration0070Entry!.when > previous!.when);
  assert.equal(
    journal.entries.filter((entry) => entry.tag === "0070_reconcile_ballet_cancellation_schema").length,
    1,
  );
  assert.equal(journal.entries.filter((entry) => entry.when === migration0070Entry!.when).length, 1);
  assert.ok(existsSync(resolve(process.cwd(), `lib/db/migrations/${migration0070Entry!.tag}.sql`)));
});

test("migration 0071 remains a unique journal entry for pending renewal uniqueness", () => {
  const migration0071Entry = journal.entries.find((entry) => entry.tag === "0071_ballet_pending_renewal_uniqueness");
  const previous = journal.entries.find((entry) => entry.idx === 70);

  assert.deepEqual(migration0071Entry, {
    idx: 71,
    version: "7",
    when: 1784462425000,
    tag: "0071_ballet_pending_renewal_uniqueness",
    breakpoints: true,
  });
  assert.equal(previous?.idx, 70);
  assert.ok(migration0071Entry!.when > previous!.when);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0071_ballet_pending_renewal_uniqueness").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.when === migration0071Entry!.when).length, 1);
  assert.ok(existsSync(resolve(process.cwd(), `lib/db/migrations/${migration0071Entry!.tag}.sql`)));
});

test("migration 0074 is the newest unique journal entry after the reminder-automation migrations", () => {
  const newest = journal.entries.at(-1);
  const previous = journal.entries.at(-2);

  assert.deepEqual(newest, {
    idx: 74,
    version: "7",
    when: 1784462428000,
    tag: "0074_reminder_worker_heartbeat",
    breakpoints: true,
  });
  assert.equal(previous?.idx, 73);
  assert.ok(newest!.when > previous!.when);
  assert.equal(journal.entries.filter((entry) => entry.tag === "0074_reminder_worker_heartbeat").length, 1);
  assert.equal(journal.entries.filter((entry) => entry.when === newest!.when).length, 1);
  assert.ok(existsSync(resolve(process.cwd(), `lib/db/migrations/${newest!.tag}.sql`)));
});

test("migration 0070 documents a narrow forward-only initiator reconciliation", () => {
  assert.match(migration0070, /forward-only migration reconciles only the confirmed/);
  assert.match(migration0070, /initiated_by_type/);
  assert.match(migration0070, /initiated_by_admin_id/);
  assert.match(migration0070, /deliberately does not touch ballet_refunds/);
});

test("migration 0070 only targets cancellation initiator attribution", () => {
  assert.match(migration0070, /ALTER TABLE ballet_enrollment_cancellation_requests/);
  assert.match(migration0070, /ADD COLUMN IF NOT EXISTS initiated_by_type text DEFAULT 'parent'/);
  assert.match(migration0070, /ADD COLUMN IF NOT EXISTS initiated_by_admin_id integer/);
  assert.match(migration0070, /ALTER COLUMN initiated_by_type SET DEFAULT 'parent'/);
  assert.match(migration0070, /ALTER COLUMN initiated_by_type SET NOT NULL/);

  assert.doesNotMatch(migration0070, /CREATE TABLE IF NOT EXISTS ballet_enrollment_cancellation_requests/i);
  assert.doesNotMatch(migration0070, /ALTER COLUMN application_id SET NOT NULL/i);
  assert.doesNotMatch(migration0070, /ALTER COLUMN level_assignment_id SET NOT NULL/i);
  assert.doesNotMatch(migration0070, /ballet_enrollment_cancellation_status_check/i);
  assert.doesNotMatch(migration0070, /ballet_enrollment_cancellation_requested_timing_check/i);
  assert.doesNotMatch(migration0070, /ballet_enrollment_cancellation_approved_timing_check/i);
});

test("migration 0070 does not reconcile unrelated final-0068 objects", () => {
  assert.doesNotMatch(migration0070, /CREATE TABLE IF NOT EXISTS ballet_refunds/i);
  assert.doesNotMatch(migration0070, /ALTER TABLE ballet_refunds/i);
  assert.doesNotMatch(migration0070, /DROP INDEX IF EXISTS ballet_refunds/i);
  assert.doesNotMatch(migration0070, /CREATE (UNIQUE )?INDEX IF NOT EXISTS ballet_refunds/i);
  assert.doesNotMatch(migration0070, /ALTER TABLE ballet_level_assignments/i);
  assert.doesNotMatch(migration0070, /ALTER TABLE attendance/i);
  assert.doesNotMatch(migration0070, /DROP INDEX IF EXISTS ballet_applications_active_per_child/i);
  assert.doesNotMatch(migration0070, /DROP INDEX IF EXISTS ballet_applications_active_per_manual_identity/i);
  assert.doesNotMatch(migration0070, /CREATE UNIQUE INDEX IF NOT EXISTS ballet_applications_active_per_child/i);
  assert.doesNotMatch(migration0070, /CREATE UNIQUE INDEX IF NOT EXISTS ballet_applications_active_per_manual_identity/i);
});

test("migration 0070 backfills only missing initiator attribution and preserves valid admin history", () => {
  assert.match(migration0070, /SET initiated_by_type = 'parent'\s+WHERE initiated_by_type IS NULL/);
  assert.doesNotMatch(migration0070, /SET initiated_by_type = 'parent'\s+WHERE initiated_by_type = 'admin'/);
  assert.doesNotMatch(migration0070, /SET initiated_by_admin_id = NULL\s+WHERE initiated_by_type = 'parent'/);
});

test("migration 0070 fails clearly for incompatible partially-attributed data", () => {
  assert.match(migration0070, /parent rows must not have initiated_by_admin_id/);
  assert.match(migration0070, /admin rows must have initiated_by_admin_id/);
  assert.match(migration0070, /initiated_by_type must be parent or admin/);
});

test("migration 0070 enforces the final initiator combination check", () => {
  assert.match(migration0070, /DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_initiated_by_type_check/);
  assert.match(migration0070, /DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_initiator_combination_check/);
  assert.match(migration0070, /ADD CONSTRAINT ballet_enrollment_cancellation_initiator_combination_check/);
  assert.match(migration0070, /\(initiated_by_type = 'parent' AND initiated_by_admin_id IS NULL\)/);
  assert.match(migration0070, /\(initiated_by_type = 'admin' AND initiated_by_admin_id IS NOT NULL\)/);
});

test("initiator combination truth table allows only parent/null and admin/adminId", () => {
  const accepts = (initiatedByType: string, hasAdminId: boolean) =>
    (initiatedByType === "parent" && !hasAdminId)
    || (initiatedByType === "admin" && hasAdminId);

  assert.equal(accepts("parent", false), true);
  assert.equal(accepts("admin", true), true);
  assert.equal(accepts("parent", true), false);
  assert.equal(accepts("admin", false), false);
  assert.equal(accepts("staff", false), false);
});

test("migration 0070 repairs only incompatible initiated_by_admin_id foreign keys", () => {
  assert.match(migration0070, /con\.conkey = ARRAY\[admin_column_attnum\]::smallint\[\]/);
  assert.match(migration0070, /con\.confrelid <> 'public\.system_users'::regclass/);
  assert.match(migration0070, /con\.confdeltype <> 'r'/);
  assert.match(migration0070, /ballet_enrollment_cancellation_initiated_by_admin_fk/);
  assert.match(migration0070, /REFERENCES system_users\(id\)\s+ON DELETE RESTRICT\s+ON UPDATE NO ACTION/);
  assert.doesNotMatch(migration0070, /DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_requests_application_id_fkey/);
  assert.doesNotMatch(migration0070, /DROP CONSTRAINT IF EXISTS ballet_enrollment_cancellation_request_level_assignment_id_fkey/);
});

test("migration 0070 remains non-destructive", () => {
  assert.doesNotMatch(migration0070, /ON DELETE CASCADE/i);
  assert.doesNotMatch(migration0070, /DROP TABLE/i);
  assert.doesNotMatch(migration0070, /TRUNCATE/i);
  assert.doesNotMatch(migration0070, /DELETE FROM/i);
  assert.doesNotMatch(migration0070, /DROP COLUMN/i);
  assert.doesNotMatch(migration0070, /DROP INDEX/i);
});

test("historical migrations 0068 and 0069 remain unchanged sources for their original shapes", () => {
  assert.match(migration0068, /CREATE TABLE IF NOT EXISTS ballet_enrollment_cancellation_requests/);
  assert.match(migration0068, /initiated_by_type text NOT NULL DEFAULT 'parent'/);
  assert.match(migration0068, /initiated_by_admin_id integer REFERENCES system_users\(id\) ON DELETE RESTRICT/);
  assert.match(migration0069, /ALTER TABLE "ballet_schedules" ADD COLUMN IF NOT EXISTS "capacity" integer/);
});
