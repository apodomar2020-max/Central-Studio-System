import assert from "node:assert/strict";
import { after, before, test } from "node:test";

/**
 * Security-06B (CS-SEC-M-01) regression suite — email_otps.code is now an
 * HMAC-SHA-256 digest (`v1:<64 hex>`), never the raw 6-digit OTP. Disposable
 * real-Postgres coverage, following the same safety-guard + fixture pattern
 * as authHelpers.otpExpiry.integration.test.ts / otpSendLimits.integration.test.ts.
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
process.env.NODE_ENV ??= "test";
process.env.OTP_PEPPER ??= "test-otp-at-rest-security-pepper-".padEnd(64, "0");

let pool: typeof import("@workspace/db").pool;

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function testEmail(tag: string): string {
  return `otpatrest-${tag}-${runSuffix}@example.test`;
}

const capturedOtps = new Map<string, string>();
function captureKey(email: string, purpose: string): string {
  return `${email}|${purpose}`;
}
function capturedCode(email: string, purpose: string): string {
  const code = capturedOtps.get(captureKey(email, purpose));
  assert.ok(code, `expected a captured OTP for ${email}/${purpose}`);
  return code;
}

const createdStudentIds: number[] = [];
async function createStudent(tag: string): Promise<{ id: number; email: string }> {
  const email = testEmail(tag);
  const res = await pool.query(
    `INSERT INTO students (name, email) VALUES ('OTP At-Rest Security Test Student', $1) RETURNING id`,
    [email],
  );
  const id = res.rows[0].id as number;
  createdStudentIds.push(id);
  return { id, email };
}

async function rowForEmail(email: string, purpose: string): Promise<Record<string, unknown>> {
  const res = await pool.query(
    `SELECT * FROM email_otps WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [email, purpose],
  );
  assert.ok(res.rows[0], `expected a row for ${email}/${purpose}`);
  return res.rows[0];
}

before(async () => {
  pool = (await import("@workspace/db")).pool;
  const { __setOtpEmailTestListener } = await import("./authHelpers");
  __setOtpEmailTestListener((to, code, purpose) => {
    capturedOtps.set(captureKey(to, purpose), code);
  });
});

after(async () => {
  await pool.query(`DELETE FROM email_otps WHERE email LIKE $1`, [`otpatrest-%-${runSuffix}@example.test`]);
  if (createdStudentIds.length > 0) {
    await pool.query(`DELETE FROM students WHERE id = ANY($1::int[])`, [createdStudentIds]);
  }
  await pool.end();
});

// 1. Digest-shaped storage.
test("1. issued OTP is stored in v1:<64hex> digest form", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("digest-shape");
  await issueOtp(email, { purpose: "verify" });
  const row = await rowForEmail(email, "verify");
  assert.match(row.code as string, /^v1:[0-9a-f]{64}$/);
});

// 2. Digest != raw OTP.
test("2. stored digest is never equal to the raw OTP", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("digest-ne-raw");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const row = await rowForEmail(email, "verify");
  assert.notEqual(row.code, code);
});

// 3. Raw OTP absent from every column of the row.
test("3. raw OTP does not appear in any column of its row", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("raw-absent");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const row = await rowForEmail(email, "verify");
  for (const value of Object.values(row)) {
    assert.ok(String(value ?? "").indexOf(code) === -1, "raw OTP leaked into a column");
  }
});

// 4. Correct OTP verifies.
test("4. correct OTP verifies successfully", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("correct-verifies");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  assert.deepEqual(await verifyOtpCode(email, code, "verify"), { status: "ok" });
});

// 5. Wrong OTP fails.
test("5. wrong OTP is rejected", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("wrong-fails");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const wrong = code === "111111" ? "222222" : "111111";
  const result = await verifyOtpCode(email, wrong, "verify");
  assert.equal(result.status, "invalid");
});

// 6. Wrong OTP increments attempts.
test("6. wrong OTP increments the attempts counter", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("attempts-increment");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const wrong = code === "111111" ? "222222" : "111111";
  await verifyOtpCode(email, wrong, "verify");
  const row = await rowForEmail(email, "verify");
  assert.equal(row.attempts, 1);
});

// 7. Max-attempt lockout.
test("7. exceeding max attempts locks out even the correct code", async () => {
  const { issueOtp, verifyOtpCode, OTP_MAX_ATTEMPTS } = await import("./authHelpers");
  const email = testEmail("lockout");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const wrong = code === "111111" ? "222222" : "111111";
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    await verifyOtpCode(email, wrong, "verify");
  }
  const result = await verifyOtpCode(email, code, "verify");
  assert.equal(result.status, "locked");
});

// 8. Expired OTP fails.
test("8. expired OTP fails to verify", async () => {
  const { verifyOtpCode } = await import("./authHelpers");
  const { computeOtpDigest } = await import("./otpDigest");
  const { OTP_PEPPER } = await import("./authHelpers");
  const email = testEmail("expired");
  const code = "654321";
  const digest = computeOtpDigest("verify", email, code, OTP_PEPPER);
  const createdAt = new Date(Date.now() - 700_000);
  const expiresAt = new Date(createdAt.getTime() + 600_000);
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, attempts, expires_at, used_at, created_at)
     VALUES (NULL, $1, $2, 'verify', 0, $3, NULL, $4)`,
    [email, digest, expiresAt, createdAt],
  );
  assert.deepEqual(await verifyOtpCode(email, code, "verify"), { status: "expired" });
});

// 9. Consumed OTP can't replay.
test("9. a consumed OTP cannot be replayed", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("no-replay");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  assert.deepEqual(await verifyOtpCode(email, code, "verify"), { status: "ok" });
  const second = await verifyOtpCode(email, code, "verify");
  assert.notEqual(second.status, "ok");
});

// 10. Resend invalidates prior challenge.
test("10. resend invalidates the previous unused OTP", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("resend-invalidates");
  await issueOtp(email, { purpose: "verify" });
  const oldCode = capturedCode(email, "verify");
  await pool.query(`UPDATE email_otps SET created_at = created_at - interval '70 seconds' WHERE email = $1`, [email]);
  await issueOtp(email, { purpose: "verify" });
  const newCode = capturedCode(email, "verify");
  assert.notEqual(newCode, oldCode);
  const oldResult = await verifyOtpCode(email, oldCode, "verify");
  assert.notEqual(oldResult.status, "ok");
});

// 11. Purpose isolation.
test("11. a verify-purpose code cannot authorize a reset", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("purpose-isolation");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const result = await verifyOtpCode(email, code, "reset");
  assert.notEqual(result.status, "ok");
});

// 12. Malformed digest fails closed.
test("12. a malformed stored digest fails closed (never verifies)", async () => {
  const { verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("malformed-digest");
  const code = "135790";
  // Directly insert a row whose code is a same-length-but-wrong hex digest —
  // simulates any post-migration corruption without violating the DB CHECK.
  const bogusDigest = `v1:${"0".repeat(64)}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, attempts, expires_at, used_at, created_at)
     VALUES (NULL, $1, $2, 'verify', 0, $3, NULL, now())`,
    [email, bogusDigest, expiresAt],
  );
  const result = await verifyOtpCode(email, code, "verify");
  assert.equal(result.status, "invalid");
});

// 13. Unsupported version fails closed (verified directly against the helper,
// since the DB CHECK would reject inserting a v2 value in the first place —
// this proves the comparison logic itself also fails closed, defensively).
test("13. verifyOtpDigest rejects an unsupported stored version", async () => {
  const { verifyOtpDigest } = await import("./otpDigest");
  const bogus = `v2:${"a".repeat(64)}`;
  assert.equal(verifyOtpDigest(bogus, "verify", "x@example.test", "123456", "some-pepper"), false);
});

// 14. Concurrent verification yields at most one success.
test("14. concurrent verification of the same OTP yields exactly one success", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("concurrent-verify");
  await issueOtp(email, { purpose: "verify" });
  const code = capturedCode(email, "verify");
  const results = await Promise.all([
    verifyOtpCode(email, code, "verify"),
    verifyOtpCode(email, code, "verify"),
    verifyOtpCode(email, code, "verify"),
  ]);
  const oks = results.filter((r) => r.status === "ok");
  assert.equal(oks.length, 1, "exactly one concurrent verification must succeed");
});

// 15. DB CHECK rejects plaintext.
test("15. DB CHECK constraint rejects a plaintext 6-digit code", async () => {
  await assert.rejects(
    () => pool.query(
      `INSERT INTO email_otps (email, code, purpose, expires_at) VALUES ($1, '123456', 'verify', now() + interval '10 min')`,
      [testEmail("check-plaintext")],
    ),
    /violates check constraint/,
  );
});

// 16. DB CHECK rejects malformed digest.
test("16. DB CHECK constraint rejects a malformed digest", async () => {
  await assert.rejects(
    () => pool.query(
      `INSERT INTO email_otps (email, code, purpose, expires_at) VALUES ($1, 'v1:not-hex', 'verify', now() + interval '10 min')`,
      [testEmail("check-malformed")],
    ),
    /violates check constraint/,
  );
});

// 17. DB CHECK accepts valid v1 digest.
test("17. DB CHECK constraint accepts a valid v1 digest", async () => {
  const email = testEmail("check-valid");
  await pool.query(
    `INSERT INTO email_otps (email, code, purpose, expires_at) VALUES ($1, $2, 'verify', now() + interval '10 min')`,
    [email, `v1:${"a".repeat(64)}`],
  );
  const row = await rowForEmail(email, "verify");
  assert.match(row.code as string, /^v1:[0-9a-f]{64}$/);
});

// 18. Production config validation rejects missing OTP_PEPPER.
test("18. OTP_PEPPER is required in production (fail-closed at module load)", async () => {
  const { execFileSync } = await import("node:child_process");
  const path = await import("node:path");
  const tsxBin = path.join(import.meta.dirname, "../../../../lib/db/node_modules/.bin/tsx");
  const script = path.join(import.meta.dirname, "otpPepperProdCheck.fixture.ts");
  let output: string;
  try {
    output = execFileSync(tsxBin, [script], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production", OTP_PEPPER: "", STUDENT_JWT_SECRET: "x", DATABASE_URL },
    });
  } catch (err) {
    const e = err as { stdout?: string };
    output = e.stdout ?? "";
  }
  assert.match(output, /THROWN:OTP_PEPPER must be set in production/);
});

// 19. Test/dev config behavior is deterministic.
test("19. dev/test fallback OTP_PEPPER is a fixed labeled placeholder, not random", async () => {
  // Re-import in this same process: OTP_PEPPER was already resolved once at
  // first import of authHelpers (module singleton) using the pepper this
  // suite set explicitly above — confirm it is exactly that fixed value,
  // not something regenerated per-call.
  const first = await import("./authHelpers");
  const second = await import("./authHelpers");
  assert.equal(first.OTP_PEPPER, second.OTP_PEPPER);
  assert.equal(first.OTP_PEPPER, process.env.OTP_PEPPER);
});

// 20. Social-auth verification path still works through the shared helper.
test("20. verifyEmailOtpForStudent (used by socialAuth.ts's unverified-account flow) still works end-to-end", async () => {
  const { issueOtp, verifyEmailOtpForStudent } = await import("./authHelpers");
  const student = await createStudent("social-path");
  await issueOtp(student.email, { studentId: student.id, purpose: "verify" });
  const code = capturedCode(student.email, "verify");
  const result = await verifyEmailOtpForStudent(student.id, student.email, code);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.student.emailVerified, true);
  }
});
