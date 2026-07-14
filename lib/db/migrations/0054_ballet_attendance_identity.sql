-- Migration 0054: Ballet attendance identity + duplicate prevention (Phase B / C3)
--
-- Adds the minimal columns needed to record a Ballet-specific attendance row
-- against an enrolled student's identity, and a partial unique index that
-- prevents recording the same (student, schedule slot, calendar date) twice.
--
--   attendance.ballet_level_assignment_id  → ballet_level_assignments.id
--       The enrolled-student identity for a ballet check-in (a child's ballet
--       identity is their active enrollment, not the raw student row).
--       Nullable — every existing/non-ballet attendance row is unaffected and
--       stays valid. ON DELETE CASCADE (D1 correction — amended here rather
--       than via a follow-up migration, since 0053/0054 were still
--       uncommitted/unapplied at the time of this correction): the level
--       assignment IS this row's Ballet identity, so an attendance row has no
--       meaning once its assignment is deleted — unlike ballet_class_id /
--       ballet_schedule_id above, which are optional cross-references and
--       correctly stay ON DELETE SET NULL.
--   attendance.class_date (date)
--       The calendar day the class occurred (distinct from checked_in_at,
--       which is when the row was recorded).
--   attendance.duration_minutes (integer, D1 correction)
--       A snapshot of the class's duration (in minutes) AT THE TIME
--       attendance was recorded. Nullable for legacy/non-Ballet rows. The
--       monthly hours calculation (lib/balletAttendance.ts) reads this stored
--       value, never a live join to ballet_schedules.duration_mins, so a
--       later edit to a schedule's duration never retroactively changes a
--       past month's totals.
--
-- Partial unique index attendance_ballet_unique_per_slot_date on
-- (ballet_level_assignment_id, ballet_schedule_id, class_date)
-- WHERE ballet_level_assignment_id IS NOT NULL. Deliberately keyed on
-- ballet_schedule_id too — NOT (assignment, date) alone — because a child can
-- attend more than one ballet class on the same date, and each schedule slot
-- is a distinct attendance identity. Partial so only ballet rows are covered.
--
-- Journal "when" set to 1784462409000 (> 0053's 1784462408000), following this
-- repo's +1000ms-per-migration convention so the installed drizzle-orm migrator
-- (pending-detection by "when", not idx) never skips it.

ALTER TABLE "attendance" ADD COLUMN "ballet_level_assignment_id" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "class_date" date;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_ballet_level_assignment_id_ballet_level_assignments_id_fk" FOREIGN KEY ("ballet_level_assignment_id") REFERENCES "public"."ballet_level_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Preflight (mirrors migration 0050's DO $$ ... RAISE EXCEPTION style).
-- Trivially passes on any existing database: both new columns start NULL on
-- every existing row, so no row satisfies the index's partial predicate
-- (ballet_level_assignment_id IS NOT NULL) and there is nothing to collide.
-- Kept anyway so the guarantee is explicit and this migration behaves
-- consistently if re-run against data that somehow already populated these
-- columns out-of-band.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count FROM (
    SELECT "ballet_level_assignment_id", "ballet_schedule_id", "class_date"
    FROM "attendance"
    WHERE "ballet_level_assignment_id" IS NOT NULL
    GROUP BY "ballet_level_assignment_id", "ballet_schedule_id", "class_date"
    HAVING count(*) > 1
  ) "conflicts";

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Aborting attendance_ballet_unique_per_slot_date (migration 0054): % (ballet_level_assignment_id, ballet_schedule_id, class_date) group(s) already have more than one attendance row. Inspect with: SELECT ballet_level_assignment_id, ballet_schedule_id, class_date, array_agg(id) FROM attendance WHERE ballet_level_assignment_id IS NOT NULL GROUP BY ballet_level_assignment_id, ballet_schedule_id, class_date HAVING count(*) > 1;', conflict_count;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "attendance_ballet_unique_per_slot_date" ON "attendance" USING btree ("ballet_level_assignment_id","ballet_schedule_id","class_date") WHERE "attendance"."ballet_level_assignment_id" is not null;
