-- Additive migration 0105: Notifications Wave 2.1 — durable campaign send
-- recovery state.
--
-- Closes the reliability gap identified in the Wave 2 integrity review: a
-- campaign that crashes after the freeze transaction but before delivery
-- finalization was permanently stuck at status='sending' with no recovery
-- path. No existing row's data changes; four nullable/defaulted columns are
-- added to notification_campaigns:
--
--   send_started_at         — set once, when the campaign first enters
--                              "sending". Observability only.
--   last_send_heartbeat_at  — updated by the delivery loop after every
--                              device page processed, and by a resume
--                              claim. The sole durable signal used to judge
--                              staleness (no in-memory state is relied on).
--   send_attempt            — incremented on the initial send and on every
--                              resume claim; bounds total resume attempts.
--   last_error               — diagnostic text, set on an unexpected
--                              exception, cleared on successful completion.

ALTER TABLE "notification_campaigns"
  ADD COLUMN IF NOT EXISTS "send_started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_send_heartbeat_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "send_attempt" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_error" text;

CREATE INDEX IF NOT EXISTS "notification_campaigns_status_heartbeat_idx"
  ON "notification_campaigns" ("status", "last_send_heartbeat_at");

-- Rollback (not executed by this migration; documented for operator reference):
--   DROP INDEX IF EXISTS "notification_campaigns_status_heartbeat_idx";
--   ALTER TABLE "notification_campaigns"
--     DROP COLUMN IF EXISTS "send_started_at",
--     DROP COLUMN IF EXISTS "last_send_heartbeat_at",
--     DROP COLUMN IF EXISTS "send_attempt",
--     DROP COLUMN IF EXISTS "last_error";
