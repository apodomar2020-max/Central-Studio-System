-- Migration 0011: Add dance_types table
--
-- Stores canonical dance type definitions that drive:
--   - Admin Classes page category dropdown (replaces hardcoded list)
--   - Mobile category matching via slug normalization
--   - Admin Settings → Dance Types management page
--
-- classes.category continues to store dance_types.name (the display string).
-- Mobile apiAdapters.ts uses fuzzy normalization to match names to DANCE_CATEGORIES.

CREATE TABLE IF NOT EXISTS "dance_types" (
  "id"         serial PRIMARY KEY,
  "name"       text NOT NULL,
  "slug"       text NOT NULL,
  "is_active"  boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "dance_types_slug_unique" UNIQUE("slug")
);

-- Seed with canonical dance types matching mobile DANCE_CATEGORIES.
-- ON CONFLICT DO NOTHING makes this idempotent on re-runs.
INSERT INTO "dance_types" ("name", "slug", "sort_order") VALUES
  ('Hip Hop',     'hiphop',       1),
  ('Afro Dance',  'afrodance',    2),
  ('Breaking',    'breaking',     3),
  ('Salsa',       'salsa',        4),
  ('Bachata',     'bachata',      5),
  ('Contemporary','contemporary', 6),
  ('Ballet',      'ballet',       7),
  ('Zumba',       'zumba',        8),
  ('Popping',     'popping',      9),
  ('Locking',     'locking',      10),
  ('Jazz',        'jazz',         11),
  ('House Dance', 'housedance',   12)
ON CONFLICT ("slug") DO NOTHING;
