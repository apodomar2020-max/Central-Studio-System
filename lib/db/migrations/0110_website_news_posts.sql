-- Migration 0110: Website CMS Wave 2 — website_news_posts table
--
-- WHY: Foundation table for the Website → News Admin area (Website CMS
-- Wave 2, News only — Performance remains Wave 3 and gets no table here).
-- Lets Admin create/edit/deactivate News posts that the public website
-- reads instead of the hardcoded lib/articlesData.ts array.
--
-- SCHEMA ONLY — no data. Seeding the 6 existing News posts (migrated
-- byte-for-byte from lib/articlesData.ts) is a SEPARATE, idempotent step
-- (scripts/src/seedWebsiteNewsPosts.ts, run once after this migration and
-- after the API is deployed) per the locked Wave 2 seed strategy — this
-- migration deliberately does not mix schema creation with content seeding.
--
-- EXISTING DATA IMPACT: none. This is a net-new table; no existing table,
-- column, or row is touched.
--
-- TWO DATE COLUMNS (published_date text + published_at timestamptz): see
-- lib/db/src/schema/websiteNewsPosts.ts's doc comment for the full
-- reasoning — published_date is the exact literal display string (never
-- parsed/reformatted), published_at is a real sortable timestamp used only
-- for ORDER BY / indexing.
--
-- RELATED CONTENT: related_refs (jsonb) stores an ordered
-- Array<{type:'news'|'performance', slug}> — intentionally NOT a foreign
-- key, since Performance has no CMS table in this wave. See the Wave 2
-- report's "Wave-3 handoff" section for why no migration of this column is
-- needed when Performance later moves to its own CMS table.
--
-- NO PHYSICAL DELETE ROUTE: the API only exposes soft-deactivate
-- (is_active = false) on DELETE — there is no way for Admin to physically
-- remove a row through the application.
--
-- ROLLBACK: revert the application code (routes/Admin pages/website BFF) to
-- stop reading this table and point the website back at
-- lib/articlesData.ts (kept as the Wave 0 canonical rollback reference,
-- untouched by this migration). If the table itself needs to be dropped
-- too: DROP TABLE IF EXISTS "website_news_posts"; — this drops only
-- Admin-authored News content, never any booking/payment/attendance data.

CREATE TABLE IF NOT EXISTS "website_news_posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "category" text NOT NULL,
  "category_label" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text NOT NULL,
  "excerpt" text,
  "hero_image_url" text NOT NULL,
  "listing_image_url" text,
  "published_date" text NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "read_time" text,
  "is_featured" boolean DEFAULT false NOT NULL,
  "author_name" text NOT NULL,
  "author_role" text NOT NULL,
  "author_avatar_url" text,
  "tags" text[] DEFAULT '{}' NOT NULL,
  "gallery_images" text[] DEFAULT '{}' NOT NULL,
  "content" jsonb NOT NULL,
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
    SELECT 1 FROM pg_constraint WHERE conname = 'website_news_posts_slug_unique'
  ) THEN
    ALTER TABLE "website_news_posts"
      ADD CONSTRAINT "website_news_posts_slug_unique" UNIQUE ("slug");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_news_posts_updated_by_admin_id_fkey'
  ) THEN
    ALTER TABLE "website_news_posts"
      ADD CONSTRAINT "website_news_posts_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_news_posts_category_not_blank'
  ) THEN
    ALTER TABLE "website_news_posts" ADD CONSTRAINT "website_news_posts_category_not_blank"
      CHECK (length(trim("category")) > 0);
  END IF;
END $$;
--> statement-breakpoint
-- No separate unique index on "slug" — the UNIQUE constraint added above
-- already creates one implicitly; a second explicit index would be a
-- redundant duplicate (caught during local verification).
CREATE INDEX IF NOT EXISTS "website_news_posts_active_published_at_idx" ON "website_news_posts" ("is_active", "published_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_news_posts_is_featured_idx" ON "website_news_posts" ("is_featured") WHERE "is_featured" = true;
