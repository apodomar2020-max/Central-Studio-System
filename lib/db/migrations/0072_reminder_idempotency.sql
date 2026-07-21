-- Migration 0072: Database-enforced reminder idempotency
--
-- Adds a nullable dedupe key to notifications, used exclusively by the
-- booked-class reminder automation. Nullable + a PARTIAL unique index means
-- ordinary (non-reminder) notifications are never subject to this
-- constraint, and every historical row (which has no idempotency key) stays
-- valid. Key format: "booking:{bookingId}:{reminderType}:{occurrenceDate}".
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "reminder_idempotency_key" text;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_reminder_idempotency_key_unique"
  ON "notifications" ("reminder_idempotency_key")
  WHERE "reminder_idempotency_key" IS NOT NULL;
