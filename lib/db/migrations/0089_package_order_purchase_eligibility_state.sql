-- Phase C: persist the immutable purchase-time package configuration state.
-- Existing development rows remain legacy-compatible; no data is backfilled.

ALTER TABLE "package_orders"
  ADD COLUMN "purchase_eligibility_configuration_state" text;

ALTER TABLE "package_orders"
  ADD CONSTRAINT "package_orders_purchase_eligibility_configuration_state_check"
  CHECK (
    "purchase_eligibility_configuration_state" IS NULL
    OR "purchase_eligibility_configuration_state" IN ('configured', 'legacy_unconfigured')
  );
