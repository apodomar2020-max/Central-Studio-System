/**
 * Email OTP verification routes — /api/auth/*
 *
 * Email-shaped endpoints (request email is accepted for wire compatibility,
 * but identity is always derived from the limited/full student JWT):
 *   POST /api/auth/send-otp     { email }          → issue + send a code
 *   POST /api/auth/resend-otp   { email }          → alias of send-otp (cooldown applies)
 *   POST /api/auth/verify-otp   { email, code }    → verify, mark verified, return full token
 *
 * Mobile-compatible studentId-shaped endpoints (the request field is accepted
 * for wire compatibility, but identity is always derived from the student JWT):
 *   POST /api/auth/send-email-otp    { studentId }
 *   POST /api/auth/verify-email-otp  { studentId, code }
 *
 * On successful verification the student's email_verified / email_verified_at
 * are set, and the email-keyed verify endpoint returns a fresh FULL access
 * token so the client can swap its limited token for a verified one.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireStudentAuth } from "../middlewares/studentAuth";
import { idRateLimiter, resetIdLimiter } from "../middlewares/authRateLimit";
import { requireBotToken } from "../middlewares/botProtection";
import {
  invalidateOtpCodes,
  issueOtp,
  verifyEmailOtpForStudent,
  signStudentToken,
  EmailDeliveryError,
  EmailProviderConfigurationError,
  isEmailProviderConfigured,
  OtpRateLimitError,
  OTP_TTL_SECONDS,
} from "../lib/authHelpers";

const router: IRouter = Router();
const GENERIC_SEND_RESPONSE = { ok: true, expiresIn: OTP_TTL_SECONDS };

// Security Wave — Auth Abuse Foundation: additive Redis-backed layer on top
// of the existing DB-backed cooldown/hourly/daily budget in authHelpers.ts
// (issueOtp) — this does NOT replace that logic, it bounds request VOLUME
// (including malformed/rejected ones that never reach issueOtp) per already-
// authenticated studentId. studentId is a numeric internal id, not raw PII,
// so no HMAC fingerprint is needed here (contrast with the pre-auth email-
// keyed limiters in auth.ts).
const otpSendLimiter = idRateLimiter("otp-send", { limit: 10, windowSeconds: 15 * 60, idFor: (req) => req.studentId ?? null });
const otpVerifyLimiter = idRateLimiter("otp-verify", { limit: 15, windowSeconds: 15 * 60, idFor: (req) => req.studentId ?? null });

// Maps a non-"ok" verifyOtpCode result to an HTTP response.
function respondVerifyFailure(
  res: import("express").Response,
  result: Exclude<Awaited<ReturnType<typeof verifyEmailOtpForStudent>>, { status: "ok" }>,
): void {
  switch (result.status) {
    case "invalid":
      res.status(400).json({ error: "Incorrect code. Please try again.", attemptsLeft: result.attemptsLeft });
      return;
    case "expired":
      res.status(400).json({ error: "Code expired. Please request a new one.", requiresResend: true });
      return;
    case "locked":
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code.", requiresResend: true });
      return;
  }
}

function respondEmailDeliveryFailure(
  res: import("express").Response,
  err: unknown,
  context: Record<string, unknown>,
): boolean {
  if (err instanceof EmailProviderConfigurationError || err instanceof EmailDeliveryError) {
    logger.error({ err, ...context }, "OTP email delivery failed");
    res.status(503).json({ error: "Email delivery is temporarily unavailable. Please try again later." });
    return true;
  }
  return false;
}

function respondMissingEmailProvider(res: import("express").Response): boolean {
  if (process.env["NODE_ENV"] === "production" && !isEmailProviderConfigured()) {
    logger.error("OTP email provider missing in production");
    res.status(503).json({ error: "Email delivery is temporarily unavailable. Please try again later." });
    return true;
  }
  return false;
}

function respondOtpRateLimit(res: import("express").Response, err: OtpRateLimitError): void {
  res.status(429).json({
    error: err.message,
    retryAfter: err.retryAfterSeconds,
    retryAfterSeconds: err.retryAfterSeconds,
  });
}

// ─── POST /api/auth/send-otp  &  /api/auth/resend-otp ────────────────────────
const SendOtpBody = z.object({ email: z.string().email("Invalid email address") });

async function handleSendOtp(req: import("express").Request, res: import("express").Response): Promise<void> {
  const parsed = SendOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const email = req.studentEmail!.toLowerCase().trim();
  if (respondMissingEmailProvider(res)) return;

  const [student] = await db
    .select({ id: studentsTable.id, emailVerified: studentsTable.emailVerified })
    .from(studentsTable)
    .where(eq(studentsTable.email, email));

  if (!student || student.emailVerified) {
    logger.info({ studentId: req.studentId }, "Email verification OTP requested for unavailable email-keyed account");
    res.json(GENERIC_SEND_RESPONSE);
    return;
  }

  try {
    const { expiresIn } = await issueOtp(email, { studentId: student.id, purpose: "verify" });
    res.json({ ok: true, expiresIn });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      respondOtpRateLimit(res, err);
      return;
    }
    await invalidateOtpCodes(email, "verify");
    if (respondEmailDeliveryFailure(res, err, { studentId: student.id })) return;
    throw err;
  }
}

router.post("/auth/send-otp", requireStudentAuth, requireBotToken("otp_send"), otpSendLimiter, handleSendOtp);
router.post("/auth/resend-otp", requireStudentAuth, requireBotToken("otp_send"), otpSendLimiter, handleSendOtp);

// ─── POST /api/auth/verify-otp ───────────────────────────────────────────────
const VerifyOtpBody = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/verify-otp", requireStudentAuth, otpVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const email = req.studentEmail!;
  const { code } = parsed.data;

  const result = await verifyEmailOtpForStudent(req.studentId!, email, code);
  if (result.status !== "ok") {
    respondVerifyFailure(res, result);
    return;
  }
  await resetIdLimiter("otp-verify", req.studentId!);

  const { student } = result;

  // Issue a fresh FULL token now that the account is verified.
  const accessToken = signStudentToken(student.id, student.email, true, student.tokenVersion);
  logger.info({ studentId: student.id }, "Email verified via OTP");
  // Security-02B: tokenVersion is internal revocation state — strip it before
  // the row reaches the client, same as passwordHash/qrToken elsewhere.
  const { tokenVersion: _tokenVersion, ...publicStudentFields } = student;
  res.json({ ok: true, accessToken, student: publicStudentFields });
});

// ─── Legacy studentId-keyed endpoints (backward compatibility) ───────────────
const SendEmailOtpBody = z.object({ studentId: z.coerce.number().int().positive() });

router.post("/auth/send-email-otp", requireStudentAuth, requireBotToken("otp_send"), otpSendLimiter, async (req, res): Promise<void> => {
  const parsed = SendEmailOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const studentId = req.studentId!;
  if (respondMissingEmailProvider(res)) return;

  const [student] = await db
    .select({ id: studentsTable.id, email: studentsTable.email, emailVerified: studentsTable.emailVerified })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId));

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  if (student.emailVerified) {
    res.status(400).json({ error: "Email is already verified" });
    return;
  }

  try {
    const { expiresIn } = await issueOtp(student.email, { studentId: student.id, purpose: "verify" });
    res.json({ ok: true, expiresIn });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      respondOtpRateLimit(res, err);
      return;
    }
    await invalidateOtpCodes(student.email, "verify");
    if (respondEmailDeliveryFailure(res, err, { studentId: student.id })) return;
    throw err;
  }
});

const VerifyEmailOtpBody = z.object({
  studentId: z.coerce.number().int().positive(),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/verify-email-otp", requireStudentAuth, otpVerifyLimiter, async (req, res): Promise<void> => {
  const parsed = VerifyEmailOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const studentId = req.studentId!;
  const { code } = parsed.data;

  const [student] = await db
    .select({ email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId));

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const result = await verifyEmailOtpForStudent(studentId, student.email, code);
  if (result.status !== "ok") {
    respondVerifyFailure(res, result);
    return;
  }
  await resetIdLimiter("otp-verify", studentId);

  const verifiedStudent = result.student;
  const accessToken = signStudentToken(verifiedStudent.id, verifiedStudent.email, true, verifiedStudent.tokenVersion);
  logger.info({ studentId }, "Email verified successfully (legacy endpoint)");
  // Security-02B: tokenVersion is internal revocation state — strip it before
  // the row reaches the client, same as passwordHash/qrToken elsewhere.
  const { tokenVersion: _tokenVersion, ...publicVerifiedStudent } = verifiedStudent;
  res.json({ ok: true, student: publicVerifiedStudent, accessToken });
});

export default router;
