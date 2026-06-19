/**
 * Authentication routes — /api/auth/*
 *
 * POST /api/auth/register          — create a new (unverified) student account
 * POST /api/auth/login             — verify credentials, return student + token
 * GET  /api/auth/me                — current student from the bearer token
 * POST /api/auth/forgot-password   — send OTP code to email for password reset
 * POST /api/auth/reset-password    — verify OTP and set a new password
 *
 * Mandatory email verification: register always creates an unverified account
 * and login of an unverified account both return a *limited* token plus
 * { requiresOtp: true, email }. The client must complete OTP (see emailOtp.ts)
 * before any requireVerifiedStudent route will accept the token.
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable, emailOtpsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireStudentAuth } from "../middlewares/studentAuth";
import { signStudentToken, generateOtp, sendOtpEmail, OTP_TTL_SECONDS } from "../lib/authHelpers";

const router: IRouter = Router();

const RegisterBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  accountType: z.enum(["student", "parent"]).optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const LoginBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const AccountType = z.enum(["student", "parent"]);
const ProfileBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().min(1, "Phone number is required").optional(),
  accountType: AccountType.optional(),
  useProviderName: z.boolean().optional(),
});

type StudentRow = typeof studentsTable.$inferSelect;

function profileMissingFields(student: Pick<StudentRow, "name" | "phone" | "accountType">): string[] {
  const missing: string[] = [];
  if (!student.name?.trim()) missing.push("name");
  if (!student.phone?.trim()) missing.push("phone");
  if (student.accountType !== "student" && student.accountType !== "parent") missing.push("accountType");
  return missing;
}

function profileCompletionPatch(student: Pick<StudentRow, "name" | "phone" | "accountType">) {
  const complete = profileMissingFields(student).length === 0;
  return {
    profileCompleted: complete,
    profileCompletedAt: complete ? new Date().toISOString() : null,
  };
}

function publicStudent(student: StudentRow) {
  const missing = profileMissingFields(student);
  return {
    id: student.id,
    name: student.name,
    email: student.email,
    phone: student.phone,
    accountType: student.accountType,
    emailVerified: student.emailVerified,
    emailVerifiedAt: student.emailVerifiedAt,
    authProvider: student.authProvider,
    avatarUrl: student.avatarUrl ?? null,
    providerAvatarUrl: student.providerAvatarUrl ?? null,
    providerDisplayName: student.providerDisplayName ?? null,
    profileCompleted: missing.length === 0,
    profileMissingFields: missing,
    joinedAt: student.joinedAt,
    qrToken: student.qrToken,
  };
}

// POST /api/auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { name, email, phone, accountType, password } = parsed.data;

  // Check if email is already taken
  const [existing] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.email, email.toLowerCase().trim()));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const profileInput = {
    name: name.trim(),
    phone: phone?.trim() || null,
    accountType: accountType ?? null,
  };
  const completion = profileCompletionPatch(profileInput);

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: profileInput.name,
      email: email.toLowerCase().trim(),
      phone: profileInput.phone,
      accountType: profileInput.accountType,
      ...completion,
      passwordHash,
      authProvider: "local",
      // emailVerified defaults to false — the account must pass OTP before
      // it can reach any verified-only route.
    })
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

  // Limited token (emailVerified=false): unlocks OTP + /auth/me only.
  const accessToken = signStudentToken(student.id, student.email, false);

  logger.info({ studentId: student.id }, "New student registered (pending verification)");

  res.status(201).json({ student, accessToken, requiresOtp: true });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.email, email.toLowerCase().trim()));

  if (!student) {
    // Return a generic message to avoid leaking whether the email exists
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!student.passwordHash) {
    // Student was created by admin without a password — they need to register
    res.status(401).json({ error: "No password set for this account. Please register." });
    return;
  }

  const valid = await bcrypt.compare(password, student.passwordHash);
  if (!valid) {
    logger.warn({ email }, "Failed login attempt");
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await db
    .update(studentsTable)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(studentsTable.id, student.id));

  // Token verification scope mirrors the account: an unverified account gets a
  // limited token and must complete OTP before reaching verified-only routes.
  const accessToken = signStudentToken(student.id, student.email, student.emailVerified);

  logger.info({ studentId: student.id, emailVerified: student.emailVerified }, "Student logged in");

  res.json({
    student: {
      id: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      accountType: student.accountType,
      emailVerified: student.emailVerified,
      authProvider: student.authProvider,
      avatarUrl: student.avatarUrl ?? null,
      providerDisplayName: student.providerDisplayName ?? null,
      profileCompleted: profileMissingFields(student).length === 0,
      profileMissingFields: profileMissingFields(student),
      joinedAt: student.joinedAt,
      qrToken: student.qrToken,
    },
    accessToken,
    requiresOtp: !student.emailVerified,
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
// Returns the current student for the bearer token. Uses requireStudentAuth
// (NOT requireVerifiedStudent) so an unverified account can still load its own
// profile while sitting on the OTP screen.
router.get("/auth/me", requireStudentAuth, async (req, res): Promise<void> => {
  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.studentId!));

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json({ student: publicStudent(student), requiresOtp: !student.emailVerified });
});

// ─── PATCH /api/auth/profile ─────────────────────────────────────────────────
// Updates the authenticated student's studio profile. Email and avatar are not
// changed here; avatar upload can remain a separate explicit flow.
router.patch("/auth/profile", requireStudentAuth, async (req, res): Promise<void> => {
  const parsed = ProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.studentId!));
  if (!existing) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const nextName = parsed.data.useProviderName && existing.providerDisplayName
    ? existing.providerDisplayName
    : parsed.data.name?.trim() ?? existing.name;
  const nextPhone = parsed.data.phone?.trim() ?? existing.phone;
  const nextAccountType = parsed.data.accountType ?? existing.accountType;
  const completion = profileCompletionPatch({
    name: nextName,
    phone: nextPhone,
    accountType: nextAccountType,
  });

  if (profileMissingFields({ name: nextName, phone: nextPhone, accountType: nextAccountType }).length > 0) {
    res.status(400).json({
      error: "Profile is incomplete",
      profileMissingFields: profileMissingFields({
        name: nextName,
        phone: nextPhone,
        accountType: nextAccountType,
      }),
    });
    return;
  }

  const [student] = await db
    .update(studentsTable)
    .set({
      name: nextName,
      phone: nextPhone,
      accountType: nextAccountType,
      ...completion,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(studentsTable.id, req.studentId!))
    .returning();

  res.json({ student: publicStudent(student!), requiresOtp: !student!.emailVerified });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
const ForgotPasswordBody = z.object({
  email: z.string().email("Invalid email address"),
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const [student] = await db
    .select({ id: studentsTable.id, email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.email, normalizedEmail));

  // Always respond success to avoid leaking whether an email exists
  if (!student) {
    res.json({ ok: true });
    return;
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await db.insert(emailOtpsTable).values({
    studentId: student.id,
    email: normalizedEmail,
    code,
    purpose: "reset",
    expiresAt,
  });

  // Reuse the shared OTP mailer (dev: logs the code).
  await sendOtpEmail(normalizedEmail, code, "reset");

  logger.info({ studentId: student.id }, "Password reset OTP generated");

  // Return studentId so the client can submit the reset form
  res.json({ ok: true, studentId: student.id });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
const ResetPasswordBody = z.object({
  studentId: z.coerce.number().int().positive(),
  code: z.string().length(6, "Code must be exactly 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { studentId, code, newPassword } = parsed.data;
  const now = new Date().toISOString();

  // Find latest valid (unused, unexpired) OTP for this student
  const [otp] = await db
    .select()
    .from(emailOtpsTable)
    .where(
      and(
        eq(emailOtpsTable.studentId, studentId),
        eq(emailOtpsTable.code, code),
        eq(emailOtpsTable.purpose, "reset"),
        isNull(emailOtpsTable.usedAt),
        gt(emailOtpsTable.expiresAt, now),
      )
    )
    .limit(1);

  if (!otp) {
    res.status(400).json({ error: "Invalid or expired code. Please request a new one." });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Mark OTP as used
  await db.update(emailOtpsTable).set({ usedAt: now }).where(eq(emailOtpsTable.id, otp.id));

  // Update password
  await db.update(studentsTable).set({ passwordHash }).where(eq(studentsTable.id, studentId));

  logger.info({ studentId }, "Password reset successfully");

  res.json({ ok: true });
});

export default router;
