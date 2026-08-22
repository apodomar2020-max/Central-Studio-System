/**
 * Security-02B — CS-SEC-H-03 student session revocation.
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * requireAuth middleware and the actual auth/emailOtp/socialAuth routers
 * (socialAuth's provider verification is mocked — same pattern as
 * socialAuth.linking.integration.test.ts — nothing about revocation itself
 * is mocked).
 *
 * Sections mirror the Security-02B brief:
 *   A. Legacy rollout
 *   B. Password reset
 *   C. Password change
 *   D. Logout
 *   E. Social tokens
 *   F. Verification status (requireVerifiedStudent interaction)
 *   G. Concurrency / atomicity
 *
 * Section H (admin RBAC unaffected) is verified by re-running
 * adminAuth.integration.test.ts unchanged, not duplicated here.
 *
 * Requires --experimental-test-module-mocks (mocks only ../lib/socialProviders,
 * for section E).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDENT_SESSION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_student_session";

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
process.env.OTP_PEPPER = "test-session-revocation-otp-pepper".padEnd(64, "0");
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY; // dev-mode no-op path for OTP/security emails

type Identity = {
  provider: "google" | "apple" | "facebook";
  providerId: string;
  email: string | null;
  emailTrust: "provider_attested" | "provider_asserted" | "none";
  name: string | null;
  avatarUrl: string | null;
};
let nextIdentity: Identity | null = null;

class MockProviderNotConfiguredError extends Error {
  requiredEnv: string[];
  constructor(provider: string, requiredEnv: string[]) {
    super(`${provider} sign-in is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
    this.requiredEnv = requiredEnv;
  }
}

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

// requireAuth gates every /api route except /healthz and /version. A student
// JWT satisfies it directly; otherwise the shared API key is required.
type ApiResult = { status: number; json: any };
async function post(path: string, body: unknown, token?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token ?? process.env.API_SECRET_KEY}`,
  };
  const res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path: string, token?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token ?? process.env.API_SECRET_KEY}`,
  };
  const res = await fetch(apiUrl(path), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function put(path: string, body: unknown, token?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token ?? process.env.API_SECRET_KEY}`,
  };
  const res = await fetch(apiUrl(path), { method: "PUT", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  mock.module("../lib/socialProviders", {
    namedExports: {
      ProviderNotConfiguredError: MockProviderNotConfiguredError,
      ProviderTokenInvalidError: class ProviderTokenInvalidError extends Error {},
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
  const authRouter = (await import("./auth")).default;
  const emailOtpRouter = (await import("./emailOtp")).default;
  const socialAuthRouter = (await import("./socialAuth")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", authRouter);
  app.use("/api", emailOtpRouter);
  app.use("/api", socialAuthRouter);
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
function freshEmail(tag: string): string {
  seq += 1;
  return `sr-${tag}-${Date.now()}-${seq}@example.com`;
}

function decodeJwt(token: string): any {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

/** Registers, verifies, and returns { studentId, token, email } for a fresh account. */
async function makeVerifiedStudent(tag: string, password = "OriginalPass123") {
  const email = freshEmail(tag);
  const reg = await post("/api/auth/register", { name: "Session Test User", email, password });
  assert.equal(reg.status, 201);
  const studentId: number = reg.json.student.id;
  await pool.query(`UPDATE students SET email_verified = true, email_verified_at = now() WHERE id = $1`, [studentId]);
  // Re-login to obtain a FULL token reflecting the verified state (register's
  // token is deliberately limited).
  const login = await post("/api/auth/login", { email, password });
  assert.equal(login.status, 200);
  return { studentId, token: login.json.accessToken as string, email, password };
}

async function currentDbVersion(studentId: number): Promise<number> {
  const r = await pool.query(`SELECT token_version FROM students WHERE id = $1`, [studentId]);
  return r.rows[0].token_version as number;
}

/** Mints a JWT by hand with an arbitrary payload — used to simulate legacy
 *  tokens that never had a tokenVersion claim at all. */
async function signRawStudentToken(payload: Record<string, unknown>): Promise<string> {
  const jwtModule = await import("jsonwebtoken");
  return jwtModule.default.sign(payload, process.env.STUDENT_JWT_SECRET!, { expiresIn: "30d" });
}

