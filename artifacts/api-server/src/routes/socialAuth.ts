/**
 * Social authentication routes — /api/auth/{google,apple,facebook}
 *
 * Flow (shared across providers):
 *   1. Validate the provider token server-side (socialProviders.ts).
 *   2. Resolve the account (resolveSocialLogin below).
 *   3. Issue a token, or a business response demanding more proof.
 *
 * ─── Linking rules (Security-01B1 — closes CS-SEC-C-01) ──────────────────────
 *
 * The ONLY question that matters here is: may this provider identity attach
 * itself to an account that already exists? The answer is derived exclusively
 * from `identity.emailTrust` — never from anything stored on the student row.
 *
 *   Branch 1  provider id already linked
 *             → sign in. No email lookup, no linking decision. Every existing
 *               Google/Facebook user takes this path, unchanged.
 *
 *   Branch 2  no provider email at all
 *             → { requiresEmail: true }. No DB write. A client-supplied email
 *               is NOT accepted as a substitute (see SocialBody below).
 *
 *   Branch 3  provider email, no account matches it
 *             → create a new account. It is marked verified only for
 *               "provider_attested"; otherwise it starts unverified and the
 *               existing OTP flow runs. Nothing pre-existing is at risk here.
 *
 *   Branch 4  provider email matches an EXISTING account
 *             → this is the branch CS-SEC-C-01 lived in.
 *               • "provider_attested"  → link (atomically) and sign in.
 *               • anything else        → 409 PROVIDER_LINK_VERIFICATION_REQUIRED.
 *                 NOTHING is written: no provider id, no auth_provider, no
 *                 display name, no avatar, no email_verified_at. NO token of
 *                 any kind is issued.
 *
 * ─── The bug this replaces ───────────────────────────────────────────────────
 *
 * The previous implementation resolved the account from a client-supplied
 * body email, linked the provider id onto it, and then read the VICTIM'S
 * stored `student.emailVerified` to decide access — so an attacker holding a
 * genuine provider token for their own account, plus any victim's address,
 * received a full 30-day verified session for that victim. The stored flag is
 * a record of something the account owner did in the past; it is never proof
 * that the party authenticating right now controls the address. It is no
 * longer consulted when deciding whether a link may occur.
 *
 * Security-01B2 will replace the 409 in branch 4 with a real OTP link
 * challenge. The response already carries `requiresLinkVerification` so that
 * change is additive for clients.
 *
 * Apple stays fail-closed (socialProviders.ts throws before any of this runs).
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ACCOUNT_DEACTIVATED_BODY, isActiveAccountStatus } from "../lib/studentAccountStatus";
import { signStudentToken, issueOtp, OtpRateLimitError } from "../lib/authHelpers";
import { publicStudent } from "../lib/studentProfileResponse";
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

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

async function findByEmail(email: string): Promise<StudentRow | null> {
  const [row] = await db.select().from(studentsTable).where(eq(studentsTable.email, normalizeEmail(email)));
  return row ?? null;
}

/** Current value of this provider's id column on a row (null when unlinked). */
function readProviderId(row: StudentRow, provider: ProviderName): string | null {
  if (provider === "google") return row.googleId;
  if (provider === "apple") return row.appleId;
  return row.facebookId;
}

/**
 * "jane.doe@example.com" -> "j********@example.com".
 *
 * Used only in the link-verification response. This leaks nothing the caller
 * does not already have: the address came from the provider in the first
 * place, so this cannot be used as an account-existence oracle for an address
 * the caller does not already control a provider identity for.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
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
 * Outcome of resolving a provider identity.
 *
 * Every non-"ok" variant is a terminal refusal that has performed ZERO writes.
 */
type SocialLoginOutcome =
  | { kind: "ok"; student: StudentRow; verified: boolean }
  | { kind: "needsEmail" }
  | { kind: "linkVerificationRequired"; maskedEmail: string; targetStudentId: number }
  | { kind: "providerAlreadyLinked" }
  | { kind: "accountDeactivated" };

/**
 * Resolve a verified provider identity into a student account.
 *
 * See the file header for the four branches and why branch 4 is gated on
 * `identity.emailTrust` alone.
 */
