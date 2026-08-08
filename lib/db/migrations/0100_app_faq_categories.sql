-- Migration 0100: App Content → FAQ Categories
--
-- Adds an independently managed FAQ Category CMS entity and references it
-- from app_faq_items via a nullable FK. Purely additive:
--   * app_faq_categories is a brand-new, empty table (no seed rows).
--   * app_faq_items.category_id is a new NULLABLE column — every existing
--     row gets category_id = NULL, no other column is touched, no row is
--     deleted or recreated.
-- ON DELETE RESTRICT: categories are only ever soft-deleted (is_active =
-- false), mirroring every sibling App Content table; RESTRICT enforces that
-- intent at the DB level even against a raw SQL delete.
-- Name uniqueness is case-insensitive (functional index on lower(trim(name))),
-- mirroring the existing convention in ballet_applications.

CREATE TABLE IF NOT EXISTS app_faq_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_faq_categories_name_unique_ci
  ON app_faq_categories (lower(trim(name)));

ALTER TABLE app_faq_items
  ADD COLUMN IF NOT EXISTS category_id INTEGER
    REFERENCES app_faq_categories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS app_faq_items_category_id_idx
  ON app_faq_items (category_id);
