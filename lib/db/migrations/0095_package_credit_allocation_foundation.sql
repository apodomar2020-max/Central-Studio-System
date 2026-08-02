-- Package Credit Allocation Foundation — Phase A (database only).
-- Ships dark: no backfill, writers, triggers, procedures, or business-flow changes.

ALTER TABLE "package_orders" ADD COLUMN "purchase_unit_price_minor" integer;
--> statement-breakpoint
ALTER TABLE "package_orders" ADD COLUMN "price_snapshot_basis" text;
--> statement-breakpoint
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_price_snapshot_basis_check" CHECK ("price_snapshot_basis" is null or "price_snapshot_basis" in ('recorded_purchase_price', 'estimated_catalog_price', 'unknown'));
--> statement-breakpoint

CREATE TABLE "package_credit_lots" (
  "id" serial PRIMARY KEY NOT NULL,
  "package_order_id" integer NOT NULL,
  "source_type" text NOT NULL,
  "credits_issued" integer NOT NULL,
  "credits_remaining" integer NOT NULL,
  "total_value_minor" integer,
  "value_basis" text NOT NULL,
  "expires_at" timestamp with time zone,
  "issuing_credit_transaction_id" integer NOT NULL,
  "restored_from_allocation_id" integer,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  CONSTRAINT "package_credit_lots_source_type_check" CHECK ("source_type" in ('purchased','bonus','manual_complimentary','manual_paid','restored','legacy_unknown')),
  CONSTRAINT "package_credit_lots_credits_issued_positive_check" CHECK ("credits_issued" > 0),
  CONSTRAINT "package_credit_lots_credits_remaining_range_check" CHECK ("credits_remaining" >= 0 and "credits_remaining" <= "credits_issued"),
  CONSTRAINT "package_credit_lots_total_value_non_negative_check" CHECK ("total_value_minor" is null or "total_value_minor" >= 0),
  CONSTRAINT "package_credit_lots_value_basis_check" CHECK ("value_basis" in ('recorded_purchase_price','estimated_catalog_price','unknown')),
  CONSTRAINT "package_credit_lots_package_order_id_package_orders_id_fk" FOREIGN KEY ("package_order_id") REFERENCES "public"."package_orders"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_lots_issuing_credit_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("issuing_credit_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint

CREATE TABLE "package_credit_allocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "lot_id" integer NOT NULL,
  "event_type" text NOT NULL,
  "credit_transaction_id" integer NOT NULL,
  "package_order_id" integer NOT NULL,
  "attendance_id" integer,
  "booking_id" integer,
  "schedule_id" integer,
  "branch_id" integer,
  "room_id" integer,
  "credits" integer NOT NULL,
  "unit_value_minor" integer,
  "total_value_minor" integer DEFAULT 0 NOT NULL,
  "value_basis" text NOT NULL,
  "policy_version" text NOT NULL,
  "reverses_allocation_id" integer,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  CONSTRAINT "package_credit_allocations_event_type_check" CHECK ("event_type" in ('consumption','expiration','reversal','refund_retirement')),
  CONSTRAINT "package_credit_allocations_credits_positive_check" CHECK ("credits" > 0),
  CONSTRAINT "package_credit_allocations_total_value_non_negative_check" CHECK ("total_value_minor" >= 0),
  CONSTRAINT "package_credit_allocations_value_basis_check" CHECK ("value_basis" in ('recorded_purchase_price','estimated_catalog_price','unknown')),
  CONSTRAINT "package_credit_allocations_lot_id_package_credit_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."package_credit_lots"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_credit_transaction_id_credit_transactions_id_fk" FOREIGN KEY ("credit_transaction_id") REFERENCES "public"."credit_transactions"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_package_order_id_package_orders_id_fk" FOREIGN KEY ("package_order_id") REFERENCES "public"."package_orders"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_branch_id_studio_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."studio_branches"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_room_id_studio_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."studio_rooms"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "package_credit_allocations_reverses_allocation_id_package_credit_allocations_id_fk" FOREIGN KEY ("reverses_allocation_id") REFERENCES "public"."package_credit_allocations"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint

ALTER TABLE "package_credit_lots" ADD CONSTRAINT "package_credit_lots_restored_from_allocation_id_package_credit_allocations_id_fk" FOREIGN KEY ("restored_from_allocation_id") REFERENCES "public"."package_credit_allocations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "package_credit_lots_issuing_transaction_unique" ON "package_credit_lots" USING btree ("issuing_credit_transaction_id");
--> statement-breakpoint
CREATE INDEX "package_credit_lots_package_order_id_idx" ON "package_credit_lots" USING btree ("package_order_id");
--> statement-breakpoint
CREATE INDEX "package_credit_lots_source_type_idx" ON "package_credit_lots" USING btree ("source_type");
--> statement-breakpoint
CREATE INDEX "package_credit_lots_remaining_idx" ON "package_credit_lots" USING btree ("credits_remaining") WHERE "credits_remaining" > 0;
--> statement-breakpoint
CREATE INDEX "package_credit_lots_expires_at_remaining_idx" ON "package_credit_lots" USING btree ("expires_at") WHERE "credits_remaining" > 0;
--> statement-breakpoint
CREATE UNIQUE INDEX "package_credit_allocations_credit_transaction_unique" ON "package_credit_allocations" USING btree ("credit_transaction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "package_credit_allocations_consumption_attendance_unique" ON "package_credit_allocations" USING btree ("attendance_id") WHERE "event_type" = 'consumption' AND "attendance_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "package_credit_allocations_lot_id_idx" ON "package_credit_allocations" USING btree ("lot_id");
--> statement-breakpoint
CREATE INDEX "package_credit_allocations_package_order_id_idx" ON "package_credit_allocations" USING btree ("package_order_id");
--> statement-breakpoint
CREATE INDEX "package_credit_allocations_schedule_id_idx" ON "package_credit_allocations" USING btree ("schedule_id");
--> statement-breakpoint
CREATE INDEX "package_credit_allocations_branch_id_idx" ON "package_credit_allocations" USING btree ("branch_id");
