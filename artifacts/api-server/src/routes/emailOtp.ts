/**
 * Email OTP verification routes — /api/auth/*
 *
 * Email-keyed (preferred — used by the new auth flow):
 *   POST /api/auth/send-otp     { email }          → issue + send a code
 *   POST /api/auth/resend-otp   { email }          → alias of send-otp (cooldown applies)
 *   POST /api/auth/verify-otp   { email, code }    → verify, mark verified, return full token
 *
 * Legacy studentId-keyed (kept for backward compatibility with the shipped
 * mobile build's verify-email screen):
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
import {
  issueOtp,
  verifyOtpCode,
  signStudentToken,
  EmailDeliveryError,
  EmailProviderConfigurationError,
  isEmailProviderConfigured,
  OtpRateLimitError,
} from "../lib/authHelpers";

const router: IRouter = Router();

// Marks a student verified and returns the refreshed row (or null if missing).
async function markVerified(email: string) {
  const now = new Date().toISOString();
  const [student] = await db
    .update(studentsTable)
    .set({ emailVerified: true, emailVerifiedAt: now })
    .where(eq(studentsTable.email, email.toLowerCase().trim()))
    .returning({
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
    });
  return student ?? null;
}

// Maps a non-"ok" verifyOtpCode result to an HTTP response.
function respondVerifyFailure(res: import("express").Response, result: Exclude<Awaited<ReturnType<typeof verifyOtpCode>>, { status: "ok" }>): void {
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

// ─── POST /api/auth/send-otp  &  /api/auth/resend-otp ────────────────────────
const SendOtpBody = z.object({ email: z.string().email("Invalid email address") });

async function handleSendOtp(req: import("express").Request, res: import("express").Response): Promise<void> {
  const parsed = SendOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  if (respondMissingEmailProvider(res)) return;

  const [student] = await db
    .select({ id: studentsTable.id, emailVerified: studentsTable.emailVerified })
    .from(studentsTable)
    .where(eq(studentsTable.email, email));

  if (!student) {
    res.status(404).json({ error: "No account found for this email." });
    return;
  }
  if (student.emailVerified) {
    res.status(400).json({ error: "Email is already verified." });
    return;
  }

  try {
    const { expiresIn } = await issueOtp(email, { studentId: student.id, purpose: "verify" });
    res.json({ ok: true, expiresIn });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      res.status(429).json({ error: "Please wait before requesting another code.", retryAfter: err.retryAfterSeconds });
      return;
    }
    if (respondEmailDeliveryFailure(res, err, { email })) return;
    throw err;
  }
}

router.post("/auth/send-otp", handleSendOtp);
router.post("/auth/resend-otp", handleSendOtp);

// ─── POST /api/auth/verify-otp ───────────────────────────────────────────────
const VerifyOtpBody = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { email, code } = parsed.data;

  const result = await verifyOtpCode(email, code, "verify");
  if (result.status !== "ok") {
    respondVerifyFailure(res, result);
    return;
  }

  const student = await markVerified(email);
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  // Issue a fresh FULL token now that the account is verified.
  const accessToken = signStudentToken(student.id, student.email, true);
  logger.info({ studentId: student.id }, "Email verified via OTP");
  res.json({ ok: true, accessToken, student });
});

// ─── Legacy studentId-keyed endpoints (backward compatibility) ───────────────
const SendEmailOtpBody = z.object({ studentId: z.coerce.number().int().positive() });

router.post("/auth/send-email-otp", async (req, res): Promise<void> => {
  const parsed = SendEmailOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { studentId } = parsed.data;
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
      res.status(429).json({ error: "Please wait before requesting another code.", retryAfter: err.retryAfterSeconds });
      return;
    }
    if (respondEmailDeliveryFailure(res, err, { studentId: student.id })) return;
    throw err;
  }
});

const VerifyEmailOtpBody = z.object({
  studentId: z.coerce.number().int().positive(),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/verify-email-otp", async (req, res): Promise<void> => {
  const parsed = VerifyEmailOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { studentId, code } = parsed.data;

  const [student] = await db
    .select({ email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.id, studentId));

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const result = await verifyOtpCode(student.email, code, "verify");
  if (result.status !== "ok") {
    // Legacy clients expect a generic 400 message.
    res.status(400).json({ error: "Invalid or expired verification code" });
    return;
  }

  const verifiedStudent = await markVerified(student.email);
  if (!verifiedStudent) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  const accessToken = signStudentToken(verifiedStudent.id, verifiedStudent.email, true);
  logger.info({ studentId }, "Email verified successfully (legacy endpoint)");
  res.json({ ok: true, student: verifiedStudent, accessToken });
});

export default router;
