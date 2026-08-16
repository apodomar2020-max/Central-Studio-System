-- Additive migration 0107: Notifications Wave 5 — Notification Delivery Logs
-- operational read index.
--
-- System → Logs → Notification Delivery (Wave 5) queries
-- notification_delivery_logs filtered by status and/or a created_at date
-- range, always ordered newest-first. No existing index covers this shape:
-- migration 0040 gave the table single-column indexes on notification_id,
-- student_id, and status only — none of which help a status + date-range
-- scan avoid a full-table sort as the table grows (every booking, package,
-- reminder, attendance, and Ballet lifecycle event that dispatches Push
-- writes a row here, so this table's growth is unbounded and ongoing).
--
-- Composite (status, created_at) index: directly serves the mandatory
-- "Delivery Status" + "Date range" filter combination (equality on the
-- leading column, range scan on the second), and still assists a
-- status-only filter or a plain created_at-ordered scan within one status.
-- Chosen over a bare created_at index because status is one of the two
-- filters explicitly required by the Wave 5 UI (alongside Date range) and
-- is very likely to be combined with a date range in real operator usage
-- ("show me today's failures") — see the Wave 5 report's Database/Index
-- Impact section for the full justification.
--
-- Purely additive: no existing index dropped, no column added or removed,
-- no historical row touched or rewritten.

CREATE INDEX IF NOT EXISTS "notification_delivery_logs_status_created_at_idx"
  ON "notification_delivery_logs" ("status", "created_at");
