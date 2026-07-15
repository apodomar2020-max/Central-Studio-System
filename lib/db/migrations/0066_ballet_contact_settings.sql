-- Migration 0066: Ballet contact settings
-- Adds admin-managed contact fields for the mobile Ballet Contact page.

ALTER TABLE "ballet_settings"
  ADD COLUMN IF NOT EXISTS "whatsapp_number" text,
  ADD COLUMN IF NOT EXISTS "phone_number" text,
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "studio_location_url" text;
