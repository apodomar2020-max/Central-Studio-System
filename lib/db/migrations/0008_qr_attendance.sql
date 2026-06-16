-- Migration 0008: QR Attendance System
--
-- Adds a secure, opaque QR token to each student and links attendance
-- records to actual class/schedule rows.
--
-- Safety rules applied throughout:
--   - All new attendance columns are nullable  → existing records stay valid.
--   - qr_token uses DEFAULT gen_random_uuid() → all existing students get
--     a unique token automatically on migration (PostgreSQL 13+ built-in).
--   - IF NOT EXISTS guards make every statement idempotent / safe to re-run.
--   - FK references use ON DELETE SET NULL so deleting a class or schedule
--     does not cascade-delete attendance history.

-- ---------------------------------------------------------------------------
-- 1. students — add QR token
-- ---------------------------------------------------------------------------
ALTER TABLE "students"
  ADD COLUMN IF NOT EXISTS "qr_token" uuid NOT NULL DEFAULT gen_random_uuid();

-- Enforce uniqueness via a dedicated index (fast lookup path for by-token route)
CREATE UNIQUE INDEX IF NOT EXISTS "students_qr_token_idx"
  ON "students" ("qr_token");

-- ---------------------------------------------------------------------------
-- 2. attendance — add FK columns
-- ---------------------------------------------------------------------------
ALTER TABLE "attendance"
  ADD COLUMN IF NOT EXISTS "student_id"  integer REFERENCES "students"("id")  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "class_id"    integer REFERENCES "classes"("id")    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "schedule_id" integer REFERENCES "schedules"("id")  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Indexes to support duplicate-attendance prevention query
-- ---------------------------------------------------------------------------
-- Used by POST /api/attendance when classId or scheduleId is provided:
--   WHERE student_email = $1 AND schedule_id = $2 AND checked_in_at::date = CURRENT_DATE
CREATE INDEX IF NOT EXISTS "attendance_dedup_schedule_idx"
  ON "attendance" ("student_email", "schedule_id", "checked_in_at");

CREATE INDEX IF NOT EXISTS "attendance_dedup_class_idx"
  ON "attendance" ("student_email", "class_id", "checked_in_at");
