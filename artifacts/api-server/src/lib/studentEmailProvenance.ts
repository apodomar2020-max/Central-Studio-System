/**
 * Phase B3B0-1A: student email-ownership provenance fingerprinting.
 *
 * Design (per B3B0 investigation, binding findings):
 *  - Reuses the canonical `normalizeEmail` from membershipIdentity.ts exactly
 *    as-is (trim + lowercase). Do NOT reimplement or add Gmail dot-stripping,
 *    plus-address stripping, or Unicode transforms here.
 *  - Fingerprint = HMAC-SHA-256(IDENTITY_PROVENANCE_PEPPER,
 *      "v1\nstudent-email-provenance\n" + normalizeEmail(email))
 *    studentId is deliberately NOT part of the HMAC input — the system must
 *    be able to detect the SAME normalized email recurring across DIFFERENT
 *    students over time (e.g. student A releases an email, student B later
 *    registers with it); folding studentId into the hash would defeat that.
 *  - IDENTITY_PROVENANCE_PEPPER is a NEW, narrowly-scoped secret. It must
 *    NEVER be reused for OTP digesting (OTP_PEPPER), JWT signing, or any
 *    other purpose — domain separation is an established convention in this
 *    repo (see authHelpers.ts's OTP_PEPPER). It must never be exposed to the
 *    Admin or Mobile bundles — server-only.
 *  - Stored representation is versioned on TWO independent axes:
 *      "v<algo-version>:k<key-id>:<64 lowercase hex>"
 *    `v1` is the algorithm/payload-format version (canonical HMAC-SHA-256
 *    construction + normalizeEmail + the "v1\nstudent-email-provenance\n"
 *    payload prefix — unchanged since this was first designed). `k1` is the
 *    provenance HMAC KEY generation identifier — see KEY ROTATION MODEL
 *    below. These two segments are deliberately independent: rotating the
 *    key (k1 -> k2) does not require bumping the algorithm version, and a
 *    future algorithm change (v2) would not by itself require a new key.
 *    This lets a future key rotation or algorithm change be introduced
 *    without invalidating already-stored fingerprints — see ROTATION
 *    STRATEGY / KEY ROTATION MODEL below.
 *
 * ROTATION STRATEGY (documented now, NOT implemented beyond what's needed to
 * not be actively hostile to it later):
 *   Because provenance stores only fingerprints (never raw email), an old
 *   fingerprint can never be "re-keyed" after the fact without the original
 *   raw email — there is nothing to rotate retroactively. A future key
 *   rotation instead works by ADDING a new version:
 *     1. Introduce IDENTITY_PROVENANCE_PEPPER_V2 (or however the next
 *        version's key is provisioned) and add a "v2" entry to
 *        PROVENANCE_FINGERPRINT_KEYS below, without removing "v1"'s entry.
 *     2. Bump CURRENT_FINGERPRINT_VERSION to "v2". All NEW writes
 *        (fingerprintStudentEmail) immediately start using v2.
 *     3. Verification against a *known* candidate email (e.g. "does this
 *        submitted email match student X's fingerprint on file") computes
 *        candidates for every supported version and checks stored fingerprints
 *        against whichever version they were stored under
 *        (candidateFingerprintsForEmail below) — it never assumes a stored
 *        v1 fingerprint can be upgraded to v2 without the original email.
 *   This phase implements only "v1" — the versioned-key-lookup structure
 *   exists so a future phase does not have to redesign storage or the
 *   stored-format string, only add a key and a version bump.
 *
 * KEY ROTATION MODEL (k-segment, documented now, not implemented beyond the
 * versioned-lookup structure needed to not be hostile to it later):
 *   To rotate the provenance HMAC key: (1) retain the "k1" secret so
 *   previously-stored "v1:k1:..." fingerprints remain verifiable; (2)
 *   introduce a new "k2" secret (e.g. IDENTITY_PROVENANCE_PEPPER_K2) as the
 *   new WRITE key and add it to PROVENANCE_KEY_SECRETS below; (3) bump
 *   CURRENT_PROVENANCE_KEY_ID to "k2" — all new writes use it immediately;
 *   (4) a candidate email can be fingerprinted under BOTH k1 and k2 (see
 *   candidateFingerprintsForEmail) for historical comparison purposes; (5)
 *   old stored "k1:..." digests are NEVER re-computed or migrated — there is
 *   no raw historical email available to do that, and none is required by
 *   this rotation model. No dynamic key-management service is built here —
 *   CURRENT_PROVENANCE_KEY_ID is a plain server constant.
 *   Confirmed: this pepper is never OTP_PEPPER, JWT_SECRET, or
 *   API_SECRET_KEY — domain separation is preserved (see authHelpers.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./membershipIdentity";

export const CURRENT_FINGERPRINT_VERSION = "v1" as const;

/**
 * The provenance HMAC key-generation identifier currently used for NEW
 * writes. Bump this (and add the corresponding entry below) when rotating
 * the pepper — see KEY ROTATION MODEL above. Not a dynamic key-management
 * service: just a server constant plus the existing versioned-lookup
 * structure, extended to also key by key-id.
 */
