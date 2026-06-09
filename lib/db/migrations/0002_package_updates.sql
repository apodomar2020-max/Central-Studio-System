-- Migration: add validity_months, single_class_price_egp, allowed_dance_types to price_packages
ALTER TABLE "price_packages" ADD COLUMN IF NOT EXISTS "validity_months" integer NOT NULL DEFAULT 6;
ALTER TABLE "price_packages" ADD COLUMN IF NOT EXISTS "single_class_price_egp" real;
ALTER TABLE "price_packages" ADD COLUMN IF NOT EXISTS "allowed_dance_types" text[] NOT NULL DEFAULT '{}';
