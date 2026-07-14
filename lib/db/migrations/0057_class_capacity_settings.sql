-- Migration 0057: Global class capacity feature flag
CREATE TABLE IF NOT EXISTS "class_capacity_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "class_capacity_enabled" boolean DEFAULT true NOT NULL,
  "updated_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "class_capacity_settings_singleton" CHECK ("id" = 1)
);

ALTER TABLE "class_capacity_settings"
  ADD CONSTRAINT "class_capacity_settings_updated_by_admin_id_system_users_id_fk"
  FOREIGN KEY ("updated_by_admin_id")
  REFERENCES "public"."system_users"("id")
  ON DELETE set null
  ON UPDATE no action;

INSERT INTO "class_capacity_settings" ("id", "class_capacity_enabled")
VALUES (1, true)
ON CONFLICT ("id") DO NOTHING;