export const CURRENT_PROVENANCE_KEY_ID = "k1" as const;

type FingerprintVersion = "v1";
type ProvenanceKeyId = "k1";

/**
 * Versioned-key lookup. Only "v1" is populated today. A future version's key
 * would be added here (e.g. reading IDENTITY_PROVENANCE_PEPPER_V2) without
 * touching any other part of this module or breaking existing "v1:"
 * fingerprints already stored in student_email_identity_history.
 */
function provenanceSecretForKeyId(keyId: ProvenanceKeyId): string | undefined {
  switch (keyId) {
    case "k1":
      return process.env["IDENTITY_PROVENANCE_PEPPER"];
    default:
      return undefined;
  }
}

const FINGERPRINT_DOMAIN = "student-email-provenance";

// HMAC payload construction is keyed only by the algorithm/payload-format
// version (v-segment). The key-id (k-segment) selects WHICH secret is used
// to compute the HMAC, but never enters the payload itself.
function computeFingerprintDigest(version: FingerprintVersion, normalizedEmail: string, secret: string): string {
  const payload = `${version}\n${FINGERPRINT_DOMAIN}\n${normalizedEmail}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** Parses a stored "v<algo>:k<key>:<hex>" fingerprint into its independent
 * v/k/digest segments. Exists so the architecture can distinguish the
 * algorithm-version segment from the key-id segment programmatically, not
 * merely via a single opaque regex match on the full string. */
export function parseStoredFingerprint(stored: string): { version: string; keyId: string; digest: string } | null {
  const match = /^(v[0-9]+):(k[0-9]+):([0-9a-f]{64})$/.exec(stored);
  if (!match) return null;
  return { version: match[1]!, keyId: match[2]!, digest: match[3]! };
}

/**
 * Computes the CURRENT-version stored fingerprint for a raw email, ready to
 * persist into student_email_identity_history.email_fingerprint.
 *
 * FAILS CLOSED: throws if IDENTITY_PROVENANCE_PEPPER is not set. This must
 * never silently no-op or fall back to an insecure/dev default the way
 * OTP_PEPPER does — a missing pepper at write time means the write must not
 * happen, not that it happens insecurely.
 */
export function fingerprintStudentEmail(email: string): string {
  const secret = provenanceSecretForKeyId(CURRENT_PROVENANCE_KEY_ID);
  if (!secret) {
    throw new Error(
      "IDENTITY_PROVENANCE_PEPPER is not set — refusing to write student email provenance. " +
      "This secret must be configured (server-only) before any email-identity mutation is attempted.",
    );
  }
  const normalized = normalizeEmail(email);
  const digest = computeFingerprintDigest(CURRENT_FINGERPRINT_VERSION, normalized, secret);
  return `${CURRENT_FINGERPRINT_VERSION}:${CURRENT_PROVENANCE_KEY_ID}:${digest}`;
}

/**
 * Computes candidate stored-format fingerprints for a raw email across every
 * version whose key is currently configured. Used only for verification
 * against a KNOWN candidate email (never to "reverse" a stored fingerprint —
 * that remains impossible by design). Not required by this phase's writer
 * path, provided for forward compatibility with a future verification
 * consumer (e.g. a B3B1 planner checking "does this email match what's on
 * file for this student").
 */
export function candidateFingerprintsForEmail(email: string): string[] {
  const normalized = normalizeEmail(email);
  const keyIds: ProvenanceKeyId[] = ["k1"];
  const candidates: string[] = [];
  for (const keyId of keyIds) {
    const secret = provenanceSecretForKeyId(keyId);
    if (!secret) continue;
    candidates.push(`${CURRENT_FINGERPRINT_VERSION}:${keyId}:${computeFingerprintDigest(CURRENT_FINGERPRINT_VERSION, normalized, secret)}`);
  }
  return candidates;
}

/** Constant-time comparison of two stored fingerprint strings. */
export function fingerprintsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
