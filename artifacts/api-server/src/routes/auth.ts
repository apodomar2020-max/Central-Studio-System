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
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable, studentDanceInterestsTable, danceTypesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import {
  invalidateOtpCodes,
  issueOtp,
  OtpRateLimitError,
  PasswordSchema,
  sendSecurityNotificationEmail,
  signStudentToken,
  verifyOtpCode,
} from "../lib/authHelpers";
import { publicStudent, legacyProfileCompletionPatch } from "../lib/studentProfileResponse";
import { validateProfileAge } from "../lib/eligibility/profileAgeValidation";

const router: IRouter = Router();

const RegisterBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  accountType: z.enum(["student", "parent"]).optional(),
  dateOfBirth: z.string().optional(),
  password: PasswordSchema,
});

const LoginBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const GENERIC_RESET_RESPONSE = {
  ok: true,
  message: "If an account exists for this email, a reset code will be sent.",
};

const forgotPasswordAttempts = new Map<string, number>();

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function throttleKey(email: string, ip: string | undefined): string {
  return `${email}:${ip ?? "unknown"}`;
}

function isForgotPasswordThrottled(email: string, ip: string | undefined): boolean {
  const key = throttleKey(email, ip);
  const now = Date.now();
  const last = forgotPasswordAttempts.get(key);
  forgotPasswordAttempts.set(key, now);
  return last != null && now - last < 60_000;
}

function passwordResetFailure(res: import("express").Response, message = "Invalid or expired code. Please request a new one."): void {
  res.status(400).json({ error: message });
}

function logPasswordSecurityEvent(studentId: number, event: "password_reset" | "password_changed"): void {
  logger.info({ studentId, event }, "Student password security event");
}

async function notifyPasswordSecurityEvent(email: string, event: "password_reset" | "password_changed"): Promise<void> {
  try {
    await sendSecurityNotificationEmail(email, event);
  } catch (err) {
    logger.warn({ err, event }, "Password security notification email failed");
  }
}

const AccountType = z.enum(["student", "parent"]);
const GENDERS = ["male", "female", "other"] as const;
const ProfileBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().min(1, "Phone number is required").optional(),
  accountType: AccountType.optional(),
  useProviderName: z.boolean().optional(),
  // Profile Completion Engine (Phase 4)
  gender: z.enum(GENDERS).optional(),
  dateOfBirth: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  nationality: z.string().min(1).optional(),
  howDidYouHearAboutUs: z.string().min(1).optional(),
  policiesAccepted: z.boolean().optional(),
});

// POST /api/auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { name, email, phone, accountType, dateOfBirth, password } = parsed.data;

  if (dateOfBirth != null) {
    const ageValidation = validateProfileAge({
      accountType: accountType ?? null,
      dateOfBirth,
    });
    if (!ageValidation.eligible) {
      const reason = ageValidation.reasons[0]!;
      res.status(400).json({ error: reason.message, code: reason.code });
      return;
    }
  }

  // Check if email is already taken
  const [existing] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(eq(studentsTable.email, normalizeEmail(email)));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const profileInput = {
    name: name.trim(),
    phone: phone?.trim() || null,
    accountType: accountType ?? null,
    dateOfBirth: dateOfBirth ?? null,
  };
  const completion = legacyProfileCompletionPatch(profileInput);

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: profileInput.name,
      email: normalizeEmail(email),
      phone: profileInput.phone,
      accountType: profileInput.accountType,
      dateOfBirth: profileInput.dateOfBirth,
      ...completion,
      passwordHash,
      authProvider: "local",
      // emailVerified defaults to false — the account must pass OTP before
      // it can reach any verified-only route.
    })
    .returning();

  // Limited token (emailVerified=false): unlocks OTP + /auth/me only.
  const accessToken = signStudentToken(student.id, student.email, false);

  logger.info({ studentId: student.id }, "New student registered (pending verification)");

  res.status(201).json({ student: await publicStudent(student), accessToken, requiresOtp: true });
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
    .where(eq(studentsTable.email, normalizeEmail(email)));

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
    student: await publicStudent(student),
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

  res.json({ student: await publicStudent(student), requiresOtp: !student.emailVerified });
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
  const nextGender = parsed.data.gender ?? existing.gender;
  const nextDateOfBirth = parsed.data.dateOfBirth?.trim() ?? existing.dateOfBirth;
  const nextCity = parsed.data.city?.trim() ?? existing.city;
  const nextNationality = parsed.data.nationality?.trim() ?? existing.nationality;
  const nextHowDidYouHearAboutUs = parsed.data.howDidYouHearAboutUs?.trim() ?? existing.howDidYouHearAboutUs;
  const nextPoliciesAcceptedAt = parsed.data.policiesAccepted === true
    ? existing.policiesAcceptedAt ?? new Date().toISOString()
    : parsed.data.policiesAccepted === false
      ? null
      : existing.policiesAcceptedAt;

  // Phase A: DOB/Parent-age validation is authoritative at the profile
  // boundary, while missing DOB remains a valid partial-onboarding state.
  // Validate before writing so a rejected transition cannot partially
  // mutate the account or accidentally mark completion finished.
  const shouldValidateAge =
    nextDateOfBirth != null &&
    (parsed.data.dateOfBirth !== undefined || parsed.data.accountType !== undefined);
  if (shouldValidateAge) {
    const ageValidation = validateProfileAge({
      accountType: nextAccountType,
      dateOfBirth: nextDateOfBirth,
    });
    if (!ageValidation.eligible) {
      const reason = ageValidation.reasons[0]!;
      res.status(400).json({ error: reason.message, code: reason.code });
      return;
    }
  }

  // Profile Completion Engine (Phase 4): this endpoint now ALWAYS saves
  // whatever subset of fields is given and reports current completion
  // status — it never rejects a partial/incomplete submission. Each
  // onboarding step (Complete Profile, Children, Medical, Your Vibe) saves
  // independently; the client uses profileCompletion.nextStep to know what
  // to ask for next, not a 400 from this endpoint.
  const legacyCompletion = legacyProfileCompletionPatch({
    name: nextName,
    phone: nextPhone,
    accountType: nextAccountType,
  });

  const [student] = await db
    .update(studentsTable)
    .set({
      name: nextName,
      phone: nextPhone,
      accountType: nextAccountType,
      gender: nextGender,
      dateOfBirth: nextDateOfBirth,
      city: nextCity,
      nationality: nextNationality,
      howDidYouHearAboutUs: nextHowDidYouHearAboutUs,
      policiesAcceptedAt: nextPoliciesAcceptedAt,
      ...legacyCompletion,
      lastCompletionStep: "profile",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(studentsTable.id, req.studentId!))
    .returning();

  res.json({ student: await publicStudent(student!), requiresOtp: !student!.emailVerified });
});