async function resolveSocialLogin(identity: ProviderIdentity): Promise<SocialLoginOutcome> {
  const { provider, providerId, emailTrust } = identity;
  const email = identity.email ? normalizeEmail(identity.email) : null;
  const now = new Date().toISOString();

  // ── Branch 1: this provider id is already linked ───────────────────────────
  // The link was established by an earlier, separately-authorised flow, so
  // there is no linking decision to make. Deliberately the FIRST lookup: every
  // already-linked user reaches this and never touches the email path at all.
  const linked = await findByProviderId(provider, providerId);
  if (linked) {
    // Account lifecycle (Phase B1B): fail closed before any mutation or
    // token issuance for a non-active account. Never auto-reactivate.
    if (!isActiveAccountStatus(linked.accountStatus)) {
      return { kind: "accountDeactivated" };
    }

    // A provider that attests THIS account's own address may promote it to
    // verified. Requires an exact match against the account's stored address,
    // so an attested identity for some other address can never verify it.
    const promote =
      !linked.emailVerified &&
      emailTrust === "provider_attested" &&
      email !== null &&
      email === normalizeEmail(linked.email);

    const [updated] = await db
      .update(studentsTable)
      .set({
        ...avatarPatch(identity, linked),
        authProvider: provider,
        providerDisplayName: identity.name ?? linked.providerDisplayName,
        lastLoginAt: now,
        ...(promote ? { emailVerified: true, emailVerifiedAt: now } : {}),
      })
      .where(eq(studentsTable.id, linked.id))
      .returning();
    const student = updated!;
    return { kind: "ok", student, verified: student.emailVerified };
  }

  // ── Branch 2: the provider released no address ─────────────────────────────
  // There is nothing to match on, and a client-supplied address is not an
  // acceptable substitute (that was exploit variants V1/V2). No DB write.
  if (!email) return { kind: "needsEmail" };

  const existing = await findByEmail(email);

  // ── Branch 3: brand-new account ────────────────────────────────────────────
  // No pre-existing account is at risk, so a merely asserted address is fine
  // to seed with — it just does not count as verified, and the caller is sent
  // through the existing OTP flow by the handler below.
  if (!existing) {
    const attested = emailTrust === "provider_attested";
    const [created] = await db
      .insert(studentsTable)
      .values({
        name: identity.name ?? email.split("@")[0] ?? "Member",
        email,
        authProvider: provider,
        providerDisplayName: identity.name,
        ...providerPatch(provider, providerId),
        ...avatarPatch(identity),
        emailVerified: attested,
        emailVerifiedAt: attested ? now : null,
        lastLoginAt: now,
      })
      .returning();
    const student = created!;
    return { kind: "ok", student, verified: student.emailVerified };
  }

  // ── Branch 4: an account already exists for this address ───────────────────
  // Attaching a provider identity to it is an account-control decision, and
  // the ONLY acceptable proof at this stage is a provider attestation over
  // this exact address. `existing.emailVerified` is deliberately not consulted:
  // it records what the owner did in the past, not who is authenticating now.
  // Account lifecycle (Phase B1B): fail closed before any linking mutation
  // or token issuance. Checked before the attestation gate so a deactivated
  // account never leaks whether it would otherwise qualify for linking.
  if (!isActiveAccountStatus(existing.accountStatus)) {
    return { kind: "accountDeactivated" };
  }

  if (emailTrust !== "provider_attested") {
    return {
      kind: "linkVerificationRequired",
      maskedEmail: maskEmail(existing.email),
      targetStudentId: existing.id,
    };
  }

  // Never silently replace a different subject already linked for this
  // provider — that would evict the legitimate owner's identity.
  const alreadyLinkedId = readProviderId(existing, provider);
  if (alreadyLinkedId != null && alreadyLinkedId !== providerId) {
    return { kind: "providerAlreadyLinked" };
  }

  // Atomic link. One UPDATE, inside a transaction, behind a row lock — so a
  // mid-flow failure cannot leave a half-written link, and a concurrent
  // attempt cannot interleave between the check and the write.
  const linkResult = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, existing.id))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "vanished" as const };

    const currentId = readProviderId(locked, provider);
    if (currentId != null && currentId !== providerId) {
      return { kind: "conflict" as const };
    }

    const [updated] = await tx
      .update(studentsTable)
      .set({
        ...providerPatch(provider, providerId),
        ...avatarPatch(identity, locked),
        authProvider: provider,
        providerDisplayName: identity.name ?? locked.providerDisplayName,
        lastLoginAt: now,
        // The provider just attested this exact address, so promoting an
        // unverified account here is proof-backed, not flag-recycling.
        ...(locked.emailVerified ? {} : { emailVerified: true, emailVerifiedAt: now }),
      })
      .where(eq(studentsTable.id, locked.id))
      .returning();
    return { kind: "linked" as const, student: updated! };
  });

  if (linkResult.kind === "conflict") return { kind: "providerAlreadyLinked" };
  if (linkResult.kind === "vanished") return { kind: "needsEmail" };

  return { kind: "ok", student: linkResult.student, verified: linkResult.student.emailVerified };
}

