/**
 * Shared student-auth helpers: JWT signing, OTP issue/verify, and email delivery.
 *
 * Used by the local auth routes (auth.ts), the OTP routes (emailOtp.ts), and the
 * social auth routes (socialAuth.ts) so the token shape and OTP rules stay in
 * exactly one place.
 */
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, emailOtpsTable, studentsTable } from "@workspace/db";
import { STUDENT_JWT_SECRET, type StudentTokenPayload } from "../middlewares/auth";
import { logger } from "./logger";
import { computeOtpDigest, verifyOtpDigest } from "./otpDigest";

// ─── JWT ──────────────────────────────────────────────────────────────────────

const STUDENT_JWT_EXPIRES_IN = "30d"; // mobile sessions live for 30 days

/**
 * Sign a student access token.
 *
 * When `emailVerified` is false the token is "limited": every student-scoped
 * route guarded by requireVerifiedStudent will reject it (403 requiresOtp),
 * while OTP and /auth/me routes still accept it so the client can finish
 * verification.
 *
 * `tokenVersion` is REQUIRED, not defaulted, and MUST be the account's
 * current `students.token_version` at the moment of issuance (Security-02B,
 * CS-SEC-H-03) — never a hardcoded 1. For a brand-new account the row's
 * DEFAULT 1 IS that current value, so passing the freshly-inserted row's own
 * `tokenVersion` is correct there too; the point is every caller reads it off
 * an actual row rather than assuming it. requireAuth's student fast-path
 * rejects any token whose embedded version no longer matches the database,
 * so a token signed with a stale version would be silently unusable — making
 * this a required parameter turns that class of mistake into a compile error
 * instead of a runtime one.
 */
export function signStudentToken(studentId: number, email: string, emailVerified: boolean, tokenVersion: number): string {
  const payload: Omit<StudentTokenPayload, "iat" | "exp"> = {
    sub: studentId,
    email,
    type: "student",
    emailVerified,
    tokenVersion,
  };
  return jwt.sign(payload, STUDENT_JWT_SECRET, { expiresIn: STUDENT_JWT_EXPIRES_IN });
}

// ─── OTP ────────────────────────────────────────────────────────────────────

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const OTP_TTL_SECONDS = positiveIntEnv("OTP_TTL_SECONDS", 600);
export const OTP_RESEND_COOLDOWN_SECONDS = positiveIntEnv("OTP_RESEND_COOLDOWN_SECONDS", 60);
export const OTP_MAX_ATTEMPTS = positiveIntEnv("OTP_MAX_ATTEMPTS", 5);
export const OTP_MAX_SENDS_PER_HOUR = positiveIntEnv("OTP_MAX_SENDS_PER_HOUR", 5);
export const OTP_MAX_SENDS_PER_DAY = positiveIntEnv("OTP_MAX_SENDS_PER_DAY", 10);
export const PASSWORD_MIN_LENGTH = positiveIntEnv("PASSWORD_MIN_LENGTH", 8);

export const PasswordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/[0-9]/, "Password must include at least one number");

// "social_link" (Security-01B2): ownership-verification OTP sent to an
// EXISTING account's email before a verified-but-unattested provider
// identity may attach to it. Shares all the same hashing/pepper/cooldown/
// attempt-limit/single-use infrastructure as "verify"/"reset" — see
// routes/socialAuth.ts and lib/socialLinkChallenge.ts.
export type OtpPurpose = "verify" | "reset" | "social_link";

// ─── OTP pepper (CS-SEC-M-01 / Security-06B) ───────────────────────────────
//
// Server-only, API-only secret used to HMAC-SHA-256 OTP codes before they
// are stored in email_otps.code. NEVER expose this via an EXPO_PUBLIC_*/
// VITE_*-prefixed name or any client-reachable config — it must only ever
// be read here, server-side. Expected to be at least 32 random bytes
// (256-bit) of entropy, e.g.:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Follows the exact same fail-closed-in-production / warn-in-dev pattern as
// STUDENT_JWT_SECRET (middlewares/auth.ts).
export const OTP_PEPPER = process.env["OTP_PEPPER"] ?? "dev-otp-pepper-change-in-production";

if (!process.env["OTP_PEPPER"]) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "OTP_PEPPER must be set in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  logger.warn(
    "OTP_PEPPER is not set — using insecure dev default. " +
      "Set this env var before deploying to production.",
  );
}

