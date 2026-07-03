-- Migration 0045: Admin Activity Logs (Phase 7B)
--
-- Unified admin-facing audit trail. One row per sensitive admin mutation,
-- written by the activityLog service after the business action succeeds.
-- actor_id → system_users with ON DELETE SET NULL (history survives admin
-- deletion; actor_name/actor_email are denormalized snapshots).
--
-- NOTE: the stashed marketing-audit WIP contains an unrelated
-- 0038_marketing_audit_logs.sql — this migration intentionally uses the next
-- free number (0045) and a different table.

CREATE TABLE IF NOT EXISTS "admin_activity_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "actor_email" text NOT NULL,
  "action" text NOT NULL,
  "module" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "entity_label" text,
  "before" jsonb,
  "after" jsonb,
  "summary" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_activity_logs_created_at_idx" ON "admin_activity_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "admin_activity_logs_actor_idx" ON "admin_activity_logs" ("actor_id");
CREATE INDEX IF NOT EXISTS "admin_activity_logs_module_idx" ON "admin_activity_logs" ("module");
CREATE INDEX IF NOT EXISTS "admin_activity_logs_action_idx" ON "admin_activity_logs" ("action");
CREATE INDEX IF NOT EXISTS "admin_activity_logs_entity_idx" ON "admin_activity_logs" ("entity_type", "entity_id");
