/**
 * Social authentication routes — /api/auth/{google,apple,facebook}
 *
 * Flow (shared across providers):
 *   1. Validate the provider token server-side (socialProviders.ts).
 *   2. Resolve the account: match by provider id, else by email (link), else create.
 *   3. Decide access:
 *        - provider asserts the email is verified  → mark verified, FULL token.
 *        - otherwise (incl. Apple hidden email)    → LIMITED token + send OTP.
 *
 * Account-linking safety: linking a provider id alone grants nothing — full
 * access requires either a provider-verified email or a completed OTP. So an
 * attacker cannot take over an existing account with an unverified provider email.
 *
 * Apple "Hide My Email": when the provider releases no email and the client
 * sends none, we respond { requiresEmail: true } so the app can collect one and
 * re-submit; that email is then OTP-verified.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { signStudentToken, issueOtp, OtpRateLimitError } from "../lib/authHelpers";
import {
  verifyProviderToken,
  ProviderNotConfiguredError,
  ProviderTokenInvalidError,
  type ProviderName,
  type ProviderIdentity,
} from "../lib/socialProviders";

const router: IRouter = Router();

type StudentRow = typeof studentsTable.$inferSelect;

const providerColumn = {
  google: studentsTable.googleId,
  apple: studentsTable.appleId,
  facebook: studentsTable.facebookId,
} as const;

// Type-safe single-column patch for the provider's stable id.
function providerPatch(provider: ProviderName, providerId: string):
  | { googleId: string } | { appleId: string } | { facebookId: string } {
  if (provider === "google") return { googleId: providerId };
  if (provider === "apple") return { appleId: providerId };
  return { facebookId: providerId };
}

async function findByProviderId(provider: ProviderName, providerId: string): Promise<StudentRow | null> {
  const [row] = await db.select().from(studentsTable).where(eq(providerColumn[provider], providerId));
  return row ?? null;
}

async function findByEmail(email: string): Promise<StudentRow | null> {
  const [row] = await db.select().from(studentsTable).where(eq(studentsTable.email, email.toLowerCase().trim()));
  return row ?? null;
}

function publicStudent(s: StudentRow) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    emailVerified: s.emailVerified,
    avatarUrl: s.avatarUrl ?? null,
    joinedAt: s.joinedAt,
    qrToken: s.qrToken,
  };
}

/**
 * Compute the avatar columns to write for a social login.
 *
 * Rules:
 *   - Always keep provider_avatar_url in sync with the latest provider picture.
 *   - Only set the *displayed* avatar (avatar_url/avatar_source) to the provider
 *     picture when the account does NOT have a manual avatar — a manual upload is
 *     never overwritten.
 *   - `existing` is undefined for brand-new accounts (they have no manual avatar).
 */
function avatarPatch(
  identity: ProviderIdentity,
  existing?: StudentRow,
): { providerAvatarUrl?: string; avatarUrl?: string; avatarSource?: string } {
  if (!identity.avatarUrl) return {};
  const patch: { providerAvatarUrl?: string; avatarUrl?: string; avatarSource?: string } = {
    providerAvatarUrl: identity.avatarUrl,
  };
  if (existing?.avatarSource !== "manual") {
    patch.avatarUrl = identity.avatarUrl;
    patch.avatarSource = "google";
  }
  return patch;
}

/**
 * Resolve a social identity into a student account and an access decision.
 * Returns either a student + verification state, or a signal that the client
 * must collect an email first (Apple hidden-email case).
 */
