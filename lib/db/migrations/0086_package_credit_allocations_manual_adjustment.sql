-- Migration 0086: Add manual_adjustment to package_credit_allocations event_type and replace unique index on credit_transaction_id with non-unique index

ALTER TABLE "package_credit_allocations" DROP CONSTRAINT IF EXISTS "package_credit_allocations_event_type_check";
ALTER TABLE "package_credit_allocations" ADD CONSTRAINT "package_credit_allocations_event_type_check" CHECK ("event_type" in ('consumption','expiration','reversal','refund_retirement','manual_adjustment'));

DROP INDEX IF EXISTS "package_credit_allocations_credit_transaction_unique";
CREATE INDEX IF NOT EXISTS "package_credit_allocations_credit_transaction_id_idx" ON "package_credit_allocations" ("credit_transaction_id");
