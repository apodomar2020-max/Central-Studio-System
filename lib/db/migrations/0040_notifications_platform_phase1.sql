-- Notifications Platform Phase 1: server read state, device tokens, delivery
-- logs, and basic template foundation. Additive only.

CREATE TABLE IF NOT EXISTS "notification_read_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "student_id" integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_read_receipts_notification_student_unique"
  ON "notification_read_receipts" ("notification_id", "student_id");

CREATE INDEX IF NOT EXISTS "notification_read_receipts_student_id_idx"
  ON "notification_read_receipts" ("student_id");

CREATE INDEX IF NOT EXISTS "notification_read_receipts_notification_id_idx"
  ON "notification_read_receipts" ("notification_id");

CREATE TABLE IF NOT EXISTS "notification_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "push_token" text NOT NULL,
  "provider" text DEFAULT 'expo' NOT NULL,
  "platform" text DEFAULT 'unknown' NOT NULL,
  "device_id" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_devices_push_token_unique"
  ON "notification_devices" ("push_token");

CREATE INDEX IF NOT EXISTS "notification_devices_student_id_idx"
  ON "notification_devices" ("student_id");

CREATE TABLE IF NOT EXISTS "notification_delivery_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer REFERENCES "notifications"("id") ON DELETE SET NULL,
  "student_id" integer REFERENCES "students"("id") ON DELETE SET NULL,
  "device_id" integer REFERENCES "notification_devices"("id") ON DELETE SET NULL,
  "channel" text DEFAULT 'push' NOT NULL,
  "provider" text DEFAULT 'expo' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_message_id" text,
  "error_code" text,
  "error_message" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notification_delivery_logs_student_id_idx"
  ON "notification_delivery_logs" ("student_id");

CREATE INDEX IF NOT EXISTS "notification_delivery_logs_notification_id_idx"
  ON "notification_delivery_logs" ("notification_id");

CREATE INDEX IF NOT EXISTS "notification_delivery_logs_status_idx"
  ON "notification_delivery_logs" ("status");

CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "title_template" text NOT NULL,
  "body_template" text NOT NULL,
  "language" text DEFAULT 'en' NOT NULL,
  "type" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_templates_key_unique"
  ON "notification_templates" ("key");

CREATE INDEX IF NOT EXISTS "notification_templates_key_idx"
  ON "notification_templates" ("key");

INSERT INTO "notification_templates" ("key", "title_template", "body_template", "language", "type", "is_active")
VALUES (
  'class_reminder_24h',
  'Class reminder',
  'Your {{className}} class is coming up {{scheduleLabel}}.',
  'en',
  'class_reminder_24h',
  true
)
ON CONFLICT ("key") DO NOTHING;
