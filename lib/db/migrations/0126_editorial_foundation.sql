-- Migration 0126: Unified Editorial CMS Wave 1 — additive backend foundation
--
-- WHY: Foundation tables for the unified Editorial CMS (one post model
-- serving both the 'news' and 'experience' channels), with first-class
-- authors, channel-scoped topics, post-to-post recommendations, named
-- curation placements, and an append-only published-edit revision history.
--
-- SCHEMA ONLY — no data, no backfill, no content migration. The
-- `migration_source_table` / `migration_source_id` columns on
-- editorial_posts are inert provenance placeholders for a LATER wave and
-- are written by nothing in this wave.
--
-- EXISTING DATA IMPACT: NONE. Every statement below is a CREATE against a
-- net-new object. No existing table, column, index, constraint, or row is
-- altered or dropped. In particular website_news_posts,
-- website_performances, ballet_performance_opportunities, and every
-- Ballet / Background-CMS / Classes / Schedules / bookings / payments /
-- attendance / auth table are untouched — this migration does not name
-- them at all, except as the referenced side of new FKs into
-- system_users(id) (which adds a constraint to the NEW table, never to
-- system_users).
--
-- AUTHORED BY HAND, deliberately: `drizzle-kit generate` cannot be used in
-- this repo — migrations/meta contains snapshots only up to 0056 while the
-- journal runs past 0125, so the snapshot chain is broken and a generate
-- run fails outright (ENOENT meta/0000_snapshot.json). Hand-authored,
-- idempotent, heavily-commented SQL (DO $$ constraint guards +
-- IF NOT EXISTS) is the established convention for every migration since —
-- see 0110_website_news_posts.sql, which this file mirrors in style.
--
-- LIFECYCLE / INTEGRITY NOTES:
--   * status and channel are text + CHECK (repo convention — see
--     ballet_performance_opportunities.status) rather than PG enum types,
--     so adding a value later is an additive CHECK swap, not an ALTER TYPE.
--   * editorial_post_topics.topic_id is ON DELETE RESTRICT on purpose:
--     topics are retired with status='archived', never physically dropped
--     out from under published content. post_id is CASCADE — a post's own
--     assignments belong to the post.
--   * editorial_post_relations has a row-level CHECK forbidding
--     self-reference. The "same channel only" rule needs a cross-row
--     lookup and is therefore enforced in the service layer, not here.
--   * editorial_post_revisions is append-only; revision_number is per-post
--     sequential, assigned inside the mutating transaction under a row
--     lock on the parent post, and is UNIQUE (post_id, revision_number) so
--     a concurrent edit cannot duplicate a number.
--
-- ROLLBACK: this wave adds no read path used by the public website or the
-- mobile app, so reverting the application code is sufficient. If the
-- tables themselves must go, drop them in FK-dependency order:
--   DROP TABLE IF EXISTS "editorial_post_revisions";
--   DROP TABLE IF EXISTS "editorial_placements";
--   DROP TABLE IF EXISTS "editorial_post_relations";
--   DROP TABLE IF EXISTS "editorial_post_topics";
--   DROP TABLE IF EXISTS "editorial_posts";
--   DROP TABLE IF EXISTS "editorial_topics";
--   DROP TABLE IF EXISTS "editorial_authors";
-- That drops only Admin-authored editorial content — never any booking,
-- payment, attendance, ballet, or website_news/website_performance data.

-- ─── 1. editorial_authors ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "editorial_authors" (
  "id" serial PRIMARY KEY NOT NULL,
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
END $$;
--> statement-breakpoint
DO $$
BEGIN
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

-- ─── 2. editorial_topics ───────────────────────────────────────────────────

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

-- ─── 3. editorial_posts ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "editorial_posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel" text NOT NULL,
  "slug" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "title" text NOT NULL,
  "deck" text,
  "context_label" text,
  "body" jsonb NOT NULL,
  "body_version" integer DEFAULT 1 NOT NULL,
  "feature_image_url" text,
  "feature_image_alt" text,
  "author_id" integer,
  "author_snapshot" jsonb,
  "reading_time_override_minutes" integer,
  "published_at" timestamp with time zone,
  "migration_source_table" text,
  "migration_source_id" integer,
  "seo_title" text,
  "seo_description" text,
  "og_image_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
DO $$
BEGIN
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_channel_slug_unique') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_channel_slug_unique"
      UNIQUE ("channel", "slug");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_title_not_blank') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_title_not_blank"
      CHECK (length(trim("title")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_slug_not_blank') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_slug_not_blank"
      CHECK (length(trim("slug")) > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_channel_valid') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_channel_valid"
      CHECK ("channel" IN ('news', 'experience'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_status_valid') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_status_valid"
      CHECK ("status" IN ('draft', 'published', 'archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_body_version_positive') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_body_version_positive"
      CHECK ("body_version" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editorial_posts_reading_time_override_positive') THEN
    ALTER TABLE "editorial_posts" ADD CONSTRAINT "editorial_posts_reading_time_override_positive"
      CHECK ("reading_time_override_minutes" IS NULL OR "reading_time_override_minutes" > 0);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "editorial_posts_channel_status_published_at_idx"
  ON "editorial_posts" ("channel", "status", "published_at");
--> statement-breakpoint

-- ─── 4. editorial_post_topics ──────────────────────────────────────────────

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

-- ─── 5. editorial_post_relations ───────────────────────────────────────────

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

-- ─── 6. editorial_placements ───────────────────────────────────────────────

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

-- ─── 7. editorial_post_revisions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "editorial_post_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "post_id" integer NOT NULL,
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
      CHECK ("event_type" IN ('published_edit', 'restore', 'author_change', 'topics_change'));
  END IF;
END $$;
