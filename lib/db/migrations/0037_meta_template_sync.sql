ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "meta_template_id" text;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "header_type" text;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "header_text" text;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "footer" text;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "buttons" jsonb;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "rejected_reason" text;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "marketing_templates" ADD COLUMN IF NOT EXISTS "raw_meta_payload" jsonb;
