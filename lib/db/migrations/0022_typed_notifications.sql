ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "related_entity_type" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "related_entity_id" integer;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
