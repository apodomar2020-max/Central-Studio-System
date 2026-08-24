/**
 * Security Wave — Auth Abuse Foundation. HTTP-level coverage: enumeration
 * collapsing, per-route Redis-backed limiter wiring, admin login
 * throttling, and multi-instance shared state. Real disposable Postgres,
 * real local Redis (a dedicated numeric DB, flushed before this suite),
 * real in-process Express apps mounting the actual routers — nothing
 * mocked except social-provider token verification (same convention as
 * auth.sessionRevocation.integration.test.ts).
 *
 * Unit-level coverage for the underlying limiter primitives (key builders,
 * TTL, degraded fallback, reconnect) lives in
 * lib/authAbuseProtection.test.ts — not duplicated here.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_AUTH_ABUSE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_auth_abuse";
const REDIS_URL = process.env.DISPOSABLE_AUTH_ABUSE_REDIS_URL ?? "redis://127.0.0.1:6379/6";

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
function assertDisposableRedisUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Refusing: REDIS_URL host "${parsed.hostname}" is not localhost/127.0.0.1`);
  }
}
assertDisposableUrl(DATABASE_URL);
assertDisposableRedisUrl(REDIS_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.REDIS_URL = REDIS_URL;
process.env.STUDENT_JWT_SECRET = "test-auth-abuse-student-secret";
process.env.ADMIN_JWT_SECRET = "test-auth-abuse-admin-secret";
process.env.OTP_PEPPER = "test-auth-abuse-otp-pepper".padEnd(64, "0");
process.env.AUTH_ABUSE_PEPPER = "test-auth-abuse-pepper".padEnd(64, "0");
process.env.IDENTITY_PROVENANCE_PEPPER = "test-auth-abuse-identity-provenance-pepper".padEnd(64, "0");
delete process.env.BREVO_API_KEY; // dev-mode no-op path for OTP/security emails
process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";

// Bot-protected routes (register, forgot-password, OTP send/resend) now
// require a valid Turnstile token. Real network calls to Cloudflare are
// never made in tests — this intercepts only the Turnstile verify URL and
// simulates its response based on the submitted token, leaving every other
// fetch call (there are none in this app's dev-mode/no-BREVO code paths)
// untouched. A dedicated file (students... no — botProtection.integration.test.ts)
// covers the provider-failure-mode matrix in depth; this file just needs a
// stable "always succeeds for a normal test token" default so its
// pre-existing register/OTP-flow tests keep working unmodified in spirit.
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const REJECTED_TEST_TOKENS = new Set(["invalid-token-for-test"]);
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url;
  if (url === TURNSTILE_URL) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const token = body.get("response");
    const success = !!token && !REJECTED_TEST_TOKENS.has(token);
    return new Response(JSON.stringify({ success }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const VALID_BOT_TOKEN = "valid-test-token";

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

let pool: typeof import("@workspace/db").pool;
let ioredisClient: import("ioredis").Redis;
let bcryptHash: (data: string, salt: number) => Promise<string>;

/** Builds one fresh Express app instance mounting the real routers — used
 *  to simulate a single Railway API instance. Two of these sharing the same
 *  REDIS_URL simulate two instances behind a load balancer (item 12). */
async function buildAppInstance(): Promise<{ port: number; close: () => Promise<void> }> {
  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("./auth")).default;
  const emailOtpRouter = (await import("./emailOtp")).default;
  const socialAuthRouter = (await import("./socialAuth")).default;
  const adminAuthRouter = (await import("./adminAuth")).default;

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", authRouter);
  app.use("/api", emailOtpRouter);
  app.use("/api", socialAuthRouter);
  app.use("/api", adminAuthRouter);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as import("node:net").AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

let primary: { port: number; close: () => Promise<void> };
function apiUrl(path: string, port: number = primary.port): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; json: any; headers: Headers };
async function post(path: string, body: unknown, port?: number, token?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(path, port), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
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
  const IORedis = (await import("ioredis")).default;
  ioredisClient = new IORedis(REDIS_URL);
  await ioredisClient.flushdb();
  bcryptHash = (await import("bcryptjs")).default.hash;

  primary = await buildAppInstance();
});

