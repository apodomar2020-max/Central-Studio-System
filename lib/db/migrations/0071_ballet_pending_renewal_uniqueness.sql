CREATE UNIQUE INDEX IF NOT EXISTS "ballet_payments_open_pending_renewal_idx"
ON "ballet_payments" ("application_id", "renewed_from_id")
WHERE "is_renewal" = true
  AND "renewed_from_id" IS NOT NULL
  AND "status" = 'pending';
