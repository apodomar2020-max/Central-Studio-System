-- Additive migration 0102: Ballet Assessment Fee configuration & tracking fields

-- 1. Add configurable assessment_fee_egp to single-row ballet_settings table
ALTER TABLE "ballet_settings"
ADD COLUMN IF NOT EXISTS "assessment_fee_egp" integer;

-- 2. Add assessment fee tracking columns to ballet_applications table
ALTER TABLE "ballet_applications"
ADD COLUMN IF NOT EXISTS "assessment_fee_amount_egp" integer,
ADD COLUMN IF NOT EXISTS "assessment_fee_status" text NOT NULL DEFAULT 'unpaid',
ADD COLUMN IF NOT EXISTS "assessment_fee_paid_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "assessment_fee_payment_method" text,
ADD COLUMN IF NOT EXISTS "assessment_fee_recorded_by_id" integer REFERENCES "system_users"("id") ON DELETE SET NULL;
