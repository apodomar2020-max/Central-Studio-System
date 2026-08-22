-- Security-06B (CS-SEC-M-01) — stop storing OTP codes as plaintext.
--
-- email_otps is purely ephemeral short-lived challenge state (verified: no
-- other code path treats these rows as historical/audit records — the only
-- reads are the live-lookup in verifyOtpInTransaction, the resend/cooldown
-- and hourly/daily-count queries scoped to recent createdAt windows in
-- issueOtp, and cleanupOldOtpRows' maintenance deletion of already-used/
-- expired rows; nothing reports on or reconstructs past codes). Clean
-- cutover: delete existing rows (all plaintext, pre-fix) and enforce the new
-- digest format going forward.
--
-- After this migration, email_otps.code stores `v1:<64 lowercase hex>` — an
-- HMAC-SHA-256 digest of (purpose, normalized email, raw 6-digit code) keyed
-- by the server-only OTP_PEPPER env var, never the raw code itself. See
-- artifacts/api-server/src/lib/otpDigest.ts.
DELETE FROM "email_otps";

ALTER TABLE "email_otps"
  ADD CONSTRAINT "email_otps_code_digest_format_check"
  CHECK ("code" ~ '^v1:[0-9a-f]{64}$');

-- Manual rollback (only after rolling back every application version that
-- writes the new digest format — an old deployment writing raw 6-digit
-- codes would otherwise violate this constraint on INSERT):
-- ALTER TABLE "email_otps" DROP CONSTRAINT IF EXISTS "email_otps_code_digest_format_check";
