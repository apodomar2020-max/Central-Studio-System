-- Migration 0043: Promotions permission module (Phase 6B)
--
-- Promotions historically piggybacked on the `offers` permission module.
-- Phase 6B introduces a dedicated `promotions` module in the permission
-- catalog; this migration copies each role's existing offers.* grants into
-- promotions.* so no admin loses Promotions access when the frontend/backend
-- guards switch from `offers` to `promotions`.
--
-- Guarantees:
--   * Additive only — existing offers.* grants are NOT removed or modified.
--   * Idempotent — re-running produces the same result (jsonb merge).
--   * Existing explicit promotions.* values win over copied offers.* values
--     (right side of the `||` merge takes precedence).
--   * Roles without an `offers` object are untouched.
--   * Role names/descriptions and system_users are untouched; Super Admins
--     bypass permission checks entirely and are unaffected.

UPDATE "roles"
SET "permissions" = jsonb_set(
  "permissions",
  '{promotions}',
  ("permissions"->'offers') || COALESCE(
    CASE WHEN jsonb_typeof("permissions"->'promotions') = 'object'
         THEN "permissions"->'promotions'
         ELSE '{}'::jsonb
    END,
    '{}'::jsonb
  )
)
WHERE jsonb_typeof("permissions"->'offers') = 'object';
