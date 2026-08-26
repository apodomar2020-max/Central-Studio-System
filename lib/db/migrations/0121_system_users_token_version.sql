-- Security Wave — Admin Session / Browser Security Hardening.
--
-- Mirrors students.token_version (migration 0113) for Admin JWTs: a simple
-- integer embedded in the JWT payload at sign time and re-checked against
-- the DB-current value on every authenticated admin request. Deactivation
-- already invalidates existing JWTs instantly (requireAdminAuth's
-- loadAdminIdentity re-reads is_active and returns null for an inactive
-- account) — this column closes the one remaining gap: a password change
-- did not, on its own, invalidate a still-active admin's already-issued
-- JWTs.

ALTER TABLE "system_users"
  ADD COLUMN "token_version" integer NOT NULL DEFAULT 1;

-- Manual rollback (not executed by this migration):
--   ALTER TABLE "system_users" DROP COLUMN "token_version";
