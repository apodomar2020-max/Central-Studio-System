-- Additive migration 0104: Notifications Wave 2 — Manual Push Campaign
-- entity + frozen recipient snapshot.
--
-- Two brand-new, empty tables. No existing table is altered, no existing
-- row is touched, no historical data is affected.
--
--   notification_campaigns           — one row per logical Manual Push
--                                       Campaign (draft through archived).
--   notification_campaign_recipients — one row per intended ACCOUNT,
--                                       written once at send time and never
--                                       re-derived afterward (the frozen
--                                       recipient snapshot). No push token,
--                                       no email/phone/name is stored.
--
-- notification_campaigns.notification_id references the pre-existing
-- notifications table (nullable, set at send time) — the one canonical
-- mobile-visible row for the campaign; see routes/notifications.ts's
-- additive `target = 'campaign:{id}'` visibility extension for how mobile
-- history stays correct without touching any existing notification row.
--
-- notification_campaign_recipients.student_id references the pre-existing
-- students table with ON DELETE SET NULL — mirrors
-- notification_delivery_logs.student_id's existing precedent, so a
-- historical campaign's aggregate counts survive an account being deleted
-- later.

CREATE TABLE IF NOT EXISTS "notification_campaigns" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "audience_type" text NOT NULL DEFAULT 'all',
  "audience_config" jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by_admin_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "notification_id" integer REFERENCES "notifications"("id") ON DELETE SET NULL,
  "previewed_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "intended_recipient_count" integer NOT NULL DEFAULT 0,
  "push_enabled_account_count" integer NOT NULL DEFAULT 0,
  "active_device_count" integer NOT NULL DEFAULT 0,
  "sent_device_count" integer NOT NULL DEFAULT 0,
  "failed_device_count" integer NOT NULL DEFAULT 0,
  "no_device_account_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_campaigns_status_check"
    CHECK ("status" in ('draft', 'ready', 'sending', 'completed', 'completed_with_errors', 'failed', 'archived')),
  CONSTRAINT "notification_campaigns_audience_type_check"
    CHECK ("audience_type" in ('all'))
);

CREATE INDEX IF NOT EXISTS "notification_campaigns_status_created_at_idx"
  ON "notification_campaigns" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "notification_campaigns_notification_id_idx"
  ON "notification_campaigns" ("notification_id");

CREATE TABLE IF NOT EXISTS "notification_campaign_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL REFERENCES "notification_campaigns"("id") ON DELETE CASCADE,
  "student_id" integer REFERENCES "students"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "had_active_device_at_snapshot" boolean NOT NULL DEFAULT false,
  "active_device_count_at_snapshot" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_campaign_recipients_status_check"
    CHECK ("status" in ('pending', 'sent', 'failed', 'no_device'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_campaign_recipients_campaign_student_unique"
  ON "notification_campaign_recipients" ("campaign_id", "student_id");

CREATE INDEX IF NOT EXISTS "notification_campaign_recipients_campaign_id_idx"
  ON "notification_campaign_recipients" ("campaign_id");

CREATE INDEX IF NOT EXISTS "notification_campaign_recipients_student_id_idx"
  ON "notification_campaign_recipients" ("student_id");

CREATE INDEX IF NOT EXISTS "notification_campaign_recipients_status_idx"
  ON "notification_campaign_recipients" ("status");

-- Rollback (not executed by this migration; documented for operator reference):
--   DROP TABLE IF EXISTS "notification_campaign_recipients";
--   DROP TABLE IF EXISTS "notification_campaigns";
-- (notification_campaign_recipients must be dropped first — it has the FK
-- to notification_campaigns. Neither statement touches notifications,
-- notification_delivery_logs, notification_read_receipts, students, or
-- system_users.)
