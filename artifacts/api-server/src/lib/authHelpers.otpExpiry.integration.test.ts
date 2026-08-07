import assert from "node:assert/strict";
import { after, before, test } from "node:test";

/**
 * Disposable-real-Postgres regression coverage for the OTP immediate-expiry
 * fix (authHelpers.ts: verifyOtpInTransaction's expiry check, issueOtp's
 * hourly-limit filter). Follows the exact safety-guard + fixture-lifecycle
 * pattern already used by schedulesLifecycle.integration.test.ts: a
 * disposable local database only, real inserts, real assertions against
 * real driver-returned rows, cleanup in after().
 *
 * This is deliberately a REAL Postgres round trip, not a mock — the defect
 * this fixes only manifests once a value has gone through the actual `pg`
 * driver's timestamptz type parser and Drizzle's mapFromDriverValue. A
 * mocked/in-memory test would not exercise that path and would not have
 * caught the original bug.
 */
const DATABASE_URL = process.env.DISPOSABLE_OTP_EXPIRY_TEST_DATABASE_URL
  ?? "postgresql://127.0.0.1:5432/central_studio_disposable_otp_expiry";
const databaseUrl = new URL(DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
  !/disposable|test|local/i.test(databaseUrl.pathname) ||
  /railway/i.test(DATABASE_URL)
) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV ??= "test"; // ensures issueOtp's sendOtpEmail() takes the safe DEV MODE no-op path, never a real network call

let pool: typeof import("@workspace/db").pool;
let studentId: number;
let studentEmail: string;

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function testEmail(tag: string): string {
  return `otpfix-${tag}-${runSuffix}@example.test`;
}

before(async () => {
  pool = (await import("@workspace/db")).pool;
  studentEmail = testEmail("verify-path");
  const res = await pool.query(
    `INSERT INTO students (name, email) VALUES ('OTP Fix Test Student', $1) RETURNING id`,
    [studentEmail],
  );
  studentId = res.rows[0].id;
});

after(async () => {
  await pool.query(`DELETE FROM email_otps WHERE email LIKE $1`, [`otpfix-%-${runSuffix}@example.test`]);
  await pool.query(`DELETE FROM students WHERE id = $1`, [studentId]);
  await pool.end();
});

