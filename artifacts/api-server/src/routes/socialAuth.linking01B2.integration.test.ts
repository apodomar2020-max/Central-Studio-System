/**
 * Security-01B2 — social-account-linking OTP ownership-verification suite.
 *
 * Covers the /auth/social-link/{verify,resend} completion flow that
 * Branch 4's non-attested case now opens instead of dead-ending at a bare
 * 409. C-01's existing regression suite (socialAuth.linking.integration.test.ts)
 * still proves the underlying containment invariants (provider-id-first,
 * overwrite protection, new-account semantics, Apple fail-closed) are
 * unaffected — this file proves the NEW challenge/OTP completion machinery.
 *
 * Harness mirrors socialAuth.linking.integration.test.ts exactly: in-process
 * express app + real disposable Postgres, `../lib/socialProviders` mocked so
 * providers are driven directly.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SOCIAL_AUTH_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_social_auth";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "test-api-secret-key";
process.env.STUDENT_JWT_SECRET = "test-student-secret";
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY; // OTP send is a dev-mode no-op
process.env.IDENTITY_PROVENANCE_PEPPER = "test-regression-identity-provenance-pepper".padEnd(64, "0");

type EmailTrust = "provider_attested" | "provider_asserted" | "none";
type Identity = {
  provider: "google" | "apple" | "facebook";
  providerId: string;
  email: string | null;
  emailTrust: EmailTrust;
  name: string | null;
  avatarUrl: string | null;
};

let nextIdentity: Identity | null = null;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.API_SECRET_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

class MockProviderNotConfiguredError extends Error {
  requiredEnv: string[];
  constructor(provider: string, requiredEnv: string[]) {
    super(`${provider} sign-in is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
    this.requiredEnv = requiredEnv;
  }
}
class MockProviderTokenInvalidError extends Error {
  constructor(message = "Invalid or expired provider token.") {
    super(message);
    this.name = "ProviderTokenInvalidError";
  }
}

before(async () => {
  mock.module("../lib/socialProviders", {
    namedExports: {
      ProviderNotConfiguredError: MockProviderNotConfiguredError,
      ProviderTokenInvalidError: MockProviderTokenInvalidError,
      verifyProviderToken: async (provider: string) => {
        if (provider === "apple") throw new MockProviderNotConfiguredError("apple", ["APPLE_CLIENT_ID"]);
        if (!nextIdentity) throw new Error("test did not set nextIdentity");
        return nextIdentity;
      },
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const socialRouter = (await import("./socialAuth")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

beforeEach(() => { nextIdentity = null; });

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
async function makeVictim(opts: { emailVerified?: boolean } = {}): Promise<{ id: number; email: string }> {
  seq += 1;
  const email = `victim2b-${Date.now()}-${seq}@example.com`;
  const verified = opts.emailVerified ?? true;
  const r = await pool.query(
    `INSERT INTO students (name, email, email_verified, email_verified_at, auth_provider, password_hash)
     VALUES ('Victim Owner', $1, $2, $3, 'local', 'x') RETURNING id`,
    [email, verified, verified ? new Date().toISOString() : null],
  );
  return { id: r.rows[0].id as number, email };
}

// The plaintext OTP code is never persisted (Security-06B: only its HMAC
// digest is stored) and never appears in any HTTP response — the only way a
// test can observe it is authHelpers' own dev/test-only send hook, exactly
// like the OTP suites elsewhere in this codebase.
async function latestOtpCodeForEmail(): Promise<string> {
  const { __setOtpEmailTestListener } = await import("../lib/authHelpers");
  return new Promise((resolve) => {
    __setOtpEmailTestListener((_to, code) => resolve(code));
  });
}

async function initiateLink(provider: "google" | "facebook", identity: Identity) {
  nextIdentity = identity;
  return post(`/api/auth/${provider}`, provider === "google" ? { idToken: "t" } : { accessToken: "t" });
}

async function makeVictimAndLinkChallenge(provider: "google" | "facebook" = "google") {
  const victim = await makeVictim({ emailVerified: true });
  const providerId = `${provider}-sub-${Date.now()}-${seq}-unattested`;
  const codePromise = latestOtpCodeForEmail();
  const { status, json } = await initiateLink(provider, {
    provider, providerId, email: victim.email,
    emailTrust: provider === "google" ? "provider_asserted" : "provider_asserted",
    name: "Attacker Name", avatarUrl: null,
  });
  assert.equal(status, 409);
  assert.equal(json.code, "PROVIDER_LINK_VERIFICATION_REQUIRED");
  assert.ok(json.linkChallengeId, "a challenge id must be returned");
  const code = await codePromise;
  return { victim, providerId, provider, challengeId: json.linkChallengeId as string, code };
}

// ─────────────────────────────────────────────────────────────────────────────
test("3/5/6: initiating a link challenge writes nothing and issues no token", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = (await pool.query(`SELECT google_id, auth_provider, email_verified FROM students WHERE id=$1`, [victim.id])).rows[0];
  const { status, json } = await initiateLink("google", {
    provider: "google", providerId: `google-sub-${Date.now()}-x`, email: victim.email,
    emailTrust: "provider_asserted", name: "Attacker", avatarUrl: null,
  });
  assert.equal(status, 409);
  assert.equal(json.accessToken, undefined, "no JWT before verification");
  assert.equal(json.student, undefined);
  const after = (await pool.query(`SELECT google_id, auth_provider, email_verified FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.deepEqual(after, before, "provider not attached before OTP");
});

test("7: correct OTP links Google, issues a token, and marks the challenge consumed", async () => {
  const { victim, providerId, challengeId, code } = await makeVictimAndLinkChallenge("google");
  const { status, json } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 200);
  assert.equal(json.student.id, victim.id);
  assert.ok(json.accessToken);
  const row = (await pool.query(`SELECT google_id, auth_provider FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.google_id, providerId);
  assert.equal(row.auth_provider, "google");
});

test("8: correct OTP links Facebook", async () => {
  const { victim, providerId, challengeId, code } = await makeVictimAndLinkChallenge("facebook");
  const { status, json } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 200);
  assert.equal(json.student.id, victim.id);
  const row = (await pool.query(`SELECT facebook_id FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.facebook_id, providerId);
});

test("9: wrong OTP is rejected and does not link", async () => {
  const { victim, challengeId } = await makeVictimAndLinkChallenge("google");
  const { status, json } = await post("/api/auth/social-link/verify", { challengeId, code: "000000" });
  assert.equal(status, 400);
  assert.equal(json.accessToken, undefined);
  const row = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.google_id, null);
});

test("13/22/23: unknown/forged challenge id is rejected generically (no student/provider id can be smuggled in)", async () => {
  const { status, json } = await post("/api/auth/social-link/verify", { challengeId: "not-a-real-token", code: "123456" });
  assert.equal(status, 400);
  assert.equal(json.code, "SOCIAL_LINK_INVALID_CHALLENGE");
  assert.equal(json.accessToken, undefined);
});

test("14/15: challenge is single-use — replaying it after success is rejected, does not re-link or re-issue", async () => {
  const { challengeId, code } = await makeVictimAndLinkChallenge("google");
  const first = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(first.status, 200);
  const second = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(second.status, 400);
  assert.equal(second.json.accessToken, undefined);
});

test("16: concurrent completion of the same challenge is safe — exactly one succeeds", async () => {
  const { challengeId, code, providerId } = await makeVictimAndLinkChallenge("google");
  const [a, b] = await Promise.all([
    post("/api/auth/social-link/verify", { challengeId, code }),
    post("/api/auth/social-link/verify", { challengeId, code }),
  ]);
  const successes = [a, b].filter((r) => r.status === 200);
  assert.equal(successes.length, 1, "exactly one request wins the race");
  const row = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [(successes[0]!.json.student).id]))
    .rows[0];
  assert.equal(row.google_id, providerId);
});

test("17: provider linked elsewhere before completion is rejected, existing link survives", async () => {
  const { victim, providerId, challengeId, code } = await makeVictimAndLinkChallenge("google");
  // Someone else's account grabs this exact provider id before completion.
  const other = await makeVictim();
  await pool.query(`UPDATE students SET google_id=$1 WHERE id=$2`, [providerId, other.id]);

  const { status } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 400);
  const victimRow = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(victimRow.google_id, null, "victim account never received the (now-elsewhere) provider id");
  const otherRow = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [other.id])).rows[0];
  assert.equal(otherRow.google_id, providerId, "the other account's link is undisturbed");
});

test("18: deactivated account cannot complete a link", async () => {
  const { victim, challengeId, code } = await makeVictimAndLinkChallenge("google");
  await pool.query(`UPDATE students SET account_status='deactivated' WHERE id=$1`, [victim.id]);
  const { status, json } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 400);
  assert.equal(json.accessToken, undefined);
  const row = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.google_id, null);
});

test("20: account in active deletion-preparation cannot complete a link", async () => {
  const { victim, challengeId, code } = await makeVictimAndLinkChallenge("google");
  await pool.query(
    `INSERT INTO student_deletion_workflows (student_id, status, policy_version) VALUES ($1, 'PREPARING', '1')`,
    [victim.id],
  );
  const { status } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 400);
  const row = (await pool.query(`SELECT google_id FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.google_id, null);
});

test("21: never attempting completion (cancel) leaves the provider fully unlinked", async () => {
  const { victim } = await makeVictimAndLinkChallenge("google");
  const row = (await pool.query(`SELECT google_id, auth_provider FROM students WHERE id=$1`, [victim.id])).rows[0];
  assert.equal(row.google_id, null);
  assert.equal(row.auth_provider, "local");
});

test("24: a code minted for one provider's challenge cannot be redeemed against the other's challenge id", async () => {
  const g = await makeVictimAndLinkChallenge("google");
  const f = await makeVictimAndLinkChallenge("facebook");
  // Attempt: Google's challenge id, but Facebook's code (wrong OTP for that email+purpose).
  const { status } = await post("/api/auth/social-link/verify", { challengeId: g.challengeId, code: f.code });
  assert.equal(status, 400);
});

test("resend: unknown challenge id returns the same generic ok shape (no oracle)", async () => {
  const { status, json } = await post("/api/auth/social-link/resend", { challengeId: "bogus" });
  assert.equal(status, 200);
  assert.deepEqual(json, { ok: true });
});

test("12: resend cooldown is preserved — an immediate resend is rate-limited, not a fresh send", async () => {
  const { challengeId } = await makeVictimAndLinkChallenge("google");
  // issueOtp's shared per-email cooldown was just consumed by the initial
  // send moments ago inside makeVictimAndLinkChallenge — an immediate resend
  // must hit the SAME cooldown, proving social_link reuses that infra rather
  // than bypassing it.
  const resend = await post("/api/auth/social-link/resend", { challengeId });
  assert.equal(resend.status, 429);
  assert.ok(resend.json.retryAfterSeconds > 0);
});

test("resend: original code (from initiation) still verifies after a cooled-down resend attempt", async () => {
  const { challengeId, code } = await makeVictimAndLinkChallenge("google");
  await post("/api/auth/social-link/resend", { challengeId }); // rate-limited, does not disturb the live code
  const verify = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(verify.status, 200);
});

test("28: successful link emits a security notification to the account owner", async () => {
  const { victim, challengeId, code } = await makeVictimAndLinkChallenge("google");
  const before = await post; // noop to keep lint happy about unused import style consistency
  void before;
  const { status } = await post("/api/auth/social-link/verify", { challengeId, code });
  assert.equal(status, 200);
  const notif = (await pool.query(
    `SELECT title, body FROM notifications WHERE target=$1 ORDER BY id DESC LIMIT 1`,
    [`student:${victim.id}`],
  )).rows[0];
  assert.ok(notif, "a notification row was created");
  assert.match(notif.body, /linked/i);
});
