-- Security-01B2: short-lived, server-authoritative social-account-linking
-- OTP-ownership challenges. See lib/db/src/schema/socialLinkChallenges.ts
-- for the full design rationale.

CREATE TABLE "social_link_challenges" (
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

-- Opaque token lookup is always by hash; unique so a completion request can
-- never resolve to more than one candidate row.
CREATE UNIQUE INDEX "social_link_challenges_token_hash_unique" ON "social_link_challenges" ("token_hash");

-- Completion re-checks "is the provider subject still unlinked elsewhere"
-- against the live students table, not this table — no index needed here
-- for that. This index only speeds up the (rare, operational) query "how
-- many pending challenges does this student have outstanding".
CREATE INDEX "social_link_challenges_student_id_status_idx" ON "social_link_challenges" ("student_id", "status");

-- Manual rollback (not executed by this migration):
--   DROP TABLE "social_link_challenges";
