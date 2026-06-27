-- Task 1.1: Hero becomes an image-only carousel.
-- Drop the legacy content columns. The hero now consists of: image_url,
-- button_route (tap target), sort_order, is_active (+ id / created_at).
-- Idempotent guards so the migration is safe to re-run.
ALTER TABLE "hero_items" DROP COLUMN IF EXISTS "title";
ALTER TABLE "hero_items" DROP COLUMN IF EXISTS "tagline";
ALTER TABLE "hero_items" DROP COLUMN IF EXISTS "button_text";
