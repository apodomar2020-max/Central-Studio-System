/**
 * Authentication routes — /api/auth/*
 *
 * POST /api/auth/register          — create a new (unverified) student account
 * POST /api/auth/login             — verify credentials, return student + token
 * GET  /api/auth/me                — current student from the bearer token
 * POST /api/auth/forgot-password   — send OTP code to email for password reset
 * POST /api/auth/reset-password    — verify OTP and set a new password
 * POST /api/auth/change-password   — change password while authenticated
 * POST /api/auth/logout             — revoke every outstanding session (Security-02B)
 *
 * Mandatory email verification: register always creates an unverified account
 * and login of an unverified account both return a *limited* token plus
 * { requiresOtp: true, email }. The client must complete OTP (see emailOtp.ts)
 * before any requireVerifiedStudent route will accept the token.
 *
 * ─── Session revocation (Security-02B, CS-SEC-H-03) ──────────────────────────
 *
 * Reset, change, and logout all bump `students.token_version` — atomically,
 * via `token_version = token_version + 1` inside the SQL statement itself
 * (never SELECT-then-increment-in-JS-then-UPDATE, which would lose
 * concurrent bumps). requireAuth's student fast-path (middlewares/auth.ts)
 * compares each token's embedded version against this column on every
 * request, so a bump invalidates every previously-issued token for the
 * account immediately, on its very next use — no caching, no propagation
 * delay. There is no per-device session table in this phase: one bump
 * revokes ALL of that account's outstanding tokens, on every device.
 *   - reset-password: bumps the version but issues no new token (unchanged
 *     product contract — the user re-authenticates via /auth/login).
 *   - change-password: bumps the version AND issues a fresh token carrying
 *     it, so the device that just changed the password stays logged in;
 *     every OTHER outstanding token for the account is revoked.
 *   - logout: bumps the version and returns success; the calling device's
 *     own token is revoked along with everyone else's (there is no way to
 *     spare it, since revocation in this phase has no per-device grain).
 */
import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable, studentDanceInterestsTable, danceTypesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ACCOUNT_DEACTIVATED_BODY, isActiveAccountStatus } from "../lib/studentAccountStatus";
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
import { openInitialProvenanceInterval } from "../lib/studentEmailChangeService";
import { accountRateLimiter, ipRateLimiter, resetAccountLimiter } from "../middlewares/authRateLimit";

const router: IRouter = Router();

