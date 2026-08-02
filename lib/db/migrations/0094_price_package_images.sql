-- Package Visual Redesign: admin-controlled artwork for package cards/details.
-- cardImageUrl backs the Home package card; detailsImageUrl backs the details
-- sheet hero (mobile falls back to cardImageUrl when details is empty).
ALTER TABLE "price_packages" ADD COLUMN "card_image_url" text;
ALTER TABLE "price_packages" ADD COLUMN "details_image_url" text;
