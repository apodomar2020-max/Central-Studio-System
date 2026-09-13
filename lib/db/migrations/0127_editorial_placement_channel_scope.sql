-- ══════════════════════════════════════════════════════════════════════════
-- 0127 — Unified Editorial CMS Wave 2.0 hardening: SCOPE PLACEMENTS BY CHANNEL
-- ══════════════════════════════════════════════════════════════════════════
--
-- ─── WHY ──────────────────────────────────────────────────────────────────
--
-- Wave 1 modelled a curation slot as a free-text `key` ("featured", "hero")
-- and carried `channel` on the row, but then identified the slot by `key`
-- ALONE everywhere it mattered:
--
--   * UNIQUE ("key", "post_id")                      — channel-blind
--   * INDEX  ("key", "position")                     — channel-blind
--   * the service DELETE predicate (replacePlacement) — channel-blind
--   * the route SELECT predicate (loadPlacement)      — channel-blind
--
-- Consequence (Issue #23): the news channel and the experience channel
-- cannot both use a slot named "featured". A PUT of experience:featured
-- DELETEs every news:featured row as its first statement, and a GET of
-- "featured" returns both channels' rows interleaved. The two channels are
-- meant to be independent curation surfaces; sharing a key namespace across
-- them is a data-loss bug, not a naming inconvenience.
--
-- This migration fixes the DATABASE half (constraint + index). The service
-- and route predicates are fixed in the same commit; both halves are
-- required, and neither alone is sufficient.
--
-- ─── EXISTING DATA IMPACT: NONE, AND STRUCTURALLY CANNOT FAIL ─────────────
--
-- The replacement uniqueness key is a SUPERSET of the old one:
--
--     old: UNIQUE ("key", "post_id")
--     new: UNIQUE ("channel", "key", "post_id")
--
-- Adding a column to a unique key can only ever PERMIT more rows, never
-- reject rows that were already legal. Every row that satisfied the old
-- constraint therefore satisfies the new one by construction. There is no
-- data state — empty, small, or large — in which this migration can fail on
-- a uniqueness violation or silently drop a row. No row is UPDATEd or
-- DELETEd here at all; only the constraint and index objects change.
--
-- That is deliberately NOT an assumption that production is empty. Wave
-- 1.1's audit found `editorial_placements` empty at that moment, but this
-- migration does not rely on that and would be correct against any
-- population.
--
-- For operator visibility only, step 0 RAISEs a NOTICE reporting the row
-- count and whether any `key` is currently shared across both channels —
-- i.e. whether the Issue #23 data-loss window was ever actually exercised
-- in this environment. A non-zero cross-channel count is informational, not
-- an error: those rows are exactly the ones the new scoping repairs, and
-- they are preserved as-is and correctly partitioned from here on.
--
-- ─── SCOPE ────────────────────────────────────────────────────────────────
--
-- Touches ONE table: "editorial_placements", created by 0126. It does not
-- name website_news_posts, website_performances, website_background_settings,
-- or any Ballet / Classes / Schedules / bookings / payments / attendance /
-- notifications / auth table. It does not alter any other editorial_* table.
--
-- Manual rollback (not executed by this migration):
--   ALTER TABLE "editorial_placements"
--     DROP CONSTRAINT "editorial_placements_channel_key_post_unique";
--   DROP INDEX "editorial_placements_channel_key_position_idx";
--   ALTER TABLE "editorial_placements" ADD CONSTRAINT
--     "editorial_placements_key_post_unique" UNIQUE ("key", "post_id");
--   CREATE INDEX "editorial_placements_key_position_idx"
--     ON "editorial_placements" ("key", "position");
-- (The rollback re-adds a STRICTER constraint and so CAN fail, if by then
-- the same key is genuinely in use in both channels. That asymmetry is the
-- expected shape of un-fixing a bug, and is why rollback is manual.)

-- ─── 0. Report the pre-change population (informational NOTICE only) ───────

DO $$
DECLARE
  total_rows bigint;
  shared_keys bigint;
BEGIN
  SELECT count(*) INTO total_rows FROM "editorial_placements";

  SELECT count(*) INTO shared_keys FROM (
    SELECT "key"
    FROM "editorial_placements"
    GROUP BY "key"
    HAVING count(DISTINCT "channel") > 1
  ) AS multi_channel_keys;

  RAISE NOTICE '0127: editorial_placements has % row(s); % key(s) are currently used in more than one channel.',
    total_rows, shared_keys;

  IF shared_keys > 0 THEN
    RAISE NOTICE '0127: those cross-channel keys are PRESERVED and become independently addressable per channel. No row is modified or removed by this migration.';
  END IF;
END $$;
--> statement-breakpoint

-- ─── 1. Replace the channel-blind UNIQUE with the channel-scoped one ───────
-- Guarded by pg_constraint existence checks, matching 0126's established
-- style, so the migration is re-runnable and tolerant of a database that
-- was hand-repaired to the target shape already.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_channel_key_post_unique'
  ) THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_channel_key_post_unique"
      UNIQUE ("channel", "key", "post_id");
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_key_post_unique'
  ) THEN
    ALTER TABLE "editorial_placements" DROP CONSTRAINT "editorial_placements_key_post_unique";
  END IF;
END $$;
--> statement-breakpoint

-- ─── 2. Replace the channel-blind lookup index with the channel-scoped one ─
-- Every read of a placement is "give me slot K of channel C, in order", so
-- ("channel", "key", "position") is the leading-column match. The old
-- ("key", "position") index can no longer serve that prefix and is dropped
-- rather than left behind as dead write cost.

CREATE INDEX IF NOT EXISTS "editorial_placements_channel_key_position_idx"
  ON "editorial_placements" ("channel", "key", "position");
--> statement-breakpoint
DROP INDEX IF EXISTS "editorial_placements_key_position_idx";
