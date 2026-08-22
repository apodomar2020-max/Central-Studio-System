import assert from "node:assert/strict";
import { after, before, test } from "node:test";

/**
 * Disposable-real-Postgres regression coverage for the UNIFIED OTP send-limit
 * policy (authHelpers.ts: issueOtp's cooldown/hourly/daily accounting and its
 * transaction-scoped advisory lock).
 *
 * Policy under test:
 *  - Cooldown remains scoped to email + purpose (unchanged).
 *  - Hourly (5) and daily (10) send limits are now ONE shared budget per
 *    normalized email across every OTP purpose (verify + reset combined).
 *  - The advisory lock is now keyed on email alone (not email+purpose), so
 *    concurrent verify/reset issuance for the same email serializes and
 *    cannot together exceed the shared budget.
 *  - OTP *authorization* (verification/consumption/invalidation) remains
 *    fully purpose-isolated — untouched by this policy change.
 *
 * Follows the exact safety-guard + fixture-lifecycle pattern already used by
 * authHelpers.otpExpiry.integration.test.ts: a disposable local database
 * only, real inserts, real assertions against real driver-returned rows,
 * cleanup in after(). Reuses that same disposable database (already
 * migrated, confirmed by the sibling suite) rather than provisioning a new
 * one — this file only adds email_otps/students rows scoped to its own
 * run-unique email suffix, so it cannot collide with that suite's data.
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
// API_SECRET_KEY has zero authorization significance in requireAuth
// (Security-04B/04C) — this placeholder value only exercises the legacy
// non-JWT-shaped-bearer compatibility path below, it is never compared
// against anything server-side.
process.env.API_SECRET_KEY ??= "test-otp-send-limits-api-secret-key";

let pool: typeof import("@workspace/db").pool;

const runSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function testEmail(tag: string): string {
  return `otpsend-${tag}-${runSuffix}@example.test`;
}

const createdStudentIds: number[] = [];
async function createStudent(tag: string): Promise<{ id: number; email: string }> {
  const email = testEmail(tag);
  const res = await pool.query(
    `INSERT INTO students (name, email) VALUES ('OTP Send Limits Test Student', $1) RETURNING id`,
    [email],
  );
  const id = res.rows[0].id as number;
  createdStudentIds.push(id);
  return { id, email };
}

before(async () => {
  pool = (await import("@workspace/db")).pool;
});

after(async () => {
  await pool.query(`DELETE FROM email_otps WHERE email LIKE $1`, [`otpsend-%-${runSuffix}@example.test`]);
  if (createdStudentIds.length > 0) {
    await pool.query(`DELETE FROM students WHERE id = ANY($1::int[])`, [createdStudentIds]);
  }
  await pool.end();
});

/** Raw-insert an email_otps row with an explicit createdAt, bypassing issueOtp entirely. */
async function insertRow(opts: {
  email: string;
  purpose: "verify" | "reset";
  code?: string;
  createdAtMsAgo: number;
  expiresAtMsFromCreated?: number;
  usedAt?: Date | null;
}): Promise<void> {
  const createdAt = new Date(Date.now() - opts.createdAtMsAgo);
  const expiresAt = new Date(createdAt.getTime() + (opts.expiresAtMsFromCreated ?? 600_000));
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, attempts, expires_at, used_at, created_at)
     VALUES (NULL, $1, $2, $3, 0, $4, $5, $6)`,
    [opts.email, opts.code ?? "000000", opts.purpose, expiresAt, opts.usedAt ?? null, createdAt],
  );
}

/** Insert `count` alternating verify/reset rows, all `msAgo` old (past cooldown for both purposes), oldest-first. */
async function insertAlternatingHistory(email: string, count: number, msAgo: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const purpose = i % 2 === 0 ? "verify" : "reset";
    await insertRow({ email, purpose, code: `9${i}0000`.padStart(6, "0"), createdAtMsAgo: msAgo - i * 500 });
  }
}

async function rowsForEmail(email: string): Promise<Array<{ purpose: string; used_at: string | null; created_at: string }>> {
  const res = await pool.query(
    `SELECT purpose, used_at, created_at FROM email_otps WHERE email = $1 ORDER BY created_at`,
    [email],
  );
  return res.rows;
}

// ═══ Combined hourly budget (1–6) ════════════════════════════════════════════

// 1. 1–5 combined verify/reset sends within one hour are allowed.
test("4 existing mixed-purpose sends within the hour + 1 more (5th total) is allowed", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("hourly-1to5");
  // 2 verify + 2 reset, all 50min old: within the hour, past the 60s cooldown for either purpose.
  await insertAlternatingHistory(email, 4, 50 * 60_000);
  await issueOtp(email, { purpose: "verify" }); // 5th total — must succeed
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, 5);
});

// 2. 6th combined hourly issuance blocked.
test("5 existing mixed-purpose sends within the hour → 6th (either purpose) is blocked", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("hourly-6th");
  await insertAlternatingHistory(email, 5, 50 * 60_000);
  await assert.rejects(
    () => issueOtp(email, { purpose: "reset" }),
    (err: unknown) => err instanceof OtpRateLimitError && /Too many verification codes/.test(err.message),
  );
});

// 3. Alternating purposes cannot bypass the hourly limit.
test("alternating verify/reset sends up to the hourly cap still blocks the next send of either purpose", async () => {
  const { issueOtp, OtpRateLimitError, OTP_MAX_SENDS_PER_HOUR } = await import("./authHelpers");
  const email = testEmail("hourly-alternate");
  await insertAlternatingHistory(email, OTP_MAX_SENDS_PER_HOUR, 45 * 60_000);
  // Next in the alternating sequence would be "verify" (index 5, even) — confirm it's blocked too.
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
  await assert.rejects(
    () => issueOtp(email, { purpose: "reset" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
});

// ═══ Combined daily budget (4–6) ═════════════════════════════════════════════

// 4. 1–10 combined daily sends allowed.
test("9 existing mixed-purpose sends within the day + 1 more (10th total) is allowed", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("daily-1to10");
  // All ~2h old: outside the 1h window (hourly check can't fire), inside 24h, past cooldown.
  await insertAlternatingHistory(email, 9, 2 * 60 * 60_000);
  await issueOtp(email, { purpose: "reset" }); // 10th total — must succeed
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, 10);
});

// 5. 11th combined daily issuance blocked.
test("10 existing mixed-purpose sends within the day → 11th (either purpose) is blocked", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("daily-11th");
  await insertAlternatingHistory(email, 10, 2 * 60 * 60_000);
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError && /Daily verification code limit reached/.test(err.message),
  );
});

// 6. Alternating purposes cannot bypass the daily limit.
test("alternating verify/reset sends up to the daily cap still blocks the next send of either purpose", async () => {
  const { issueOtp, OtpRateLimitError, OTP_MAX_SENDS_PER_DAY } = await import("./authHelpers");
  const email = testEmail("daily-alternate");
  await insertAlternatingHistory(email, OTP_MAX_SENDS_PER_DAY, 3 * 60 * 60_000);
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
  await assert.rejects(
    () => issueOtp(email, { purpose: "reset" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
});

// ═══ Purpose isolation — authorization (7–10) ════════════════════════════════

// 7. Reset OTP cannot verify email.
test("a reset-purpose code cannot be consumed by the email-verification flow", async () => {
  const { issueOtp, verifyEmailOtpForStudent } = await import("./authHelpers");
  const student = await createStudent("reset-not-verify");
  await issueOtp(student.email, { studentId: student.id, purpose: "reset" });
  const [row] = await pool.query(
    `SELECT code FROM email_otps WHERE email = $1 AND purpose = 'reset' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [student.email],
  ).then((r) => r.rows);
  const result = await verifyEmailOtpForStudent(student.id, student.email, row.code);
  assert.notEqual(result.status, "ok");
});

