ALTER TABLE "attendance"
  ADD COLUMN "participant_date_of_birth_snapshot" date,
  ADD COLUMN "attendance_source" text,
  ADD COLUMN "payment_source" text;

ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_source_check"
  CHECK (
    "attendance_source" IS NULL
    OR "attendance_source" IN ('booking', 'walk_in')
  );

ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_payment_source_check"
  CHECK (
    "payment_source" IS NULL
    OR "payment_source" IN (
      'booking_package_credit',
      'booking_pay_at_studio',
      'walk_in_package_credit',
      'walk_in_pay_at_studio'
    )
  );

CREATE INDEX "attendance_owner_participant_checked_in_at_idx"
  ON "attendance" ("student_id", "participant_type", "participant_child_id", "checked_in_at");
