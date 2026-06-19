ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "account_owner_student_id" integer;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "participant_child_id" integer;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "booking_scope" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_account_owner_student_id_students_id_fk'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_account_owner_student_id_students_id_fk"
      FOREIGN KEY ("account_owner_student_id") REFERENCES "students"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_participant_child_id_children_id_fk'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_participant_child_id_children_id_fk"
      FOREIGN KEY ("participant_child_id") REFERENCES "children"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_booking_scope_check'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_booking_scope_check"
      CHECK ("booking_scope" IS NULL OR "booking_scope" IN ('self', 'child'));
  END IF;
END $$;

UPDATE "bookings" b
SET
  "account_owner_student_id" = COALESCE(b."account_owner_student_id", s."id"),
  "booking_scope" = COALESCE(b."booking_scope", 'self')
FROM "students" s
WHERE lower(trim(b."student_email")) = lower(trim(s."email"));

UPDATE "bookings"
SET "booking_scope" = 'self'
WHERE "booking_scope" IS NULL;