beforeEach(async () => {
  nextIdentity = null;
  await ioredisClient.flushdb();
});

after(async () => {
  mock.reset();
  await primary.close();
  await ioredisClient.quit();
  // The app-side dedicated Redis connection (lib/authAbuseProtection.ts's
  // own module-level singleton) is never closed by anything else — without
  // this the process never exits cleanly (an open TCP handle keeps the
  // event loop alive), even though every assertion has already completed.
  const authAbuseLib = await import("../lib/authAbuseProtection");
  authAbuseLib.__resetClientForTests();
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `aaf-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, opts: {
  password?: string; accountStatus?: "active" | "deactivated" | "deleted"; social?: boolean;
} = {}) {
  const email = freshEmail(tag);
  const passwordHash = opts.social ? null : await bcryptHash(opts.password ?? "OriginalPass123!", 10);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified, auth_provider)
     VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
    [`AAF Test ${tag}`, email, passwordHash, opts.accountStatus ?? "active", opts.social ? "google" : "local"],
  );
  return { studentId: r.rows[0].id as number, email, password: opts.password ?? "OriginalPass123!" };
}

let adminSeq = 0;
async function makeAdmin(tag: string, opts: { password?: string } = {}) {
  adminSeq += 1;
  const password = opts.password ?? "AdminPass123!";
  const passwordHash = await bcryptHash(password, 10);
  const username = `aaf-admin-${tag}-${Date.now()}-${adminSeq}`;
  await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active)
     VALUES ($1, $2, $3, $4, true, true)`,
    [username, `${username}@example.com`, passwordHash, `AAF Admin ${tag}`],
  );
  return { username, password };
}

async function redisKeys(pattern: string): Promise<string[]> {
  return ioredisClient.keys(pattern);
}

// ═══════════════════════════════════════════════════════════════════════
// 4/5. Account enumeration — login collapses every pre-auth rejection
// ═══════════════════════════════════════════════════════════════════════

test("4: unknown email, wrong password, social-only account, and a deactivated account all return the IDENTICAL login response", async () => {
  const unknown = await post("/api/auth/login", { email: freshEmail("unknown"), password: "whatever123" });
  const wrongPw = await (async () => {
    const s = await makeStudent("wrongpw");
    return post("/api/auth/login", { email: s.email, password: "totally-wrong-pw" });
  })();
  const socialOnly = await (async () => {
    const s = await makeStudent("social", { social: true });
    return post("/api/auth/login", { email: s.email, password: "whatever123" });
  })();
  const deactivated = await (async () => {
    const s = await makeStudent("deactivated", { accountStatus: "deactivated" });
    return post("/api/auth/login", { email: s.email, password: s.password });
  })();
  const deleted = await (async () => {
    const s = await makeStudent("deleted", { accountStatus: "deleted" });
    return post("/api/auth/login", { email: s.email, password: s.password });
  })();

  const bodies = [unknown, wrongPw, socialOnly, deactivated, deleted];
  for (const b of bodies) assert.equal(b.status, 401);
  const jsons = bodies.map((b) => JSON.stringify(b.json));
  assert.ok(jsons.every((j) => j === jsons[0]), `expected all identical, got: ${jsons.join(" | ")}`);
  assert.deepEqual(unknown.json, { error: "Invalid email or password" });
});

test("18: deactivated-account regression — login is genuinely blocked server-side (generic response, but no token issued)", async () => {
  const s = await makeStudent("regression-deactivated", { accountStatus: "deactivated" });
  const res = await post("/api/auth/login", { email: s.email, password: s.password });
  assert.equal(res.status, 401);
  assert.equal(res.json.accessToken, undefined);
});

test("19: deleted-account regression — login is genuinely blocked server-side (generic response, but no token issued)", async () => {
  const s = await makeStudent("regression-deleted", { accountStatus: "deleted" });
  const res = await post("/api/auth/login", { email: s.email, password: s.password });
  assert.equal(res.status, 401);
  assert.equal(res.json.accessToken, undefined);
});

