-- Migration 0044: Drop legacy offers table (Phase 6E-B)
--
-- The Offers feature was removed in stages:
--   Phase 6B (0043)  — Promotions decoupled from offers permissions
--   Phase 6C         — admin /offers UI route removed
--   Phase 6D         — admin offers mutations deprecated (410)
--   Phase 6E-A       — public GET endpoints, OpenAPI contract, dashboard
--                      totalOffers, and the offers permission module removed
--
-- Nothing reads or writes the "offers" table anymore, so this drops it.
-- Historical notification rows referencing offers (type='offer_published',
-- related_entity_type='offer') are plain text columns with no FK to this
-- table and are intentionally preserved — the mobile app continues to render
-- them from the notifications table alone.

DROP TABLE IF EXISTS "offers";
