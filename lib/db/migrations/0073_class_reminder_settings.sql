-- Migration 0073: Class reminder settings (singleton)
--
-- Admin-controlled on/off switches for the booked-class reminder automation.
-- Timing itself (24h / 1h / 3h-post-class) is fixed and not configurable
-- here. The admin attribution FK uses ON DELETE SET NULL so deleting an
-- admin account never blocks account lifecycle or historical settings rows.
CREATE TABLE IF NOT EXISTS "class_reminder_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "automatic_reminders_enabled" boolean DEFAULT true NOT NULL,
  "class_reminder_24h_enabled" boolean DEFAULT true NOT NULL,
  "class_reminder_1h_enabled" boolean DEFAULT true NOT NULL,
  "post_class_rating_3h_enabled" boolean DEFAULT true NOT NULL,
  "updated_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "class_reminder_settings_singleton" CHECK ("id" = 1)
);--> statement-breakpoint

ALTER TABLE "class_reminder_settings"
  ADD CONSTRAINT "class_reminder_settings_updated_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

INSERT INTO "class_reminder_settings" ("id", "automatic_reminders_enabled", "class_reminder_24h_enabled", "class_reminder_1h_enabled", "post_class_rating_3h_enabled")
VALUES (1, true, true, true, true)
ON CONFLICT ("id") DO NOTHING;