// 8. Verify OTP cannot reset password.
test("a verify-purpose code cannot be consumed by the password-reset flow", async () => {
  const { issueOtp, verifyOtpCode } = await import("./authHelpers");
  const email = testEmail("verify-not-reset");
  await issueOtp(email, { purpose: "verify" });
  const [row] = await pool.query(
    `SELECT code FROM email_otps WHERE email = $1 AND purpose = 'verify' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email],
  ).then((r) => r.rows);
  const result = await verifyOtpCode(email, row.code, "reset");
  assert.notEqual(result.status, "ok");
});

// 9. Verify invalidation remains verify-only.
test("issuing a new verify OTP invalidates only prior verify rows, not reset rows", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("invalidate-verify-only");
  await insertRow({ email, purpose: "verify", code: "111111", createdAtMsAgo: 70_000 });
  await insertRow({ email, purpose: "reset", code: "222222", createdAtMsAgo: 70_000 });
  await issueOtp(email, { purpose: "verify" }); // should invalidate only the "verify" row above

  const rows = await rowsForEmail(email);
  const oldVerify = rows.find((r) => r.purpose === "verify" && r.created_at && Number(new Date(r.created_at)) < Date.now() - 60_000);
  const oldReset = rows.find((r) => r.purpose === "reset");
  assert.ok(oldVerify?.used_at, "prior verify row must be invalidated (usedAt set)");
  assert.equal(oldReset?.used_at, null, "prior reset row must remain untouched by a verify issuance");
});

// 10. Reset invalidation remains reset-only.
test("issuing a new reset OTP invalidates only prior reset rows, not verify rows", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("invalidate-reset-only");
  await insertRow({ email, purpose: "verify", code: "333333", createdAtMsAgo: 70_000 });
  await insertRow({ email, purpose: "reset", code: "444444", createdAtMsAgo: 70_000 });
  await issueOtp(email, { purpose: "reset" }); // should invalidate only the "reset" row above

  const rows = await rowsForEmail(email);
  const oldReset = rows.find((r) => r.purpose === "reset" && r.created_at && Number(new Date(r.created_at)) < Date.now() - 60_000);
  const oldVerify = rows.find((r) => r.purpose === "verify");
  assert.ok(oldReset?.used_at, "prior reset row must be invalidated (usedAt set)");
  assert.equal(oldVerify?.used_at, null, "prior verify row must remain untouched by a reset issuance");
});

// ═══ Cooldown stays purpose-specific (11–13) ═════════════════════════════════

// 11/12. A verify send does not impose a reset cooldown.
test("issuing a verify OTP does not block an immediately-following reset OTP for the same email", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("cooldown-verify-then-reset");
  await issueOtp(email, { purpose: "verify" });
  // Must NOT throw — reset has its own, independent cooldown clock.
  await issueOtp(email, { purpose: "reset" });
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, 2);
});

// 13. A reset send does not impose a verify cooldown.
test("issuing a reset OTP does not block an immediately-following verify OTP for the same email", async () => {
  const { issueOtp } = await import("./authHelpers");
  const email = testEmail("cooldown-reset-then-verify");
  await issueOtp(email, { purpose: "reset" });
  // Must NOT throw — verify has its own, independent cooldown clock.
  await issueOtp(email, { purpose: "verify" });
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, 2);
});

// Same-purpose cooldown is still enforced (sanity: the split didn't accidentally remove it).
test("same-purpose resend within 60s is still blocked by cooldown (unchanged)", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("cooldown-same-purpose");
  await issueOtp(email, { purpose: "reset" });
  await assert.rejects(
    () => issueOtp(email, { purpose: "reset" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
});

// ═══ Window boundaries (14–15) ═══════════════════════════════════════════════

// 14. Hourly boundary: rows older than 1h (mixed purposes) do not count toward the hourly limit.
test("mixed-purpose rows older than the 1h window do not count toward the hourly limit", async () => {
  const { issueOtp, OTP_MAX_SENDS_PER_HOUR } = await import("./authHelpers");
  const email = testEmail("hourly-boundary-mixed");
  await insertAlternatingHistory(email, OTP_MAX_SENDS_PER_HOUR, 70 * 60_000); // all >1h old
  // Must NOT throw for the hourly reason — all prior rows are outside the hourly window.
  await issueOtp(email, { purpose: "verify" });
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, OTP_MAX_SENDS_PER_HOUR + 1);
});

// 15. Daily boundary: rows older than 24h (mixed purposes) do not count toward the daily limit.
test("mixed-purpose rows older than the 24h window do not count toward the daily limit", async () => {
  const { issueOtp, OTP_MAX_SENDS_PER_DAY } = await import("./authHelpers");
  const email = testEmail("daily-boundary-mixed");
  await insertAlternatingHistory(email, OTP_MAX_SENDS_PER_DAY, 25 * 60 * 60_000); // all >24h old
  await issueOtp(email, { purpose: "reset" }); // must NOT throw — all prior rows are outside the daily window
  const rows = await rowsForEmail(email);
  assert.equal(rows.length, OTP_MAX_SENDS_PER_DAY + 1);
});

// ═══ Email normalization (16) ════════════════════════════════════════════════

test("email case/whitespace variants are normalized to the same send-limit bucket", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const normalized = testEmail("normalize");
  const messyVariant = `  ${normalized.slice(0, normalized.indexOf("@")).toUpperCase()}${normalized.slice(normalized.indexOf("@"))}  `;
  await issueOtp(normalized, { purpose: "verify" });
  // Same account under a case/whitespace variant must be blocked by the same cooldown clock.
  await assert.rejects(
    () => issueOtp(messyVariant, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
  const rows = await rowsForEmail(normalized);
  assert.equal(rows.length, 1, "the messy-variant attempt must not have inserted a second, differently-cased row");
});

// ═══ Failed delivery cleanup (17) ═════════════════════════════════════════════

test("a failed provider delivery deletes its row and does not consume the shared quota or trigger cooldown", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env["BREVO_API_KEY"] = "test-brevo-key";
  process.env["EMAIL_FROM"] = "Central Studio <no-reply@centralstudioco.com>";
  globalThis.fetch = (async (_url: unknown, _init?: RequestInit) => ({ ok: false, status: 500, text: async () => "" }) as Response) as typeof fetch;

  try {
    const { issueOtp, EmailDeliveryError } = await import("./authHelpers");
    const email = testEmail("failed-delivery");

    await assert.rejects(() => issueOtp(email, { purpose: "verify" }), EmailDeliveryError);
    const rowsAfterFailure = await rowsForEmail(email);
    assert.equal(rowsAfterFailure.length, 0, "the row inserted by the failed attempt must be deleted");

    // Restore a working transport and confirm the failed attempt did not
    // consume the cooldown or the shared hourly/daily budget.
    globalThis.fetch = originalFetch;
    delete process.env["BREVO_API_KEY"];
    delete process.env["EMAIL_FROM"];
    await issueOtp(email, { purpose: "verify" }); // must succeed immediately — no leftover cooldown/quota consumption
    const rowsAfterRetry = await rowsForEmail(email);
    assert.equal(rowsAfterRetry.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

// ═══ Timestamp parsing regression (18) ═══════════════════════════════════════

test("toEpochMs-based hourly filtering still applies correctly to the unified all-purpose query", async () => {
  const { issueOtp, OtpRateLimitError, OTP_MAX_SENDS_PER_HOUR } = await import("./authHelpers");
  const email = testEmail("epoch-regression");
  // Rows straddling the hour boundary: half just inside, half just outside.
  for (let i = 0; i < OTP_MAX_SENDS_PER_HOUR; i++) {
    await insertRow({ email, purpose: i % 2 === 0 ? "verify" : "reset", code: `5${i}0000`.padStart(6, "0"), createdAtMsAgo: 59 * 60_000 + i * 1000 });
  }
  await assert.rejects(
    () => issueOtp(email, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError && /Too many verification codes/.test(err.message),
  );
});

// ═══ Route-level contract checks (19–20) ═════════════════════════════════════

let app: import("express").Express;
let server: import("node:http").Server;
let port: number;

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const authRouter = (await import("../routes/auth")).default;
  const emailOtpRouter = (await import("../routes/emailOtp")).default;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(authRouter);
  app.use(emailOtpRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

async function studentToken(studentId: number, email: string): Promise<string> {
  const jwt = (await import("jsonwebtoken")).default;
  const { STUDENT_JWT_SECRET } = await import("../middlewares/auth");
  return jwt.sign({ sub: studentId, email, type: "student", emailVerified: false }, STUDENT_JWT_SECRET);
}

// 19. Forgot-password remains generic even when the unified limit is exhausted.
test("POST /auth/forgot-password stays generic-200 once the shared hourly budget is exhausted", async () => {
  const student = await createStudent("route-forgot-generic");
  await insertAlternatingHistory(student.email, 5, 45 * 60_000); // exhaust the shared hourly budget

  // Anonymous requests (no student session yet) send a non-JWT-shaped bearer
  // token here purely as legacy-client compatibility coverage — requireAuth
  // treats it as anonymous and never compares it against anything (see
  // middlewares/auth.ts). forgot-password is a public route either way.
  const res = await fetch(apiUrl("/auth/forgot-password"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.API_SECRET_KEY}` },
    body: JSON.stringify({ email: student.email }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; message?: string; retryAfter?: number };
  assert.equal(body.ok, true);
  assert.ok(!("retryAfter" in body), "generic response must never expose rate-limit internals");
});

