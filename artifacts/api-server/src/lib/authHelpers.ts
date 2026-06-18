/**
 * Shared student-auth helpers: JWT signing, OTP issue/verify, and email delivery.
 *
 * Used by the local auth routes (auth.ts), the OTP routes (emailOtp.ts), and the
 * social auth routes (socialAuth.ts) so the token shape and OTP rules stay in
 * exactly one place.
 */
import jwt from "jsonwebtoken";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, emailOtpsTable } from "@workspace/db";
import { STUDENT_JWT_SECRET, type StudentTokenPayload } from "../middlewares/auth";
import { logger } from "./logger";

// ─── JWT ──────────────────────────────────────────────────────────────────────

const STUDENT_JWT_EXPIRES_IN = "30d"; // mobile sessions live for 30 days

/**
 * Sign a student access token.
 *
 * When `emailVerified` is false the token is "limited": every student-scoped
 * route guarded by requireVerifiedStudent will reject it (403 requiresOtp),
 * while OTP and /auth/me routes still accept it so the client can finish
 * verification.
 */
export function signStudentToken(studentId: number, email: string, emailVerified: boolean): string {
  const payload: Omit<StudentTokenPayload, "iat" | "exp"> = {
    sub: studentId,
    email,
    type: "student",
    emailVerified,
  };
  return jwt.sign(payload, STUDENT_JWT_SECRET, { expiresIn: STUDENT_JWT_EXPIRES_IN });
}

// ─── OTP ────────────────────────────────────────────────────────────────────

export const OTP_TTL_SECONDS = 600;            // codes valid for 10 minutes
export const OTP_RESEND_COOLDOWN_SECONDS = 60; // min gap between (re)sends per email+purpose
export const OTP_MAX_ATTEMPTS = 5;             // wrong guesses before a code is locked

export type OtpPurpose = "verify" | "reset";

/** Generate a 6-digit numeric code (zero-padded). */
export function generateOtp(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

/**
 * Deliver an OTP. In development the code is only logged; in production this is
 * where a real email provider (Resend / SendGrid / Nodemailer) would be wired.
 */
export async function sendOtpEmail(to: string, code: string, purpose: OtpPurpose): Promise<void> {
  if (process.env["NODE_ENV"] !== "production") {
    logger.info({ to, code, purpose }, "DEV MODE — OTP code (not sent via email)");
    return;
  }
  // TODO: integrate a real email provider. Example (Resend):
  //   await resend.emails.send({ from, to, subject, text: `Your code is ${code}` });
  logger.warn({ to, purpose }, "Email provider not configured — OTP not sent in production");
}

export class OtpRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Please wait before requesting another code.");
    this.name = "OtpRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Issue (and send) a fresh OTP for an email, enforcing a per-email+purpose
 * resend cooldown. Throws OtpRateLimitError when called again too soon.
 */
export async function issueOtp(
  email: string,
  opts: { studentId?: number | null; purpose?: OtpPurpose } = {},
): Promise<{ expiresIn: number }> {
  const normalizedEmail = email.toLowerCase().trim();
  const purpose: OtpPurpose = opts.purpose ?? "verify";

  // Rate limit: reject if an unused code for this email+purpose was issued
  // within the cooldown window.
  const [recent] = await db
    .select({ createdAt: emailOtpsTable.createdAt })
    .from(emailOtpsTable)
    .where(
      and(
        eq(emailOtpsTable.email, normalizedEmail),
        eq(emailOtpsTable.purpose, purpose),
        isNull(emailOtpsTable.usedAt),
      ),
    )
    .orderBy(desc(emailOtpsTable.createdAt))
    .limit(1);

  if (recent) {
    const ageSeconds = (Date.now() - new Date(recent.createdAt).getTime()) / 1000;
    if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new OtpRateLimitError(Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds));
    }
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await db.insert(emailOtpsTable).values({
    studentId: opts.studentId ?? null,
    email: normalizedEmail,
    code,
    purpose,
    expiresAt,
  });

  await sendOtpEmail(normalizedEmail, code, purpose);
  logger.info({ email: normalizedEmail, purpose }, "OTP issued");

  return { expiresIn: OTP_TTL_SECONDS };
}

export type VerifyOtpResult =
  | { status: "ok" }
  | { status: "invalid"; attemptsLeft: number }
  | { status: "expired" }   // no live code — client must resend
  | { status: "locked" };   // too many wrong guesses — client must resend

/**
 * Verify a code against the latest live (unused, unexpired) OTP for an
 * email+purpose. On success the row is marked used. Wrong guesses increment the
 * attempt counter and lock the code once OTP_MAX_ATTEMPTS is reached.
 */
export async function verifyOtpCode(
  email: string,
  code: string,
  purpose: OtpPurpose = "verify",
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  const [otp] = await db
    .select()
    .from(emailOtpsTable)
    .where(
      and(
        eq(emailOtpsTable.email, normalizedEmail),
        eq(emailOtpsTable.purpose, purpose),
        isNull(emailOtpsTable.usedAt),
        gt(emailOtpsTable.expiresAt, now),
      ),
    )
    .orderBy(desc(emailOtpsTable.createdAt))
    .limit(1);

  if (!otp) return { status: "expired" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { status: "locked" };

  if (otp.code !== code) {
    const attempts = otp.attempts + 1;
    await db.update(emailOtpsTable).set({ attempts }).where(eq(emailOtpsTable.id, otp.id));
    if (attempts >= OTP_MAX_ATTEMPTS) return { status: "locked" };
    return { status: "invalid", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
  }

  await db.update(emailOtpsTable).set({ usedAt: now }).where(eq(emailOtpsTable.id, otp.id));
  return { status: "ok" };
}
