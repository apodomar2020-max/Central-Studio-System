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
 *               • anything else        → 409 PROVIDER_LINK_VERIFICATION_REQUIRED,
 *                 PLUS (Security-01B2) a short-lived opaque `linkChallengeId`
 *                 and an OTP sent to the EXISTING account's email. NOTHING is
 *                 written yet: no provider id, no auth_provider, no display
 *                 name, no avatar, no email_verified_at. NO token of any kind
 *                 is issued. The provider identity may only attach once the
 *                 account owner proves control by completing that OTP via
 *                 POST /auth/social-link/verify (see below).
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
 * ─── Security-01B2 — OTP ownership-verification linking ─────────────────────
 *
 * Branch 4's non-attested case no longer dead-ends at a bare 409: it opens a
 * server-authoritative `social_link_challenges` row (lib/socialLinkChallenge.ts)
 * binding exactly {studentId, provider, providerId} as verified moments ago —
 * never anything the client supplies — and sends an OTP to the EXISTING
 * account's own email (never a client-supplied address). The client's only
 * job from there is to hand back the opaque challenge id plus the code the
 * account owner received. Completion re-validates every precondition inside
 * one transaction (challenge live, account still active/not mid-deletion-
 * prep, provider subject still unlinked) before atomically attaching the
 * provider id and issuing a token — see /auth/social-link/verify below.
 *
 * Apple stays fail-closed (socialProviders.ts throws before any of this runs).
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, studentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { isActiveAccountStatus } from "../lib/studentAccountStatus";
import {
  signStudentToken,
  issueOtp,
  invalidateOtpCodes,
  verifyOtpCode,
  OtpRateLimitError,
} from "../lib/authHelpers";
import { publicStudent } from "../lib/studentProfileResponse";
import { openInitialProvenanceInterval } from "../lib/studentEmailChangeService";
import { getActivePreparation } from "../lib/studentDeletionPreparation";
import {
  createSocialLinkChallenge,
  findPendingChallenge,
  consumeChallenge,
  invalidateChallenge,
} from "../lib/socialLinkChallenge";
import { createStudentNotification } from "../lib/notifications";
import { ipRateLimiter } from "../middlewares/authRateLimit";
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
  | { kind: "linkVerificationRequired"; maskedEmail: string; targetStudentId: number; provider: ProviderName; providerId: string }
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
    // Phase B3B0-1A completion (Section F/G): the student INSERT and the
    // initial provenance interval are atomic (same transaction). This does
    // NOT add a new trust boundary — `email` here is already the exact
    // value about to be stored as students.email under this branch's
    // existing (unchanged) trust rules, whether or not it is
    // provider-attested/emailVerified. Provenance simply mirrors that same
    // already-happening, already-trusted insert; it never runs ahead of it.
    const student = await db.transaction(async (tx) => {
      const [row] = await tx
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
      const created = row!;
      await openInitialProvenanceInterval(tx, {
        studentId: created.id,
        email: created.email,
        source: "registration",
        validFrom: created.createdAt,
      });
      return created;
    });
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
      provider,
      providerId,
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
      // the provider does not attest ownership of it. Still write NOTHING to
      // the account and issue NO token — instead open a short-lived
      // server-authoritative challenge and send an OTP to the EXISTING
      // account's own email (never the provider-supplied one) so its real
      // owner, not this caller, must prove control before anything attaches.
      let challenge: { challengeId: string; expiresIn: number } | null = null;
      try {
        challenge = await createSocialLinkChallenge({
          studentId: result.targetStudentId,
          provider: result.provider,
          providerId: result.providerId,
        });
        const [target] = await db
          .select({ email: studentsTable.email })
          .from(studentsTable)
          .where(eq(studentsTable.id, result.targetStudentId));
        if (target) {
          await issueOtp(target.email, { studentId: result.targetStudentId, purpose: "social_link" });
        }
      } catch (err) {
        // A recent code already exists (cooldown) — the challenge itself was
        // still created, so completion can proceed against the still-live code.
        if (!(err instanceof OtpRateLimitError)) {
          logger.error({ err, provider }, "Failed to open social-link challenge / send OTP");
          // Fail closed: no challenge id is disclosed if we cannot be sure an
          // OTP is actually on its way, or if the challenge itself never got
          // created (provider-unavailable style outage — additive, does not
          // relax any other check).
          res.status(503).json({ error: "Verification is temporarily unavailable. Please try again later." });
          return;
        }
      }

      logger.warn(
        { provider, emailTrust: identity.emailTrust, targetStudentId: result.targetStudentId },
        "Social login refused: provider email is not attested for an existing account — OTP link challenge issued",
      );
      res.status(409).json({
        error:
          "An account already exists for the email this provider returned. " +
          "Additional verification is required before it can be linked.",
        code: "PROVIDER_LINK_VERIFICATION_REQUIRED",
        requiresLinkVerification: true,
        provider,
        maskedEmail: result.maskedEmail,
        // Security-01B2: opaque, single-use, short-lived handle for
        // POST /auth/social-link/verify. Carries no account metadata itself.
        linkChallengeId: challenge?.challengeId,
        expiresIn: challenge?.expiresIn,
      });
      return;
    }

    if (result.kind === "accountDeactivated") {
      // Account-enumeration hardening (Security Wave — Auth Abuse
      // Foundation): generic body, does not confirm account_status/
      // existence. Server-side enforcement (the isActiveAccountStatus gate
      // inside resolveSocialLogin) is unchanged — only the outward message
      // no longer says "deactivated".
      logger.info({ provider }, "Social login refused: account not active");
      res.status(401).json({ error: "This account is not available for sign-in." });
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

function limitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const socialAuthIpLimiter = ipRateLimiter("social-auth", { limit: limitEnv("AUTH_SOCIAL_IP_LIMIT", 60), windowSeconds: 15 * 60 });

router.post("/auth/google", socialAuthIpLimiter, makeHandler("google"));
router.post("/auth/apple", socialAuthIpLimiter, makeHandler("apple"));
router.post("/auth/facebook", socialAuthIpLimiter, makeHandler("facebook"));

// ─── Security-01B2 — social-link OTP completion / resend ─────────────────────
//
// These are the ONLY endpoints that may act on a social_link_challenges row.
// The client authenticates itself purely by possession of the opaque
// challenge id (findPendingChallenge hashes it and looks up by digest) —
// there is no student JWT yet at this point in the flow, by design (no token
// has been issued; issuing one is exactly what completion is gating). A
// forged/guessed studentId or providerId in the request body is impossible
// to exploit because neither is ever read from the body — every fact used to
// perform the link comes from the challenge row itself, re-validated fresh
// inside the completion transaction.
const socialLinkIpLimiter = ipRateLimiter("social-link", { limit: limitEnv("AUTH_SOCIAL_LINK_IP_LIMIT", 30), windowSeconds: 15 * 60 });

const SocialLinkVerifyBody = z.object({
  challengeId: z.string().min(1),
  code: z.string().length(6, "Code must be exactly 6 digits"),
});

router.post("/auth/social-link/verify", socialLinkIpLimiter, async (req, res): Promise<void> => {
  const parsed = SocialLinkVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { challengeId, code } = parsed.data;

  // Generic, single-shape rejection for every "this can't proceed" case, so
  // an attacker probing challenge ids/codes cannot distinguish "wrong code"
  // from "challenge doesn't exist" from "challenge already used" from
  // "account no longer eligible" — all collapse to the same 400.
  const REJECTED = {
    status: 400 as const,
    body: { error: "This verification code is invalid or has expired.", code: "SOCIAL_LINK_INVALID_CHALLENGE" as const },
  };

  const outcome = await db.transaction(async (tx) => {
    const challenge = await findPendingChallenge(tx, challengeId, { lock: true });
    if (!challenge) return { kind: "rejected" as const };

    const [student] = await tx
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, challenge.studentId))
      .for("update")
      .limit(1);
    if (!student) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }

    // Re-check every precondition fresh, inside the lock — never trust
    // anything captured at challenge-creation time to still hold.
    if (!isActiveAccountStatus(student.accountStatus)) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }
    const activePreparation = await getActivePreparation(tx, student.id);
    if (activePreparation) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }
    const provider = challenge.provider as ProviderName;
    const challengeProviderId = challenge.providerId;
    const challengeRowId = challenge.id;

    // "Still unlinked" must be checked against the ENTIRE table, not just
    // this row: the provider subject could have been claimed by a DIFFERENT
    // account since the challenge was issued (its own attested sign-in, or
    // another concurrent link-completion elsewhere). Locking this row alone
    // would not see that.
    async function providerSubjectConflict(): Promise<boolean> {
      const [claimedBy] = await tx
        .select({ id: studentsTable.id })
        .from(studentsTable)
        .where(eq(providerColumn[provider], challengeProviderId))
        .for("update")
        .limit(1);
      return !!claimedBy && claimedBy.id !== student.id;
    }

    if (await providerSubjectConflict()) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }

    const verifyResult = await verifyOtpCode(student.email, code, "social_link");
    if (verifyResult.status !== "ok") {
      // Do NOT invalidate the challenge itself on a wrong/expired code — the
      // OTP's own attempt-limit/expiry governs retries, exactly like every
      // other OTP purpose. Only state changes that make the challenge itself
      // stale invalidate it.
      return { kind: "otpFailed" as const, verifyResult };
    }

    // Re-check one more time immediately before the write — the OTP verify
    // step itself took time, and a lock-free window opened between the
    // conflict check above and here.
    if (await providerSubjectConflict()) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }

    const [locked] = await tx
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, student.id))
      .for("update")
      .limit(1);
    if (!locked) {
      await invalidateChallenge(tx, challenge.id);
      return { kind: "rejected" as const };
    }

    const [updated] = await tx
      .update(studentsTable)
      .set({
        ...providerPatch(provider, challenge.providerId),
        authProvider: provider,
        lastLoginAt: new Date().toISOString(),
        // OTP delivered to and verified against the account's OWN email is
        // itself an ownership proof — promote unverified accounts exactly as
        // the direct-attested path does.
        ...(locked.emailVerified ? {} : { emailVerified: true, emailVerifiedAt: new Date().toISOString() }),
      })
      .where(eq(studentsTable.id, locked.id))
      .returning();

    await consumeChallenge(tx, challenge.id);
    return { kind: "linked" as const, student: updated!, provider };
  });

  if (outcome.kind === "rejected") {
    res.status(REJECTED.status).json(REJECTED.body);
    return;
  }
  if (outcome.kind === "otpFailed") {
    switch (outcome.verifyResult.status) {
      case "invalid":
        res.status(400).json({ error: "Incorrect code. Please try again.", attemptsLeft: outcome.verifyResult.attemptsLeft });
        return;
      case "expired":
        res.status(400).json({ error: "Code expired. Please request a new one.", requiresResend: true });
        return;
      case "locked":
        res.status(429).json({ error: "Too many incorrect attempts. Please request a new code.", requiresResend: true });
        return;
    }
    return;
  }

  const { student, provider } = outcome;
  const accessToken = signStudentToken(student.id, student.email, student.emailVerified, student.tokenVersion);

  logger.info({ studentId: student.id, provider, action: "social_link_completed" }, "Social account linked after OTP ownership verification");

  // Best-effort: a notification-delivery failure must never undo or block an
  // already-successful, already-committed link.
  try {
    await createStudentNotification(db, {
      studentId: student.id,
      title: "Sign-in method linked",
      body: `A ${provider === "google" ? "Google" : "Facebook"} account was linked to your Central Studio account.`,
      type: "security",
      source: "system",
    });
  } catch (err) {
    logger.warn({ err, studentId: student.id }, "Social-link security notification failed to send (link itself succeeded)");
  }

  res.json({ student: await publicStudent(student), accessToken, requiresOtp: !student.emailVerified });
});

