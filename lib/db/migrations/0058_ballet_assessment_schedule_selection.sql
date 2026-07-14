ALTER TABLE "ballet_applications" ADD COLUMN IF NOT EXISTS "assessment_schedule_id" integer;--> statement-breakpoint
ALTER TABLE "ballet_applications" ADD COLUMN IF NOT EXISTS "assessment_date" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ballet_applications" ADD CONSTRAINT "ballet_applications_assessment_schedule_id_ballet_schedules_id_fk" FOREIGN KEY ("assessment_schedule_id") REFERENCES "public"."ballet_schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ballet_applications_assessment_schedule_idx" ON "ballet_applications" ("assessment_schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ballet_applications_assessment_date_idx" ON "ballet_applications" ("assessment_date");
