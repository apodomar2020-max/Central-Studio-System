-- Migration 0055: Central Studio background music settings
--
-- Adds one singleton row for remotely managed in-app background music. The
-- admin attribution FK uses ON DELETE SET NULL so deleting/deactivating an
-- admin account never blocks account lifecycle or historical settings rows.
CREATE TABLE IF NOT EXISTS "background_music_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "source_url" text,
  "source_title" text,
  "volume" numeric(4, 3) DEFAULT '0.250' NOT NULL,
  "loop" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "background_music_settings_singleton" CHECK ("id" = 1),
  CONSTRAINT "background_music_settings_volume_range" CHECK ("volume" >= 0 AND "volume" <= 1),
  CONSTRAINT "background_music_settings_version_positive" CHECK ("version" >= 1)
);--> statement-breakpoint

ALTER TABLE "background_music_settings"
  ADD CONSTRAINT "background_music_settings_updated_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

INSERT INTO "background_music_settings" ("id", "enabled", "volume", "loop", "version")
VALUES (1, false, '0.250', true, 1)
ON CONFLICT ("id") DO NOTHING;