const SocialLinkResendBody = z.object({ challengeId: z.string().min(1) });

router.post("/auth/social-link/resend", socialLinkIpLimiter, async (req, res): Promise<void> => {
  const parsed = SocialLinkResendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const challenge = await findPendingChallenge(db, parsed.data.challengeId);
  // Generic response regardless of whether the challenge is live — never an
  // existence oracle for challenge ids.
  const GENERIC = { ok: true };
  if (!challenge) {
    res.json(GENERIC);
    return;
  }

  const [student] = await db
    .select({ email: studentsTable.email, accountStatus: studentsTable.accountStatus })
    .from(studentsTable)
    .where(eq(studentsTable.id, challenge.studentId));
  if (!student || !isActiveAccountStatus(student.accountStatus)) {
    res.json(GENERIC);
    return;
  }

  try {
    await issueOtp(student.email, { studentId: challenge.studentId, purpose: "social_link" });
  } catch (err) {
    if (err instanceof OtpRateLimitError) {
      res.status(429).json({ error: err.message, retryAfter: err.retryAfterSeconds, retryAfterSeconds: err.retryAfterSeconds });
      return;
    }
    await invalidateOtpCodes(student.email, "social_link");
    logger.error({ err }, "Social-link OTP resend failed");
    res.status(503).json({ error: "Verification is temporarily unavailable. Please try again later." });
    return;
  }
  res.json(GENERIC);
});

export default router;
