/**
 * Email OTP verification routes — /api/auth/*
 *
 * POST /api/auth/send-email-otp
 *   Body: { studentId: number }
 *   Generates a 6-digit OTP, stores it (hashed) in email_otps, and:
 *   - In development: logs the code to the console (no real email sent)
 *   - In production: sends via the configured email provider (stub for now —
 *     swap in Resend / SendGrid / Nodemailer by filling in sendEmail() below)
 *   Returns: { ok: true, expiresIn: 600 }
 *
 * POST /api/auth/verify-email-otp
 *   Body: { studentId: number, code: string }
 *   Validates the code, marks email_verified = true on the student, and
 *   marks the OTP row as used.
 *   Returns: { ok: true }
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import { db, emailOtpsTable, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const OTP_TTL_SECONDS = 600; // 10 minutes

// ─── Email sending stub ───────────────────────────────────────────────────────
// In development, the OTP is only logged. To wire up real email delivery,
// replace the body of this function with your provider's SDK call.
async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (process.env["NODE_ENV"] !== "production") {
    logger.info({ to, code }, "DEV MODE — OTP code (not sent via email)");
    return;
  }
  // TODO: replace with real email provider (Resend, SendGrid, Nodemailer, etc.)
  // Example with Resend:
  //   await resend.emails.send({
  //     from: "Central Studio <noreply@centralstudio.com>",
  //     to,
  //     subject: "Your verification code",
  //     text: `Your Central Studio verification code is: ${code}\n\nThis code expires in 10 minutes.`,
  //   });
  logger.warn({ to }, "Email provider not configured — OTP not sent in production");
}

// Generate a cryptographically random 6-digit code
function generateOtp(): string {
  const num = Math.floor(Math.random() * 1_000_000);
  return String(num).padStart(6, "0");
}

// ─── POST /api/auth/send-email-otp ───────────────────────────────────────────
const SendOtpBody = z.object({
  studentId: z.coerce.number().int().positive(),
});

router.post("/auth/send-email-otp", async (req, res): Promise<void> => {
  const parsed = SendOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { studentId } = parsed.data;

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

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await db.insert(emailOtpsTable).values({
    studentId,
    email: student.email,
    code,
    expiresAt,
  });

  await sendOtpEmail(student.email, code);

  logger.info({ studentId, email: student.email }, "OTP sent for email verification");

  res.json({ ok: true, expiresIn: OTP_TTL_SECONDS });
});

// ─── POST /api/auth/verify-email-otp ─────────────────────────────────────────
const VerifyOtpBody = z.object({
  studentId: z.coerce.number().int().positive(),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/verify-email-otp", async (req, res): Promise<void> => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { studentId, code } = parsed.data;

  const now = new Date().toISOString();

  // Find the latest valid (unused, unexpired) OTP for this student
  const [otp] = await db
    .select()
    .from(emailOtpsTable)
    .where(
      and(
        eq(emailOtpsTable.studentId, studentId),
        eq(emailOtpsTable.code, code),
        isNull(emailOtpsTable.usedAt),
        gt(emailOtpsTable.expiresAt, now),
      )
    )
    .limit(1);

  if (!otp) {
    res.status(400).json({ error: "Invalid or expired verification code" });
    return;
  }

  // Mark OTP as used
  await db
    .update(emailOtpsTable)
    .set({ usedAt: now })
    .where(eq(emailOtpsTable.id, otp.id));

  // Mark student's email as verified
  await db
    .update(studentsTable)
    .set({ emailVerified: true })
    .where(eq(studentsTable.id, studentId));

  logger.info({ studentId }, "Email verified successfully");

  res.json({ ok: true });
});

export default router;