/** Generate a cryptographically secure 6-digit numeric code (zero-padded). */
export function generateOtp(): string {
  // crypto.randomInt is a CSPRNG; Math.random() is predictable — never use
  // Math.random() for security-sensitive values.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export class EmailProviderConfigurationError extends Error {
  constructor(message = "Email provider is not configured.") {
    super(message);
    this.name = "EmailProviderConfigurationError";
  }
}

export class EmailDeliveryError extends Error {
  constructor(message = "Email delivery failed.") {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function getEmailConfig(): { apiKey: string; from: string; replyTo?: string } | null {
  const apiKey = process.env["BREVO_API_KEY"]?.trim();
  const from = process.env["EMAIL_FROM"]?.trim() || process.env["MAIL_FROM"]?.trim();
  const replyTo = process.env["EMAIL_REPLY_TO"]?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: replyTo || undefined };
}

export function isEmailProviderConfigured(): boolean {
  return getEmailConfig() !== null;
}

/**
 * Parse an EMAIL_FROM value into Brevo's `sender` shape.
 *
 * Accepts both forms the existing EMAIL_FROM contract supports:
 *   "Central Studio <no-reply@centralstudioco.com>" → { name: "Central Studio", email: "no-reply@centralstudioco.com" }
 *   "no-reply@centralstudioco.com"                  → { email: "no-reply@centralstudioco.com" }
 */
function parseSenderAddress(raw: string): { name?: string; email: string } {
  const match = raw.trim().match(/^(.*)<([^<>]+)>\s*$/);
  if (!match) return { email: raw.trim() };
  const email = match[2]!.trim();
  const name = match[1]!.trim().replace(/^"(.*)"$/, "$1").trim();
  return name ? { name, email } : { email };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function otpEmailContent(code: string, purpose: OtpPurpose): Omit<EmailPayload, "to"> {
  const escapedCode = escapeHtml(code);
  const isReset = purpose === "reset";
  const isSocialLink = purpose === "social_link";
  const title = isReset
    ? "Reset your Central Studio password"
    : isSocialLink
      ? "Confirm linking a sign-in method to your Central Studio account"
      : "Verify your Central Studio email";
  const intro = isReset
    ? "Use this code to reset your Central Studio password."
    : isSocialLink
      ? "Someone requested to link a Google or Facebook sign-in to your Central Studio account. Use this code to confirm it's you."
      : "Use this code to verify your Central Studio account.";
  const safety = isReset
    ? "If you did not request a password reset, you can ignore this email."
    : isSocialLink
      ? "If you did not request this, you can ignore this email — nothing will be linked without this code."
      : "If you did not create a Central Studio account, you can ignore this email.";

  return {
    subject: title,
    text: `${intro}\n\nCode: ${code}\n\nThis code expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.\n\n${safety}`,
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapedCode}</p>`,
      `<p>This code expires in ${Math.round(OTP_TTL_SECONDS / 60)} minutes.</p>`,
      `<p>${escapeHtml(safety)}</p>`,
    ].join("\n"),
  };
}

function securityEmailContent(event: "password_reset" | "password_changed"): Omit<EmailPayload, "to"> {
  const isReset = event === "password_reset";
  const title = isReset ? "Your Central Studio password was reset" : "Your Central Studio password was changed";
  const message = isReset
    ? "Your Central Studio password was reset successfully."
    : "Your Central Studio password was changed successfully.";
  const safety = "If this was not you, contact Central Studio support immediately.";

  return {
    subject: title,
    text: `${message}\n\n${safety}`,
    html: `<p>${escapeHtml(message)}</p>\n<p>${escapeHtml(safety)}</p>`,
  };
}

async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = getEmailConfig();
  if (!config) {
    if (process.env["NODE_ENV"] !== "production") {
      logger.info({ to: payload.to, subject: payload.subject }, "DEV MODE — email not sent; provider not configured");
      return;
    }
    throw new EmailProviderConfigurationError("Email provider not configured. Set BREVO_API_KEY and EMAIL_FROM.");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: parseSenderAddress(config.from),
      to: [{ email: payload.to }],
      subject: payload.subject,
      textContent: payload.text,
      htmlContent: payload.html,
      ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
    }),
  });

  if (!response.ok) {
    // Do not log the response body: Brevo error payloads can echo request
    // content (recipient address, etc.) and, in some failure modes, may
    // include values that should never reach logs. Status code is enough to
    // diagnose delivery failures from the dashboard/provider side.
    logger.error({ status: response.status }, "Brevo email delivery failed");
    throw new EmailDeliveryError("Email provider rejected the message.");
  }
}

/**
 * Test-only hook (Security-06B / task J): when set, receives the raw OTP at
 * the moment it is composed into an outbound email, so integration tests can
 * recover it without reading email_otps.code directly — that column now
 * stores only an HMAC digest, not the plaintext code. Production code paths
 * never call the setter; it is a no-op unless a test explicitly registers a
 * listener, and it does not change OTP generation or delivery in any way.
 *
 * Security-06C hardening: this is a module-level global, so ANY code with
 * import access to this file could otherwise call the setter and silently
 * intercept every OTP sent for the lifetime of the process — not just test
 * code. Guarded here so the setter is inert in production regardless of who
 * calls it, closing that surface without changing the test-facing API tests
 * already rely on.
 */
let otpEmailTestListener: ((to: string, code: string, purpose: OtpPurpose) => void) | null = null;
export function __setOtpEmailTestListener(fn: typeof otpEmailTestListener): void {
  if (process.env["NODE_ENV"] === "production") {
    logger.error("__setOtpEmailTestListener called in production — ignored");
    return;
  }
  otpEmailTestListener = fn;
}

export async function sendOtpEmail(to: string, code: string, purpose: OtpPurpose): Promise<void> {
  otpEmailTestListener?.(to, code, purpose);
  await sendEmail({ to, ...otpEmailContent(code, purpose) });
  logger.info({ to, purpose }, "OTP email sent");
}

export async function sendSecurityNotificationEmail(
  to: string,
  event: "password_reset" | "password_changed",
): Promise<void> {
  await sendEmail({ to, ...securityEmailContent(event) });
  logger.info({ to, event }, "Password security notification email sent");
}

export class OtpRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Please wait before requesting another code.") {
    super(message);
    this.name = "OtpRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Convert a timestamp string read back from the `email_otps` table to epoch
 * milliseconds for comparison.
 *
 * Required because Postgres/Drizzle can return these `mode: "string"`
 * timestamptz columns in a different serialized form than the
 * `new Date().toISOString()` strings this file generates for "now" — e.g.
 * "2026-08-07 12:16:36.570+00" (Postgres/Drizzle, space + numeric offset,
 * produced when the driver hands Drizzle a Date and it re-serializes it)
 * vs. "2026-08-07T12:16:36.570Z" (Node). Comparing those two forms directly
 * with JS string operators (`<=`, `>=`) is a lexicographic comparison, not a
 * temporal one, and silently misclassifies still-valid values as expired (or
 * still-recent rows as outside the rate-limit window). Always compare the
 * parsed epoch-millisecond values instead — never the raw strings.
 *
 * Returns `NaN` for an unparseable value; callers must check
 * `Number.isFinite(...)` and fail closed rather than trust a NaN comparison,
 * since every JS relational comparison involving NaN is `false` (which would
 * silently treat a malformed timestamp as "not expired" / "not recent").
 */
export function toEpochMs(value: string): number {
  return new Date(value).getTime();
}

export async function invalidateOtpCodes(email: string, purpose: OtpPurpose): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(emailOtpsTable)
    .set({ usedAt: now })
    .where(and(
      eq(emailOtpsTable.email, email.toLowerCase().trim()),
      eq(emailOtpsTable.purpose, purpose),
      isNull(emailOtpsTable.usedAt),
    ));
}

/**
 * Issue (and send) a fresh OTP for an email. Issuance is serialized per
 * email (across every OTP purpose) with a transaction-scoped advisory lock,
 * so concurrent requests — including a verify send racing a reset send for
 * the same email — cannot both observe a pre-limit count and together
 * exceed the shared hourly/daily budget.
 */
export async function issueOtp(
  email: string,
  opts: { studentId?: number | null; purpose?: OtpPurpose } = {},
): Promise<{ expiresIn: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  const purpose: OtpPurpose = opts.purpose ?? "verify";
  const nowMs = Date.now();
  const hourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date(nowMs).toISOString();
  const code = generateOtp();
  const expiresAt = new Date(nowMs + OTP_TTL_SECONDS * 1000).toISOString();

  const otpId = await db.transaction(async (tx) => {
    // Lock keyed on email only (not email+purpose) so verify and reset
    // issuance for the same email fully serialize — required for the shared
    // hourly/daily budget below to be enforced atomically across purposes.
    // Different emails still lock independently.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${normalizedEmail}))`);

    // Purpose-scoped history — cooldown intentionally stays per email+purpose:
    // a verify send moments ago must not itself trigger the reset-purpose
    // cooldown (and vice versa). Only the shared hourly/daily budget below is
    // unified across purposes.
    const issuedThisPurposeToday = await tx
      .select({ createdAt: emailOtpsTable.createdAt })
      .from(emailOtpsTable)
      .where(and(
        eq(emailOtpsTable.email, normalizedEmail),
        eq(emailOtpsTable.purpose, purpose),
        gte(emailOtpsTable.createdAt, dayAgo),
      ))
      .orderBy(emailOtpsTable.createdAt);

    const latest = issuedThisPurposeToday.at(-1);
    if (latest) {
      const ageSeconds = (nowMs - new Date(latest.createdAt).getTime()) / 1000;
      if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
        throw new OtpRateLimitError(Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds));
      }
    }

    // All-purpose history — hourly/daily send limits are ONE shared budget
    // per email across every OTP purpose (verify + reset), per the approved
    // unified send-limit policy. Deliberately no purpose predicate here.
    const issuedToday = await tx
      .select({ createdAt: emailOtpsTable.createdAt })
      .from(emailOtpsTable)
      .where(and(
        eq(emailOtpsTable.email, normalizedEmail),
        gte(emailOtpsTable.createdAt, dayAgo),
      ))
      .orderBy(emailOtpsTable.createdAt);

    // toEpochMs, not raw string comparison — see its doc comment: `row.createdAt`
    // (Postgres/Drizzle format) and `hourAgo` (Node ISO format) are not
    // lexicographically comparable. An unparseable row.createdAt fails closed
    // (counted toward the hourly limit) rather than silently excluded from it.
    const hourAgoMs = toEpochMs(hourAgo);
    const issuedThisHour = issuedToday.filter((row) => {
      const createdAtMs = toEpochMs(row.createdAt);
      return !Number.isFinite(createdAtMs) || createdAtMs >= hourAgoMs;
    });
    if (issuedThisHour.length >= OTP_MAX_SENDS_PER_HOUR) {
      const retryAt = new Date(issuedThisHour[0]!.createdAt).getTime() + 60 * 60 * 1000;
      throw new OtpRateLimitError(
        Math.max(1, Math.ceil((retryAt - nowMs) / 1000)),
        "Too many verification codes requested. Please try again later.",
      );
    }

    if (issuedToday.length >= OTP_MAX_SENDS_PER_DAY) {
      const retryAt = new Date(issuedToday[0]!.createdAt).getTime() + 24 * 60 * 60 * 1000;
      throw new OtpRateLimitError(
        Math.max(1, Math.ceil((retryAt - nowMs) / 1000)),
        "Daily verification code limit reached. Please try again later.",
      );
    }

    await tx
      .update(emailOtpsTable)
      .set({ usedAt: now })
      .where(and(
        eq(emailOtpsTable.email, normalizedEmail),
        eq(emailOtpsTable.purpose, purpose),
        isNull(emailOtpsTable.usedAt),
      ));

    const digest = computeOtpDigest(purpose, normalizedEmail, code, OTP_PEPPER);
    const [inserted] = await tx
      .insert(emailOtpsTable)
      .values({
        studentId: opts.studentId ?? null,
        email: normalizedEmail,
        code: digest,
        purpose,
        expiresAt,
      })
      .returning({ id: emailOtpsTable.id });
    return inserted!.id;
  });

  try {
    await sendOtpEmail(normalizedEmail, code, purpose);
  } catch (error) {
    // Failed deliveries should not consume the rolling issuance allowance.
    // Delete only the row created by this call; older invalidated rows remain
    // historical evidence and cannot become valid again.
    await db.delete(emailOtpsTable).where(eq(emailOtpsTable.id, otpId));
    throw error;
  }
  logger.info({ email: normalizedEmail, purpose }, "OTP issued");

  return { expiresIn: OTP_TTL_SECONDS };
}

