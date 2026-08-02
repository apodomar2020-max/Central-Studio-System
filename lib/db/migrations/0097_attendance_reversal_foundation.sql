CREATE TABLE "attendance_reversals" (
	"id" serial PRIMARY KEY NOT NULL,
	"attendance_id" integer NOT NULL,
	"original_consumption_allocation_id" integer NOT NULL,
	"package_order_id" integer NOT NULL,
	"booking_id" integer,
	"status" text NOT NULL,
	"request_idempotency_key" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"completed_by" text,
	"rejected_by" text,
	"failed_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"resulting_credit_transaction_id" integer,
	"resulting_reversal_allocation_id" integer,
	"resulting_restored_lot_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_reversals_status_check" CHECK ("status" in ('requested','approved','rejected','completed','failed')),
	CONSTRAINT "attendance_reversals_reason_code_not_blank_check" CHECK (btrim("reason_code") <> ''),
	CONSTRAINT "attendance_reversals_reason_not_blank_check" CHECK (btrim("reason") <> ''),
	CONSTRAINT "attendance_reversals_requested_by_not_blank_check" CHECK (btrim("requested_by") <> ''),
	CONSTRAINT "attendance_reversals_approved_shape_check" CHECK ("status" <> 'approved' or ("approved_by" is not null and "approved_at" is not null)),
	CONSTRAINT "attendance_reversals_rejected_shape_check" CHECK ("status" <> 'rejected' or ("rejected_by" is not null and "rejected_at" is not null)),
	CONSTRAINT "attendance_reversals_failed_shape_check" CHECK ("status" <> 'failed' or ("failed_by" is not null and "failed_at" is not null)),
	CONSTRAINT "attendance_reversals_completed_shape_check" CHECK ("status" <> 'completed' or ("completed_by" is not null and "completed_at" is not null and "resulting_credit_transaction_id" is not null and "resulting_reversal_allocation_id" is not null and "resulting_restored_lot_id" is not null)),
	CONSTRAINT "attendance_reversals_results_completed_only_check" CHECK ("status" = 'completed' or ("resulting_credit_transaction_id" is null and "resulting_reversal_allocation_id" is null and "resulting_restored_lot_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_original_consumption_allocation_id_package_credit_allocations_id_fk" FOREIGN KEY ("original_consumption_allocation_id") REFERENCES "public"."package_credit_allocations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_package_order_id_package_orders_id_fk" FOREIGN KEY ("package_order_id") REFERENCES "public"."package_orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_resulting_credit_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("resulting_credit_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_resulting_reversal_allocation_id_package_credit_allocations_id_fk" FOREIGN KEY ("resulting_reversal_allocation_id") REFERENCES "public"."package_credit_allocations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_reversals" ADD CONSTRAINT "attendance_reversals_resulting_restored_lot_id_package_credit_lots_id_fk" FOREIGN KEY ("resulting_restored_lot_id") REFERENCES "public"."package_credit_lots"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "package_credit_allocations" ADD CONSTRAINT "package_credit_allocations_reversal_linkage_check" CHECK (("event_type" = 'reversal' and "reverses_allocation_id" is not null and "payment_refund_id" is null) or ("event_type" <> 'reversal' and "reverses_allocation_id" is null));
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_request_idempotency_unique" ON "attendance_reversals" USING btree ("request_idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_completed_attendance_unique" ON "attendance_reversals" USING btree ("attendance_id") WHERE "status" = 'completed';
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_completed_consumption_unique" ON "attendance_reversals" USING btree ("original_consumption_allocation_id") WHERE "status" = 'completed';
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_resulting_transaction_unique" ON "attendance_reversals" USING btree ("resulting_credit_transaction_id") WHERE "resulting_credit_transaction_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_resulting_allocation_unique" ON "attendance_reversals" USING btree ("resulting_reversal_allocation_id") WHERE "resulting_reversal_allocation_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_reversals_resulting_lot_unique" ON "attendance_reversals" USING btree ("resulting_restored_lot_id") WHERE "resulting_restored_lot_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "package_credit_allocations_reversal_original_unique" ON "package_credit_allocations" USING btree ("reverses_allocation_id") WHERE "event_type" = 'reversal' AND "reverses_allocation_id" is not null;
