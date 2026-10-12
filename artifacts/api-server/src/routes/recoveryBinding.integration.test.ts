import assert from "node:assert/strict";
import { before, after, test, mock } from "node:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";

const url = process.env.DISPOSABLE_ROUTES_DATABASE_URL;
if (!url) throw new Error("Disposable local database required");
const target = new URL(url);
if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("disposable")) throw new Error("Unsafe database");
process.env.DATABASE_URL = url;
process.env.STUDENT_JWT_SECRET = "synthetic-recovery-only";
process.env.OTP_PEPPER = "synthetic-recovery-only";
delete process.env.REDIS_URL;
let pool: typeof import("@workspace/db").pool;
let server: Server;
let base: string;
let sequence = 0;
const run = Date.now();
const password = "Synthetic-New-2026!";
let hash: (value: string, rounds: number) => Promise<string>;
let digest: typeof import("../lib/otpDigest").computeOtpDigest;
let signSession: typeof import("../lib/authHelpers").signStudentToken;
let providerIdentity: object;

before(async () => {
  mock.module("../lib/socialProviders", { namedExports: {
    ProviderNotConfiguredError: class extends Error {},
    ProviderTokenInvalidError: class extends Error {},
    verifyProviderToken: async () => providerIdentity,
  } });
  pool = (await import("@workspace/db")).pool;
  hash = (await import("bcryptjs")).default.hash;
  digest = (await import("../lib/otpDigest")).computeOtpDigest;
  signSession = (await import("../lib/authHelpers")).signStudentToken;
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", (await import("./auth")).default);
  app.use("/api", (await import("./socialAuth")).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api`;
});
after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
});
async function account(provider = "google", verified = true) {
  const email = `recovery-${run}-${++sequence}@example.invalid`;
  return (await pool.query(`INSERT INTO students(name,email,account_type,auth_provider,email_verified,password_hash,google_id,facebook_id)
    VALUES('Synthetic Recovery',$1,'student',$2,$3,$4,$5,$6) RETURNING *`,
    [email, provider, verified, provider === "local" ? await hash("Original-2026!", 4) : null,
      provider === "google" ? email : null, provider === "facebook" ? email : null])).rows[0] as { id: number; email: string; token_version: number };
}
async function otp(a: { id: number; email: string }, bound: number | null = a.id, expired = false) {
  await pool.query("INSERT INTO email_otps(student_id,email,code,purpose,expires_at) VALUES($1,$2,$3,'reset',$4)",
    [bound, a.email, digest("reset", a.email, "123456", process.env.OTP_PEPPER!), new Date(Date.now() + (expired ? -1000 : 60000))]);
}
async function post(path: string, body: object) {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function grant(a: { id: number; email: string }) {
  await otp(a);
  const response = await post("/auth/verify-reset-otp", { email: a.email, code: "123456" });
  assert.equal(response.status, 200);
  return ((await response.json()) as { resetToken: string }).resetToken;
}
test("existing password and Google/Facebook first passwords preserve identity and revoke sessions", async () => {
  for (const provider of ["local", "google", "facebook"]) {
    const a = await account(provider, provider !== "google");
    const old = signSession(a.id, a.email, true, a.token_version);
    const before = (await pool.query("SELECT * FROM students WHERE id=$1", [a.id])).rows[0];
    const token = await grant(a);
    assert.equal((await post("/auth/reset-password", { email: a.email, resetToken: token, newPassword: password })).status, 200);
    const after = (await pool.query("SELECT * FROM students WHERE id=$1", [a.id])).rows[0];
    assert.equal(after.token_version, before.token_version + 1);
    for (const key of ["id", "google_id", "facebook_id", "auth_provider", "email", "email_verified"]) assert.equal(after[key], before[key]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM students WHERE email=$1", [a.email])).rows[0].n, 1);
    assert.equal((await post("/auth/login", { email: a.email, password })).status, 200);
    if (provider !== "local") {
      providerIdentity = { provider, providerId: a.email, email: a.email, emailTrust: "provider_attested", displayName: null, avatarUrl: null };
      const social = await post(`/auth/${provider}`, { token: "synthetic-provider-token" });
      assert.equal(social.status, 200);
      const body = await social.json() as { student: { id: number } };
      assert.equal(body.student.id, a.id);
    }
    assert.equal((await fetch(base + "/auth/me", { headers: { authorization: `Bearer ${old}` } })).status, 401);
    assert.equal((await post("/auth/reset-password", { email: a.email, resetToken: token, newPassword: password })).status, 400);
  }
});
test("cross-account, unbound and expired OTPs cannot issue grants or reset directly", async () => {
  const other = await account();
  for (const bound of [other.id, null]) {
    const a = await account();
    await otp(a, bound);
    assert.equal((await post("/auth/verify-reset-otp", { email: a.email, code: "123456" })).status, 400);
    assert.equal((await post("/auth/reset-password", { email: a.email, code: "123456", newPassword: password })).status, 400);
  }
  const expired = await account();
  await otp(expired, expired.id, true);
  assert.equal((await post("/auth/verify-reset-otp", { email: expired.email, code: "123456" })).status, 400);
});
test("email reassignment cannot redirect OTP or grant", async () => {
  const a = await account();
  await otp(a);
  await pool.query("UPDATE students SET email=$1 WHERE id=$2", ["old-" + a.email, a.id]);
  const b = await account();
  await pool.query("UPDATE students SET email=$1 WHERE id=$2", [a.email, b.id]);
  assert.equal((await post("/auth/verify-reset-otp", { email: a.email, code: "123456" })).status, 400);
  const c = await account();
  const token = await grant(c);
  await pool.query("UPDATE students SET email=$1 WHERE id=$2", ["old-" + c.email, c.id]);
  await pool.query("UPDATE students SET email=$1 WHERE id=$2", [c.email, b.id]);
  assert.equal((await post("/auth/reset-password", { email: c.email, resetToken: token, newPassword: password })).status, 400);
});
test("invalid/expired/wrong-account grants, weak passwords and ambiguous identities reject safely", async () => {
  const a = await account();
  const token = await grant(a);
  const b = await account();
  const expired = jwt.sign({ sub: a.id, email: a.email, tokenVersion: a.token_version, type: "password_reset", exp: 1 }, process.env.STUDENT_JWT_SECRET!);
  for (const [email, resetToken] of [[a.email, "invalid"], [a.email, expired], [b.email, token]])
    assert.equal((await post("/auth/reset-password", { email, resetToken, newPassword: password })).status, 400);
  assert.equal((await post("/auth/reset-password", { email: a.email, resetToken: token, newPassword: "weak" })).status, 400);
  const untrusted = await account("unknown", false);
  await otp(untrusted);
  assert.equal((await post("/auth/verify-reset-otp", { email: untrusted.email, code: "123456" })).status, 400);
});
test("legacy OTP and concurrent grant redemption are single-use", async () => {
  const a = await account();
  await otp(a);
  assert.equal((await post("/auth/reset-password", { email: a.email, code: "123456", newPassword: password })).status, 200);
  assert.equal((await post("/auth/reset-password", { email: a.email, code: "123456", newPassword: password })).status, 400);
  const b = await account();
  const token = await grant(b);
  const responses = await Promise.all([password, "Other-Synthetic-2026!"].map(newPassword => post("/auth/reset-password", { email: b.email, resetToken: token, newPassword })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
  assert.equal((await pool.query("SELECT token_version FROM students WHERE id=$1", [b.id])).rows[0].token_version, b.token_version + 1);
});

test("one account-bound OTP cannot issue two concurrent grants", async () => {
  const a = await account();
  await otp(a);
  const responses = await Promise.all([1, 2].map(() => post("/auth/verify-reset-otp", { email: a.email, code: "123456" })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
});

test("account eligibility is rechecked when redeeming a grant", async () => {
  for (const status of ["deactivated", "deleted"]) {
    const a = await account();
    const token = await grant(a);
    await pool.query("UPDATE students SET account_status=$1 WHERE id=$2", [status, a.id]);
    assert.equal((await post("/auth/reset-password", { email: a.email, resetToken: token, newPassword: password })).status, 400);
    assert.equal((await pool.query("SELECT password_hash FROM students WHERE id=$1", [a.id])).rows[0].password_hash, null);
  }
});
