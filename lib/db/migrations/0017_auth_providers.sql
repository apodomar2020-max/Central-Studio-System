-- Migration 0017: Auth providers + mandatory email verification foundation
-- Adds social-auth + verification columns to `students`, hardens `email_otps`,
-- and backfills existing real accounts so they are NOT locked out when email
-- verification becomes mandatory.
--
-- All columns are nullable / defaulted so existing rows remain valid.

-- ─── 1. students: verification + provider columns ────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_provider     text,
  ADD COLUMN IF NOT EXISTS google_id         text,
  ADD COLUMN IF NOT EXISTS apple_id          text,
  ADD COLUMN IF NOT EXISTS facebook_id       text,
  ADD COLUMN IF NOT EXISTS last_login_at     timestamptz;

-- One account per provider identity; NULLs allowed (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_google_id   ON students (google_id)   WHERE google_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_apple_id    ON students (apple_id)    WHERE apple_id    IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_facebook_id ON students (facebook_id) WHERE facebook_id IS NOT NULL;

-- ─── 2. Backfill: grandfather existing password (local) accounts ─────────────
-- Decision (documented): accounts that already set a password are real, active
-- users from before mandatory verification. Marking them verified avoids
-- locking out the existing user base on their next login. Net-new accounts
-- (created after this migration) start unverified and MUST pass OTP.
-- Admin-created rows WITHOUT a password are intentionally left unverified.
UPDATE students
SET
  email_verified    = true,
  email_verified_at = COALESCE(email_verified_at, now()),
  auth_provider     = COALESCE(auth_provider, 'local')
WHERE password_hash IS NOT NULL
  AND email_verified = false;

-- Tag remaining already-verified rows with a provider for consistency.
UPDATE students
SET auth_provider = 'local'
WHERE auth_provider IS NULL
  AND email_verified = true;

-- ─── 3. email_otps hardening ─────────────────────────────────────────────────
-- student_id becomes nullable (email-first / social verification flows),
-- plus a purpose discriminator and an attempts counter for brute-force lockout.
ALTER TABLE email_otps ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE email_otps
  ADD COLUMN IF NOT EXISTS purpose  text    NOT NULL DEFAULT 'verify',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps (email);