// ═════════════════════════════════════════════════════════════════════════════
// A. Legacy rollout
// ═════════════════════════════════════════════════════════════════════════════

test("A1: legacy JWT with no tokenVersion claim + DB version 1 authenticates", async () => {
  const { studentId, email } = await makeVerifiedStudent("legacy1");
  assert.equal(await currentDbVersion(studentId), 1, "sanity: every account starts at version 1");

  const legacyToken = await signRawStudentToken({ sub: studentId, email, type: "student", emailVerified: true });
  // No `tokenVersion` key at all — exactly what every token issued before
  // this feature looks like.
  assert.equal(decodeJwt(legacyToken).tokenVersion, undefined, "sanity: genuinely no claim");

  const res = await get("/api/auth/me", legacyToken);
  assert.equal(res.status, 200, "absent claim is treated as version 1 and matches the DB default");
});

test("A2: the same legacy token is rejected once the DB version increments to 2", async () => {
  const { studentId, email, token } = await makeVerifiedStudent("legacy2");
  const legacyToken = await signRawStudentToken({ sub: studentId, email, type: "student", emailVerified: true });
  assert.equal((await get("/api/auth/me", legacyToken)).status, 200, "sanity: works before any bump");

  const logout = await post("/api/auth/logout", {}, token);
  assert.equal(logout.status, 200);
  assert.equal(await currentDbVersion(studentId), 2);

  const after = await get("/api/auth/me", legacyToken);
  assert.equal(after.status, 401);
  assert.equal(after.json.code, "SESSION_REVOKED");
  assert.equal(after.json.error, "Session expired. Please sign in again.");
  // Internal version numbers must never appear in the response body.
  const bodyText = JSON.stringify(after.json);
  assert.doesNotMatch(bodyText, /tokenVersion/i);
  assert.doesNotMatch(bodyText, /"1"|"2"/);
});

test("A3: applying the migration alone (every row at version 1) does not invalidate legacy tokens", async () => {
  // Simulates the rollout moment: an account that has NEVER had its version
  // bumped, holding a token minted before this feature shipped.
  const { studentId, email } = await makeVerifiedStudent("legacy3");
  assert.equal(await currentDbVersion(studentId), 1, "the migration's DEFAULT 1 — no bump has ever occurred");
  const legacyToken = await signRawStudentToken({ sub: studentId, email, type: "student", emailVerified: true });
  const res = await get("/api/auth/me", legacyToken);
  assert.equal(res.status, 200, "deployment alone must not log out any existing user");
});

// ═════════════════════════════════════════════════════════════════════════════
// B. Password reset
// ═════════════════════════════════════════════════════════════════════════════