async function latestUnusedCode(email: string, purpose: string): Promise<string> {
  const res = await pool.query(
    `SELECT code FROM email_otps WHERE email = $1 AND purpose = $2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  assert.ok(res.rows[0], `expected an unused OTP row for ${email}/${purpose}`);
  return res.rows[0].code as string;
}

/** Raw-insert an email_otps row with an explicit createdAt/expiresAt, bypassing issueOtp entirely. */
async function insertRow(opts: {
  email: string;
  purpose: string;
  code?: string;
  createdAtMsAgo: number;
  expiresAtMsFromCreated: number;
  usedAt?: Date | null;
  attempts?: number;
}): Promise<void> {
  const createdAt = new Date(Date.now() - opts.createdAtMsAgo);
  const expiresAt = new Date(createdAt.getTime() + opts.expiresAtMsFromCreated);
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, attempts, expires_at, used_at, created_at)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
    [opts.email, opts.code ?? "000000", opts.purpose, opts.attempts ?? 0, expiresAt, opts.usedAt ?? null, createdAt],
  );
}

// ─── 1. Fresh OTP: issue → immediately verify → success ─────────────────────
test("issue OTP then immediately verify → success (real DB round trip)", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("immediate");
  await issueOtp(email, { purpose: "verify" });
  const code = await latestUnusedCode(email, "verify");
  const result = await verifyOtpCode(email, code, "verify");
  assert.deepEqual(result, { status: "ok" });
});

// ─── 2. Valid OTP shortly before expiry → success ────────────────────────────
test("OTP verified a few seconds before its 600s expiry → success", async () => {
  const { verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("near-expiry");
  await insertRow({ email, purpose: "verify", code: "111222", createdAtMsAgo: 598_000, expiresAtMsFromCreated: 600_000 });
  const result = await verifyOtpCode(email, "111222", "verify");
  assert.deepEqual(result, { status: "ok" });
});

// ─── 3. OTP after real TTL elapse → expired ──────────────────────────────────
test("OTP verified after its expiry has genuinely passed → expired", async () => {
  const { verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("past-expiry");
  await insertRow({ email, purpose: "verify", code: "222333", createdAtMsAgo: 700_000, expiresAtMsFromCreated: 600_000 });
  const result = await verifyOtpCode(email, "222333", "verify");
  assert.deepEqual(result, { status: "expired" });
});

// ─── 6. Resend: newest OTP works; previous OTP is invalidated ───────────────
test("resend issues a new usable code and invalidates the previous one", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("resend");
  // Simulate an earlier issuance old enough that a fresh issueOtp() call won't
  // be blocked by the (unmodified) resend cooldown.
  await insertRow({ email, purpose: "verify", code: "333444", createdAtMsAgo: 70_000, expiresAtMsFromCreated: 600_000 });

  await issueOtp(email, { purpose: "verify" }); // real resend
  const newCode = await latestUnusedCode(email, "verify");
  assert.notEqual(newCode, "333444");

  const newResult = await verifyOtpCode(email, newCode, "verify");
  assert.deepEqual(newResult, { status: "ok" });
});

test("previous OTP after resend follows existing invalidation policy (rejected, not falsely accepted)", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("resend-old-code");
  await insertRow({ email, purpose: "verify", code: "444555", createdAtMsAgo: 70_000, expiresAtMsFromCreated: 600_000 });
  await issueOtp(email, { purpose: "verify" }); // invalidates the row above, inserts a new one

  const result = await verifyOtpCode(email, "444555", "verify");
  assert.notEqual(result.status, "ok");
});

// ─── 7. Verification-email OTP path (verifyEmailOtpForStudent) → success ────
test("verifyEmailOtpForStudent: real student, issued code, immediate verify → success and marks emailVerified", async () => {
  const { issueOtp, verifyEmailOtpForStudent } = await import("./authHelpers");
  await issueOtp(studentEmail, { studentId, purpose: "verify" });
  const code = await latestUnusedCode(studentEmail, "verify");
  const result = await verifyEmailOtpForStudent(studentId, studentEmail, code);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.student.emailVerified, true);
  }
});

// ─── 8. Password-reset OTP path (verifyOtpCode, purpose "reset") → success ──
test("password-reset OTP path: issue → immediately verify (purpose=reset) → success", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("reset-path");
  await issueOtp(email, { purpose: "reset" });
  const code = await latestUnusedCode(email, "reset");
  const result = await verifyOtpCode(email, code, "reset");
  assert.deepEqual(result, { status: "ok" });
});

// ─── 9. Attempts/lockout unchanged ───────────────────────────────────────────
test("attempts increment on wrong code and lock out after OTP_MAX_ATTEMPTS (unchanged)", async () => {
  const { issueOtp, verifyOtpCode, OTP_MAX_ATTEMPTS } = await import("./authHelpers");
  const email = testEmail("lockout");
  await issueOtp(email, { purpose: "verify" });
  const realCode = await latestUnusedCode(email, "verify");
  const wrongCode = realCode === "999999" ? "888888" : "999999";

  for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt++) {
    const result = await verifyOtpCode(email, wrongCode, "verify");
    assert.deepEqual(result, { status: "invalid", attemptsLeft: OTP_MAX_ATTEMPTS - attempt });
  }
  const finalWrong = await verifyOtpCode(email, wrongCode, "verify");
  assert.deepEqual(finalWrong, { status: "locked" });

  // Even the correct code must be rejected once locked (unchanged security control).
  const correctAfterLock = await verifyOtpCode(email, realCode, "verify");
  assert.deepEqual(correctAfterLock, { status: "locked" });
});

// ─── 10. TTL remains 600 seconds by default ──────────────────────────────────
test("OTP_TTL_SECONDS default remains 600 (no TTL policy change)", async () => {
  const { OTP_TTL_SECONDS } = await import("./authHelpers");
  if (!process.env.OTP_TTL_SECONDS) {
    assert.equal(OTP_TTL_SECONDS, 600);
  }
});

// ─── 12. Hourly rate limit: recent rows are counted correctly after the fix ─
test("hourly send limit blocks the next issuance once OTP_MAX_SENDS_PER_HOUR recent rows exist", async () => {
  const { issueOtp, OTP_MAX_SENDS_PER_HOUR, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("hourly-limit");
  // All rows ~50 minutes old: within the 1h window, but well past the 60s
  // resend cooldown, so only the hourly cap can be the thing that blocks.
  for (let i = 0; i < OTP_MAX_SENDS_PER_HOUR; i++) {
    await insertRow({ email, purpose: "verify", code: `10000${i}`, createdAtMsAgo: 50 * 60_000 - i * 1000, expiresAtMsFromCreated: 600_000 });
  }
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError && /Too many verification codes/.test(err.message),
  );
});

// ─── 13. Hourly rate-limit boundary: rows older than 1h are excluded ────────
test("rows older than the 1h window do not count toward the hourly limit (fix does not overcorrect)", async () => {
  const { issueOtp, OTP_MAX_SENDS_PER_HOUR } = await import("./authHelpers");
  const email = testEmail("hourly-boundary");
  for (let i = 0; i < OTP_MAX_SENDS_PER_HOUR; i++) {
    await insertRow({ email, purpose: "verify", code: `20000${i}`, createdAtMsAgo: 70 * 60_000 - i * 1000, expiresAtMsFromCreated: 600_000 });
  }
  // Must NOT throw — all prior rows are outside the hourly window.
  await issueOtp(email, { purpose: "verify" });
  const code = await latestUnusedCode(email, "verify");
  assert.ok(code);
});

// ─── 14. Daily rate-limit behavior unchanged ─────────────────────────────────
test("daily send limit still blocks once OTP_MAX_SENDS_PER_DAY rows exist within 24h (unchanged, SQL-side)", async () => {
  const { issueOtp, OTP_MAX_SENDS_PER_DAY, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("daily-limit");
  // All rows ~2h old: outside the 1h window (so the hourly check can't be
  // what fires), inside the 24h window, past the 60s cooldown.
  for (let i = 0; i < OTP_MAX_SENDS_PER_DAY; i++) {
    await insertRow({ email, purpose: "verify", code: `30000${i}`.padStart(6, "0"), createdAtMsAgo: 2 * 60 * 60_000 - i * 1000, expiresAtMsFromCreated: 600_000 });
  }
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError && /Daily verification code limit reached/.test(err.message),
  );
});

// ─── 15. Resend cooldown unchanged ───────────────────────────────────────────
test("resend cooldown still blocks an immediate second issuance (unchanged)", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("cooldown");
  await issueOtp(email, { purpose: "verify" });
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
});