// Security Wave — Auth Abuse Foundation. IP + account-scoped, Redis-backed
// (see lib/authAbuseProtection.ts). The account key is always the
// HMAC-fingerprinted normalized email, never the raw address. Limits are
// intentionally generous enough not to interfere with legitimate retry
// behavior (a mistyped password, a slow network) while still bounding
// brute-force/credential-stuffing volume.
const emailIdentifier = (req: import("express").Request): string | null => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.includes("@") ? normalizeEmail(email) : null;
};
function limitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
// IP limits are deliberately generous — an IP represents an unknown number
// of real people behind it (school labs, offices, carrier-grade NAT), so
// this bounds abuse volume without punishing shared-IP legitimate use.
// Account limits are much tighter since a single account has exactly one
// legitimate owner.
const loginIpLimiter = ipRateLimiter("login", { limit: limitEnv("AUTH_LOGIN_IP_LIMIT", 60), windowSeconds: 15 * 60 });
const loginAccountLimiter = accountRateLimiter("login", { limit: limitEnv("AUTH_LOGIN_ACCOUNT_LIMIT", 10), windowSeconds: 15 * 60, identifierFor: emailIdentifier });
const registerIpLimiter = ipRateLimiter("register", { limit: limitEnv("AUTH_REGISTER_IP_LIMIT", 60), windowSeconds: 60 * 60 });
const registerAccountLimiter = accountRateLimiter("register", { limit: limitEnv("AUTH_REGISTER_ACCOUNT_LIMIT", 5), windowSeconds: 60 * 60, identifierFor: emailIdentifier });
const forgotPasswordIpLimiter = ipRateLimiter("forgot-password", { limit: limitEnv("AUTH_FORGOT_PASSWORD_IP_LIMIT", 40), windowSeconds: 15 * 60 });
const forgotPasswordAccountLimiter = accountRateLimiter("forgot-password", { limit: limitEnv("AUTH_FORGOT_PASSWORD_ACCOUNT_LIMIT", 5), windowSeconds: 15 * 60, identifierFor: emailIdentifier });
const resetPasswordIpLimiter = ipRateLimiter("reset-password", { limit: limitEnv("AUTH_RESET_PASSWORD_IP_LIMIT", 40), windowSeconds: 15 * 60 });
const resetPasswordAccountLimiter = accountRateLimiter("reset-password", { limit: limitEnv("AUTH_RESET_PASSWORD_ACCOUNT_LIMIT", 8), windowSeconds: 15 * 60, identifierFor: emailIdentifier });

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

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
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
router.post("/auth/register", registerIpLimiter, registerAccountLimiter, async (req, res): Promise<void> => {
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
    // Account-enumeration policy decision (Security Wave — Auth Abuse
    // Foundation): registration keeps its existing 409 + explicit message.
    // Fully collapsing this into a generic response would be a materially
    // larger UX change (the mobile client's "this email is taken, log in
    // instead" flow depends on it) than this focused pass should make
    // silently. Enumeration risk here is instead mitigated by the new
    // registerIpLimiter/registerAccountLimiter above, which bound how many
    // distinct addresses one caller can probe per window.
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

  // Phase B3B0-1A completion (Section F): student creation and the initial
  // provenance interval are atomic — if either write fails, both roll back
  // (natural db.transaction behavior). This does NOT change trust/
  // verification semantics: the email is already what the pre-existing
  // logic trusts enough to store as students.email, so provenance simply
  // mirrors that same trust boundary at the same insert point.
  const student = await db.transaction(async (tx) => {
    const [row] = await tx
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
    const created = row!;
    // validFrom reuses the student row's own server-generated createdAt
    // (defaultNow(), never client input) — never a second independent
    // `new Date()` reading, so the two writes can never diverge.
    await openInitialProvenanceInterval(tx, {
      studentId: created.id,
      email: created.email,
      source: "registration",
      validFrom: created.createdAt,
    });
    return created;
  });

  // Limited token (emailVerified=false): unlocks OTP + /auth/me only.
  const accessToken = signStudentToken(student.id, student.email, false, student.tokenVersion);

  logger.info({ studentId: student.id }, "New student registered (pending verification)");

  res.status(201).json({ student: await publicStudent(student), accessToken, requiresOtp: true });
});

// POST /api/auth/login
//
// Account-enumeration hardening (Security Wave — Auth Abuse Foundation):
// every pre-auth rejection reason below — unknown email, social-only
// account (no passwordHash), wrong password, and a non-active account
// (deactivated/deleted) — returns the exact SAME generic 401 body. This is
// deliberate: an external caller must not be able to distinguish "no such
// account" from "account exists but is deactivated" from "this is a
// Google-only account". Server-side lifecycle enforcement (the
// isActiveAccountStatus gate) is unchanged and still fully blocks the
// login — only the OUTWARD response shape was collapsed. Nothing here is
// logged with a raw email address; failures are logged by internal
// studentId (when known) or omitted entirely (when the account is unknown,
// there is no safe internal id to log).
router.post("/auth/login", loginIpLimiter, loginAccountLimiter, async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = normalizeEmail(email);
  const GENERIC_LOGIN_FAILURE = { error: "Invalid email or password" };

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.email, normalizedEmail));

  if (!student) {
    res.status(401).json(GENERIC_LOGIN_FAILURE);
    return;
  }

  if (!student.passwordHash) {
    // Social-only account (no local password set). Same generic response as
    // every other pre-auth rejection — never reveals the account's
    // provider type or that it exists at all.
    res.status(401).json(GENERIC_LOGIN_FAILURE);
    return;
  }

  const valid = await bcrypt.compare(password, student.passwordHash);
  if (!valid) {
    logger.warn({ studentId: student.id }, "Failed login attempt");
    res.status(401).json(GENERIC_LOGIN_FAILURE);
    return;
  }

  // Account lifecycle (Phase B1B): password verified, but never issue a
  // token for a non-active account. Fail closed on anything other than
  // "active" (covers "deactivated", "deleted", and any unexpected value).
  // Externally generic (same GENERIC_LOGIN_FAILURE body/status as every
  // other rejection above) — server-side enforcement is unchanged, only the
  // outward response no longer distinguishes this case.
  if (!isActiveAccountStatus(student.accountStatus)) {
    logger.info({ studentId: student.id }, "Login rejected: account not active");
    res.status(401).json(GENERIC_LOGIN_FAILURE);
    return;
  }

  // Successful auth — age out any accumulated failure state for this
  // account so a legitimate user who mistyped their password a few times
  // isn't left sitting near the rate-limit threshold.
  await resetAccountLimiter("login", normalizedEmail);

  await db
    .update(studentsTable)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(studentsTable.id, student.id));

  // Token verification scope mirrors the account: an unverified account gets a
  // limited token and must complete OTP before reaching verified-only routes.
  const accessToken = signStudentToken(student.id, student.email, student.emailVerified, student.tokenVersion);

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

