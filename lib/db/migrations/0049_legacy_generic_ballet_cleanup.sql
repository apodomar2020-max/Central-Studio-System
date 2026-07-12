-- Migration 0049: Legacy Generic Ballet Cleanup
--
-- The Ballet program has been fully separated onto its own dedicated tables
-- (ballet_classes, ballet_schedules, ballet_groups, ballet_levels, etc. —
-- see migrations 0047/0048). Before this separation, Ballet was represented
-- as ordinary rows inside the GENERIC classes/schedules tables, tagged
-- either via classes.dance_type_id pointing at the 'ballet' dance_types row,
-- or via the older free-text classes.category = 'ballet' fallback. Those
-- generic rows are now dead weight that would otherwise keep showing up
-- anywhere the generic catalogue is queried. This migration removes them.
--
-- This is a pure data-cleanup (DML) migration — no ALTER TABLE, no schema
-- shape change. It does NOT touch any ballet_* dedicated table; those are
-- the current source of truth and are left completely alone here.
--
-- Scope is resolved entirely by subquery/expression — no class id, schedule
-- id, or dance_type id is ever hardcoded, so this migration is safe to run
-- against any environment's actual data regardless of what those ids happen
-- to be there.
--
-- Known real FK side effects on OTHER tables when the classes/schedules
-- rows below are deleted (verified by grepping lib/db/src/schema/*.ts and
-- lib/db/migrations/*.sql for every REFERENCES classes/schedules; see the
-- Phase 5 report for the full relation table):
--   - class_whatsapp_groups.class_id / .schedule_id are REAL foreign keys
--     with ON DELETE CASCADE (added in migration 0036). Rather than let
--     that cascade fire silently, this migration runs a fail-safe preflight
--     check (the DO block immediately below) that counts any
--     class_whatsapp_groups row still referencing a Ballet-tagged class or
--     schedule and RAISEs EXCEPTION to abort the entire migration if any
--     are found — no DELETE or UPDATE in this file executes in that case.
--     This migration never deletes or otherwise touches class_whatsapp_groups
--     rows itself; it only detects and, if necessary, aborts.
--   - attendance.class_id / attendance.schedule_id are REAL foreign keys
--     with ON DELETE SET NULL (added in migration 0008, inline column-level
--     REFERENCES — see that file's own header comment: "does not
--     cascade-delete attendance history"). Any attendance row referencing
--     one of these rows keeps existing; only its class_id/schedule_id
--     back-reference is nulled out by Postgres automatically.
--   - bookings.class_id / bookings.schedule_id have NO FK constraint
--     anywhere (confirmed via grep) — any booking row referencing one of
--     these legacy rows is left with a plain dangling integer, no DB-level
--     effect, no error.
--   - classes.dance_type_id → dance_types.id (ON DELETE SET NULL, migration
--     0025) and student_dance_interests.dance_type_id → dance_types.id (ON
--     DELETE CASCADE, migration 0035) are both irrelevant here: this
--     migration never deletes the dance_types row itself, only flips
--     is_active to false via UPDATE, which never triggers a DELETE-only
--     cascade/set-null.

-- ---------------------------------------------------------------------------
-- 0. Fail-safe preflight: abort if any class_whatsapp_groups row still
--    references a class/schedule that step 1/2 below would delete. That FK
--    is ON DELETE CASCADE (migration 0036) — instead of letting Postgres
--    cascade-delete those rows silently, we count them ourselves and refuse
--    to proceed at all if any exist, so the data loss is never silent.
--    Scope resolved via the same slug-based subquery used everywhere else
--    in this file — never a hardcoded class/schedule/dance_type id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  affected_count integer;
BEGIN
  SELECT count(*) INTO affected_count
  FROM "class_whatsapp_groups" cwg
  WHERE cwg."class_id" IN (
    SELECT "id" FROM "classes"
    WHERE "dance_type_id" = (SELECT "id" FROM "dance_types" WHERE "slug" = 'ballet')
       OR lower(trim("category")) = 'ballet'
  )
  OR cwg."schedule_id" IN (
    SELECT "id" FROM "schedules"
    WHERE "class_id" IN (
      SELECT "id" FROM "classes"
      WHERE "dance_type_id" = (SELECT "id" FROM "dance_types" WHERE "slug" = 'ballet')
         OR lower(trim("category")) = 'ballet'
    )
  );

  IF affected_count > 0 THEN
    RAISE EXCEPTION 'Aborting migration 0049: % class_whatsapp_groups row(s) still reference a Ballet-tagged class or schedule. This migration never deletes or modifies class_whatsapp_groups rows — reassign or remove the linked WhatsApp group(s) manually first, then re-run this migration.', affected_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Delete generic `schedules` rows belonging to Ballet-tagged classes.
--    Deleted first (logical parent→child order: schedules are children of
--    classes) even though no FK enforces that ordering here — this just
--    keeps the migration readable and mirrors how you'd do it if a FK did
--    exist. Scope resolved via subquery against the same OR condition used
--    in step 2, so a schedule is only removed if its owning class matches
--    the Ballet criteria below.
-- ---------------------------------------------------------------------------
DELETE FROM "schedules"
WHERE "class_id" IN (
  SELECT "id" FROM "classes"
  WHERE "dance_type_id" = (SELECT "id" FROM "dance_types" WHERE "slug" = 'ballet')
     OR lower(trim("category")) = 'ballet'
);

-- ---------------------------------------------------------------------------
-- 2. Delete the Ballet-tagged `classes` rows themselves.
--    Matches EITHER the structured dance_type_id link (current tagging
--    path) OR the legacy free-text category fallback (case-insensitive,
--    trimmed — matching how the frontend's apiAdapters.ts isBalletName/
--    normCat comparison already treats this field). Resolved via subquery
--    against dance_types.slug — never a literal id.
-- ---------------------------------------------------------------------------
DELETE FROM "classes"
WHERE "dance_type_id" = (SELECT "id" FROM "dance_types" WHERE "slug" = 'ballet')
   OR lower(trim("category")) = 'ballet';

-- ---------------------------------------------------------------------------
-- 3. Soft-retire the dance_types row — never delete it.
--    Ballet still exists as a concept (it's the whole point of the
--    dedicated ballet_* system); this just marks the generic catalogue's
--    dance_types entry as inactive so it stops appearing as a selectable
--    generic dance type going forward. Deliberately a plain UPDATE, not a
--    DELETE — student_dance_interests.dance_type_id (ON DELETE CASCADE)
--    must never be triggered by this step.
-- ---------------------------------------------------------------------------
UPDATE "dance_types"
SET "is_active" = false, "updated_at" = now()
WHERE "slug" = 'ballet';