// ─── PUT /api/auth/dance-interests ───────────────────────────────────────────
// Profile Completion Engine (Phase 4) — "Your Vibe". Replaces the student's
// full set of dance interests with exactly the given list (backend-persisted;
// no more AsyncStorage-only selection). Requires email verification since it
// sits after Verify Email in the registration flow.
const DanceInterestsBody = z.object({
  danceTypeIds: z.array(z.coerce.number().int().positive()).default([]),
});

router.put("/auth/dance-interests", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const parsed = DanceInterestsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const studentId = req.studentId!;
  const danceTypeIds = [...new Set(parsed.data.danceTypeIds)];

  const student = await db.transaction(async (tx) => {
    await tx.delete(studentDanceInterestsTable).where(eq(studentDanceInterestsTable.studentId, studentId));
    if (danceTypeIds.length > 0) {
      // Only insert ids that correspond to a real dance type — silently
      // drop anything else rather than failing the whole request on stale
      // client-side data.
      const validTypes = await tx
        .select({ id: danceTypesTable.id })
        .from(danceTypesTable)
        .where(inArray(danceTypesTable.id, danceTypeIds));
      const validIds = validTypes.map((t) => t.id);
      if (validIds.length > 0) {
        await tx.insert(studentDanceInterestsTable).values(
          validIds.map((danceTypeId) => ({ studentId, danceTypeId })),
        );
      }
    }
    const [updated] = await tx
      .update(studentsTable)
      .set({ lastCompletionStep: "styles", updatedAt: new Date().toISOString() })
      .where(eq(studentsTable.id, studentId))
      .returning();
    return updated;
  });

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json({ student: await publicStudent(student), requiresOtp: !student.emailVerified });
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
  const normalizedEmail = normalizeEmail(email);

  const [student] = await db
    .select({ id: studentsTable.id, email: studentsTable.email })
    .from(studentsTable)
    .where(eq(studentsTable.email, normalizedEmail));

  if (isForgotPasswordThrottled(normalizedEmail, req.ip)) {
    logger.warn({ email: normalizedEmail, ip: req.ip }, "Forgot password throttled");
    res.json(GENERIC_RESET_RESPONSE);
    return;
  }

  // Always respond success to avoid leaking whether an email exists.
  if (!student) {
    res.json(GENERIC_RESET_RESPONSE);
    return;
  }

  try {
    await issueOtp(normalizedEmail, { studentId: student.id, purpose: "reset" });
    logger.info({ studentId: student.id }, "Password reset OTP generated");
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      logger.warn({ studentId: student.id }, "Password reset OTP request rate-limited");
    } else {
      await invalidateOtpCodes(normalizedEmail, "reset");
      logger.error({ err, studentId: student.id }, "Password reset OTP delivery failed");
    }
  }

  res.json(GENERIC_RESET_RESPONSE);
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
const ResetPasswordBody = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Code must be exactly 6 digits"),
  newPassword: PasswordSchema,
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, code, newPassword } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.email, normalizedEmail));
  if (!student) {
    passwordResetFailure(res);
    return;
  }

  const result = await verifyOtpCode(normalizedEmail, code, "reset");
  if (result.status !== "ok") {
    if (result.status === "locked") {
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }
    passwordResetFailure(res);
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await db
    .update(studentsTable)
    .set({ passwordHash, authProvider: student.authProvider ?? "local", updatedAt: now })
    .where(eq(studentsTable.id, student.id));

  await invalidateOtpCodes(normalizedEmail, "reset");
  logPasswordSecurityEvent(student.id, "password_reset");
  void notifyPasswordSecurityEvent(student.email, "password_reset");

  res.json({ ok: true });
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: PasswordSchema,
});

router.post("/auth/change-password", requireStudentAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, req.studentId!));
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }
  if (!student.passwordHash) {
    res.status(400).json({ error: "This account does not have a password set." });
    return;
  }

  const currentValid = await bcrypt.compare(parsed.data.currentPassword, student.passwordHash);
  if (!currentValid) {
    logger.warn({ studentId: student.id }, "Student change-password current password mismatch");
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }
  const samePassword = await bcrypt.compare(parsed.data.newPassword, student.passwordHash);
  if (samePassword) {
    res.status(400).json({ error: "New password must be different from your current password." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await db
    .update(studentsTable)
    .set({ passwordHash, authProvider: student.authProvider ?? "local", updatedAt: new Date().toISOString() })
    .where(eq(studentsTable.id, student.id));

  logPasswordSecurityEvent(student.id, "password_changed");
  void notifyPasswordSecurityEvent(student.email, "password_changed");

  res.json({ ok: true });
});

export default router;
