ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "template_id" integer;
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "audience_type" text NOT NULL DEFAULT 'students';
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "audience_config" jsonb;
ALTER TABLE "marketing_campaigns" ADD COLUMN IF NOT EXISTS "prepared_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "marketing_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'marketing',
  "language" text NOT NULL DEFAULT 'en',
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "variables" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "marketing_campaign_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE,
  "student_id" integer REFERENCES "students"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "normalized_phone" text,
  "audience_reason" text,
  "status" text NOT NULL DEFAULT 'prepared',
  "error_message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "marketing_delivery_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE,
  "recipient_id" integer REFERENCES "marketing_campaign_recipients"("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'whatsapp_cloud',
  "provider_message_id" text,
  "event_type" text NOT NULL,
  "status" text NOT NULL,
  "error_code" text,
  "error_message" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "marketing_opt_ins" (
  "id" serial PRIMARY KEY NOT NULL,
  "student_id" integer REFERENCES "students"("id") ON DELETE CASCADE,
  "phone" text,
  "normalized_phone" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'whatsapp',
  "status" text NOT NULL DEFAULT 'opted_in',
  "source" text,
  "opted_in_at" timestamp with time zone,
  "opted_out_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "class_whatsapp_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "class_id" integer NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "schedule_id" integer REFERENCES "schedules"("id") ON DELETE CASCADE,
  "title" text,
  "group_url" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "marketing_templates_status_idx" ON "marketing_templates" ("status");
CREATE INDEX IF NOT EXISTS "marketing_campaign_recipients_campaign_idx" ON "marketing_campaign_recipients" ("campaign_id");
CREATE INDEX IF NOT EXISTS "marketing_campaign_recipients_phone_idx" ON "marketing_campaign_recipients" ("normalized_phone");
CREATE INDEX IF NOT EXISTS "marketing_delivery_logs_campaign_idx" ON "marketing_delivery_logs" ("campaign_id");
CREATE INDEX IF NOT EXISTS "marketing_opt_ins_phone_channel_idx" ON "marketing_opt_ins" ("normalized_phone", "channel");
CREATE INDEX IF NOT EXISTS "class_whatsapp_groups_class_idx" ON "class_whatsapp_groups" ("class_id");
