-- Security-02B (CS-SEC-H-03) — student JWT session revocation.
--
-- Every student JWT embeds the token_version that was current at issuance.
-- requireAuth's student fast-path rejects a token whose embedded version no
-- longer matches this column, so bumping it atomically invalidates every
-- outstanding token for the account (password reset, password change,
-- logout).
--
-- DEFAULT 1, NOT NULL, additive: every existing row starts at 1, and a
-- legacy JWT with no tokenVersion claim is treated as version 1 by the
-- verification code — so applying this migration alone does not invalidate
-- any currently-issued token. Enforcement only activates the first time an
-- account's version is bumped (its next reset/change/logout).
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 1;

-- Manual rollback (only after rolling back all application versions that
-- read this field — see the deployment sequencing note in the Security-02B
-- implementation report):
-- ALTER TABLE "students" DROP COLUMN IF EXISTS "token_version";
