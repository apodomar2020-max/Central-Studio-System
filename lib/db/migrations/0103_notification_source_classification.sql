-- Additive migration 0103: notification source/origin classification (Wave 1).
--
-- Adds a nullable "source" column to "notifications" distinguishing:
--   manual_admin — created through the Admin manual notification composer/API
--   system       — direct transactional/domain event (booking, attendance,
--                  package lifecycle, Ballet application/cancellation/refund,
--                  schedule changed/cancelled, ...)
--   automation   — scheduled/worker-created (class/post-class reminders,
--                  package expiry/low-credit reminders, Ballet auto-absence)
--
-- Nullable and unconstrained beyond the three known values: historical rows
-- are left untouched (NULL = unclassified / pre-Wave-1). No backfill is
-- performed here or planned — application code sets this value going
-- forward (see artifacts/api-server/src/lib/notifications.ts and
-- lib/notificationReminders.ts).

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "source" text;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_source_check"
  CHECK ("source" is null or "source" in ('manual_admin', 'system', 'automation'));

-- Rollback (not executed by this migration; documented for operator reference):
--   ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_source_check";
--   ALTER TABLE "notifications" DROP COLUMN IF EXISTS "source";
