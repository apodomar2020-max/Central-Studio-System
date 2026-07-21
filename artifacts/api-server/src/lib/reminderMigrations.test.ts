import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

function migration(file: string): string {
  return readFileSync(resolve(process.cwd(), `lib/db/migrations/${file}`), "utf8");
}

test("0072: reminder_idempotency_key is nullable and its unique index is partial", () => {
  const sql = migration("0072_reminder_idempotency.sql");
  assert.match(sql, /ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "reminder_idempotency_key" text;/);
  // No NOT NULL on the new column — historical rows must stay valid.
  assert.doesNotMatch(sql, /"reminder_idempotency_key" text NOT NULL/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS "notifications_reminder_idempotency_key_unique"\s+ON "notifications" \("reminder_idempotency_key"\)\s+WHERE "reminder_idempotency_key" IS NOT NULL;/,
  );
});

test("0073: class_reminder_settings is a singleton with all four switches defaulting true", () => {
  const sql = migration("0073_class_reminder_settings.sql");
  assert.match(sql, /CONSTRAINT "class_reminder_settings_singleton" CHECK \("id" = 1\)/);
  for (const column of [
    "automatic_reminders_enabled",
    "class_reminder_24h_enabled",
    "class_reminder_1h_enabled",
    "post_class_rating_3h_enabled",
  ]) {
    assert.match(sql, new RegExp(`"${column}" boolean DEFAULT true NOT NULL`));
  }
  assert.match(sql, /ON DELETE set null ON UPDATE no action/);
});

test("0074: reminder_worker_heartbeats stores no secrets and is keyed by worker_name", () => {
  const sql = migration("0074_reminder_worker_heartbeat.sql");
  assert.match(sql, /"worker_name" text PRIMARY KEY NOT NULL/);
  assert.match(sql, /"last_reminder_run_summary" jsonb/);
  assert.doesNotMatch(sql, /"[a-z_]*(push_)?token[a-z_]*"/i);
  assert.doesNotMatch(sql, /"[a-z_]*secret[a-z_]*"/i);
});

test("migrations 0072-0074 are additive only — no DROP or destructive ALTER", () => {
  for (const file of [
    "0072_reminder_idempotency.sql",
    "0073_class_reminder_settings.sql",
    "0074_reminder_worker_heartbeat.sql",
  ]) {
    const sql = migration(file);
    assert.doesNotMatch(sql, /DROP TABLE/i);
    assert.doesNotMatch(sql, /DROP COLUMN/i);
    assert.doesNotMatch(sql, /TRUNCATE/i);
  }
});
