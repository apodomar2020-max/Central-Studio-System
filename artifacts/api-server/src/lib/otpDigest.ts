/**
 * At-rest storage format for `email_otps.code` (CS-SEC-M-01 / Security-06B).
 *
 * The raw 6-digit OTP is never written to the database. Instead we store an
 * HMAC-SHA-256 digest of a canonical, delimiter-safe binding of
 * (purpose, normalized email, raw code), keyed by a server-only pepper
 * (OTP_PEPPER). Storage format: `v1:<64 lowercase hex chars>`.
 *
 * This is the ONE place that computes or compares that digest — both
 * `issueOtp` and `verifyOtpInTransaction` in authHelpers.ts must call into
 * this module rather than duplicating the logic.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { OtpPurpose } from "./authHelpers";

const STORED_DIGEST_PATTERN = /^v1:[0-9a-f]{64}$/;
const RAW_OTP_PATTERN = /^[0-9]{6}$/;

function assertValidRawOtp(code: string): void {
  if (!RAW_OTP_PATTERN.test(code)) {
    throw new Error("Invalid OTP shape: expected exactly 6 decimal digits.");
  }
}

/**
 * Newline-delimited canonical binding. None of purpose ("verify"/"reset"),
 * a normalized email, or a 6-digit code can legitimately contain a raw
 * newline, so this avoids the boundary-collision ambiguity of raw
 * concatenation (e.g. purpose="a" email="bc" vs purpose="ab" email="c").
 */
function canonicalInput(purpose: OtpPurpose, normalizedEmail: string, code: string): string {
  return `v1\n${purpose}\n${normalizedEmail}\n${code}`;
}

/**
 * Compute the `v1:<hex>` digest to store in `email_otps.code` for a freshly
 * issued OTP. Throws if the raw code is not exactly 6 decimal digits.
 */
export function computeOtpDigest(
  purpose: OtpPurpose,
  normalizedEmail: string,
  code: string,
  pepper: string,
): string {
  assertValidRawOtp(code);
  const hex = createHmac("sha256", pepper).update(canonicalInput(purpose, normalizedEmail, code)).digest("hex");
  return `v1:${hex}`;
}

/**
 * Constant-time comparison of a stored `v1:<hex>` digest against a
 * candidate raw OTP. Fails closed (returns false, never throws) for:
 *  - a candidate code that isn't exactly 6 decimal digits,
 *  - a stored value that doesn't match `^v1:[0-9a-f]{64}$` (unsupported
 *    version, malformed hex, wrong length, plaintext leftover, etc.),
 *  - a length mismatch that would otherwise make `timingSafeEqual` throw.
 */
export function verifyOtpDigest(
  storedValue: string,
  purpose: OtpPurpose,
  normalizedEmail: string,
  code: string,
  pepper: string,
): boolean {
  if (!RAW_OTP_PATTERN.test(code)) return false;
  if (!STORED_DIGEST_PATTERN.test(storedValue)) return false;

  const expected = computeOtpDigest(purpose, normalizedEmail, code, pepper);

  const a = Buffer.from(storedValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false; // guard: timingSafeEqual throws on length mismatch

  try {
    return timingSafeEqual(a, b);
  } catch {
    // Defensive — should be unreachable given the length guard above, but
    // never let a comparison failure escape as an unhandled exception /
    // accidental "verified" outcome.
    return false;
  }
}

export const OTP_STORED_DIGEST_PATTERN = STORED_DIGEST_PATTERN;