export type VerifyOtpResult =
  | { status: "ok" }
  | { status: "invalid"; attemptsLeft: number }
  | { status: "expired" }   // no live code — client must resend
  | { status: "locked" };   // too many wrong guesses — client must resend

type OtpTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function verifyOtpInTransaction(
  tx: OtpTransaction,
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<VerifyOtpResult> {
  const now = new Date().toISOString();
  const [otp] = await tx
    .select()
    .from(emailOtpsTable)
    .where(and(
      eq(emailOtpsTable.email, email),
      eq(emailOtpsTable.purpose, purpose),
      isNull(emailOtpsTable.usedAt),
    ))
    .orderBy(desc(emailOtpsTable.createdAt))
    .limit(1)
    .for("update");

  // toEpochMs, not raw string comparison — see its doc comment: otp.expiresAt
  // (Postgres/Drizzle format) and `now` (Node ISO format) are not
  // lexicographically comparable. An unparseable otp.expiresAt fails closed
  // (treated as expired) rather than silently accepted as still valid.
  if (!otp) return { status: "expired" };
  const expiresAtMs = toEpochMs(otp.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= toEpochMs(now)) return { status: "expired" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { status: "locked" };

  if (!verifyOtpDigest(otp.code, purpose, email, code, OTP_PEPPER)) {
    const attempts = otp.attempts + 1;
    await tx
      .update(emailOtpsTable)
      .set({ attempts })
      .where(and(
        eq(emailOtpsTable.id, otp.id),
        isNull(emailOtpsTable.usedAt),
      ));
    if (attempts >= OTP_MAX_ATTEMPTS) return { status: "locked" };
    return { status: "invalid", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
  }

  const [consumed] = await tx
    .update(emailOtpsTable)
    .set({ usedAt: now })
    .where(and(
      eq(emailOtpsTable.id, otp.id),
      isNull(emailOtpsTable.usedAt),
      gt(emailOtpsTable.expiresAt, now),
    ))
    .returning({ id: emailOtpsTable.id });

  return consumed ? { status: "ok" } : { status: "expired" };
}

/**
 * Verify a code against the latest live (unused, unexpired) OTP for an
 * email+purpose. The row is locked and consumed, or its attempts incremented,
 * inside one transaction.
 */
export async function verifyOtpCode(
  email: string,
  code: string,
  purpose: OtpPurpose = "verify",
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  return db.transaction((tx) => verifyOtpInTransaction(tx, normalizedEmail, code, purpose));
}

const verifiedStudentReturning = {
  id: studentsTable.id,
  name: studentsTable.name,
  email: studentsTable.email,
  phone: studentsTable.phone,
  accountType: studentsTable.accountType,
  profileCompleted: studentsTable.profileCompleted,
  profileCompletedAt: studentsTable.profileCompletedAt,
  emailVerified: studentsTable.emailVerified,
  authProvider: studentsTable.authProvider,
  avatarUrl: studentsTable.avatarUrl,
  providerDisplayName: studentsTable.providerDisplayName,
  joinedAt: studentsTable.joinedAt,
  qrToken: studentsTable.qrToken,
  // Callers (emailOtp.ts) sign a fresh token from this returned row and must
  // embed its actual current token_version, not a hardcoded 1.
  tokenVersion: studentsTable.tokenVersion,
};

export type VerifyEmailOtpResult =
  | { status: "ok"; student: Pick<typeof studentsTable.$inferSelect, keyof typeof verifiedStudentReturning> }
  | Exclude<VerifyOtpResult, { status: "ok" }>;

/**
 * Email-verification-specific atomic flow: lock and consume the OTP, then mark
 * the authenticated student verified before the same transaction commits.
 */
export async function verifyEmailOtpForStudent(
  studentId: number,
  email: string,
  code: string,
): Promise<VerifyEmailOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  return db.transaction(async (tx) => {
    const result = await verifyOtpInTransaction(tx, normalizedEmail, code, "verify");
    if (result.status !== "ok") return result;

    const now = new Date().toISOString();
    const [student] = await tx
      .update(studentsTable)
      .set({ emailVerified: true, emailVerifiedAt: now })
      .where(and(
        eq(studentsTable.id, studentId),
        eq(studentsTable.email, normalizedEmail),
      ))
      .returning(verifiedStudentReturning);

    if (!student) {
      throw new Error("Authenticated student not found during OTP verification.");
    }
    return { status: "ok" as const, student };
  });
}

/**
 * Delete only historical OTP rows whose creation time is beyond the retention
 * window and that are already used or expired. This is intentionally not
 * scheduled here; call it from a future maintenance worker after deployment
 * ownership and cadence are defined.
 */
export async function cleanupOldOtpRows(retentionDays = 30): Promise<number> {
  const safeRetentionDays = Math.max(7, Math.floor(retentionDays));
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await db
    .delete(emailOtpsTable)
    .where(and(
      lt(emailOtpsTable.createdAt, cutoff),
      or(
        isNotNull(emailOtpsTable.usedAt),
        lt(emailOtpsTable.expiresAt, now),
      ),
    ))
    .returning({ id: emailOtpsTable.id });
  return deleted.length;
}
