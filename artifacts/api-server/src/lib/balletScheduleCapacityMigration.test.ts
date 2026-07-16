import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "lib/db/migrations/0069_restore_ballet_schedule_capacity.sql"),
  "utf8",
);

// The file's header comment deliberately documents the absence of a
// default/NOT NULL/CHECK constraint and explains this is unrelated to the
// removed assessment-capacity feature — so those words appear in prose.
// Assertions about the actual SQL must only look at non-comment lines.
const sqlOnly = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

test("corrective migration targets ballet_schedules and adds capacity as a nullable integer with IF NOT EXISTS", () => {
  assert.match(sqlOnly, /ALTER TABLE "ballet_schedules" ADD COLUMN IF NOT EXISTS "capacity" integer;/);
});

test("corrective migration does not add a default, a NOT NULL constraint, or a CHECK constraint", () => {
  assert.doesNotMatch(sqlOnly, /"capacity"[^;]*DEFAULT/i);
  assert.doesNotMatch(sqlOnly, /"capacity"[^;]*NOT NULL/i);
  assert.doesNotMatch(sqlOnly, /CHECK/i);
});

test("corrective migration contains exactly one statement (no backfill UPDATE, no data mutation)", () => {
  const statements = sqlOnly.split("\n").filter((line) => line.trim().length > 0);
  assert.equal(statements.length, 1);
  assert.doesNotMatch(sqlOnly, /UPDATE\s+"ballet_schedules"/i);
});

test("corrective migration's actual SQL statement does not touch assessment-capacity tables or logic", () => {
  assert.doesNotMatch(sqlOnly, /assessment/i);
});

test("corrective migration never modifies migration 0060's file", () => {
  const migration0060 = readFileSync(
    resolve(process.cwd(), "lib/db/migrations/0060_ballet_schedule_capacity.sql"),
    "utf8",
  );
  assert.equal(migration0060.trim(), 'ALTER TABLE "ballet_schedules" ADD COLUMN IF NOT EXISTS "capacity" integer;');
});
