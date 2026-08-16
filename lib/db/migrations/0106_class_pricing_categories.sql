-- Migration 0106: Category-based General Class walk-in pricing (Adults / Teens / Kids)
--
-- WHY: Class Pricing today is one global fallback (class_pricing_settings.
-- single_class_price_egp), optionally overridden per-schedule. The business
-- requires three independently-configurable walk-in prices — Adults, Teens,
-- Kids — resolved in this order: schedule override -> class's pricing
-- category -> category price -> legacy single price.
--
-- EXISTING DATA IMPACT: none. Both changes are purely additive:
--   1. classes.pricing_category is a new NULLABLE column with NO backfill.
--      Legacy `age_group` is free text and not a reliable signal for pricing
--      category (per the locked spec — no age_group -> pricing_category
--      inference), so every existing class starts UNASSIGNED (null) and the
--      resolver's category step never resolves for it, meaning every
--      existing class keeps resolving through the exact same
--      schedule-override -> single_class_price_egp path it uses today. An
--      Admin must explicitly assign a category (Admin -> Classes) before
--      category pricing takes effect for that class.
--   2. class_pricing_settings gains three nullable columns
--      (adults/teens/kids_walkin_price_egp), backfilled below to the
--      CURRENT single_class_price_egp value on the one settings row that
--      exists today, so the moment a class IS assigned a category its
--      resolved price is byte-identical to what it was the moment before —
--      Admin then edits each category price independently afterward.
--
-- No historical bookings/attendance/payment_records rows are touched by this
-- migration — those are the immutable financial snapshots and are never
-- recalculated by this or any later category-price change.
--
-- ROLLBACK: revert the application code (resolver/routes/UI) to stop reading
-- the new columns — that alone fully disables the feature with zero data
-- loss, since nothing here mutates an existing column. If the columns
-- themselves need to be dropped too:
--   ALTER TABLE classes DROP COLUMN IF EXISTS pricing_category;
--   ALTER TABLE class_pricing_settings
--     DROP COLUMN IF EXISTS adults_walkin_price_egp,
--     DROP COLUMN IF EXISTS teens_walkin_price_egp,
--     DROP COLUMN IF EXISTS kids_walkin_price_egp;
-- This drops no booking/payment/attendance data — only the pricing
-- configuration introduced by this migration.

ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "pricing_category" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_pricing_category_check'
  ) THEN
    ALTER TABLE "classes" ADD CONSTRAINT "classes_pricing_category_check"
      CHECK ("pricing_category" IS NULL OR "pricing_category" IN ('adults', 'teens', 'kids'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "class_pricing_settings" ADD COLUMN IF NOT EXISTS "adults_walkin_price_egp" integer;
--> statement-breakpoint
ALTER TABLE "class_pricing_settings" ADD COLUMN IF NOT EXISTS "teens_walkin_price_egp" integer;
--> statement-breakpoint
ALTER TABLE "class_pricing_settings" ADD COLUMN IF NOT EXISTS "kids_walkin_price_egp" integer;
--> statement-breakpoint
-- Backfill: seed every category price from today's single_class_price_egp so
-- resolved prices do not change until an Admin edits a category explicitly.
-- COALESCE guards re-running this migration from clobbering an
-- already-configured value (defensive; the runner only applies it once).
UPDATE "class_pricing_settings"
SET
  "adults_walkin_price_egp" = COALESCE("adults_walkin_price_egp", "single_class_price_egp"),
  "teens_walkin_price_egp" = COALESCE("teens_walkin_price_egp", "single_class_price_egp"),
  "kids_walkin_price_egp" = COALESCE("kids_walkin_price_egp", "single_class_price_egp")
WHERE "id" = 1;
