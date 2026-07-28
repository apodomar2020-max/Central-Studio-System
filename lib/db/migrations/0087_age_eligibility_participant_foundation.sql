-- Phase A: additive age-eligibility and participant-identity foundations.
-- Existing rows remain valid; no ownership inference or data backfill occurs.

ALTER TABLE "children" ADD COLUMN "date_of_birth" date;

ALTER TABLE "classes" ADD COLUMN "allow_all_ages" boolean;
ALTER TABLE "classes" ADD COLUMN "min_age" smallint;
ALTER TABLE "classes" ADD COLUMN "max_age" smallint;
ALTER TABLE "classes" ADD CONSTRAINT "classes_age_range_shape_check" CHECK (
  ("allow_all_ages" IS NULL AND "min_age" IS NULL AND "max_age" IS NULL)
  OR ("allow_all_ages" = true AND "min_age" IS NULL AND "max_age" IS NULL)
  OR (
    "allow_all_ages" = false
    AND "min_age" IS NOT NULL
    AND "min_age" BETWEEN 0 AND 150
    AND ("max_age" IS NULL OR ("max_age" BETWEEN 0 AND 150 AND "min_age" <= "max_age"))
  )
);

ALTER TABLE "price_packages" ADD COLUMN "allow_all_ages" boolean;
ALTER TABLE "price_packages" ADD COLUMN "min_age" smallint;
ALTER TABLE "price_packages" ADD COLUMN "max_age" smallint;
ALTER TABLE "price_packages" ADD CONSTRAINT "price_packages_age_range_shape_check" CHECK (
  ("allow_all_ages" IS NULL AND "min_age" IS NULL AND "max_age" IS NULL)
  OR ("allow_all_ages" = true AND "min_age" IS NULL AND "max_age" IS NULL)
  OR (
    "allow_all_ages" = false
    AND "min_age" IS NOT NULL
    AND "min_age" BETWEEN 0 AND 150
    AND ("max_age" IS NULL OR ("max_age" BETWEEN 0 AND 150 AND "min_age" <= "max_age"))
  )
);

ALTER TABLE "package_orders" ADD COLUMN "participant_type" text;
ALTER TABLE "package_orders" ADD COLUMN "participant_child_id" integer;
ALTER TABLE "package_orders" ADD COLUMN "participant_name_snapshot" text;
ALTER TABLE "package_orders" ADD COLUMN "participant_date_of_birth_snapshot" date;
ALTER TABLE "package_orders" ADD COLUMN "participant_age_at_purchase" smallint;
ALTER TABLE "package_orders" ADD COLUMN "eligibility_evaluated_on" date;
ALTER TABLE "package_orders" ADD COLUMN "package_allow_all_ages_snapshot" boolean;
ALTER TABLE "package_orders" ADD COLUMN "package_min_age_snapshot" smallint;
ALTER TABLE "package_orders" ADD COLUMN "package_max_age_snapshot" smallint;
ALTER TABLE "package_orders" ADD COLUMN "allowed_dance_type_ids_snapshot" integer[];
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_participant_child_id_children_id_fk"
  FOREIGN KEY ("participant_child_id") REFERENCES "children"("id") ON DELETE SET NULL;
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_participant_shape_check" CHECK (
  ("participant_type" IS NULL AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'self' AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'child' AND "participant_child_id" IS NOT NULL)
);
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_participant_age_snapshot_check" CHECK (
  "participant_age_at_purchase" IS NULL OR "participant_age_at_purchase" BETWEEN 0 AND 150
);
ALTER TABLE "package_orders" ADD CONSTRAINT "package_orders_age_range_snapshot_check" CHECK (
  ("package_allow_all_ages_snapshot" IS NULL AND "package_min_age_snapshot" IS NULL AND "package_max_age_snapshot" IS NULL)
  OR ("package_allow_all_ages_snapshot" = true AND "package_min_age_snapshot" IS NULL AND "package_max_age_snapshot" IS NULL)
  OR (
    "package_allow_all_ages_snapshot" = false
    AND "package_min_age_snapshot" IS NOT NULL
    AND "package_min_age_snapshot" BETWEEN 0 AND 150
    AND (
      "package_max_age_snapshot" IS NULL
      OR ("package_max_age_snapshot" BETWEEN 0 AND 150 AND "package_min_age_snapshot" <= "package_max_age_snapshot")
    )
  )
);
CREATE INDEX "package_orders_owner_participant_status_idx"
  ON "package_orders" ("student_id", "participant_type", "participant_child_id", "status");
