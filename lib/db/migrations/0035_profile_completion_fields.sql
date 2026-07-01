-- Profile Completion Engine (Phase 4): additional student profile fields +
-- the "Your Vibe" dance-interests join table.
--
-- All new students columns are nullable — every existing account (and every
-- new one before it completes the corresponding step) simply reads as
-- "missing" for that field, which is the correct/intended state, not a bug.
-- Completion percentage is deliberately NOT stored anywhere; it is always
-- derived fresh from these columns (see artifacts/api-server/src/lib/profileCompletion.ts).
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "gender" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "nationality" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "how_did_you_hear_about_us" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "policies_accepted_at" timestamp with time zone;
-- Resume-support only (see schema comment) — not the source of truth for completion.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "last_completion_step" text;

CREATE TABLE IF NOT EXISTS "student_dance_interests" (
  "id" serial PRIMARY KEY,
  "student_id" integer NOT NULL,
  "dance_type_id" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_dance_interests_student_id_students_id_fk'
  ) THEN
    ALTER TABLE "student_dance_interests"
      ADD CONSTRAINT "student_dance_interests_student_id_students_id_fk"
      FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_dance_interests_dance_type_id_dance_types_id_fk'
  ) THEN
    ALTER TABLE "student_dance_interests"
      ADD CONSTRAINT "student_dance_interests_dance_type_id_dance_types_id_fk"
      FOREIGN KEY ("dance_type_id") REFERENCES "dance_types"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_dance_interests_student_id_dance_type_id_unique'
  ) THEN
    ALTER TABLE "student_dance_interests"
      ADD CONSTRAINT "student_dance_interests_student_id_dance_type_id_unique"
      UNIQUE ("student_id", "dance_type_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "student_dance_interests_student_id_idx"
  ON "student_dance_interests" ("student_id");
