-- Migration 0126: Unified Editorial CMS — additive backend foundation
--                  (Wave 1 + the Wave 1.1 multilingual / Website Settings
--                   correction, folded in place)
--
-- WHY: Foundation tables for the unified Editorial CMS. ONE logical post
-- serving both the 'news' and 'experience' channels, with MANY
-- independent-lifecycle language translations, first-class channel-scoped
-- authors, channel-scoped topics, post-to-post recommendations, named
-- curation placements, an append-only translation-aware revision history,
-- and a Website Settings domain (Languages + app-store Links).
--
-- ─── WHY THIS FILE WAS CORRECTED IN PLACE RATHER THAN FOLLOWED UP ────────
--
-- Wave 1 of this migration created editorial_posts with title/slug/body/
-- status/published_at/seo* directly on the post row — a single-language
-- model. Wave 1.1 splits those into editorial_post_translations. That is a
-- destructive change to the Wave 1 shape, so it was only legitimate to do
-- in place after confirming 0126 had never reached any shared or
-- persistent environment. Verified three ways:
--   * `git branch -r --contains` on the Wave 1 schema commit returns ONLY
--     feat/unified-editorial-foundation — the commit is on no other
--     branch and not on origin/main.
--   * `git log origin/main -- lib/db/migrations/0126_editorial_foundation.sql`
--     is empty: this file has never existed on main, so no deploy has ever
--     seen it.
--   * Migrations do not run on application startup in this system (they
--     are an explicit deploy step), so an unmerged branch cannot have
--     applied itself anywhere.
-- Wave 1's own report likewise records only disposable-local-Postgres
-- testing. Correcting in place therefore leaves NO environment carrying
-- the superseded shape, and avoids shipping a create-then-immediately-
-- rewrite pair as permanent history.
--
-- LOCAL DATABASES that already applied the SUPERSEDED 0126 will not be
-- fixed by re-running migrations: drizzle records 0126 as applied and
-- skips it. Drop and recreate any such local/disposable database. No
-- shared environment is in that state.
--
-- ─── EXISTING DATA IMPACT: NONE ──────────────────────────────────────────
--
-- Every statement below is a CREATE / INSERT against a net-new object.
-- No PRE-EXISTING table, column, index, constraint, or row is altered or
-- dropped. In particular website_news_posts, website_performances,
-- ballet_performance_opportunities, website_background_settings, and every
-- Ballet / Classes / Schedules / Instructors / Packages / FAQ / bookings /
-- payments / attendance / notifications / auth table are untouched — this
-- migration does not name them at all, except as the referenced side of
-- new FKs into system_users(id) (which adds a constraint to the NEW table,
-- never to system_users).
--
-- SCHEMA + TWO STRUCTURAL SEEDS. No content, no backfill, no content
-- migration. The `migration_source_table` / `migration_source_id` columns
-- on editorial_posts are inert provenance placeholders for a LATER wave
-- and are written by nothing here. The two seeded rows are structural
-- rather than content:
--   * editorial_website_links id = 1 — the singleton settings row, exactly
--     as ballet_settings is seeded in 0009. Both its URL columns are NULL,
--     i.e. "no link configured".
--   * editorial_languages 'en' — a default language must EXIST for the
--     single-default invariant to mean anything and for any translation to
--     be creatable at all. Seeded active + default, display_order 0.
-- Both use ON CONFLICT DO NOTHING and are therefore re-runnable.
--
-- AUTHORED BY HAND, deliberately: `drizzle-kit generate` cannot be used in
-- this repo — migrations/meta contains snapshots only up to 0056 while the
-- journal runs past 0125, so the snapshot chain is broken and a generate
-- run fails outright (ENOENT meta/0000_snapshot.json). Hand-authored,
-- idempotent, heavily-commented SQL (DO $$ constraint guards +
-- IF NOT EXISTS) is the established convention for every migration since —
-- see 0110_website_news_posts.sql and 0100, which this file mirrors in
-- style. The Drizzle schema files under lib/db/src/schema/ are the
-- authoritative TS mirror of what is created here.
--
-- ─── LIFECYCLE / INTEGRITY NOTES ─────────────────────────────────────────
--
--   * status / channel / direction are text + CHECK (repo convention — see
--     ballet_performance_opportunities.status) rather than PG enum types,
--     so adding a value later is an additive CHECK swap, not an ALTER TYPE.
--   * SLUG UNIQUENESS is (channel, language_id, slug) on
--     editorial_post_translations, a REAL unique constraint. `channel` is
--     a denormalized copy of the parent post's channel, DERIVED by the
--     sync_editorial_translation_channel trigger (section 10) rather than
--     trusted from the application, and the parent's channel is made
--     immutable by guard_editorial_post_integrity. See section 10 and
--     lib/db/src/schema/editorialPostTranslations.ts for why a generated
--     column / view / plain CHECK cannot express this.
--   * AT MOST ONE DEFAULT LANGUAGE is guaranteed by the partial unique
--     index editorial_languages_single_default (section 1) — a race-safe
--     database guarantee, not an application-ordering convention. Partial
--     unique index precedent: 0017_auth_providers.sql,
--     0050_ballet_applications_active_uniqueness.sql.
--   * AUTHOR CHANNEL MATCH (post.author.channel = post.channel) is
--     enforced by guard_editorial_post_integrity (section 10) as well as
--     in the service layer. A composite FK cannot be used: it would need
--     ON DELETE SET NULL to null editorial_posts.channel too, which is NOT
--     NULL, and Wave 1's rule that deleting an author must never delete or
--     block a post has to hold.
--   * editorial_post_topics.topic_id and
--     editorial_post_translations.language_id are ON DELETE RESTRICT on
--     purpose: topics and languages are retired with status/is_active,
--     never physically dropped out from under published content. post_id
--     is CASCADE — a post's own assignments and translations belong to the
--     post.
--   * editorial_post_relations has a row-level CHECK forbidding
--     self-reference. The "same channel only" rule needs a cross-row
--     lookup and is therefore enforced in the service layer.
--   * editorial_post_revisions is append-only. revision_number is
--     PER-POST sequential, assigned inside the mutating transaction under
--     a row lock on the parent post, UNIQUE (post_id, revision_number).
--     `translation_id` is NULL for shared-field revisions and, when set,
--     is constrained by a COMPOSITE FK (translation_id, post_id) so a
--     revision can never reference another post's translation. A CHECK
--     ties each event_type to the correct scope.
--   * Trigger precedent in this repo: 0078_payment_records_foundation.sql,
--     0080_payment_events_foundation.sql.
--
-- ROLLBACK: this wave adds no read path used by the public website or the
-- mobile app, so reverting the application code is sufficient. If the
-- objects themselves must go, drop them in FK-dependency order:
--   DROP TRIGGER IF EXISTS "editorial_post_integrity_trg" ON "editorial_posts";
--   DROP TRIGGER IF EXISTS "editorial_translation_channel_trg" ON "editorial_post_translations";
--   DROP TRIGGER IF EXISTS "editorial_author_channel_immutable_trg" ON "editorial_authors";
--   DROP FUNCTION IF EXISTS guard_editorial_post_integrity();
--   DROP FUNCTION IF EXISTS sync_editorial_translation_channel();
--   DROP FUNCTION IF EXISTS guard_editorial_author_channel_immutable();
--   DROP TABLE IF EXISTS "editorial_website_links";
--   DROP TABLE IF EXISTS "editorial_post_revisions";
--   DROP TABLE IF EXISTS "editorial_placements";
--   DROP TABLE IF EXISTS "editorial_post_relations";
--   DROP TABLE IF EXISTS "editorial_post_topics";
--   DROP TABLE IF EXISTS "editorial_post_translations";
--   DROP TABLE IF EXISTS "editorial_posts";
--   DROP TABLE IF EXISTS "editorial_topics";
--   DROP TABLE IF EXISTS "editorial_authors";
--   DROP TABLE IF EXISTS "editorial_languages";
-- That drops only Admin-authored editorial content and settings — never
-- any booking, payment, attendance, ballet, background-CMS,
-- website_news_posts or website_performances data.