// 20. Verify/send-otp endpoint retains its existing 429 contract when the shared budget is exhausted.
test("POST /auth/send-otp still returns 429 + retryAfter once the shared hourly budget is exhausted", async () => {
  const student = await createStudent("route-send-otp-429");
  await insertAlternatingHistory(student.email, 5, 45 * 60_000); // exhaust the shared hourly budget
  const token = await studentToken(student.id, student.email);

  const res = await fetch(apiUrl("/auth/send-otp"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ email: student.email }),
  });
  assert.equal(res.status, 429);
  const body = await res.json() as { error: string; retryAfter: number; retryAfterSeconds: number };
  assert.equal(typeof body.retryAfter, "number");
  assert.equal(typeof body.retryAfterSeconds, "number");
});

// ═══ Concurrency (21–22) ══════════════════════════════════════════════════════

// 21. Concurrent verify + reset issuance at the threshold cannot exceed the shared budget.
test("concurrent verify + reset issuance at the hourly boundary: exactly one succeeds, the shared budget is not exceeded", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const email = testEmail("concurrency-race");
  // 4 existing mixed-purpose rows — one slot left in the shared hourly budget of 5.
  await insertAlternatingHistory(email, 4, 50 * 60_000);

  const [verifyResult, resetResult] = await Promise.allSettled([
    issueOtp(email, { purpose: "verify" }),
    issueOtp(email, { purpose: "reset" }),
  ]);

  const outcomes = [verifyResult, resetResult];
  const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
  const rejected = outcomes.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent issuances must succeed — the email-scoped lock must serialize them");
  assert.equal(rejected.length, 1, "the other must be blocked by the shared hourly budget, not silently allowed through");
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof OtpRateLimitError);

  const rows = await rowsForEmail(email);
  assert.equal(rows.length, 5, "the shared hourly budget of 5 must not be exceeded even under concurrent alternating-purpose issuance");
});

// 22. Different emails remain independently limited.
test("two different emails at their own hourly caps do not affect one another", async () => {
  const { issueOtp, OtpRateLimitError } = await import("./authHelpers");
  const emailA = testEmail("independent-a");
  const emailB = testEmail("independent-b");
  await insertAlternatingHistory(emailA, 5, 50 * 60_000); // email A exhausted

  await assert.rejects(
    () => issueOtp(emailA, { purpose: "verify" }),
    (err: unknown) => err instanceof OtpRateLimitError,
  );
  // Email B has no history at all — must succeed, completely unaffected by A's exhausted budget.
  await issueOtp(emailB, { purpose: "verify" });
  const rowsB = await rowsForEmail(emailB);
  assert.equal(rowsB.length, 1);
});
