DROP INDEX IF EXISTS "ballet_applications_slot_idx";--> statement-breakpoint
ALTER TABLE "ballet_applications" DROP CONSTRAINT IF EXISTS "ballet_applications_slot_id_ballet_assessment_slots_id_fk";--> statement-breakpoint
ALTER TABLE "ballet_applications" DROP COLUMN IF EXISTS "slot_id";--> statement-breakpoint
ALTER TABLE "ballet_applications" DROP COLUMN IF EXISTS "slot_label";--> statement-breakpoint
DROP TABLE IF EXISTS "ballet_assessment_slots";
