-- Task 3.5 (occurrence-aware): a booking is tied to a specific class occurrence.
-- Add a nullable date column (legacy rows stay null and are treated as
-- schedule-level legacy bookings — they never block new occurrence bookings).
-- Index the (schedule_id, occurrence_date) pair for the duplicate guard + counts.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "occurrence_date" date;
CREATE INDEX IF NOT EXISTS "bookings_schedule_occurrence_idx"
  ON "bookings" ("schedule_id", "occurrence_date");
