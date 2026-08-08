-- Migration 0101: Ballet FAQ Categories
--
-- Adds a Ballet-domain-only FAQ Category CMS entity and references it from
-- ballet_faqs via a nullable FK. Purely additive:
--   * ballet_faq_categories is a brand-new, empty table (no seed rows).
--   * ballet_faqs.category_id is a new NULLABLE column — every existing
--     row gets category_id = NULL, no other column is touched, no row is
--     deleted or recreated.
-- ON DELETE RESTRICT: categories are only ever soft-deactivated (is_active
-- = false), never hard-deleted; RESTRICT enforces that intent at the DB
-- level even against a raw SQL delete.
-- Name uniqueness is case-insensitive (functional index on
-- lower(trim(name))), mirroring the existing convention in
-- ballet_applications and app_faq_categories.
--
-- Fully independent of app_faq_categories/app_faq_items — no shared table,
-- no shared FK, no cross-domain relationship.

CREATE TABLE IF NOT EXISTS ballet_faq_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ballet_faq_categories_name_unique_ci
  ON ballet_faq_categories (lower(trim(name)));

ALTER TABLE ballet_faqs
  ADD COLUMN IF NOT EXISTS category_id INTEGER
    REFERENCES ballet_faq_categories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ballet_faqs_category_id_idx
  ON ballet_faqs (category_id);
