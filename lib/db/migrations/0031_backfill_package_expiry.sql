-- Task 6.1: backfill expires_at for already-active package orders whose expiry was
-- never computed (historically only activated_at was set). expires_at is derived
-- as activated_at + the linked package's validity window. Pending orders, orders
-- with no linked package, or packages with no validity are left NULL (no expiry).
UPDATE "package_orders" po
SET "expires_at" = po."activated_at" + (pp."validity_months" || ' months')::interval
FROM "price_packages" pp
WHERE po."package_id" = pp."id"
  AND po."status" = 'active'
  AND po."expires_at" IS NULL
  AND po."activated_at" IS NOT NULL
  AND pp."validity_months" > 0;