router.post("/auth/forgot-password", forgotPasswordIpLimiter, forgotPasswordAccountLimiter, async (req, res): Promise<void> => {
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

  // Always respond success to avoid leaking whether an email exists. The
  // old per-(email,ip) in-memory debounce Map was removed in favor of the
  // Redis-backed forgotPasswordIpLimiter/forgotPasswordAccountLimiter
  // middleware above — one system, not two overlapping ones.
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

router.post("/auth/reset-password", resetPasswordIpLimiter, resetPasswordAccountLimiter, async (req, res): Promise<void> => {
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

  // Successful reset — age out any accumulated failure state for this
  // account across both the login and reset-password limiter scopes.
  await Promise.all([
    resetAccountLimiter("reset-password", normalizedEmail),
    resetAccountLimiter("login", normalizedEmail),
  ]);

  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Security-02B: bump token_version in the SAME UPDATE that changes the
  // password — one statement, atomic by Postgres's own single-row UPDATE
  // guarantee. `token_version = token_version + 1` is computed IN SQL, never
  // read-then-incremented-in-JS, so a concurrent reset/change/logout for
  // this account can never clobber another's bump (see requireAuth for the
  // read side of this invariant). This invalidates every token issued before
  // this moment, on every device, on its next request. No replacement token
  // is issued here — the product contract for reset-password has never
  // included one; the user re-authenticates via /auth/login as before.
  await db
    .update(studentsTable)
    .set({
      passwordHash,
      authProvider: student.authProvider ?? "local",
      updatedAt: now,
      tokenVersion: sql`${studentsTable.tokenVersion} + 1`,
    })
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

  // Security-02B: atomic increment in the same UPDATE as the password write
  // (see the reset-password handler above for why — identical invariant).
  // `.returning()` hands back the POST-increment value directly from the
  // database, so the replacement token below is never at risk of embedding a
  // stale version even under concurrent writes to this row.
  const [updated] = await db
    .update(studentsTable)
    .set({
      passwordHash,
      authProvider: student.authProvider ?? "local",
      updatedAt: new Date().toISOString(),
      tokenVersion: sql`${studentsTable.tokenVersion} + 1`,
    })
    .where(eq(studentsTable.id, student.id))
    .returning({ tokenVersion: studentsTable.tokenVersion });

  logPasswordSecurityEvent(student.id, "password_changed");
  void notifyPasswordSecurityEvent(student.email, "password_changed");

  // The device that just changed the password stays logged in: it receives a
  // fresh token carrying the NEW version. Every other outstanding token for
  // this account — including one that might currently be sitting on a second
  // device — embeds the OLD version and is rejected on its next request.
  // Additive response field: existing clients that only read `ok` are
  // unaffected; `accessToken` is new.
  const accessToken = signStudentToken(student.id, student.email, student.emailVerified, updated!.tokenVersion);

  res.json({ ok: true, accessToken });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// Security-02B (CS-SEC-H-03). Revokes every outstanding session for this
// account — there is no per-device session table in this phase, so logging
// out on one device also ends every other device's session. This is a
// deliberate, documented scope for this phase, not an oversight; see the file
// header. Requires a currently-valid student JWT: an already-expired or
// already-revoked token cannot "log out" (there is nothing left to revoke),
// which requireStudentAuth's normal 401 already communicates correctly.
router.post("/auth/logout", requireStudentAuth, async (req, res): Promise<void> => {
  await db
    .update(studentsTable)
    .set({ tokenVersion: sql`${studentsTable.tokenVersion} + 1` })
    .where(eq(studentsTable.id, req.studentId!));

  logger.info({ studentId: req.studentId }, "Student logged out (all sessions revoked)");

  res.json({ ok: true });
});

export default router;
