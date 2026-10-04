import { createHash, randomBytes } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { and, eq, gt, lt, lte, or, isNull, asc, sql } from "drizzle-orm";
import { db, appleAuthChallengesTable, appleCredentialsTable, studentsTable } from "@workspace/db";
import { validateAppleIdentity } from "./appleIdentity";
import { encryptThirdPartyToken, decryptThirdPartyToken, tokenEncryptionKeyringFromEnv, type EncryptedTokenEnvelope } from "./thirdPartyTokenCrypto";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const context = (subject: string) => `apple-refresh:${subject}`;
export const APPLE_MANUAL_REVOCATION = "On your iPhone, open Settings > your name > Sign in with Apple > Central Studio > Stop Using Sign in with Apple. You can also manage this at account.apple.com under Sign-In and Security.";
export class AppleServiceError extends Error {
  constructor() { super("Apple authorization is temporarily unavailable."); this.name = "AppleServiceError"; }
}
export async function createAppleChallenge() {
  const challengeId = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("hex");
  await db.delete(appleAuthChallengesTable).where(lt(appleAuthChallengesTable.expiresAt, new Date().toISOString()));
  await db.insert(appleAuthChallengesTable).values({ tokenHash: hash(challengeId), nonce, expiresAt: new Date(Date.now() + 300000).toISOString() });
  return { challengeId, nonce, expiresIn: 300 };
}
export async function consumeAppleChallenge(challengeId: string): Promise<string> {
  const [challenge] = await db.delete(appleAuthChallengesTable).where(and(
    eq(appleAuthChallengesTable.tokenHash, hash(challengeId)), gt(appleAuthChallengesTable.expiresAt, new Date().toISOString()),
  )).returning();
  if (!challenge) throw new AppleServiceError();
  return challenge.nonce;
}
async function clientSecret() {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID } = process.env;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !APPLE_CLIENT_ID) throw new AppleServiceError();
  const key = await importPKCS8(APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: APPLE_KEY_ID }).setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_CLIENT_ID).setAudience("https://appleid.apple.com").setIssuedAt().setExpirationTime("5m").sign(key);
}
async function appleRequest(path: "token" | "revoke", fields: Record<string, string>): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`https://appleid.apple.com/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: process.env.APPLE_CLIENT_ID!, client_secret: await clientSecret() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new AppleServiceError();
    return path === "revoke" ? {} : await response.json() as Record<string, unknown>;
  } catch { throw new AppleServiceError(); }
}
export async function exchangeAppleCode(code: string, subject: string, nonce: string): Promise<EncryptedTokenEnvelope> {
  const keyring = tokenEncryptionKeyringFromEnv();
  const result = await appleRequest("token", { code, grant_type: "authorization_code" });
  if (typeof result.id_token !== "string" || typeof result.refresh_token !== "string") throw new AppleServiceError();
  const identity = await validateAppleIdentity(result.id_token, process.env.APPLE_CLIENT_ID!, nonce);
  if (identity.sub !== subject) throw new AppleServiceError();
  return encryptThirdPartyToken(result.refresh_token, context(subject), keyring);
}
export async function persistAppleCredential(subject: string, envelope: EncryptedTokenEnvelope) {
  await db.transaction(async tx => {
    const [owner] = await tx.select().from(studentsTable).where(eq(studentsTable.appleId, subject)).for("update");
    if (owner && owner.accountStatus !== "active") throw new AppleServiceError();
    const [existing] = await tx.select().from(appleCredentialsTable).where(eq(appleCredentialsTable.subject, subject)).for("update");
    if (existing?.state === "revoke_pending") throw new AppleServiceError();
    const now = new Date().toISOString();
    await tx.insert(appleCredentialsTable).values({ subject, ...envelope, studentId: owner?.id ?? null,
      expiresAt: owner ? null : new Date(Date.now() + 86400000).toISOString(), updatedAt: now,
    }).onConflictDoUpdate({ target: appleCredentialsTable.subject, set: {
      ...envelope, studentId: owner?.id ?? null, state: "active", attempts: 0, retryAt: null,
      expiresAt: owner ? null : new Date(Date.now() + 86400000).toISOString(), updatedAt: now,
    }, setWhere: eq(appleCredentialsTable.state, "active") });
  });
}
export async function attachAppleCredential(executor: Executor, studentId: number, subject: string) {
  await executor.update(appleCredentialsTable).set({ studentId, expiresAt: null }).where(and(
    eq(appleCredentialsTable.subject, subject), eq(appleCredentialsTable.state, "active"),
  ));
}
export async function markAppleRevocation(executor: Executor, studentId: number) {
  const rows = await executor.update(appleCredentialsTable).set({ state: "revoke_pending", retryAt: new Date().toISOString() })
    .where(eq(appleCredentialsTable.studentId, studentId)).returning({ subject: appleCredentialsTable.subject });
  return rows.length > 0;
}
export async function reconcileAppleRevocations(studentId?: number) {
  await db.delete(appleCredentialsTable).where(and(isNull(appleCredentialsTable.studentId), lt(appleCredentialsTable.expiresAt, new Date().toISOString())));
  const pending = await db.select().from(appleCredentialsTable).where(and(eq(appleCredentialsTable.state, "revoke_pending"), studentId === undefined ? undefined : eq(appleCredentialsTable.studentId, studentId),
    or(isNull(appleCredentialsTable.retryAt), lte(appleCredentialsTable.retryAt, new Date().toISOString())))).orderBy(asc(appleCredentialsTable.retryAt)).limit(25);
  for (const row of pending) {
    try {
      const token = decryptThirdPartyToken(row, context(row.subject), tokenEncryptionKeyringFromEnv());
      await appleRequest("revoke", { token, token_type_hint: "refresh_token" });
      await db.transaction(async tx => {
        await tx.delete(appleCredentialsTable).where(and(eq(appleCredentialsTable.subject, row.subject), eq(appleCredentialsTable.state, "revoke_pending")));
        await tx.execute(sql`UPDATE customer_deletion_requests SET apple_revocation = 'revoked' WHERE student_id = ${row.studentId} AND apple_revocation = 'pending'`);
      });
    } catch {
      if (row.attempts >= 10) {
        await db.transaction(async tx => {
          await tx.delete(appleCredentialsTable).where(and(eq(appleCredentialsTable.subject, row.subject), eq(appleCredentialsTable.state, "revoke_pending")));
          await tx.execute(sql`UPDATE customer_deletion_requests SET apple_revocation = 'manual_required' WHERE student_id = ${row.studentId} AND apple_revocation = 'pending'`);
        });
      } else {
        await db.update(appleCredentialsTable).set({ attempts: row.attempts + 1,
          retryAt: new Date(Date.now() + Math.min(86400000, 60000 * 2 ** row.attempts)).toISOString(),
        }).where(and(eq(appleCredentialsTable.subject, row.subject), eq(appleCredentialsTable.state, "revoke_pending")));
      }
    }
  }
}
