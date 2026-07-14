-- Migration 0056: Ballet monthly subscription lifecycle
--
-- Extends ballet_payments so each paid payment row can represent one
-- subscription/payment cycle with date-only validity, renewal linkage, and
-- extension history. Existing rows stay valid: every lifecycle column is
-- nullable or has a safe default.

ALTER TABLE "ballet_payments" ADD COLUMN "subscription_start_date" text;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD COLUMN "subscription_expires_at" text;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD COLUMN "original_expires_at" text;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD COLUMN "is_renewal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD COLUMN "renewed_from_id" integer;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD COLUMN "extension_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ballet_payments" ADD CONSTRAINT "ballet_payments_renewed_from_id_ballet_payments_id_fk" FOREIGN KEY ("renewed_from_id") REFERENCES "public"."ballet_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ballet_payments_application_subscription_idx" ON "ballet_payments" USING btree ("application_id","status","subscription_start_date","subscription_expires_at");--> statement-breakpoint
CREATE INDEX "ballet_payments_renewed_from_idx" ON "ballet_payments" USING btree ("renewed_from_id");--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ballet_payments"
    WHERE "subscription_start_date" IS NOT NULL
      AND "subscription_expires_at" IS NOT NULL
      AND "subscription_expires_at" <= "subscription_start_date"
  ) THEN
    RAISE EXCEPTION 'Invalid Ballet subscription dates detected: subscription_expires_at must be later than subscription_start_date.';
  END IF;
END $$;
