CREATE UNIQUE INDEX IF NOT EXISTS "credit_transactions_one_package_activation_idx"
ON "credit_transactions" ("package_order_id")
WHERE "type" = 'package_activated';
