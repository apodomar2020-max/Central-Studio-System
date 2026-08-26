/**
 * Security-01B2 — social-account-linking OTP-ownership challenges.
 *
 * A challenge is created ONLY by routes/socialAuth.ts when a verified
 * provider identity's email matches a pre-existing account but the provider
 * does not attest ownership of that address (Branch 4, non-attested case).
 * It binds exactly the server-derived facts that matter — target student,
 * provider, provider subject id — and nothing the client supplied is ever
 * trusted into it.
 *
 * The opaque token returned to the client is a random 256-bit value; only
 * its SHA-256 digest is persisted (same pattern as
 * lib/installationUnregister.ts). Completion (routes/socialAuth.ts's
 * /auth/social-link/verify) can therefore only proceed with knowledge of
 * that exact value — never by supplying student/provider ids directly.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, socialLinkChallengesTable, type SocialLinkChallenge } from "@workspace/db";
import type { ProviderName } from "./socialProviders";

const TOKEN_BYTES = 32;
const CHALLENGE_TTL_SECONDS = 10 * 60; // 10 minutes — short-lived by design.

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Create a new pending challenge for (studentId, provider, providerId) and
 * return the opaque token to hand back to the client. The raw token is never
 * stored — only its digest.
 */
export async function createSocialLinkChallenge(params: {
  studentId: number;
  provider: ProviderName;
  providerId: string;
}): Promise<{ challengeId: string; expiresIn: number }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();

  await db.insert(socialLinkChallengesTable).values({
    studentId: params.studentId,
    provider: params.provider,
    providerId: params.providerId,
    tokenHash: hashToken(token),
    status: "pending",
    expiresAt,
  });

  return { challengeId: token, expiresIn: CHALLENGE_TTL_SECONDS };
}

/**
 * Look up (and, when `lock` is set, row-lock) the live pending challenge for
 * an opaque token, using the given executor so a caller already inside a
 * transaction reads through the same connection. Returns null for a
 * missing/consumed/expired token — callers must treat every null the same
 * way (generic rejection), never distinguishing "not found" from "expired"
 * outwardly, to avoid turning this into an existence oracle.
 */
export async function findPendingChallenge(
  executor: Executor,
  token: string,
  opts: { lock?: boolean } = {},
): Promise<SocialLinkChallenge | null> {
  if (!token || typeof token !== "string") return null;
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  let query = executor
    .select()
    .from(socialLinkChallengesTable)
    .where(and(
      eq(socialLinkChallengesTable.tokenHash, tokenHash),
      eq(socialLinkChallengesTable.status, "pending"),
      gt(socialLinkChallengesTable.expiresAt, now),
    ))
    .limit(1);
  if (opts.lock) query = query.for("update") as typeof query;

  const [row] = await query;
  return row ?? null;
}

/** Mark a challenge consumed. Idempotent-safe: only affects a still-pending row. */
export async function consumeChallenge(executor: Executor, id: number): Promise<void> {
  await executor
    .update(socialLinkChallengesTable)
    .set({ status: "consumed", consumedAt: new Date().toISOString() })
    .where(and(eq(socialLinkChallengesTable.id, id), eq(socialLinkChallengesTable.status, "pending")));
}

/**
 * Mark a challenge expired/invalidated without linking — used when a
 * completion attempt discovers the underlying state has moved on (provider
 * became linked elsewhere, account deactivated, etc.) so the same challenge
 * cannot be retried against a since-changed reality.
 */
export async function invalidateChallenge(executor: Executor, id: number): Promise<void> {
  await executor
    .update(socialLinkChallengesTable)
    .set({ status: "expired" })
    .where(and(eq(socialLinkChallengesTable.id, id), eq(socialLinkChallengesTable.status, "pending")));
}
