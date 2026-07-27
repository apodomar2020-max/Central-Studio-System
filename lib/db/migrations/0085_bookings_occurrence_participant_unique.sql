-- Migration 0085: Finance Final Closure Batch 1 (Part F2) — DB-level
-- backstop for the occurrence-aware duplicate-booking guard bookings.ts
-- already enforces at the application level (identical scheduleId/
-- occurrenceDate/participant/status keying — see the duplicate_booking
-- check in POST /bookings). The app-level check-then-insert has no row
-- lock around it, so two truly concurrent requests could both pass it
-- before either commits; this index makes that impossible at the
-- database layer instead of merely reducing the odds.
--
-- Deliberately partial and narrow, per the historical-data policy (never
-- repair/backfill old rows):
--   * occurrence_date IS NOT NULL — every legacy pre-occurrence-model
--     booking has occurrence_date null and is entirely excluded; this
--     constraint applies only to future/new occurrence-specific bookings.
--   * account_owner_student_id IS NOT NULL — same reasoning for
--     pre-Membership-Engine legacy rows with no owner FK populated yet.
--   * booking_status IN ('pending','confirmed') — mirrors
--     DUPLICATE_BLOCKING_STATUSES exactly; a cancelled/rejected/attended
--     booking never blocks a new one for the same occurrence.
--
-- coalesce(participant_child_id, 0) rather than a plain column: Postgres
-- treats NULL as distinct from NULL in a unique index by default, which
-- would let two different "self" (participant_child_id null) bookings for
-- the same account/schedule/occurrence both exist — coalescing to a
-- sentinel makes every "self" row collide with every other "self" row for
-- that key, while a real child id is never zero and is left untouched.
-- (NULLS NOT DISTINCT would be the PG15+ native equivalent, but the
-- installed drizzle-orm version does not yet expose it on partial unique
-- indexes, and this expression form works identically on any supported
-- Postgres version — the smallest robust alternative.)
--
-- No backfill: CREATE UNIQUE INDEX CONCURRENTLY would fail outright if any
-- existing rows already violate it — this is intentional per the "run
-- duplicate diagnostics on a disposable/local DB before applying" and
-- "do not modify old test data" requirements. Diagnosed as safe against a
-- disposable local database before this migration was added (see
-- FINANCE_FINAL_CLOSURE_BATCH_1_REPORT.md, Part F2/13).
CREATE UNIQUE INDEX "bookings_active_occurrence_participant_unique" ON "bookings" (
  "schedule_id",
  "occurrence_date",
  "account_owner_student_id",
  coalesce("participant_child_id", 0)
) WHERE (
  "occurrence_date" is not null
  and "account_owner_student_id" is not null
  and "booking_status" in ('pending', 'confirmed')
);