test("B: full password-reset lifecycle — pre-reset token revoked, new login works, new token is version-correct and usable", async () => {
  const { studentId, email, token: preResetToken } = await makeVerifiedStudent("reset");

  // 4. Token works before reset.
  assert.equal((await get("/api/auth/me", preResetToken)).status, 200);

  const code = "654321";
  // Security-06B: email_otps.code stores an HMAC digest, not the raw code —
  // compute the same digest issueOtp would, so this direct-insert fixture
  // still satisfies the DB CHECK constraint and verifies against `code`.
  const { computeOtpDigest } = await import("../lib/otpDigest");
  const { OTP_PEPPER } = await import("../lib/authHelpers");
  const digest = computeOtpDigest("reset", email.toLowerCase().trim(), code, OTP_PEPPER);
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, expires_at) VALUES ($1, $2, $3, 'reset', now() + interval '10 minutes')`,
    [studentId, email, digest],
  );
  const reset = await post("/api/auth/reset-password", { email, code, newPassword: "BrandNewPass456" });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.ok, true);
  // Reset does not issue a replacement token — unchanged product contract.
  assert.equal(reset.json.accessToken, undefined);
  assert.equal(await currentDbVersion(studentId), 2, "exactly one atomic bump");

  // 5. Same token returns SESSION_REVOKED after reset.
  const after = await get("/api/auth/me", preResetToken);
  assert.equal(after.status, 401);
  assert.equal(after.json.code, "SESSION_REVOKED");

  // 6. New password login succeeds.
  const login = await post("/api/auth/login", { email, password: "BrandNewPass456" });
  assert.equal(login.status, 200);

  // 7. Newly-issued token carries current version and works.
  assert.equal(decodeJwt(login.json.accessToken).tokenVersion, 2);
  assert.equal((await get("/api/auth/me", login.json.accessToken)).status, 200);
});

// ═════════════════════════════════════════════════════════════════════════════
// C. Password change
// ═════════════════════════════════════════════════════════════════════════════

test("C: full password-change lifecycle — replacement token issued, old token revoked, second device also revoked", async () => {
  const { studentId, email, token: deviceAToken, password } = await makeVerifiedStudent("change");
  // A second, independently-issued token for the same account ("device B") —
  // both currently carry version 1.
  const loginB = await post("/api/auth/login", { email, password });
  const deviceBToken: string = loginB.json.accessToken;
  assert.equal(decodeJwt(deviceBToken).tokenVersion, 1);

  // 8. Token works before change.
  assert.equal((await get("/api/auth/me", deviceAToken)).status, 200);

  const change = await post("/api/auth/change-password", {
    currentPassword: password, newPassword: "AnotherNewPass789",
  }, deviceAToken);
  assert.equal(change.status, 200);
  assert.equal(change.json.ok, true);

  // 9. Change-password response contains a fresh token.
  assert.ok(change.json.accessToken, "additive accessToken field is present");
  const freshToken: string = change.json.accessToken;
  assert.notEqual(freshToken, deviceAToken, "genuinely a new token, not the old one echoed back");
  assert.equal(decodeJwt(freshToken).tokenVersion, 2);
  assert.equal(await currentDbVersion(studentId), 2, "exactly one atomic bump");

  // 10. Old token (the one that authenticated the change-password call
  // itself) returns SESSION_REVOKED on its NEXT use, after the request that
  // used it has already completed.
  const oldAfter = await get("/api/auth/me", deviceAToken);
  assert.equal(oldAfter.status, 401);
  assert.equal(oldAfter.json.code, "SESSION_REVOKED");

  // 11. Fresh replacement token works, and the device that changed the
  // password is NOT forced to log out.
  const freshAfter = await get("/api/auth/me", freshToken);
  assert.equal(freshAfter.status, 200);
  assert.equal(freshAfter.json.student.email, email);

  // 12. A second-device old token is also rejected.
  const deviceBAfter = await get("/api/auth/me", deviceBToken);
  assert.equal(deviceBAfter.status, 401);
  assert.equal(deviceBAfter.json.code, "SESSION_REVOKED");
});

test("C-notify: the existing security-notification email path still fires on password change", async () => {
  const { token, password } = await makeVerifiedStudent("changenotify");
  // dev-mode (no BREVO_API_KEY) no-ops the send but still exercises the same
  // code path that would call Brevo in production — asserting here only that
  // the request succeeds end-to-end (no exception from the notification path
  // regressing the response).
  const change = await post("/api/auth/change-password", {
    currentPassword: password, newPassword: "YetAnotherPass000",
  }, token);
  assert.equal(change.status, 200);
});

// ═════════════════════════════════════════════════════════════════════════════
// D. Logout
// ═════════════════════════════════════════════════════════════════════════════

test("D: full logout lifecycle — self-revoked, second device revoked, new login works", async () => {
  const { studentId, email, token: deviceAToken, password } = await makeVerifiedStudent("logout");
  const loginB = await post("/api/auth/login", { email, password });
  const deviceBToken: string = loginB.json.accessToken;

  // 13. POST /auth/logout succeeds with a valid token.
  const logout = await post("/api/auth/logout", {}, deviceAToken);
  assert.equal(logout.status, 200);
  assert.equal(logout.json.ok, true);
  assert.equal(await currentDbVersion(studentId), 2);

  // 14. The token used to call logout is rejected afterwards.
  const selfAfter = await get("/api/auth/me", deviceAToken);
  assert.equal(selfAfter.status, 401);
  assert.equal(selfAfter.json.code, "SESSION_REVOKED");

  // 15. A second outstanding token for the same account is also rejected —
  // logout is intentionally account-wide in this phase, not per-device.
  const deviceBAfter = await get("/api/auth/me", deviceBToken);
  assert.equal(deviceBAfter.status, 401);
  assert.equal(deviceBAfter.json.code, "SESSION_REVOKED");

  // 16. New login after logout succeeds.
  const login = await post("/api/auth/login", { email, password });
  assert.equal(login.status, 200);
  assert.equal(decodeJwt(login.json.accessToken).tokenVersion, 2);
  assert.equal((await get("/api/auth/me", login.json.accessToken)).status, 200);
});

test("D-unauth: logout requires a valid token — cannot be called with the shared API key alone", async () => {
  const res = await post("/api/auth/logout", {});
  assert.equal(res.status, 401);
});

test("D-notfound: logout is not registered under any unexpected alias", async () => {
  // Guards against a route-mount typo silently no-op'ing.
  const { token } = await makeVerifiedStudent("logoutroute");
  const res = await post("/api/auth/log-out", {}, token);
  assert.equal(res.status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// E. Social tokens
// ═════════════════════════════════════════════════════════════════════════════

test("E1: a Google-issued token embeds the current version and obeys the same revocation rule", async () => {
  const email = freshEmail("social");
  nextIdentity = {
    provider: "google", providerId: `google-sub-${Date.now()}`, email,
    emailTrust: "provider_attested", name: "Social User", avatarUrl: null,
  };
  const social = await post("/api/auth/google", { idToken: "t" });
  assert.equal(social.status, 200);
  const studentId: number = social.json.student.id;
  assert.equal(decodeJwt(social.json.accessToken).tokenVersion, 1);
  assert.equal((await get("/api/auth/me", social.json.accessToken)).status, 200);

  const logout = await post("/api/auth/logout", {}, social.json.accessToken);
  assert.equal(logout.status, 200);

  const after = await get("/api/auth/me", social.json.accessToken);
  assert.equal(after.status, 401);
  assert.equal(after.json.code, "SESSION_REVOKED");

  // A subsequent Google login (same provider id — already-linked fast path)
  // issues a token with the CURRENT (bumped) version, not a stale 1.
  const secondLogin = await post("/api/auth/google", { idToken: "t" });
  assert.equal(secondLogin.status, 200);
  assert.equal(secondLogin.json.student.id, studentId);
  assert.equal(decodeJwt(secondLogin.json.accessToken).tokenVersion, 2);
  assert.equal((await get("/api/auth/me", secondLogin.json.accessToken)).status, 200);
});

test("E2: Security-01B1 social-linking containment is unaffected by the revocation change", async () => {
  // Reproduces one Security-01B1 case end-to-end (unattested email + existing
  // account -> refused, no link, no token) through this suite's own app
  // mount, proving the two features compose without interference.
  const { email } = await makeVerifiedStudent("linkintact");
  nextIdentity = {
    provider: "facebook", providerId: `fb-sub-${Date.now()}`, email,
    emailTrust: "provider_asserted", name: "Attacker", avatarUrl: null,
  };
  const attempt = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(attempt.status, 409);
  assert.equal(attempt.json.code, "PROVIDER_LINK_VERIFICATION_REQUIRED");
  assert.equal(attempt.json.accessToken, undefined);
});

// ═════════════════════════════════════════════════════════════════════════════
// F. Verification status
// ═════════════════════════════════════════════════════════════════════════════

test("F1: requireVerifiedStudent still rejects a limited (unverified) token, independent of revocation", async () => {
  const email = freshEmail("unverified");
  const reg = await post("/api/auth/register", { name: "Unverified User", email, password: "SomePass123" });
  assert.equal(reg.status, 201);
  const limitedToken: string = reg.json.accessToken;
  assert.equal(decodeJwt(limitedToken).emailVerified, false);
  assert.equal(decodeJwt(limitedToken).tokenVersion, 1);

  // /auth/me only requires requireStudentAuth, not requireVerifiedStudent —
  // confirm it still works for a limited token (unchanged behavior).
  assert.equal((await get("/api/auth/me", limitedToken)).status, 200);

  // /auth/dance-interests requires requireVerifiedStudent and must still 403
  // with requiresOtp for a limited token — the revocation layer runs BEFORE
  // this check and must not interfere with it.
  const res = await put("/api/auth/dance-interests", { danceTypeIds: [] }, limitedToken);
  assert.equal(res.status, 403);
  assert.equal(res.json.requiresOtp, true);
});

test("F2: revocation takes precedence over verification status — a revoked-but-was-verified token never reaches a protected route", async () => {
  const { token } = await makeVerifiedStudent("precedence");
  const logout = await post("/api/auth/logout", {}, token);
  assert.equal(logout.status, 200);

  // Even though this token WAS fully verified, revocation is checked first
  // (inside requireAuth, before requireStudentAuth/requireVerifiedStudent
  // ever run) — the route must never be reached.
  const res = await put("/api/auth/dance-interests", { danceTypeIds: [] }, token);
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "SESSION_REVOKED");
  assert.notEqual(res.status, 403, "must not fall through to the requiresOtp path");
});

// ═════════════════════════════════════════════════════════════════════════════
// G. Concurrency / atomicity
// ═════════════════════════════════════════════════════════════════════════════

test("G1: N concurrent atomic increments against the same row never lose an update (raw SQL, direct pool)", async () => {
  // Isolates the exact SQL pattern every route uses — `token_version =
  // token_version + 1` — from HTTP/auth-check timing, and proves it under
  // real concurrent connections from the pool (not sequential awaits on one
  // connection).
  const { studentId } = await makeVerifiedStudent("concurrency-raw");
  const before = await currentDbVersion(studentId);
  const N = 10;
  await Promise.all(
    Array.from({ length: N }, () =>
      pool.query(`UPDATE students SET token_version = token_version + 1 WHERE id = $1`, [studentId])),
  );
  const after = await currentDbVersion(studentId);
  assert.equal(after, before + N, `all ${N} concurrent increments must land — a lost update would show a smaller total`);
});

