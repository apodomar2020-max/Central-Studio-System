-- Unified Website CMS — Slice 1: native News category
--
-- WHAT THIS DOES
--   Adds ONE nullable column to editorial_posts:
--
--     news_category text NULL
--       CHECK (news_category IS NULL OR length(trim(news_category)) > 0)
--
--   It is the machine key the public Website filters News by (today the
--   fixed tab set awards | auditions | events | press). Until now that key
--   existed ONLY on the legacy website_news_posts row, so a natively
--   authored Editorial News post had no category and could not be
--   projected publicly at all.
--
--   It lives on the post SPINE (not the translation) because it is
--   classification of the logical story, shared by every language — the
--   same reasoning that keeps Topics on the post. The human-readable label
--   is localized and already exists per translation (context_label).
--
-- WHY THE ALLOWED VALUES ARE NOT A DB CHECK
--   The allowed set is enforced at the API layer (OpenAPI enum
--   EditorialNewsCategory). Adding a category later is then a contract
--   change, not a schema migration plus a constraint swap on a live table.
--   The CHECK here only refuses blank strings, which are never meaningful.
--
-- EXISTING-DATA IMPACT
--   NONE. ADD COLUMN with no DEFAULT is a catalog-only change in
--   PostgreSQL 11+: no row is rewritten and every existing row reads NULL.
--   No backfill: migrated posts keep resolving their category from the
--   legacy overlay exactly as before (see publicEditorialNews.ts), so they
--   do not need — and are deliberately not given — a copy here.
--   The CHECK is satisfied by every existing row (all NULL).
--
-- OLD APP vs NEW SCHEMA
--   The previous app version never names the column; Drizzle selects
--   explicit column lists, so an unknown extra column is invisible to it.
--
-- ROLLBACK
--   ALTER TABLE "editorial_posts" DROP CONSTRAINT IF EXISTS "editorial_posts_news_category_not_blank";
--   ALTER TABLE "editorial_posts" DROP COLUMN IF EXISTS "news_category";
--   Loses only categories typed on native posts after this release.
--
-- LOCKING / RUNTIME
--   ADD COLUMN (nullable, no default): ACCESS EXCLUSIVE for a catalog-only
--   instant. ADD CONSTRAINT ... CHECK scans the table under ACCESS
--   EXCLUSIVE; editorial_posts holds a handful of rows, so this is
--   milliseconds.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + pg_constraint probe, matching
-- 0126–0130.

ALTER TABLE "editorial_posts"
  ADD COLUMN IF NOT EXISTS "news_category" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_news_category_not_blank') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_news_category_not_blank"
      CHECK ("news_category" IS NULL OR length(trim("news_category")) > 0);
  END IF;
END $$;
