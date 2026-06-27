-- Task 1.3: Package cards gain CMS-managed feature bullets.
-- Add a text[] column (mirrors allowed_dance_types) defaulting to empty so all
-- existing packages remain valid. Idempotent guard for safe re-runs.
ALTER TABLE "price_packages" ADD COLUMN IF NOT EXISTS "features" text[] NOT NULL DEFAULT '{}';
