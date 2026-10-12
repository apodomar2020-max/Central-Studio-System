-- Unified Website CMS — Slice 1: News → Performance references
--
-- WHAT THIS DOES
--   Creates ONE new table, editorial_post_performance_refs: an ordered list
--   of Performances a News post points readers to ("related items").
--
--     id             serial PK
--     post_id        integer NOT NULL → editorial_posts(id)      ON DELETE CASCADE
--     performance_id integer NOT NULL → website_performances(id) ON DELETE CASCADE
--     position       integer NOT NULL DEFAULT 0, CHECK (position >= 0)
--     created_at     timestamptz NOT NULL DEFAULT now()
--     UNIQUE (post_id, performance_id)
--     INDEX  (post_id, position)   — the public read is "refs of this post, in order"
--     INDEX  (performance_id)      — keeps the ON DELETE CASCADE lookup an index probe
--
-- WHY A NEW TABLE (and not editorial_post_relations)
--   editorial_post_relations is a post→post table: both FKs point at
--   editorial_posts and relation_type IN ('recommended'), and the
--   same-channel invariant is locked. A Performance is not an Editorial
--   post, so it cannot be a target there without relaxing that invariant.
--   Legacy News stored these as slugs inside a jsonb list
--   (website_news_posts.related_refs) because Performance had no table at
--   the time; it has one now, so this is a real FK and a dangling
--   reference is impossible.
--
-- DELETE BEHAVIOUR
--   post_id CASCADE: refs are owned by the post (same as
--   editorial_post_relations / editorial_post_topics).
--   performance_id CASCADE (not RESTRICT): Performances are retired by the
--   soft flag website_performances.is_active, never by DELETE (the admin
--   DELETE route is a soft deactivate), and an inactive Performance is
--   already silently dropped from public related items. A physical DELETE
--   only happens as deliberate DBA cleanup; RESTRICT would turn that into
--   a multi-table chore for a pointer that has no meaning without its
--   target, while CASCADE matches how the legacy jsonb refs behave (an
--   unresolvable ref simply disappears).
--
-- EXISTING-DATA IMPACT
--   NONE. New, empty table. No existing row is read or written; no
--   backfill (migrated posts keep their legacy related_refs overlay).
--
-- OLD APP vs NEW SCHEMA
--   The previous app version never references the table.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS "editorial_post_performance_refs";
--   Loses only Performance refs saved on native posts after this release.
--
-- LOCKING / RUNTIME
--   CREATE TABLE + FKs take SHARE ROW EXCLUSIVE on editorial_posts and
--   website_performances for an instant (no rows to validate). Milliseconds.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS + pg_constraint probes, matching
-- 0126–0130.

CREATE TABLE IF NOT EXISTS "editorial_post_performance_refs" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL,
  "performance_id" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_performance_refs_post_id_fkey') THEN
    ALTER TABLE "editorial_post_performance_refs" ADD CONSTRAINT "editorial_post_performance_refs_post_id_fkey"
      FOREIGN KEY ("post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_performance_refs_performance_id_fkey') THEN
    ALTER TABLE "editorial_post_performance_refs" ADD CONSTRAINT "editorial_post_performance_refs_performance_id_fkey"
      FOREIGN KEY ("performance_id") REFERENCES "public"."website_performances"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_performance_refs_post_performance_unique') THEN
    ALTER TABLE "editorial_post_performance_refs" ADD CONSTRAINT "editorial_post_performance_refs_post_performance_unique"
      UNIQUE ("post_id", "performance_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_performance_refs_position_non_negative') THEN
    ALTER TABLE "editorial_post_performance_refs" ADD CONSTRAINT "editorial_post_performance_refs_position_non_negative"
      CHECK ("position" >= 0);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_post_performance_refs_post_position_idx"
  ON "editorial_post_performance_refs" ("post_id", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_post_performance_refs_performance_idx"
  ON "editorial_post_performance_refs" ("performance_id");
