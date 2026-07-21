-- Migration 0074: Reminder Worker heartbeat
--
-- One row per worker process, upserted by the BullMQ worker so Admin can
-- observe Worker-side reminder health (the API process only knows its own
-- environment, not the Worker's). No secrets or PII — lastReminderRunSummary
-- stores only safe aggregate counters.
CREATE TABLE IF NOT EXISTS "reminder_worker_heartbeats" (
  "worker_name" text PRIMARY KEY NOT NULL,
  "last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_reminder_run_at" timestamp with time zone,
  "last_reminder_run_status" text,
  "last_reminder_run_summary" jsonb,
  "push_notifications_enabled" boolean DEFAULT false NOT NULL,
  "queue_worker_enabled" boolean DEFAULT false NOT NULL,
  "deployed_version" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