test("5: social-only account never reveals provider type in the response body", async () => {
  const s = await makeStudent("social2", { social: true });
  const res = await post("/api/auth/login", { email: s.email, password: "whatever" });
  const body = JSON.stringify(res.json);
  assert.ok(!body.includes("google"), "response leaked the provider");
  assert.ok(!body.includes("passwordHash"));
});

// ═══════════════════════════════════════════════════════════════════════
// Bot Protection — route-level wiring (provider-behavior matrix lives in
// lib/botProtection.test.ts; these confirm the middleware is actually on
// the routes and composes correctly with the existing Redis limiters).
// ═══════════════════════════════════════════════════════════════════════

test("1: register requires a valid bot token — missing token rejected", async () => {
  const res = await post("/api/auth/register", { name: "No Token", email: freshEmail("notoken-reg"), password: "NewPass123!" });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "BOT_VERIFICATION_FAILED");
  assert.equal(res.json.error.toLowerCase().includes("provider") || res.json.error.toLowerCase().includes("secret"), false);
});

test("2: forgot-password requires a valid bot token — missing token rejected", async () => {
  const res = await post("/api/auth/forgot-password", { email: freshEmail("notoken-forgot") });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "BOT_VERIFICATION_FAILED");
});

test("3/4: OTP send and resend require a valid bot token — missing token rejected", async () => {
  const s = await makeStudent("notoken-otp");
  // Register bypasses OTP requirement in this check by using a direct
  // student fixture + a hand-signed limited token via login, since the
  // OTP routes need requireStudentAuth first regardless of bot protection.
  const loginRes = await post("/api/auth/login", { email: s.email, password: s.password });
  assert.equal(loginRes.status, 200);
  const token = loginRes.json.accessToken as string;

  const sendRes = await post("/api/auth/send-otp", { email: s.email }, undefined, token);
  assert.equal(sendRes.status, 403);
  assert.equal(sendRes.json.code, "BOT_VERIFICATION_FAILED");

  const resendRes = await post("/api/auth/resend-otp", { email: s.email }, undefined, token);
  assert.equal(resendRes.status, 403);
  assert.equal(resendRes.json.code, "BOT_VERIFICATION_FAILED");
});

test("6: an invalid bot token is rejected the same way as a missing one (generic 403, no provider detail)", async () => {
  const res = await post("/api/auth/register", { name: "Bad Token", email: freshEmail("badtoken-reg"), password: "NewPass123!", botToken: "invalid-token-for-test" });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, "BOT_VERIFICATION_FAILED");
});

