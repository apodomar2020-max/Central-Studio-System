-- Performance Phase 1: non-destructive indexes for existing backend query paths.
-- No table changes, no query behavior changes, and no pg_trgm/search indexes here.

-- Bookings: account owner history and paginated listing.
CREATE INDEX IF NOT EXISTS "bookings_account_owner_created_at_idx"
  ON "bookings" ("account_owner_student_id", "created_at" DESC);

-- Bookings: legacy/student-email scoped lookups using the existing normalized expression.
CREATE INDEX IF NOT EXISTS "bookings_student_email_norm_created_at_idx"
  ON "bookings" (lower(trim("student_email")), "created_at" DESC);

-- Bookings: admin status filters with newest-first ordering.
CREATE INDEX IF NOT EXISTS "bookings_booking_status_created_at_idx"
  ON "bookings" ("booking_status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "bookings_payment_status_created_at_idx"
  ON "bookings" ("payment_status", "created_at" DESC);

-- Bookings: reports/export sorting by booked date.
CREATE INDEX IF NOT EXISTS "bookings_booked_at_idx"
  ON "bookings" ("booked_at" DESC);

-- Bookings: reserved-seat counts and occurrence-scoped schedule lookups.
CREATE INDEX IF NOT EXISTS "bookings_schedule_occurrence_status_idx"
  ON "bookings" ("schedule_id", "occurrence_date", "booking_status");

-- Attendance: student history and newest-first attendance screens.
CREATE INDEX IF NOT EXISTS "attendance_student_email_checked_in_at_idx"
  ON "attendance" ("student_email", "checked_in_at" DESC);

CREATE INDEX IF NOT EXISTS "attendance_student_email_norm_checked_in_at_idx"
  ON "attendance" (lower(trim("student_email")), "checked_in_at" DESC);

-- Attendance: check-in duplicate/booking-attendance lookups and global sorting.
CREATE INDEX IF NOT EXISTS "attendance_booking_id_idx"
  ON "attendance" ("booking_id");

CREATE INDEX IF NOT EXISTS "attendance_checked_in_at_idx"
  ON "attendance" ("checked_in_at" DESC);

-- Package orders: student package history and status dashboards.
CREATE INDEX IF NOT EXISTS "package_orders_student_email_created_at_idx"
  ON "package_orders" ("student_email", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "package_orders_student_email_status_created_at_idx"
  ON "package_orders" ("student_email", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "package_orders_status_created_at_idx"
  ON "package_orders" ("status", "created_at" DESC);

-- Students: admin listing and report ordering.
CREATE INDEX IF NOT EXISTS "students_joined_at_idx"
  ON "students" ("joined_at" DESC);

CREATE INDEX IF NOT EXISTS "students_account_type_joined_at_idx"
  ON "students" ("account_type", "joined_at" DESC);
