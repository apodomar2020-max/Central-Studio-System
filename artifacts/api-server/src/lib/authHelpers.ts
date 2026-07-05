/**
 * Shared student-auth helpers: JWT signing, OTP issue/verify, and email delivery.
 *
 * Used by the local auth routes (auth.ts), the OTP routes (emailOtp.ts), and the
 * social auth routes (socialAuth.ts) so the token shape and OTP rules stay in
 * exactly one place.
 */
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
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

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const OTP_TTL_SECONDS = positiveIntEnv("OTP_TTL_SECONDS", 600);
export const OTP_RESEND_COOLDOWN_SECONDS = positiveIntEnv("OTP_RESEND_COOLDOWN_SECONDS", 60);
export const OTP_MAX_ATTEMPTS = positiveIntEnv("OTP_MAX_ATTEMPTS", 5);
export const PASSWORD_MIN_LENGTH = positiveIntEnv("PASSWORD_MIN_LENGTH", 8);

export const PasswordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, "Password must include at least one letter")
  .regex(/[0-9]/, "Password must include at least one number");

export type OtpPurpose = "verify" | "reset";

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
  const apiKey = process.env["RESEND_API_KEY"]?.trim();
  const from = process.env["EMAIL_FROM"]?.trim() || process.env["MAIL_FROM"]?.trim();
  const replyTo = process.env["EMAIL_REPLY_TO"]?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: replyTo || undefined };
}

export function isEmailProviderConfigured(): boolean {
  return getEmailConfig() !== null;
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
  const title = isReset ? "Reset your Central Studio password" : "Verify your Central Studio email";
  const intro = isReset
    ? "Use this code to reset your Central Studio password."
    : "Use this code to verify your Central Studio account.";
  const safety = isReset
    ? "If you did not request a password reset, you can ignore this email."
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
    throw new EmailProviderConfigurationError("Email provider not configured. Set RESEND_API_KEY and EMAIL_FROM.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error({ status: response.status, body }, "Resend email delivery failed");
    throw new EmailDeliveryError("Email provider rejected the message.");
  }
}

export async function sendOtpEmail(to: string, code: string, purpose: OtpPurpose): Promise<void> {
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
  constructor(retryAfterSeconds: number) {
    super("Please wait before requesting another code.");
    this.name = "OtpRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
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

  await invalidateOtpCodes(normalizedEmail, purpose);

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
