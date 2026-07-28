ALTER TABLE "bookings" ADD COLUMN "participant_type" text;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_participant_shape_check" CHECK (
  ("participant_type" is null and "participant_child_id" is null)
  or ("participant_type" = 'self' and "participant_child_id" is null)
  or ("participant_type" = 'child' and "participant_child_id" is not null)
);

CREATE INDEX "bookings_owner_participant_occurrence_idx"
  ON "bookings" ("account_owner_student_id", "participant_type", "participant_child_id", "schedule_id", "occurrence_date");
