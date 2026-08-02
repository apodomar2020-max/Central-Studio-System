ALTER TABLE "payment_refunds" ADD COLUMN "request_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "completion_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "package_credit_allocations" ADD COLUMN "payment_refund_id" integer;
--> statement-breakpoint
ALTER TABLE "package_credit_allocations" ADD CONSTRAINT "package_credit_allocations_payment_refund_id_payment_refunds_id_fk" FOREIGN KEY ("payment_refund_id") REFERENCES "public"."payment_refunds"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_credit_allocations" ADD CONSTRAINT "package_credit_allocations_refund_linkage_check" CHECK (("event_type" = 'refund_retirement' and "payment_refund_id" is not null) or ("event_type" <> 'refund_retirement' and "payment_refund_id" is null));
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_request_idempotency_key_unique" ON "payment_refunds" USING btree ("request_idempotency_key") WHERE "request_idempotency_key" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_completion_idempotency_key_unique" ON "payment_refunds" USING btree ("completion_idempotency_key") WHERE "completion_idempotency_key" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "package_credit_allocations_refund_lot_unique" ON "package_credit_allocations" USING btree ("payment_refund_id", "lot_id") WHERE "event_type" = 'refund_retirement';
