-- Canonical Ballet Class model — additive Expand migration.
--
-- This migration is purely additive. It does NOT require the legacy Ballet
-- Class catalogue to be empty, does NOT delete any historical Class,
-- Schedule, or join-table row, and does NOT drop the legacy join tables
-- (ballet_class_levels / ballet_class_groups / ballet_group_schedules).
-- They remain in place for this Expand window — historical reads and the
-- currently-deployed (old) Admin API both keep working unmodified against
-- them. A future Contract migration removes them once every deployed API
-- version writes exclusively through the canonical columns added here.
--
-- ── Rolling-deployment compatibility strategy ──────────────────────────────
-- Every ballet_classes row gets a new `is_legacy` column, NOT NULL DEFAULT
-- true. Because the default is a constant, Postgres backfills every existing
-- row to is_legacy = true at ADD COLUMN time with no table rewrite and no
-- separate UPDATE pass — satisfying "all Classes existing at migration time
-- become legacy" as a side effect of the DDL itself.
--
-- During the short window where the old API version may still be receiving
-- traffic (e.g. a rolling deploy not yet fully cut over), any row it inserts
-- omits is_legacy/level_id/group_id entirely (it knows nothing about them):
-- that row lands with is_legacy = true and null level_id/group_id/
-- instructor_id — i.e. it behaves exactly like the pre-0075 model, still
-- relating to levels/groups through the legacy join tables the old code
-- writes to. It is correctly inert with respect to the new canonical
-- entitlement path (Attendance/activation only trust is_legacy = false
-- rows), so old and new writes coexist safely without any DB-level branching
-- logic. Only the *new* API explicitly sets is_legacy = false together with
-- level_id/group_id/instructor_id in the same transaction that creates the
-- row's one Schedule (see adminBalletClasses.ts).
--
-- level_id / group_id are added NULLABLE, not NOT NULL:
--   - A legacy row cannot satisfy the new Group requirement — Production
--     has zero ballet_class_groups rows, so no group_id can ever be safely
--     inferred for it (fabricating one is explicitly out of scope).
--   - A blanket NOT NULL would fail immediately against every existing
--     legacy row (and against any legacy-shaped row the old deployed API
--     writes during the rollout window), which is exactly the defect this
--     revision corrects.
-- instructor_id is left untouched (already nullable, already FK'd to
-- ballet_instructors with ON DELETE SET NULL) — no ALTER needed here.
-- Canonical correctness — all three required, Group belongs to Level,
-- Instructor active — is enforced by the new API's transactional validation
-- (validateCanonicalRelations in adminBalletClasses.ts), not a blanket DB
-- constraint, for the duration of this Expand window.
--
-- ── Deferred to the future Contract migration (see task report for the plan) ──
--   - NOT NULL on level_id / group_id / instructor_id, once no legacy row
--     needs to exist without them (or once legacy rows are migrated off
--     this table entirely).
--   - The one-schedule-per-class global unique index. The old deployed API
--     can still insert more than one ballet_schedules row for the same
--     class_id (that was legal under the pre-0075 model). The new API
--     already guarantees exactly one Schedule per canonical Class
--     transactionally — POST creates class+schedule together, PATCH only
--     ever updates the existing one, and standalone schedule creation is
--     disabled (405) — so no DB constraint is needed to prove that
--     invariant today.
--   - duration_mins NOT NULL/positive, day_of_week range, time-format, and
--     time-order CHECK constraints on ballet_schedules. The single
--     historical schedule row's exact stored shape has not been verified
--     against these rules; adding them now risks breaking a read/update of
--     that row purely to satisfy a new constraint, which is out of scope.
--     The new API already enforces all of this at the application layer for
--     every canonical write (see deriveBalletClassDuration and the zod
--     schemas in adminBalletClasses.ts), and the same rules are enforced
--     defensively at read time by every entitlement gate (see
--     balletClassEntitlement.ts).
--   - Dropping ballet_class_levels / ballet_class_groups /
--     ballet_group_schedules.
--
-- ── What this migration does add now (safe for historical rows) ──────────
--   - ballet_groups (id, level_id) UNIQUE — required so the composite
--     Group/Level FK below can reference it. Trivially satisfied by every
--     existing row (id alone is already a primary key), so this cannot
--     reject any historical or in-flight old-API write.
--   - ballet_classes.level_id → ballet_levels(id) RESTRICT — nullable, so
--     it only constrains rows that have a level_id at all.
--   - ballet_classes (group_id, level_id) → ballet_groups (id, level_id)
--     RESTRICT — a composite FK using Postgres's default MATCH SIMPLE
--     semantics: the constraint is only checked when *both* columns are
--     non-null, so a legacy row with a backfilled level_id but a null
--     group_id is unaffected.
--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD COLUMN "is_legacy" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD COLUMN "level_id" integer;
--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD COLUMN "group_id" integer;
--> statement-breakpoint
ALTER TABLE "ballet_groups" ADD CONSTRAINT "ballet_groups_id_level_id_unique" UNIQUE ("id", "level_id");
--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD CONSTRAINT "ballet_classes_level_id_ballet_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."ballet_levels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "ballet_classes" ADD CONSTRAINT "ballet_classes_group_level_fk" FOREIGN KEY ("group_id", "level_id") REFERENCES "public"."ballet_groups"("id", "level_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
-- Safe Level backfill, for display purposes on legacy rows only: set
-- level_id from the legacy ballet_class_levels join table strictly when a
-- Class has exactly one linked Level row there (never an arbitrary pick
-- among several) AND that Level still exists (belt-and-suspenders — the
-- join table's own FK already guarantees this). Every backfilled row stays
-- is_legacy = true; it does not become assignable or entitlement-bearing.
UPDATE "ballet_classes" bc
SET "level_id" = single_level."level_id"
FROM (
  SELECT bcl."class_id" AS "class_id", min(bcl."level_id") AS "level_id"
  FROM "ballet_class_levels" bcl
  INNER JOIN "ballet_levels" bl ON bl."id" = bcl."level_id"
  GROUP BY bcl."class_id"
  HAVING count(*) = 1
) AS single_level
WHERE single_level."class_id" = bc."id";