// Accept the provider token under any of the conventional keys:
//   idToken     — Google ID token
//   accessToken — Facebook access token
//   token       — generic fallback (e.g. Apple identity token)
//
// Security-01B1: the `email` field is GONE. It was the account selector in
// exploit variants V1/V2 — a caller holding any valid provider token could
// name an arbitrary victim address and have the resolver find, link, and hand
// back a session for that account. zod strips unknown keys, so an older client
// that still sends `email` is accepted and the field is silently ignored
// rather than rejected. No shipped client sends it (verified across
// artifacts/central: useGoogleSignIn posts { idToken }, useFacebookSignIn
// posts { accessToken }, Apple has no call site at all).
//
// Do not reintroduce this field. If a client-collected address is ever needed
// for the Security-01B2 link challenge, it must arrive on a dedicated,
// challenge-bound endpoint — never as a selector on the sign-in path.
const SocialBody = z
  .object({
    token: z.string().min(1).optional(),
    idToken: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
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
        // Configuration details (missing env var names) are logged server-side
        // only — never advertised to unauthenticated clients (Security G-03).
        logger.error(
          { provider, requiredEnv: err.requiredEnv, err },
          "Social sign-in provider is not configured",
        );
        res.status(501).json({ error: "This sign-in method is not available." });
        return;
      }
      if (err instanceof ProviderTokenInvalidError) {
        res.status(401).json({ error: err.message });
        return;
      }
      throw err;
    }

    // 2. Resolve / link the account.
    const result = await resolveSocialLogin(identity);

    if (result.kind === "needsEmail") {
      // Unchanged response shape. Note it is now purely informational: there
      // is no longer any body field the client could re-submit to satisfy it.
      // Security-01B2 turns this into a real email-collection + OTP challenge.
      res.status(200).json({
        requiresEmail: true,
        provider,
        message: "This provider did not share an email. Please provide one to continue.",
      });
      return;
    }

    if (result.kind === "linkVerificationRequired") {
      // An account already exists for the address this provider returned, but
      // the provider does not attest ownership of it. Refuse — without writing
      // anything and without issuing a token of any kind.
      logger.warn(
        { provider, emailTrust: identity.emailTrust, targetStudentId: result.targetStudentId },
        "Social login refused: provider email is not attested for an existing account",
      );
      res.status(409).json({
        error:
          "An account already exists for the email this provider returned. " +
          "Additional verification is required before it can be linked.",
        code: "PROVIDER_LINK_VERIFICATION_REQUIRED",
        // Forward-compatible flag: Security-01B2 keeps this key and adds the
        // OTP challenge handle alongside it, so clients written against this
        // shape keep working.
        requiresLinkVerification: true,
        provider,
        maskedEmail: result.maskedEmail,
      });
      return;
    }

    if (result.kind === "accountDeactivated") {
      logger.info({ provider }, "Social login refused: account not active");
      res.status(401).json(ACCOUNT_DEACTIVATED_BODY);
      return;
    }

    if (result.kind === "providerAlreadyLinked") {
      logger.warn(
        { provider, emailTrust: identity.emailTrust },
        "Social login refused: account already linked to a different subject for this provider",
      );
      res.status(409).json({
        error:
          "This account is already linked to a different " +
          `${provider} identity. Please sign in with that account, or contact support.`,
        code: "PROVIDER_ALREADY_LINKED",
        provider,
      });
      return;
    }

    const { student, verified } = result;
    const accessToken = signStudentToken(student.id, student.email, verified, student.tokenVersion);

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
    res.json({ student: await publicStudent(student), accessToken, requiresOtp: !verified });
  };
}

router.post("/auth/google", makeHandler("google"));
router.post("/auth/apple", makeHandler("apple"));
router.post("/auth/facebook", makeHandler("facebook"));

export default router;
