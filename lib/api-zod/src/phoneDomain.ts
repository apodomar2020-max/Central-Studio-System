/**
 * Canonical account-phone domain — the single source of truth for what an
 * Egyptian mobile "account phone" (students.phone) looks like, shared by the
 * API server, Mobile, and Admin so no one of them can drift from the others.
 *
 * This is intentionally STRICTER than lib phoneNormalization.ts's
 * normalizePhone() (api-server), which stays a broad, lookup-oriented
 * equalizer used by Attendance/Marketing search (10-15 digits, no operator
 * check) — that function must keep accepting a wide range so a search query
 * for a legacy/foreign/malformed stored value can still be normalized for
 * comparison. This module is the narrower WRITE-time authority: it decides
 * whether a value is legitimate enough to ever become the canonical value of
 * an account's identity phone.
 *
 * Pipeline: parse (strip cosmetic noise, transliterate Arabic-Indic digits)
 * → normalize (rewrite any accepted input shape to the canonical form)
 * → validate (does the canonical form look like a real Egyptian mobile
 * number?) → format (derive a local display string for UI).
 *
 * Canonical stored form: "20XXXXXXXXXX" — digits only, no "+", no leading
 * local "0", exactly 12 digits (country code "20" + 10-digit subscriber
 * number). E.g. "01012345678" -> "201012345678".
 */

/** Egyptian mobile operator prefixes as of this writing. Landlines and any
 *  other prefix are deliberately out of scope — see ACCOUNT_PHONE_REGEX. */
const MOBILE_PREFIXES = ["10", "11", "12", "15"] as const;

/** The one canonical shape a persisted students.phone value may take. */
export const ACCOUNT_PHONE_REGEX = /^20(10|11|12|15)[0-9]{8}$/;

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function transliterateArabicIndicDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const idx = ARABIC_INDIC_DIGITS.indexOf(ch);
    out += idx === -1 ? ch : String(idx);
  }
  return out;
}

/**
 * Parse + normalize: turn any of the accepted input shapes into the
 * canonical "20XXXXXXXXXX" string, or return null if the input cannot be
 * interpreted as a phone number at all (too few/many digits after cleanup).
 * This does NOT check the result is a legitimate Egyptian mobile number —
 * call isValidAccountPhone() (or validateAccountPhone()) on the result for
 * that. A non-null return here means "syntactically a phone-shaped string",
 * nothing more.
 *
 * Accepted input shapes (spaces/dashes/parentheses tolerated throughout):
 *   01XXXXXXXXX      (local, 11 digits)
 *   1XXXXXXXXX       (bare, 10 digits, no leading 0)
 *   201XXXXXXXXX     (international digits, 12 digits)
 *   +201XXXXXXXXX    (E.164)
 *   00201XXXXXXXXX   (international dialing prefix)
 * Arabic-Indic numerals (٠-٩) are transliterated before parsing.
 */
export function normalizeAccountPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = transliterateArabicIndicDigits(input.trim());
  if (!trimmed) return null;

  // Strip cosmetic separators and anything that isn't a digit or a leading "+".
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2); // 0020... -> 20...

  if (digits.startsWith("01") && digits.length === 11) {
    digits = `20${digits.slice(1)}`; // 01XXXXXXXXX (11) -> 20XXXXXXXXX (12)
  } else if (/^1\d{9}$/.test(digits)) {
    digits = `20${digits}`; // bare 1XXXXXXXXX (10 digits) -> 201XXXXXXXXX
  }

  return digits.length === 12 ? digits : null;
}

/** Does a canonical "20XXXXXXXXXX" value look like a real Egyptian mobile
 *  number (correct operator prefix)? Call normalizeAccountPhone() first if
 *  the input isn't already canonical. */
export function isValidAccountPhone(canonical: string): boolean {
  return ACCOUNT_PHONE_REGEX.test(canonical);
}

export type AccountPhoneValidation =
  | { ok: true; canonical: string }
  | { ok: false; reason: "empty" | "unparseable" | "invalid_format" };

/** One-call parse + normalize + validate. This is the authority every write
 *  path (Mobile Complete Profile / Edit Profile, Admin Student edit/create,
 *  the API server's PATCH /auth/profile, POST /auth/register, and
 *  PATCH /students/:id) should call before persisting a phone number. */
export function validateAccountPhone(input: string | null | undefined): AccountPhoneValidation {
  const trimmed = input?.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const canonical = normalizeAccountPhone(trimmed);
  if (!canonical) return { ok: false, reason: "unparseable" };
  if (!isValidAccountPhone(canonical)) return { ok: false, reason: "invalid_format" };
  return { ok: true, canonical };
}

export const ACCOUNT_PHONE_VALIDATION_MESSAGES: Record<AccountPhoneValidation extends { ok: false; reason: infer R } ? R : never, string> = {
  empty: "Phone number is required.",
  unparseable: "Please enter a valid phone number.",
  invalid_format: "Please enter a valid Egyptian mobile number.",
};

/** Derives the familiar local "01XXXXXXXXX" display form from a canonical
 *  "20XXXXXXXXXX" value, for presenting to users — the canonical form is
 *  never something a Mobile/Admin user should have to read or type. Returns
 *  the input unchanged if it isn't a recognized canonical Egyptian mobile
 *  value (defensive — e.g. a legacy/foreign value that predates this domain). */
export function formatAccountPhoneLocal(canonical: string | null | undefined): string {
  if (!canonical) return "";
  if (!ACCOUNT_PHONE_REGEX.test(canonical)) return canonical;
  return `0${canonical.slice(2)}`;
}

export { MOBILE_PREFIXES as ACCOUNT_PHONE_MOBILE_PREFIXES };