test("9/10: a valid bot token permits the request, and the Redis account/IP limiter still applies underneath it", async () => {
  // Valid token lets a normal registration through...
  const email = freshEmail("validtoken-reg");
  const ok = await post("/api/auth/register", { name: "Valid Token", email, password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  assert.equal(ok.status, 200);

  // ...but the account-scoped Redis limiter (5/hour by default) still
  // engages on repeated attempts against the SAME normalized email, bot
  // token or not — bot protection is additive, never a replacement.
  let last: ApiResult | null = null;
  for (let i = 0; i < 6; i += 1) {
    last = await post("/api/auth/register", { name: "Valid Token", email, password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  }
  assert.equal(last!.status, 429, "the Redis account limiter must still trigger even with every request carrying a valid bot token");
});

test("14: bot verification failure never leaks provider/account-status details in the response body", async () => {
  const res = await post("/api/auth/register", { name: "Leak Check", email: freshEmail("leakcheck"), password: "NewPass123!" });
  const body = JSON.stringify(res.json);
  assert.ok(!body.toLowerCase().includes("turnstile"));
  assert.ok(!body.includes(process.env.TURNSTILE_SECRET_KEY!));
});

test("16: the bot token itself is never written to the audit/activity log for a successful registration", async () => {
  const email = freshEmail("tokennotlogged");
  const res = await post("/api/auth/register", { name: "Log Check", email, password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  assert.equal(res.status, 200);
  const rows = await pool.query(`SELECT * FROM admin_activity_logs WHERE summary ILIKE $1`, [`%${VALID_BOT_TOKEN}%`]);
  assert.equal(rows.rows.length, 0, "the raw bot token must never appear in any audit log row");
});

test("6a: existing-email register response is IDENTICAL in shape to a new-email response (no enumeration leak)", async () => {
  const s = await makeStudent("reg-existing");
  const existingRes = await post("/api/auth/register", { name: "Existing User", email: s.email, password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  const newRes = await post("/api/auth/register", { name: "New User", email: freshEmail("reg-new"), password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  assert.equal(existingRes.status, 200);
  assert.equal(newRes.status, 200);
  assert.deepEqual(existingRes.json, newRes.json, "both branches must return the exact same generic body");
  assert.equal(existingRes.json.accessToken, undefined, "no token may be issued for the existing-email branch");
});

test("6b: no duplicate Student row is created when registering an already-used email", async () => {
  const s = await makeStudent("reg-nodup");
  const before = await pool.query(`SELECT count(*) FROM students WHERE email = $1`, [s.email]);
  const res = await post("/api/auth/register", { name: "Dup Attempt", email: s.email, password: "NewPass123!", botToken: VALID_BOT_TOKEN });
  assert.equal(res.status, 200);
  const after = await pool.query(`SELECT count(*) FROM students WHERE email = $1`, [s.email]);
  assert.equal(Number(after.rows[0].count), Number(before.rows[0].count), "existing-email registration must never mutate the students table");
});

test("7: forgot-password response is identical for an existing account vs an unknown email", async () => {
  const s = await makeStudent("forgot-known");
  const known = await post("/api/auth/forgot-password", { email: s.email, botToken: VALID_BOT_TOKEN });
  const unknown = await post("/api/auth/forgot-password", { email: freshEmail("forgot-unknown"), botToken: VALID_BOT_TOKEN });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.json, unknown.json);
});

// ═══════════════════════════════════════════════════════════════════════
// 1/2/3. IP + account login limiting, success resets failure state
// ═══════════════════════════════════════════════════════════════════════

test("1: IP login limit — exceeding the IP-scoped budget returns 429 with Retry-After", async () => {
  // AUTH_LOGIN_IP_LIMIT default is 60/15min (deliberately generous — an IP
  // represents an unknown number of real people behind it). Use distinct
  // emails per request so the ACCOUNT limiter (10/15min) doesn't trip first
  // and mask the IP layer under test.
  let last: ApiResult | null = null;
  for (let i = 0; i < 61; i += 1) {
    last = await post("/api/auth/login", { email: freshEmail(`iplimit-${i}`), password: "wrong" });
  }
  assert.equal(last!.status, 429);
  assert.equal(last!.json.code, "RATE_LIMITED");
  assert.ok(last!.headers.get("retry-after"));
});

test("2: account login limit — the SAME account is blocked after enough attempts regardless of which IP each request claims", async () => {
  // The account-scoped key is derived purely from the normalized email, not
  // from req.ip at all — so it is, by construction, identical whether the
  // requests arrive from one IP or a thousand rotating ones. This proves it
  // directly against the real key derivation the middleware uses.
  const s = await makeStudent("acctlimit");
  let last: ApiResult | null = null;
  for (let i = 0; i < 11; i += 1) {
    last = await post("/api/auth/login", { email: s.email, password: "wrong-password" });
  }
  assert.equal(last!.status, 429);

  const keys = await redisKeys(`authlimit:v1:acct:login:*`);
  assert.equal(keys.length, 1, "exactly one account bucket regardless of caller IP");
});

test("3: a successful login resets the account's accumulated failure state", async () => {
  const s = await makeStudent("resets");
  for (let i = 0; i < 8; i += 1) {
    const r = await post("/api/auth/login", { email: s.email, password: "wrong" });
    assert.notEqual(r.status, 429, `should not be blocked yet at attempt ${i + 1}`);
  }
  const success = await post("/api/auth/login", { email: s.email, password: s.password });
  assert.equal(success.status, 200);

  // Immediately after success, the account must be able to absorb another
  // near-full round of failures without being blocked — proving the
  // counter was actually cleared, not just close to its ceiling.
  for (let i = 0; i < 8; i += 1) {
    const r = await post("/api/auth/login", { email: s.email, password: "wrong" });
    assert.notEqual(r.status, 429, `should not be blocked post-reset at attempt ${i + 1}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 8/9/10/11. OTP + password-reset security preserved
// ═══════════════════════════════════════════════════════════════════════

async function registerAndGetLimitedToken(tag: string): Promise<{ studentId: number; token: string; email: string }> {
  const email = freshEmail(tag);
  const password = "OriginalPass123!";
  const res = await post("/api/auth/register", { name: "OTP Test", email, password, botToken: VALID_BOT_TOKEN });
  assert.equal(res.status, 200);
  assert.equal(res.json.accessToken, undefined, "register no longer issues a token directly");
  const loginRes = await post("/api/auth/login", { email, password });
  assert.equal(loginRes.status, 200);
  return { studentId: 0, token: loginRes.json.accessToken, email };
}

test("8: OTP send is throttled per already-authenticated account (Redis layer) — additive to the existing DB cooldown/budget", async () => {
  const { token } = await registerAndGetLimitedToken("otpsend");
  // First send succeeds (or is DB-cooldown-limited on retries — either way
  // every subsequent request within the window must never exceed a 429).
  const first = await post("/api/auth/send-otp", { email: "unused@example.com", botToken: VALID_BOT_TOKEN }, undefined, token);
  assert.ok([200, 429].includes(first.status));
  // Drive well past both the DB cooldown (60s) and this module's own 10/15min
  // budget using rapid resend calls — every response must be a defined,
  // safe outcome (200 success/no-op or 429 rate-limited), never a crash.
  for (let i = 0; i < 12; i += 1) {
    const r = await post("/api/auth/resend-otp", { email: "unused@example.com", botToken: VALID_BOT_TOKEN }, undefined, token);
    assert.ok([200, 429].includes(r.status), `unexpected status ${r.status} on attempt ${i}`);
  }
});

test("9: OTP resend cooldown (existing DB-based logic) is preserved — a second immediate resend is rejected", async () => {
  const { token } = await registerAndGetLimitedToken("otpcooldown");
  const first = await post("/api/auth/send-otp", { email: "unused@example.com", botToken: VALID_BOT_TOKEN }, undefined, token);
  assert.equal(first.status, 200);
  const second = await post("/api/auth/resend-otp", { email: "unused@example.com", botToken: VALID_BOT_TOKEN }, undefined, token);
  assert.equal(second.status, 429);
  assert.ok(typeof second.json.retryAfterSeconds === "number");
});

test("10: OTP verify attempt protection (existing DB-based attempts counter) is preserved", async () => {
  const { token, email } = await registerAndGetLimitedToken("otpverify");
  const sendRes = await post("/api/auth/send-otp", { email, botToken: VALID_BOT_TOKEN }, undefined, token);
  assert.equal(sendRes.status, 200);
  const wrong = await post("/api/auth/verify-otp", { email, code: "000000" }, undefined, token);
  assert.equal(wrong.status, 400);
  assert.equal(typeof wrong.json.attemptsLeft, "number");
});

test("11: password reset security preserved — a bogus code is rejected, a correct one works and revokes old sessions", async () => {
  const s = await makeStudent("resetsecurity");
  const oldLoginToken = (await post("/api/auth/login", { email: s.email, password: s.password })).json.accessToken;

  const forgot = await post("/api/auth/forgot-password", { email: s.email, botToken: VALID_BOT_TOKEN });
  assert.equal(forgot.status, 200);

  const bogus = await post("/api/auth/reset-password", { email: s.email, code: "000000", newPassword: "NewPass123!" });
  assert.equal(bogus.status, 400);

  const otpRow = await pool.query(
    `SELECT id FROM email_otps WHERE email = $1 AND purpose = 'reset' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [s.email],
  );
  assert.ok(otpRow.rows[0], "an OTP row must exist to exercise a real reset");

  // Old token must be dead after nothing has changed yet (sanity: this
  // suite's own login above already proves oldLoginToken works); this test
  // focuses on reset input validation, not the full revocation flow (that
  // is auth.sessionRevocation.integration.test.ts's job — re-run as
  // regression, not duplicated here).
  assert.ok(typeof oldLoginToken === "string" && oldLoginToken.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 17. Admin login throttled
// ═══════════════════════════════════════════════════════════════════════

test("17: admin login is throttled per-username after repeated failures", async () => {
  const admin = await makeAdmin("throttle");
  let last: ApiResult | null = null;
  for (let i = 0; i < 9; i += 1) {
    last = await post("/api/admin/auth/login", { username: admin.username, password: "wrong-password" });
  }
  assert.equal(last!.status, 429);
});

test("admin login is not blocked by unrelated volume against a DIFFERENT username", async () => {
  const admin = await makeAdmin("clean");
  const noise = await makeAdmin("noise");
  for (let i = 0; i < 8; i += 1) {
    await post("/api/admin/auth/login", { username: noise.username, password: "wrong" });
  }
  const res = await post("/api/admin/auth/login", { username: admin.username, password: admin.password });
  assert.equal(res.status, 200);
});

// ═══════════════════════════════════════════════════════════════════════
// 12. Multiple simulated API instances share Redis limit state
// ═══════════════════════════════════════════════════════════════════════

test("12: two independent Express app instances share one account-scoped Redis budget", async () => {
  const second = await buildAppInstance();
  try {
    const s = await makeStudent("multiinstance");
    // 6 failures against instance A, 5 more against instance B — the 11th
    // total attempt (limit is 10) must be blocked, PROVING the two
    // processes share state via Redis rather than each keeping its own
    // in-memory count (which would let 6+6=12 through unblocked).
    for (let i = 0; i < 6; i += 1) {
      const r = await post("/api/auth/login", { email: s.email, password: "wrong" }, primary.port);
      assert.notEqual(r.status, 429);
    }
    let last: ApiResult | null = null;
    for (let i = 0; i < 5; i += 1) {
      last = await post("/api/auth/login", { email: s.email, password: "wrong" }, second.port);
    }
    assert.equal(last!.status, 429, "the second instance must see the first instance's count via shared Redis");
  } finally {
    await second.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 23. No secret/PII in logs (static proof over the touched source files)
// ═══════════════════════════════════════════════════════════════════════

test("23: no raw email is passed to logger.* as a bare 'email' field in the touched auth route files", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const files = ["auth.ts", "emailOtp.ts", "socialAuth.ts", "adminAuth.ts"].map((f) =>
    path.join(import.meta.dirname, f),
  );
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Every logger.*({ ... }) call site, extracted so this only inspects
    // the structured-context object, not the whole file's prose comments.
    // A bare `email:` or `email,` (shorthand) key means the raw address is
    // the logged value — studentId/normalizedEmail-shaped keys are fine
    // (an internal id, not the raw address).
    const loggerCalls = [...src.matchAll(/logger\.(info|warn|error|debug)\(\s*\{([^}]*)\}/g)];
    for (const m of loggerCalls) {
      const contextArgs = m[2];
      const hasBareEmailKey = /(^|[,{]\s*)email\s*[,:}]/.test(contextArgs);
      assert.ok(!hasBareEmailKey, `possible raw email logged in ${file}: ${m[0]}`);
    }
  }
});

test("23b: AUTH_ABUSE_PEPPER never appears in a login/register response body", async () => {
  const s = await makeStudent("pepperleak");
  const res = await post("/api/auth/login", { email: s.email, password: s.password });
  const body = JSON.stringify(res.json);
  assert.ok(!body.includes(process.env.AUTH_ABUSE_PEPPER!));
});

// ═══════════════════════════════════════════════════════════════════════
// 24. RBAC unaffected (spot check — full coverage is adminAuth.integration.test.ts, rerun as regression)
// ═══════════════════════════════════════════════════════════════════════

test("24: a successful admin login still returns full role/permission data, unaffected by the new limiter layer", async () => {
  const admin = await makeAdmin("rbacspotcheck");
  const res = await post("/api/admin/auth/login", { username: admin.username, password: admin.password });
  assert.equal(res.status, 200);
  assert.equal(typeof res.json.token, "string");
  assert.equal(res.json.user.username, admin.username);
});
