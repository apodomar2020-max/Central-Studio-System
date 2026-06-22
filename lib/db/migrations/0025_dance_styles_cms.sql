ALTER TABLE "dance_types"
ADD COLUMN IF NOT EXISTS "description" text,
ADD COLUMN IF NOT EXISTS "icon_url" text,
ADD COLUMN IF NOT EXISTS "icon_svg" text,
ADD COLUMN IF NOT EXISTS "icon_mime" text,
ADD COLUMN IF NOT EXISTS "cover_image_url" text,
ADD COLUMN IF NOT EXISTS "color" text;
--> statement-breakpoint
ALTER TABLE "classes"
ADD COLUMN IF NOT EXISTS "dance_type_id" integer;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "classes" ADD CONSTRAINT "classes_dance_type_id_dance_types_id_fk"
    FOREIGN KEY ("dance_type_id") REFERENCES "dance_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "classes_dance_type_id_idx" ON "classes" ("dance_type_id");
