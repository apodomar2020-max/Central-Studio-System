ALTER TABLE "ballet_settings" ADD COLUMN IF NOT EXISTS "home_card_image_url" text;--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "pre_ballet_price_egp";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "pre_ballet_hours_monthly";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "levels_price_egp";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "levels_hours_monthly";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "few_seats_threshold";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "assessment_instructions";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "requirements";--> statement-breakpoint
ALTER TABLE "ballet_settings" DROP COLUMN IF EXISTS "acceptance_message_template";
