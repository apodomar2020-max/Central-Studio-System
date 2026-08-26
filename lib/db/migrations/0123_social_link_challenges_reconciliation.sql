-- Final Hardening Sweep: forward-only repair for a historical journal
-- timestamp collision. 0119 and 0120 were committed separately with the
-- same `when` value, so a database that had already applied 0119 could skip
-- 0120 permanently. Do not rewrite the shipped journal timestamp: reconcile
-- the intended table and indexes idempotently instead.

CREATE TABLE IF NOT EXISTS "social_link_challenges" (
  "id" serial PRIMARY KEY,
  "student_id" integer NOT NULL,
  "provider" text NOT NULL,
  "provider_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  CONSTRAINT "social_link_challenges_student_id_students_id_fk"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "social_link_challenges_provider_check"
    CHECK ("provider" IN ('google','facebook','apple')),
  CONSTRAINT "social_link_challenges_status_check"
    CHECK ("status" IN ('pending','consumed','expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_link_challenges_token_hash_unique"
  ON "social_link_challenges" ("token_hash");

CREATE INDEX IF NOT EXISTS "social_link_challenges_student_id_status_idx"
  ON "social_link_challenges" ("student_id", "status");