CREATE INDEX "package_orders_participant_child_status_idx"
  ON "package_orders" ("participant_child_id", "status");

ALTER TABLE "credit_transactions" ADD COLUMN "participant_type" text;
ALTER TABLE "credit_transactions" ADD COLUMN "participant_child_id" integer;
ALTER TABLE "credit_transactions" ADD COLUMN "booking_id" integer;
ALTER TABLE "credit_transactions" ADD COLUMN "attendance_id" integer;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_participant_child_id_children_id_fk"
  FOREIGN KEY ("participant_child_id") REFERENCES "children"("id") ON DELETE SET NULL;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_booking_id_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_attendance_id_attendance_id_fk"
  FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE SET NULL;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_participant_shape_check" CHECK (
  ("participant_type" IS NULL AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'self' AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'child' AND "participant_child_id" IS NOT NULL)
);
CREATE INDEX "credit_transactions_package_created_at_idx"
  ON "credit_transactions" ("package_order_id", "created_at");
CREATE INDEX "credit_transactions_participant_child_created_at_idx"
  ON "credit_transactions" ("participant_child_id", "created_at");
CREATE INDEX "credit_transactions_booking_id_idx" ON "credit_transactions" ("booking_id");
CREATE INDEX "credit_transactions_attendance_id_idx" ON "credit_transactions" ("attendance_id");

ALTER TABLE "bookings" ADD COLUMN "participant_date_of_birth_snapshot" date;
ALTER TABLE "bookings" ADD COLUMN "participant_age_on_occurrence" smallint;
ALTER TABLE "bookings" ADD COLUMN "eligibility_evaluated_on" date;
ALTER TABLE "bookings" ADD COLUMN "class_allow_all_ages_snapshot" boolean;
ALTER TABLE "bookings" ADD COLUMN "class_min_age_snapshot" smallint;
ALTER TABLE "bookings" ADD COLUMN "class_max_age_snapshot" smallint;
ALTER TABLE "bookings" ADD COLUMN "eligibility_decision_code" text;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_participant_age_snapshot_check" CHECK (
  "participant_age_on_occurrence" IS NULL OR "participant_age_on_occurrence" BETWEEN 0 AND 150
);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_class_age_range_snapshot_check" CHECK (
  ("class_allow_all_ages_snapshot" IS NULL AND "class_min_age_snapshot" IS NULL AND "class_max_age_snapshot" IS NULL)
  OR ("class_allow_all_ages_snapshot" = true AND "class_min_age_snapshot" IS NULL AND "class_max_age_snapshot" IS NULL)
  OR (
    "class_allow_all_ages_snapshot" = false
    AND "class_min_age_snapshot" IS NOT NULL
    AND "class_min_age_snapshot" BETWEEN 0 AND 150
    AND (
      "class_max_age_snapshot" IS NULL
      OR ("class_max_age_snapshot" BETWEEN 0 AND 150 AND "class_min_age_snapshot" <= "class_max_age_snapshot")
    )
  )
);

ALTER TABLE "attendance" ADD COLUMN "participant_type" text;
ALTER TABLE "attendance" ADD COLUMN "participant_child_id" integer;
ALTER TABLE "attendance" ADD COLUMN "participant_age_on_occurrence" smallint;
ALTER TABLE "attendance" ADD COLUMN "eligibility_evaluated_on" date;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_participant_child_id_children_id_fk"
  FOREIGN KEY ("participant_child_id") REFERENCES "children"("id") ON DELETE SET NULL;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_participant_shape_check" CHECK (
  ("participant_type" IS NULL AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'self' AND "participant_child_id" IS NULL)
  OR ("participant_type" IS NOT NULL AND "participant_type" = 'child' AND "participant_child_id" IS NOT NULL)
);
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_participant_age_snapshot_check" CHECK (
  "participant_age_on_occurrence" IS NULL OR "participant_age_on_occurrence" BETWEEN 0 AND 150
);
CREATE INDEX "attendance_participant_child_checked_in_at_idx"
  ON "attendance" ("participant_child_id", "checked_in_at");

ALTER TABLE "payment_records" ADD COLUMN "participant_type" text;
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_participant_shape_check" CHECK (
  "participant_type" IS NULL
  OR ("participant_type" = 'self' AND "child_id" IS NULL)
  OR ("participant_type" = 'child' AND "child_id" IS NOT NULL)
);
