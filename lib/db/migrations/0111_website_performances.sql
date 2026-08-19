-- Migration 0111: Website CMS Wave 3 — website_performances table
--
-- WHY: Foundation table for the Website → Performance Admin area (Website
-- CMS Wave 3, Performance only — News and Backgrounds already migrated in
-- Waves 1-2). Lets Admin create/edit/deactivate Performance entries that
-- the public website reads instead of the hardcoded lib/articlesData.ts
-- Performance entries.
--
-- SCHEMA ONLY — no data. Seeding the 4 existing Performance entries
-- (migrated byte-for-byte from lib/articlesData.ts, including their
-- existing card/detail content differences — most notably YAGP's, which
-- this migration/seed explicitly does NOT reconcile) is a SEPARATE,
-- idempotent step (scripts/src/seedWebsitePerformances.ts, run once after
-- this migration and after the API is deployed) per the locked Wave 3 seed
-- strategy — this migration deliberately does not mix schema creation with
-- content seeding.
--
-- EXISTING DATA IMPACT: none. This is a net-new table; no existing table,
-- column, or row is touched.
--
-- sortOrder (not a machine-readable event date) drives public list order
-- and featured-fallback order — LOCKED decision: no eventStartDate column
-- in Wave 3 (see lib/db/src/schema/websitePerformances.ts's doc comment).
--
-- badge_variant is a closed enum (cyan/purple/gold) enforced by a CHECK
-- constraint — never a raw CSS/Tailwind class string from Admin.
--
-- RELATED CONTENT: related_refs (jsonb) stores an ordered
-- Array<{type:'news'|'performance', slug}> — identical shape to Wave 2's
-- website_news_posts.related_refs, reused verbatim. Not a foreign key, for
-- the same reason Wave 2's wasn't: both content types resolve via their
-- own table keyed by the shared {type, slug} tag.
--
-- NO PHYSICAL DELETE ROUTE: the API only exposes soft-deactivate
-- (is_active = false) on DELETE — there is no way for Admin to physically
-- remove a row through the application.
--
-- ROLLBACK: revert the application code (routes/Admin pages/website BFF) to
-- stop reading this table and point the website back at
-- lib/articlesData.ts (kept as the Wave 0 canonical rollback reference,
-- untouched by this migration, until Wave 4 cleanup). If the table itself
-- needs to be dropped too: DROP TABLE IF EXISTS "website_performances"; —
-- this drops only Admin-authored Performance content, never any
-- booking/payment/attendance/content data.

CREATE TABLE IF NOT EXISTS "website_performances" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "sort_order" smallint NOT NULL,

  "category" text NOT NULL,
  "category_label" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text NOT NULL,
  "hero_image_url" text NOT NULL,
  "event_date_display" text NOT NULL,
  "season" text NOT NULL,

  "featured_hero_image_url" text,
  "featured_hero_date_badge" text,
  "is_featured" boolean DEFAULT false NOT NULL,

  "card_title" text NOT NULL,
  "card_description" text NOT NULL,
  "card_image_url" text NOT NULL,
  "card_venue" text NOT NULL,
  "card_dates_display" text NOT NULL,
  "card_time" text NOT NULL,
  "date_day" text NOT NULL,
  "date_month" text NOT NULL,
  "card_badge_label" text NOT NULL,

  "venue" text NOT NULL,
  "times" text[] DEFAULT '{}' NOT NULL,
  "orchestra" text,
  "runtime" text NOT NULL,
  "ticket_link" text,
  "ticket_price_range" text,
  "detail_badge_label" text NOT NULL,
  "badge_variant" text NOT NULL,

  "author_name" text NOT NULL,
  "author_role" text NOT NULL,
  "author_avatar_url" text,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "gallery_images" text[] DEFAULT '{}' NOT NULL,
  "content" jsonb NOT NULL,

  "key_highlights" text[] DEFAULT '{}' NOT NULL,
  "schedule_overview" jsonb DEFAULT '[]' NOT NULL,
  "cast_and_faculty" jsonb DEFAULT '[]' NOT NULL,

  "related_refs" jsonb DEFAULT '[]' NOT NULL,

  "is_active" boolean DEFAULT true NOT NULL,
  "updated_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_performances_slug_unique'
  ) THEN
    ALTER TABLE "website_performances"
      ADD CONSTRAINT "website_performances_slug_unique" UNIQUE ("slug");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_performances_updated_by_admin_id_fkey'
  ) THEN
    ALTER TABLE "website_performances"
      ADD CONSTRAINT "website_performances_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_performances_category_not_blank'
  ) THEN
    ALTER TABLE "website_performances" ADD CONSTRAINT "website_performances_category_not_blank"
      CHECK (length(trim("category")) > 0);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_performances_badge_variant_check'
  ) THEN
    ALTER TABLE "website_performances" ADD CONSTRAINT "website_performances_badge_variant_check"
      CHECK ("badge_variant" IN ('cyan', 'purple', 'gold'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_performances_active_sort_order_idx" ON "website_performances" ("is_active", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_performances_is_featured_idx" ON "website_performances" ("is_featured") WHERE "is_featured" = true;