test("G2: two concurrent real logout requests for the same account never lose an increment", async () => {
  const { studentId, email, password } = await makeVerifiedStudent("concurrency-http");
  const loginA = await post("/api/auth/login", { email, password });
  const loginB = await post("/api/auth/login", { email, password });
  const tokenA: string = loginA.json.accessToken;
  const tokenB: string = loginB.json.accessToken;
  assert.equal(decodeJwt(tokenA).tokenVersion, 1);
  assert.equal(decodeJwt(tokenB).tokenVersion, 1);

  const [resA, resB] = await Promise.all([
    post("/api/auth/logout", {}, tokenA),
    post("/api/auth/logout", {}, tokenB),
  ]);
  // Both tokens were valid (version 1) at the moment both requests were
  // fired, so both are expected to pass requireAuth's check and each
  // attempt its own atomic bump — but this is not asserted strictly per
  // request, since real scheduling could serialize one behind the other's
  // commit. What must ALWAYS hold is: however many requests actually
  // reached the route handler (200), that many increments landed — never
  // fewer.
  const successCount = [resA, resB].filter((r) => r.status === 200).length;
  assert.ok(successCount >= 1, "sanity: at least the first request must succeed");
  const finalVersion = await currentDbVersion(studentId);
  assert.equal(finalVersion, 1 + successCount, "final version reflects exactly the successful bumps — none lost, none duplicated");
});

// ═════════════════════════════════════════════════════════════════════════════
// Response-shape / no-leak checks
// ═════════════════════════════════════════════════════════════════════════════

test("no response body anywhere in this suite exposes a raw tokenVersion field to the client", async () => {
  const { studentId, email, password } = await makeVerifiedStudent("noleak");
  const login = await post("/api/auth/login", { email, password });
  assert.equal(JSON.stringify(login.json).includes("tokenVersion"), false, "/auth/login response");

  const change = await post("/api/auth/change-password", {
    currentPassword: password, newPassword: "NoLeakPass111",
  }, login.json.accessToken);
  assert.equal(JSON.stringify(change.json).includes("tokenVersion"), false, "/auth/change-password response");

  const me = await get("/api/auth/me", change.json.accessToken);
  assert.equal(JSON.stringify(me.json).includes("tokenVersion"), false, "/auth/me response");

  void studentId;
});