-- ─── 1. editorial_languages ────────────────────────────────────────────────
-- Website-level (NOT channel-scoped): the same language set serves both
-- editorial channels, so there is deliberately no `channel` column here.

CREATE TABLE IF NOT EXISTS "editorial_languages" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "native_name" text NOT NULL,
  "direction" text DEFAULT 'ltr' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_updated_by_admin_id_fkey') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_code_unique') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_code_unique"
      UNIQUE ("code");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_code_not_blank') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_code_not_blank"
      CHECK (length(trim("code")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_name_not_blank') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_name_not_blank"
      CHECK (length(trim("name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_native_name_not_blank') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_native_name_not_blank"
      CHECK (length(trim("native_name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_direction_valid') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_direction_valid"
      CHECK ("direction" IN ('ltr', 'rtl'));
  END IF;
  -- BCP-47 subset: language[-Script][-REGION]. Mirrors
  -- EDITORIAL_LANGUAGE_CODE_RE in lib/db/src/schema/editorialLanguages.ts.
  -- Case-sensitive, so exactly one spelling of each tag can be stored.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_code_shape') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_code_shape"
      CHECK ("code" ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$');
  END IF;
  -- The default language is ALWAYS active: makes "deactivated default" an
  -- unrepresentable state rather than merely an unreachable one. The
  -- ORDERING an editor experiences ("promote another active language to
  -- default first") is produced by the service layer, transactionally and
  -- under row locks; this CHECK is the backstop underneath it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_default_is_active') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_default_is_active"
      CHECK (NOT ("is_default" AND NOT "is_active"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_languages_display_order_non_negative') THEN
    ALTER TABLE "editorial_languages" ADD CONSTRAINT "editorial_languages_display_order_non_negative"
      CHECK ("display_order" >= 0);
  END IF;
END $$;
--> statement-breakpoint
-- AT MOST ONE DEFAULT LANGUAGE, race-safely, at the database level.
-- Among the rows this partial index covers, "is_default" is always true —
-- so uniqueness on that single column means at most one such row can
-- exist. Two concurrent transactions each promoting a different language
-- cannot both commit: the second blocks on the index and then fails 23505.
-- An application-level "demote all, then promote one" pair could not
-- guarantee that on its own.
CREATE UNIQUE INDEX IF NOT EXISTS "editorial_languages_single_default"
  ON "editorial_languages" ("is_default") WHERE "is_default";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_languages_active_order_idx"
  ON "editorial_languages" ("is_active", "display_order");
--> statement-breakpoint
-- Structural seed: a default language must exist for the single-default
-- invariant to be meaningful and for any translation to be creatable.
INSERT INTO "editorial_languages" ("code", "name", "native_name", "direction", "is_active", "is_default", "display_order")
VALUES ('en', 'English', 'English', 'ltr', true, true, 0)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- ─── 2. editorial_authors ──────────────────────────────────────────────────
-- `channel` is NOT NULL with no default: an author belongs to exactly one
-- editorial channel. Added as NOT NULL directly (no nullable-then-backfill
-- dance) because this table is pre-release — see the header.

CREATE TABLE IF NOT EXISTS "editorial_authors" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel" text NOT NULL,
  "public_name" text NOT NULL,
  "role" text NOT NULL,
  "biography" text,
  "avatar_url" text,
  "system_user_id" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_authors_system_user_id_fkey') THEN
    ALTER TABLE "editorial_authors"
      ADD CONSTRAINT "editorial_authors_system_user_id_fkey"
      FOREIGN KEY ("system_user_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_authors_channel_valid') THEN
    ALTER TABLE "editorial_authors" ADD CONSTRAINT "editorial_authors_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_authors_public_name_not_blank') THEN
    ALTER TABLE "editorial_authors" ADD CONSTRAINT "editorial_authors_public_name_not_blank"
      CHECK (length(trim("public_name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_authors_role_not_blank') THEN
    ALTER TABLE "editorial_authors" ADD CONSTRAINT "editorial_authors_role_not_blank"
      CHECK (length(trim("role")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_authors_status_valid') THEN
    ALTER TABLE "editorial_authors" ADD CONSTRAINT "editorial_authors_status_valid"
      CHECK ("status" IN ('active', 'archived'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_authors_channel_status_idx"
  ON "editorial_authors" ("channel", "status");
--> statement-breakpoint

-- ─── 3. editorial_topics ───────────────────────────────────────────────────
-- Channel-scoped taxonomy of the LOGICAL post. NOT localized: a topic is
-- editorial classification of the story, not prose, so no Topic
-- localization was added in this wave.

CREATE TABLE IF NOT EXISTS "editorial_topics" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_topics_channel_slug_unique') THEN
    ALTER TABLE "editorial_topics" ADD CONSTRAINT "editorial_topics_channel_slug_unique"
      UNIQUE ("channel", "slug");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_topics_name_not_blank') THEN
    ALTER TABLE "editorial_topics" ADD CONSTRAINT "editorial_topics_name_not_blank"
      CHECK (length(trim("name")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_topics_slug_not_blank') THEN
    ALTER TABLE "editorial_topics" ADD CONSTRAINT "editorial_topics_slug_not_blank"
      CHECK (length(trim("slug")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_topics_channel_valid') THEN
    ALTER TABLE "editorial_topics" ADD CONSTRAINT "editorial_topics_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_topics_status_valid') THEN
    ALTER TABLE "editorial_topics" ADD CONSTRAINT "editorial_topics_status_valid"
      CHECK ("status" IN ('active', 'archived'));
  END IF;
END $$;
--> statement-breakpoint

-- ─── 4. editorial_posts ────────────────────────────────────────────────────
-- The SHARED SPINE of a logical post. Every field a reader reads lives on
-- editorial_post_translations (section 5) instead. What is here is
-- identical for every language: the channel discriminator, the single
-- byline, the single feature image URL (its ALT TEXT is per-translation,
-- because alt text is prose), and provenance/audit columns.
--
-- `channel` is IMMUTABLE after insert (guard_editorial_post_integrity,
-- section 10) — the precondition that makes the denormalized `channel`
-- copy on editorial_post_translations safe to key a UNIQUE on.

CREATE TABLE IF NOT EXISTS "editorial_posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel" text NOT NULL,
  "author_id" integer,
  "feature_image_url" text,
  "migration_source_table" text,
  "migration_source_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
  -- SET NULL, not CASCADE: deleting an author must never delete a post.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_author_id_fkey') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_author_id_fkey"
      FOREIGN KEY ("author_id") REFERENCES "public"."editorial_authors"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_updated_by_admin_id_fkey') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_channel_valid') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_posts_channel_idx" ON "editorial_posts" ("channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_posts_author_idx" ON "editorial_posts" ("author_id");
--> statement-breakpoint

-- ─── 5. editorial_post_translations ────────────────────────────────────────
-- ONE ROW PER (post, language), each with a FULLY INDEPENDENT LIFECYCLE:
-- English can be published while Arabic is still a draft, each stamps its
-- own published_at on its own first publish, and editing or archiving one
-- never touches another.
--
-- `channel` is a DERIVED copy of editorial_posts.channel, overwritten on
-- every insert/update by sync_editorial_translation_channel (section 10).
-- It exists solely so the (channel, language_id, slug) UNIQUE below can be
-- a real database constraint — `channel` lives on the parent post, and a
-- constraint on this table alone cannot see another table. Application
-- code must never set it; the trigger discards whatever is supplied.

CREATE TABLE IF NOT EXISTS "editorial_post_translations" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL,
  "language_id" integer NOT NULL,
  "channel" text NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "deck" text,
  "context_label" text,
  "feature_image_alt" text,
  "body" jsonb NOT NULL,
  "body_version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "published_at" timestamp with time zone,
  "reading_time_override_minutes" integer,
  "seo_title" text,
  "seo_description" text,
  "og_image_url" text,
  "author_snapshot" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
  -- CASCADE: a post's translations ARE the post; no orphan translations.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_post_id_fkey') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_post_id_fkey"
      FOREIGN KEY ("post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  -- RESTRICT: a language can NEVER be deleted out from under content.
  -- Languages are retired with is_active = false; this FK makes the
  -- archive-not-delete policy a database guarantee, not a convention.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_language_id_fkey') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_language_id_fkey"
      FOREIGN KEY ("language_id") REFERENCES "public"."editorial_languages"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_updated_by_admin_id_fkey') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  -- One translation per language per post.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_post_language_unique') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_post_language_unique"
      UNIQUE ("post_id", "language_id");
  END IF;
  -- THE slug guarantee: unique per channel PER LANGUAGE. The same slug may
  -- exist once on 'news' and once on 'experience' (as Wave 1 allowed), and
  -- once per language — but never twice in one (channel, language) pair.
  -- Deliberately NOT global (language, slug) uniqueness.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_channel_language_slug_unique') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_channel_language_slug_unique"
      UNIQUE ("channel", "language_id", "slug");
  END IF;
  -- Target of editorial_post_revisions' COMPOSITE FK, which is what makes
  -- "a revision's translation belongs to that revision's post" declarative.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_id_post_unique') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_id_post_unique"
      UNIQUE ("id", "post_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_title_not_blank') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_title_not_blank"
      CHECK (length(trim("title")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_slug_not_blank') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_slug_not_blank"
      CHECK (length(trim("slug")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_channel_valid') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_status_valid') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_status_valid"
      CHECK ("status" IN ('draft', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_body_version_positive') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_body_version_positive"
      CHECK ("body_version" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_translations_reading_time_override_positive') THEN
    ALTER TABLE "editorial_post_translations" ADD CONSTRAINT "editorial_post_translations_reading_time_override_positive"
      CHECK ("reading_time_override_minutes" IS NULL OR "reading_time_override_minutes" > 0);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_post_translations_channel_language_status_published_at_idx"
  ON "editorial_post_translations" ("channel", "language_id", "status", "published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_post_translations_post_idx"
  ON "editorial_post_translations" ("post_id");
--> statement-breakpoint

-- ─── 6. editorial_post_topics ──────────────────────────────────────────────
-- Relational to the POST, not to a translation: classification of the
-- logical story, shared by every language.

CREATE TABLE IF NOT EXISTS "editorial_post_topics" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL,
  "topic_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_topics_post_id_fkey') THEN
    ALTER TABLE "editorial_post_topics" ADD CONSTRAINT "editorial_post_topics_post_id_fkey"
      FOREIGN KEY ("post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  -- RESTRICT, not CASCADE: an assigned topic can never be physically
  -- deleted out from under published content.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_topics_topic_id_fkey') THEN
    ALTER TABLE "editorial_post_topics" ADD CONSTRAINT "editorial_post_topics_topic_id_fkey"
      FOREIGN KEY ("topic_id") REFERENCES "public"."editorial_topics"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_topics_post_topic_unique') THEN
    ALTER TABLE "editorial_post_topics" ADD CONSTRAINT "editorial_post_topics_post_topic_unique"
      UNIQUE ("post_id", "topic_id");
  END IF;
END $$;
--> statement-breakpoint

-- ─── 7. editorial_post_relations ───────────────────────────────────────────
-- Post-to-post, not translation-to-translation: a recommendation points at
-- the logical story and the website resolves it into whichever language
-- the reader is in.

CREATE TABLE IF NOT EXISTS "editorial_post_relations" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_post_id" integer NOT NULL,
  "target_post_id" integer NOT NULL,
  "relation_type" text DEFAULT 'recommended' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_source_post_id_fkey') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_source_post_id_fkey"
      FOREIGN KEY ("source_post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_target_post_id_fkey') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_target_post_id_fkey"
      FOREIGN KEY ("target_post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_source_target_type_unique') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_source_target_type_unique"
      UNIQUE ("source_post_id", "target_post_id", "relation_type");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_no_self_reference') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_no_self_reference"
      CHECK ("source_post_id" <> "target_post_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_type_valid') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_type_valid"
      CHECK ("relation_type" IN ('recommended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_relations_position_non_negative') THEN
    ALTER TABLE "editorial_post_relations" ADD CONSTRAINT "editorial_post_relations_position_non_negative"
      CHECK ("position" >= 0);
  END IF;
END $$;
--> statement-breakpoint

-- ─── 8. editorial_placements ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "editorial_placements" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "channel" text NOT NULL,
  "post_id" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_post_id_fkey') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_post_id_fkey"
      FOREIGN KEY ("post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_key_post_unique') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_key_post_unique"
      UNIQUE ("key", "post_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_key_not_blank') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_key_not_blank"
      CHECK (length(trim("key")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_channel_valid') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_position_non_negative') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_position_non_negative"
      CHECK ("position" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_placements_window_ordered') THEN
    ALTER TABLE "editorial_placements" ADD CONSTRAINT "editorial_placements_window_ordered"
      CHECK ("start_at" IS NULL OR "end_at" IS NULL OR "start_at" < "end_at");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_placements_key_position_idx"
  ON "editorial_placements" ("key", "position");
--> statement-breakpoint

-- ─── 9. editorial_post_revisions ───────────────────────────────────────────
-- TRANSLATION-AWARE history. Every row is exactly one of two scopes:
--
--   translation_id NOT NULL  — the prior state of ONE translation's own
--     prose and lifecycle. event_type in ('published_edit', 'restore',
--     'translation_status_change').
--   translation_id NULL      — the prior state of the SHARED post spine
--     (author, topics, feature image URL). event_type in
--     ('author_change', 'topics_change', 'shared_field_change').
--
-- Two constraints make the isolation structural rather than conventional:
--   * the COMPOSITE FK (translation_id, post_id) ->
--     editorial_post_translations(id, post_id) — a revision can never
--     reference another post's translation. MATCH SIMPLE (the default)
--     skips the check entirely when translation_id IS NULL, which is
--     exactly what post-scoped rows need.
--   * editorial_post_revisions_scope_matches_event_type — a mis-scoped
--     row (a 'published_edit' with no translation, or an 'author_change'
--     naming one) cannot be written at all.
--
-- revision_number stays PER-POST sequential: one coherent timeline per
-- logical story, with translation_id saying which language each entry
-- belongs to. Filtering by translation_id yields that one language's
-- history; shared-field changes stay interleaved where an editor sees them.

CREATE TABLE IF NOT EXISTS "editorial_post_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL,
  "translation_id" integer,
  "revision_number" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "event_type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_post_id_fkey') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_post_id_fkey"
      FOREIGN KEY ("post_id") REFERENCES "public"."editorial_posts"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_translation_post_fkey') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_translation_post_fkey"
      FOREIGN KEY ("translation_id", "post_id")
      REFERENCES "public"."editorial_post_translations"("id", "post_id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_created_by_admin_id_fkey') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_created_by_admin_id_fkey"
      FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_post_revision_unique') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_post_revision_unique"
      UNIQUE ("post_id", "revision_number");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_number_positive') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_number_positive"
      CHECK ("revision_number" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_event_type_valid') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_event_type_valid"
      CHECK ("event_type" IN ('published_edit', 'restore', 'translation_status_change', 'author_change', 'topics_change', 'shared_field_change'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_post_revisions_scope_matches_event_type') THEN
    ALTER TABLE "editorial_post_revisions" ADD CONSTRAINT "editorial_post_revisions_scope_matches_event_type"
      CHECK (
        ("event_type" IN ('published_edit', 'restore', 'translation_status_change') AND "translation_id" IS NOT NULL)
        OR ("event_type" IN ('author_change', 'topics_change', 'shared_field_change') AND "translation_id" IS NULL)
      );
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_post_revisions_translation_idx"
  ON "editorial_post_revisions" ("translation_id", "revision_number");
--> statement-breakpoint

-- ─── 10. Integrity triggers ────────────────────────────────────────────────
--
-- Three cross-row invariants that no CHECK constraint can express, because
-- each needs to read a DIFFERENT table's row. Trigger precedent in this
-- repo: 0078_payment_records_foundation.sql,
-- 0080_payment_events_foundation.sql.
--
-- All three are scoped strictly to editorial_* tables. None of them
-- references, reads, or fires on any pre-existing production table.

-- (a) editorial_posts: channel immutability + author channel match.
--
-- CHANNEL IMMUTABILITY is what makes the denormalized `channel` on
-- editorial_post_translations trustworthy: if a post could change channel,
-- every one of its translation rows would silently hold a stale copy and
-- the (channel, language_id, slug) UNIQUE would be guarding the wrong
-- value. Wave 1 already never updated channel (it is absent from every
-- route's update key list); this makes that a database fact.
--
-- AUTHOR CHANNEL MATCH cannot be a composite FK (author_id, channel) ->
-- editorial_authors(id, channel): ON DELETE SET NULL would have to null
-- editorial_posts.channel as well, which is NOT NULL, so deleting an
-- author would ERROR instead of leaving the post intact — and "deleting an
-- author must never delete or block a post" is a Wave 1 rule. The trigger
-- is therefore the strongest mechanism compatible with that rule.
CREATE OR REPLACE FUNCTION guard_editorial_post_integrity()
RETURNS TRIGGER AS $$
DECLARE
  author_channel text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.channel IS DISTINCT FROM OLD.channel THEN
    RAISE EXCEPTION
      'editorial_posts.channel is immutable (post % : % -> %); translations carry a derived copy of it keyed by a UNIQUE constraint',
      OLD.id, OLD.channel, NEW.channel;
  END IF;

  -- NULL author_id is legal (a draft post need not have a byline yet, and
  -- ON DELETE SET NULL produces one), so it is simply skipped.
  IF NEW.author_id IS NOT NULL THEN
    SELECT "channel" INTO author_channel
      FROM "editorial_authors" WHERE "id" = NEW.author_id;
    IF author_channel IS NULL THEN
      RAISE EXCEPTION 'editorial_posts.author_id % does not exist', NEW.author_id;
    END IF;
    IF author_channel <> NEW.channel THEN
      RAISE EXCEPTION
        'editorial author % belongs to the % channel and cannot be the byline of a % post',
        NEW.author_id, author_channel, NEW.channel;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editorial_post_integrity_trg" ON "editorial_posts";
--> statement-breakpoint
CREATE TRIGGER "editorial_post_integrity_trg"
  BEFORE INSERT OR UPDATE ON "editorial_posts"
  FOR EACH ROW EXECUTE FUNCTION guard_editorial_post_integrity();
--> statement-breakpoint

-- (b) editorial_post_translations: DERIVE `channel` from the parent post.
--
-- Note this OVERWRITES rather than validates. The column is not an input
-- the application is trusted to get right — it is computed from post_id on
-- every insert and update, so no write path (present or future, including
-- hand-written SQL) can desynchronize it, and the service layer never has
-- to remember to set it.
CREATE OR REPLACE FUNCTION sync_editorial_translation_channel()
RETURNS TRIGGER AS $$
DECLARE
  parent_channel text;
BEGIN
  SELECT "channel" INTO parent_channel
    FROM "editorial_posts" WHERE "id" = NEW.post_id;
  IF parent_channel IS NULL THEN
    -- Unreachable through the FK, but a clear message beats a NOT NULL
    -- violation if it ever is reached (e.g. inside the same statement).
    RAISE EXCEPTION 'editorial_post_translations.post_id % does not exist', NEW.post_id;
  END IF;
  NEW.channel := parent_channel;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editorial_translation_channel_trg" ON "editorial_post_translations";
--> statement-breakpoint
CREATE TRIGGER "editorial_translation_channel_trg"
  BEFORE INSERT OR UPDATE ON "editorial_post_translations"
  FOR EACH ROW EXECUTE FUNCTION sync_editorial_translation_channel();
--> statement-breakpoint

-- (c) editorial_authors: an author's channel cannot change while any post
-- carries them as a byline. Closes the author-side route to breaking the
-- author-channel-match invariant (moving the author instead of the post).
-- Retiring an author is status = 'archived', which this does not restrict.
CREATE OR REPLACE FUNCTION guard_editorial_author_channel_immutable()
RETURNS TRIGGER AS $$
DECLARE
  referencing_posts integer;
BEGIN
  IF NEW.channel IS DISTINCT FROM OLD.channel THEN
    SELECT count(*) INTO referencing_posts
      FROM "editorial_posts" WHERE "author_id" = OLD.id;
    IF referencing_posts > 0 THEN
      RAISE EXCEPTION
        'editorial author % cannot change channel (% -> %) while % post(s) carry this byline; create a separate author for the other channel',
        OLD.id, OLD.channel, NEW.channel, referencing_posts;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editorial_author_channel_immutable_trg" ON "editorial_authors";
--> statement-breakpoint
CREATE TRIGGER "editorial_author_channel_immutable_trg"
  BEFORE UPDATE ON "editorial_authors"
  FOR EACH ROW EXECUTE FUNCTION guard_editorial_author_channel_immutable();
--> statement-breakpoint

-- ─── 11. editorial_website_links (Website Settings > Links) ────────────────
-- Dedicated SINGLE-ROW settings table, id = 1, following the
-- ballet_settings / background_music_settings convention (typed columns,
-- seeded once, GET + PATCH only, no create and no delete route). The repo
-- has no generic key/value settings store to extend — it was searched for
-- before this table was added.
--
-- website_background_settings was deliberately NOT extended: it is the
-- Background CMS's own table, out of scope here, and reusing it would also
-- put these links behind `website.backgrounds` permissions. Nothing in
-- this section reads, writes, or references it.

CREATE TABLE IF NOT EXISTS "editorial_website_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "google_play_url" text,
  "app_store_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_website_links_updated_by_admin_id_fkey') THEN
    ALTER TABLE "editorial_website_links" ADD CONSTRAINT "editorial_website_links_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  -- Singleton invariant: makes a second row impossible even from
  -- hand-written SQL, not merely absent because no route creates one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_website_links_singleton') THEN
    ALTER TABLE "editorial_website_links" ADD CONSTRAINT "editorial_website_links_singleton"
      CHECK ("id" = 1);
  END IF;
  -- HTTPS-only, absolute, and free of whitespace and markup characters
  -- (< > " ' \) so a stored value can never break out of an attribute
  -- context wherever the website interpolates it. NULL = "not configured",
  -- which is a legitimate state; the service layer normalizes "" to NULL
  -- so the two cannot both mean unset.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_website_links_google_play_url_https') THEN
    ALTER TABLE "editorial_website_links" ADD CONSTRAINT "editorial_website_links_google_play_url_https"
      CHECK ("google_play_url" IS NULL OR "google_play_url" ~ '^https://[^\s<>"''\\]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_website_links_app_store_url_https') THEN
    ALTER TABLE "editorial_website_links" ADD CONSTRAINT "editorial_website_links_app_store_url_https"
      CHECK ("app_store_url" IS NULL OR "app_store_url" ~ '^https://[^\s<>"''\\]+$');
  END IF;
END $$;
--> statement-breakpoint
-- Structural seed of the singleton row, exactly as ballet_settings is
-- seeded in 0009. Both URLs NULL = "no link configured".
INSERT INTO "editorial_website_links" ("id", "google_play_url", "app_store_url")
VALUES (1, NULL, NULL)
ON CONFLICT ("id") DO NOTHING;
