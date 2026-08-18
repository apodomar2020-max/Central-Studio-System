-- Migration 0109: Website CMS Wave 1 — website_background_settings table
--
-- WHY: Foundation table for the Website → Backgrounds Admin area (Website
-- CMS Wave 1). Lets Admin override the media URL for exactly 8 approved
-- public-website sections (Home S1/S3, About Studio S1/S4/S7, Ballet S1/S2,
-- Classes S1) without a code deploy, while every section keeps its current
-- hardcoded asset as a local fallback so the public website can never go
-- blank (fallback logic lives in the website components, not this table).
--
-- Generalizes the existing background_music_settings precedent (singleton
-- settings row + version + updated-by admin FK) from one row to a fixed,
-- keyed set of 8 rows, one per section_key.
--
-- SCHEMA ONLY — no data. Seeding the 8 approved rows (7 with their current
-- verified media URL, 1 — ballet.section2 — with a NULL media_url, since
-- that section has no existing media today) is a SEPARATE, idempotent step
-- (scripts/src/seedWebsiteBackgrounds.ts, run once after this migration and
-- after the API is deployed) per the locked Wave 1 seed strategy — this
-- migration deliberately does not mix schema creation with content seeding.
--
-- EXISTING DATA IMPACT: none. This is a net-new table; no existing table,
-- column, or row is touched.
--
-- NO CREATE/DELETE ROUTE: the API (artifacts/api-server/src/routes/
-- websiteBackgrounds.ts) only exposes GET and PATCH — there is no way for
-- Admin to add a 9th row or remove one of the 8 through the application.
-- The section_key CHECK constraint below is defense-in-depth for that same
-- fixed set at the database layer (mirrors
-- lib/db/src/websiteBackgroundSections.ts's WEBSITE_BACKGROUND_SECTION_KEYS
-- — keep both lists in sync by hand if the approved scope ever changes).
--
-- ROLLBACK: revert the application code (route/Admin pages/website fetch
-- hook) to stop reading this table — every website section already falls
-- back to its own hardcoded default when no row/URL is available, so
-- disabling the feature this way causes zero visual change. If the table
-- itself needs to be dropped too: DROP TABLE IF EXISTS
-- "website_background_settings"; — this drops only Admin-entered background
-- overrides, never any booking/payment/attendance/content data.

CREATE TABLE IF NOT EXISTS "website_background_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "section_key" text NOT NULL,
  "page" text NOT NULL,
  "section_label" text NOT NULL,
  "media_url" text,
  "media_kind" text,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_section_key_unique'
  ) THEN
    ALTER TABLE "website_background_settings"
      ADD CONSTRAINT "website_background_settings_section_key_unique" UNIQUE ("section_key");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_updated_by_admin_id_fkey'
  ) THEN
    ALTER TABLE "website_background_settings"
      ADD CONSTRAINT "website_background_settings_updated_by_admin_id_fkey"
      FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."system_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_section_key_check'
  ) THEN
    ALTER TABLE "website_background_settings" ADD CONSTRAINT "website_background_settings_section_key_check"
      CHECK ("section_key" IN (
        'home.section1', 'home.section3',
        'about-studio.section1', 'about-studio.section4', 'about-studio.section7',
        'ballet.section1', 'ballet.section2',
        'classes.section1'
      ));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_page_check'
  ) THEN
    ALTER TABLE "website_background_settings" ADD CONSTRAINT "website_background_settings_page_check"
      CHECK ("page" IN ('home','about-studio','ballet','classes'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_media_kind_check'
  ) THEN
    ALTER TABLE "website_background_settings" ADD CONSTRAINT "website_background_settings_media_kind_check"
      CHECK ("media_kind" IS NULL OR "media_kind" IN ('image','video'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'website_background_settings_version_positive'
  ) THEN
    ALTER TABLE "website_background_settings" ADD CONSTRAINT "website_background_settings_version_positive"
      CHECK ("version" >= 1);
  END IF;
END $$;
