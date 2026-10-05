import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";

process.env.DATABASE_URL = "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_native_auth_20261005";
process.env.REDIS_URL = "redis://127.0.0.1:16386/12";
process.env.NODE_ENV = "test";
process.env.STUDENT_JWT_SECRET = "test-only-native-student-secret";
process.env.OTP_PEPPER = "test-only-native-otp-pepper";
process.env.AUTH_ABUSE_PEPPER = "test-only-native-admission-pepper";
process.env.IDENTITY_PROVENANCE_PEPPER = "test-only-native-provenance-pepper";
process.env.TURNSTILE_SECRET_KEY = "test-only-native-turnstile-secret";
process.env.BREVO_API_KEY = "test-only-native-provider-key";
process.env.EMAIL_FROM = "test@example.test";
let redis: IORedis;
let pool: typeof import("@workspace/db").pool;
let helpers: typeof import("../lib/authHelpers");
let recovery: typeof import("../lib/authRecovery");
let abuse: typeof import("../lib/authAbuseProtection");
let server: import("node:http").Server;
let base: string;
let queue: Queue;
const originalFetch = globalThis.fetch;
let recipients: string[] = [];
let botCalls = 0;
let seq = 0;
const suffix = Date.now();
const freshEmail = () => `native-auth-${suffix}-${seq++}@example.test`;
before(async () => {
  redis = new IORedis(process.env.REDIS_URL!);
  pool = (await import("@workspace/db")).pool;
  helpers = await import("../lib/authHelpers");
  recovery = await import("../lib/authRecovery");
  abuse = await import("../lib/authAbuseProtection");
  queue = new Queue(recovery.AUTH_RECOVERY_QUEUE, { connection: redis });
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes("challenges.cloudflare.com")) {
      botCalls++;
      const token = new URLSearchParams(String(init?.body)).get("response");
      return Response.json({ success: token === "test-valid" || token === "test-register", action: token === "test-register" ? "register" : "otp_send" });
    }
    if (String(input).includes("api.brevo.com")) {
      recipients.push(JSON.parse(String(init?.body)).to[0].email);
      return new Response("", { status: 201 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  const express = (await import("express")).default;
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", (await import("../middlewares/auth")).requireAuth);
  app.use("/api", (await import("./auth")).default);
  app.use("/api", (await import("./emailOtp")).default);
  server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/auth`;
});
beforeEach(async () => {
  await recovery.closeRecoveryQueue();
  await redis.flushdb(); recipients = []; botCalls = 0;
  process.env.REDIS_URL = "redis://127.0.0.1:16386/12";
  abuse.__resetClientForTests();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await recovery.closeRecoveryQueue();
  await queue.close();
  abuse.__resetClientForTests();
  await redis.quit();
  await pool.end();
});
async function post(path: string, body: unknown, token?: string) {
  const response = await originalFetch(base + path, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-forwarded-for": "8.8.8.8", "x-real-ip": "1.1.1.1", "user-agent": "CentralStudioMobile" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function student() {
  const email = freshEmail();
  const passwordHash = await (await import("bcryptjs")).default.hash("OriginalPass123!", 10);
  const { rows } = await pool.query("INSERT INTO students (name, email, email_verified, auth_provider, password_hash) VALUES ('Native Auth Test', $1, false, 'local', $2) RETURNING id, token_version", [email, passwordHash]);
  return { email, id: rows[0].id as number, token: helpers.signStudentToken(rows[0].id, email, false, rows[0].token_version) };
}

test("native new/existing registration is indistinguishable and does not call Turnstile", async () => {
  const body = { name: "Native Test", email: freshEmail(), password: "OriginalPass123!" };
  const first = await post("/native/register", body);
  const second = await post("/native/register", body);
  assert.deepEqual(first, { status: 200, body: { ok: true } });
  assert.deepEqual(second, first);
  assert.equal(botCalls, 0);
  assert.equal(await redis.zcard("authadmission:{auth}:v1:register:global:day"), 2);
});

test("concurrent native registration cannot exceed fleet admission", async () => {
  const results = await Promise.all(Array.from({ length: 13 }, () => post("/native/register", { name: "Native Concurrent", email: freshEmail(), password: "OriginalPass123!" })));
  assert.ok(results.filter((result) => result.status === 200).length <= 10);
  assert.ok(results.every((result) => [200, 429, 503].includes(result.status)));
  assert.equal(await redis.zcard("authadmission:{auth}:v1:register:global:day"), 10);
  // Lost/late Redis acknowledgements during concurrent bcrypt work fail
  // closed; their already-reserved attempt must not be refunded.
});

test("web registration keeps mandatory Turnstile and shares native registration counters", async () => {
  const body = { name: "Shared Registration", email: freshEmail(), password: "OriginalPass123!" };
  assert.equal((await post("/native/register", body)).status, 200);
  assert.equal((await post("/register", { ...body, botToken: "test-register" })).status, 200);
  assert.equal(await redis.zcard("authadmission:{auth}:v1:register:global:day"), 2);
});

test("outage denies native registration before bcrypt/account creation and OTP before provider calls", async () => {
  const account = await student();
  const bcrypt = (await import("bcryptjs")).default;
  const originalHash = bcrypt.hash;
  let hashes = 0;
  bcrypt.hash = ((...args: any[]) => { hashes++; return (originalHash as any)(...args); }) as typeof bcrypt.hash;
  const email = freshEmail();
  delete process.env.REDIS_URL;
  abuse.__resetClientForTests();
  try {
    assert.equal((await post("/native/register", { name: "Outage Test", email, password: "OriginalPass123!" })).status, 503);
    assert.equal(hashes, 0);
    assert.equal((await pool.query("SELECT count(*) FROM students WHERE email=$1", [email])).rows[0].count, "0");
    assert.equal((await post("/native/send-email-otp", {}, account.token)).status, 503);
    assert.equal(recipients.length, 0);
    assert.equal((await post("/native/forgot-password", { email: account.email })).status, 200);
  } finally { bcrypt.hash = originalHash; }
});

test("native OTP requires JWT and forged body cannot redirect recipient", async () => {
  const account = await student();
  assert.equal((await post("/native/send-email-otp", {})).status, 401);
  assert.equal((await post("/native/send-email-otp", { email: "attacker@example.test", studentId: account.id + 1 }, account.token)).status, 200);
  assert.deepEqual(recipients, [account.email]);
  assert.equal(botCalls, 0);
  assert.equal((await post("/native/send-email-otp", {}, account.token)).status, 429, "DB cooldown remains mandatory");
});

test("all five legacy/web routes reject missing and invalid Turnstile despite mobile headers", async () => {
  const account = await student();
  for (const path of ["/register", "/forgot-password", "/send-otp", "/resend-otp", "/send-email-otp"]) {
    for (const botToken of [undefined, "test-invalid"]) {
      const result = await post(path, { name: "Native Test", email: account.email, password: "OriginalPass123!", studentId: account.id, botToken }, account.token);
      assert.equal(result.status, 403, path);
    }
  }
  assert.equal(recipients.length, 0);
});

test("native and legacy OTP aliases share actual provider-attempt and issuance budgets", async () => {
  const one = await student();
  const two = await student();
  assert.equal((await post("/native/send-email-otp", {}, one.token)).status, 200);
  assert.equal((await post("/send-otp", { email: "attacker@example.test", botToken: "test-valid" }, two.token)).status, 200);
  assert.equal((await post("/resend-otp", { email: one.email, botToken: "test-valid" }, one.token)).status, 429);
  assert.equal(await redis.zcard("authadmission:{auth}:v1:email:global:day"), 2);
  assert.deepEqual(recipients.sort(), [one.email, two.email].sort());
});

test("native recovery known/unknown/quota responses match; jobs contain no recipient, OTP or JWT; worker sends once", async () => {
  const account = await student();
  const known = await post("/native/forgot-password", { email: account.email });
  const unknown = await post("/native/forgot-password", { email: freshEmail() });
  assert.deepEqual(known, unknown);
  assert.equal(known.status, 200);
  assert.equal(recipients.length, 0, "public request does not await provider");
  const jobs = await queue.getJobs(["wait"]);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.equal(job.opts.attempts, 1);
    assert.deepEqual(Object.keys(job.data).sort(), ["peer", "studentId"]);
    await recovery.processRecovery(job as any);
  }
  assert.deepEqual(recipients, [account.email]);
  for (let i = 0; i < 7; i++) assert.deepEqual(await post("/native/forgot-password", { email: account.email }), known);
  assert.equal(botCalls, 0);
});

test("public reset invalid/expired/locked/unknown failures have the same outward contract", async () => {
  const account = await student();
  const { computeOtpDigest } = await import("../lib/otpDigest");
  await pool.query("INSERT INTO email_otps (email, student_id, purpose, code, attempts, expires_at) VALUES ($1,$2,'reset',$3,5,now()+interval '10 minutes')", [account.email, account.id, computeOtpDigest("reset", account.email, "123456", helpers.OTP_PEPPER)]);
  const locked = await post("/verify-reset-otp", { email: account.email, code: "000000" });
  const unknown = await post("/verify-reset-otp", { email: freshEmail(), code: "000000" });
  assert.deepEqual(locked, unknown);
  assert.equal(locked.status, 400);
  assert.equal((await pool.query("SELECT attempts FROM email_otps WHERE email=$1 ORDER BY id DESC LIMIT 1", [account.email])).rows[0].attempts, 5);
});

test("real recovery worker delivers queued reset without retries or public provider latency", async () => {
  const account = await student();
  assert.equal((await post("/native/forgot-password", { email: account.email })).status, 200);
  assert.equal(recipients.length, 0);
  const connection = new IORedis("redis://127.0.0.1:16386/12", { maxRetriesPerRequest: null });
  const worker = new Worker(recovery.AUTH_RECOVERY_QUEUE, recovery.processRecovery, { connection, concurrency: 1, maxStalledCount: 0 });
  try {
    await worker.waitUntilReady();
    const deadline = Date.now() + 5000;
    while (recipients.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(recipients, [account.email]);
  } finally { await worker.close(); await connection.quit(); }
});

test("reset grant is single use, consumes OTP, and revokes the previous JWT", async () => {
  const account = await student();
  let code = "";
  helpers.__setOtpEmailTestListener((_to, value) => { code = value; });
  try {
    await helpers.issueOtp(account.email, { studentId: account.id, purpose: "reset" });
    const verified = await post("/verify-reset-otp", { email: account.email, code });
    assert.equal(verified.status, 200);
    const resetToken = (verified.body as any).resetToken;
    assert.equal(typeof resetToken, "string");
    assert.equal((await post("/verify-reset-otp", { email: account.email, code })).status, 400);
    const body = { email: account.email, resetToken, newPassword: "NewSecurePassword123!" };
    assert.equal((await post("/reset-password", body)).status, 200);
    assert.equal((await post("/reset-password", body)).status, 400);
    assert.equal((await originalFetch(base + "/me", { headers: { authorization: `Bearer ${account.token}` } })).status, 401);
    assert.equal((await post("/login", { email: account.email, password: body.newPassword })).status, 200);
  } finally { helpers.__setOtpEmailTestListener(null); }
});
