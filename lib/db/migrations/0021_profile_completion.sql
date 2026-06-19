-- Migration 0021: Student profile completion
-- Separates authentication identity from required Central Studio profile data.
-- All additions are nullable/defaulted so existing accounts are preserved.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS account_type          text,
  ADD COLUMN IF NOT EXISTS profile_completed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS provider_display_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_account_type_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('student', 'parent'));
  END IF;
END $$;

-- Keep existing accounts incomplete until they explicitly choose account_type.
-- If account_type is already present from a prior/manual change, mark complete
-- only when the other required fields are present.
UPDATE students
SET
  profile_completed = true,
  profile_completed_at = COALESCE(profile_completed_at, now())
WHERE profile_completed = false
  AND NULLIF(btrim(name), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(phone, '')), '') IS NOT NULL
  AND account_type IN ('student', 'parent');
