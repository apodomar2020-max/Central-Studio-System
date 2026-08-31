-- Canonical Account Phone Domain — data cleanup + DB-level guarantees.
--
-- Approved architecture: students.phone is an account identity field (one
-- real Egyptian mobile number = one account, mirroring the existing email
-- uniqueness and the google_id/apple_id/facebook_id partial-unique pattern
-- from 0017_auth_providers.sql). Canonical stored form is "20XXXXXXXXXX"
-- (digits only, no "+", no leading local "0", exactly 12 digits).
--
-- Scope is deliberately narrow: this touches ONLY students.phone. It does
-- NOT touch children.emergency_phone, ballet_applications.parent_phone,
-- bookings.student_phone, package_orders.student_phone, or any other
-- historical/intake/non-identity phone field — none of those are account
-- identity columns and none of them are constrained here.
--
-- Current production/student data is test-only (owner-approved cleanup).
-- Order of operations, and why:
--   1. Normalize convertible values to canonical form in place.
--   2. Null out anything that still isn't a valid canonical Egyptian mobile
--      number after normalization (landline/foreign/malformed/unconvertible)
--      — the account itself is never touched, only the phone field.
--   3. Resolve duplicate canonical values: the OLDEST account (by
--      created_at, tie-broken by the lowest id) keeps the phone; every
--      later duplicate is nulled. This must happen before the unique index
--      is created, or index creation fails outright.
--   4. Only once zero violations remain: add the CHECK constraint, then the
--      partial unique index. Both are safe to add at that point and both
--      are trivially reversible (DROP CONSTRAINT / DROP INDEX) if ever
--      needed — no data is destroyed by adding either.

-- ─── 1. Normalize convertible values to canonical "20XXXXXXXXXX" ────────────
-- Mirrors phoneDomain.ts's normalizeAccountPhone() byte-for-byte (minus the
-- Arabic-Indic digit case, which cannot occur in already-stored data — it
-- would already have failed to normalize as pure text and been excluded by
-- the pre-existing lack of any format enforcement, so nothing to convert).
WITH cleaned AS (
  SELECT
    id,
    regexp_replace(trim(phone), '[^0-9+]', '', 'g') AS stripped
  FROM students
  WHERE phone IS NOT NULL AND trim(phone) <> ''
),
digits_only AS (
  SELECT
    id,
    regexp_replace(
      CASE WHEN stripped LIKE '+%' THEN substr(stripped, 2) ELSE stripped END,
      '[^0-9]', '', 'g'
    ) AS digits
  FROM cleaned
),
normalized AS (
  SELECT
    id,
    CASE
      WHEN digits LIKE '00%' THEN substr(digits, 3)
      ELSE digits
    END AS digits
  FROM digits_only
),
rewritten AS (
  SELECT
    id,
    CASE
      WHEN digits ~ '^01[0-9]{9}$' THEN '20' || substr(digits, 2)
      WHEN digits ~ '^1[0-9]{9}$'  THEN '20' || digits
      ELSE digits
    END AS canonical
  FROM normalized
)
UPDATE students
SET phone = rewritten.canonical
FROM rewritten
WHERE students.id = rewritten.id
  AND length(rewritten.canonical) = 12
  AND rewritten.canonical ~ '^[0-9]{12}$';

-- ─── 2. Null out anything that still isn't a valid canonical value ─────────
-- Covers: unconvertible garbage (never became 12 digits above), landlines,
-- foreign numbers, invalid operator prefixes. The account row is kept.
UPDATE students
SET phone = NULL
WHERE phone IS NOT NULL
  AND phone !~ '^20(10|11|12|15)[0-9]{8}$';

-- ─── 3. Resolve duplicate canonical values ──────────────────────────────────
-- Oldest account (created_at, then id as a deterministic tiebreak) keeps the
-- phone; every other row sharing that canonical value is nulled.
WITH ranked AS (
  SELECT
    id,
    phone,
    row_number() OVER (
      PARTITION BY phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM students
  WHERE phone IS NOT NULL
)
UPDATE students
SET phone = NULL
FROM ranked
WHERE students.id = ranked.id
  AND ranked.rn > 1;

-- ─── 4. DB-level guarantees, added only now that zero violations remain ────
ALTER TABLE students
  ADD CONSTRAINT students_phone_canonical_check
  CHECK (phone IS NULL OR phone ~ '^20(10|11|12|15)[0-9]{8}$');

-- One real Egyptian mobile number per account; NULLs allowed (partial
-- unique index) — mirrors uniq_students_google_id/apple_id/facebook_id in
-- 0017_auth_providers.sql exactly.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_phone ON students (phone) WHERE phone IS NOT NULL;