async function resolveSocialLogin(
  identity: ProviderIdentity,
  providedEmail: string | null,
): Promise<{ kind: "needsEmail" } | { kind: "ok"; student: StudentRow; verified: boolean }> {
  const { provider, providerId } = identity;

  // The email is provider-verified only when it came FROM the provider (not a
  // client-typed fallback) AND the provider marked it verified.
  const email = identity.email ?? (providedEmail ? providedEmail.toLowerCase().trim() : null);
  const verifiedByProvider = identity.emailVerified && !!identity.email && email === identity.email;

  const now = new Date().toISOString();

  // 1. Already linked by provider id → that account.
  let student = await findByProviderId(provider, providerId);

  if (!student) {
    if (!email) return { kind: "needsEmail" };

    // 2. Existing account with this email → link the provider id onto it.
    student = await findByEmail(email);
    if (student) {
      const [updated] = await db
        .update(studentsTable)
        .set({
          ...providerPatch(provider, providerId),
          ...avatarPatch(identity, student),
          authProvider: provider,
          lastLoginAt: now,
        })
        .where(eq(studentsTable.id, student.id))
        .returning();
      student = updated!;
    } else {
      // 3. Brand-new account.
      const [created] = await db
        .insert(studentsTable)
        .values({
          name: identity.name ?? email.split("@")[0] ?? "Member",
          email,
          authProvider: provider,
          ...providerPatch(provider, providerId),
          ...avatarPatch(identity),
          emailVerified: verifiedByProvider,
          emailVerifiedAt: verifiedByProvider ? now : null,
          lastLoginAt: now,
        })
        .returning();
      student = created!;
    }
  } else {
    const [updated] = await db
      .update(studentsTable)
      .set({ ...avatarPatch(identity, student), authProvider: provider, lastLoginAt: now })
      .where(eq(studentsTable.id, student.id))
      .returning();
    student = updated!;
  }

  // Promote to verified if the provider proved the email and we haven't already.
  let verified = student.emailVerified;
  if (!verified && verifiedByProvider) {
    const [updated] = await db
      .update(studentsTable)
      .set({ emailVerified: true, emailVerifiedAt: now })
      .where(eq(studentsTable.id, student.id))
      .returning();
    student = updated!;
    verified = true;
  }

  return { kind: "ok", student, verified };
}

// Accept the provider token under any of the conventional keys:
//   idToken     — Google ID token
//   accessToken — Facebook access token
//   token       — generic fallback (e.g. Apple identity token)
const SocialBody = z
  .object({
    token: z.string().min(1).optional(),
    idToken: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    // Optional client-collected email (Facebook / Apple hidden-email fallback).
    email: z.string().email().optional(),
  })
  .refine((b) => !!(b.token || b.idToken || b.accessToken), {
    message: "A provider token is required",
  });

function makeHandler(provider: ProviderName) {
  return async (req: import("express").Request, res: import("express").Response): Promise<void> => {
    const parsed = SocialBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const providerToken = parsed.data.idToken ?? parsed.data.accessToken ?? parsed.data.token!;

    // 1. Validate the provider token server-side.
    let identity: ProviderIdentity;
    try {
      identity = await verifyProviderToken(provider, providerToken);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        res.status(501).json({ error: err.message, requiredEnv: err.requiredEnv });
        return;
      }
      if (err instanceof ProviderTokenInvalidError) {
        res.status(401).json({ error: err.message });
        return;
      }
      throw err;
    }

    // 2. Resolve / link the account.
    const result = await resolveSocialLogin(identity, parsed.data.email ?? null);
    if (result.kind === "needsEmail") {
      res.status(200).json({
        requiresEmail: true,
        provider,
        message: "This provider did not share an email. Please provide one to continue.",
      });
      return;
    }

    const { student, verified } = result;
    const accessToken = signStudentToken(student.id, student.email, verified);

    // 3. Unverified → send an OTP so the client can verify on the OTP screen.
    if (!verified) {
      try {
        await issueOtp(student.email, { studentId: student.id, purpose: "verify" });
      } catch (err) {
        // A recent code already exists (cooldown) — that's fine.
        if (!(err instanceof OtpRateLimitError)) throw err;
      }
    }

    logger.info({ studentId: student.id, provider, verified }, "Social login");
    res.json({ student: publicStudent(student), accessToken, requiresOtp: !verified });
  };
}

router.post("/auth/google", makeHandler("google"));
router.post("/auth/apple", makeHandler("apple"));
router.post("/auth/facebook", makeHandler("facebook"));

export default router;
