-- Migration 0063: Ballet performance mobile fields
-- Adds display and visibility fields for future mobile Performance Opportunities cards.

ALTER TABLE "ballet_performance_opportunities"
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "image_url" text,
  ADD COLUMN IF NOT EXISTS "external_cta_url" text,
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;

ALTER TABLE "ballet_performance_opportunities"
  ADD CONSTRAINT "ballet_performance_opportunities_status_check"
  CHECK ("status" IN ('active', 'inactive'));
