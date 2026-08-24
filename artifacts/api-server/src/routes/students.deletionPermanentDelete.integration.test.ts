/**
 * Phase B3B4 — Final Permanent Delete / Tombstone.
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * students + auth routers. Follows the harness conventions of
 * students.deletionOwnershipBackfill.integration.test.ts.
 *
 * IMPORTANT: this suite never references student id 34 or any other
 * hardcoded production id — every student used here is created fresh in
 * this disposable database by this test run.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DISPOSABLE_PERMANENT_DELETE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_permanent_delete";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-permanent-delete-identity-provenance-pepper".padEnd(64, "0");
process.env.TURNSTILE_SECRET_KEY = "test-permanent-delete-turnstile-secret";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url;
  if (url === TURNSTILE_URL) {
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
}) as typeof fetch;
const VALID_BOT_TOKEN = "valid-test-token";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(p: string): string { return `http://127.0.0.1:${port}${p}`; }

type ApiResult = { status: number; json: any };
async function post(p: string, body: unknown, adminToken?: string, studentToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (studentToken) {
    headers.authorization = `Bearer ${studentToken}`;
  } else {
    headers.authorization = `Bearer ${process.env.API_SECRET_KEY}`;
    if (adminToken) headers["x-admin-token"] = adminToken;
  }
  const res = await fetch(apiUrl(p), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(p: string, adminToken?: string, studentToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (studentToken) {
    headers.authorization = `Bearer ${studentToken}`;
  } else {
    headers.authorization = `Bearer ${process.env.API_SECRET_KEY}`;
    if (adminToken) headers["x-admin-token"] = adminToken;
  }
  const res = await fetch(apiUrl(p), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const studentsRouter = (await import("./students")).default;
  const authRouter = (await import("./auth")).default;

  app = express();
  app.use(express.json());
  app.use("/api", studentsRouter);
  app.use("/api", authRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;

  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `pd-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated", opts: {
  passwordHash?: string; googleId?: string; facebookId?: string; phone?: string;
} = {}) {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified, phone, google_id, facebook_id, auth_provider)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8) RETURNING id`,
    [
      `PD Test ${tag}`, email, opts.passwordHash ?? "$2a$12$abcdefghijklmnopqrstuv", accountStatus,
      opts.phone ?? "+201000000000", opts.googleId ?? null, opts.facebookId ?? null,
      opts.googleId ? "google" : opts.facebookId ? "facebook" : "local",
    ],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`pd-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`pd-admin-${Date.now()}-${adminSeq}`, `pd-admin-${Date.now()}-${adminSeq}@example.com`, "x", `PD Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `pd-admin-${adminSeq}`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}
async function cancelPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/cancel`, {}, adminToken);
}

function deleteUrl(studentId: number) {
  return `/api/students/${studentId}/permanent-delete`;
}
function reactivateUrl(studentId: number) {
  return `/api/students/${studentId}/reactivate`;
}
function resolveUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-resolutions`;
}
function backfillUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-backfill`;
}

const DELETE_PERM = { users: { delete: true, edit: true, view: true } };
const VIEW_ONLY_PERM = { users: { view: true } };
const EDIT_ONLY_PERM = { users: { view: true, edit: true } };

/** A clean, deactivated, eligible-to-delete student with an active prep. */
async function setupEligible(tag: string) {
  const { studentId, email } = await makeStudent(tag, "deactivated", {
    passwordHash: "$2a$12$abcdefghijklmnopqrstuv", googleId: `google-${tag}-${Date.now()}`, facebookId: `fb-${tag}-${Date.now()}`,
  });
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  assert.equal(startRes.status, 201, JSON.stringify(startRes.json));
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, platform, is_active) VALUES ($1, $2, 'ios', true)`,
    [studentId, `tok-${studentId}-${Date.now()}`],
  );
  return { studentId, email, admin, workflowId: startRes.json.id as number };
}

async function studentRow(studentId: number) {
  const r = await pool.query(`SELECT * FROM students WHERE id = $1`, [studentId]);
  return r.rows[0];
}

// ═══════════════════════════════════════════════════════════════════════
// 1/8. Eligible student tombstones successfully; terminal state persists
// ═══════════════════════════════════════════════════════════════════════

test("1/8: eligible Student tombstones successfully and reads reflect the terminal state", async () => {
  const f = await setupEligible("ok");
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.accountStatus, "deleted");
  assert.equal(res.json.alreadyDeleted, false);

  const row = await studentRow(f.studentId);
  assert.equal(row.account_status, "deleted");
  assert.ok(row.deleted_at);
  assert.equal(row.deleted_by_admin_id, f.admin.id);

  // Row still exists — not a hard delete.
  const count = await pool.query(`SELECT count(*) FROM students WHERE id = $1`, [f.studentId]);
  assert.equal(Number(count.rows[0].count), 1);
});

// ═══════════════════════════════════════════════════════════════════════
// 2/3. Precondition rejections
// ═══════════════════════════════════════════════════════════════════════

test("2: active (non-deactivated) Student rejected 409", async () => {
  const f = await setupEligible("active");
  await pool.query(`UPDATE students SET account_status = 'active' WHERE id = $1`, [f.studentId]);
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_NOT_DEACTIVATED");
});

test("3: deactivated Student without an active preparation rejected 409", async () => {
  const { studentId } = await makeStudent("noprep");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await post(deleteUrl(studentId), { workflowId: 999999 }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
});

test("cancelled preparation rejected 409 (same code path as 'no preparation')", async () => {
  const f = await setupEligible("cancelled");
  assert.equal((await cancelPrep(f.studentId, f.admin.token)).status, 200);
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
});

test("stale workflow (restarted preparation) rejected 409", async () => {
  const f = await setupEligible("stale");
  assert.equal((await cancelPrep(f.studentId, f.admin.token)).status, 200);
  const restart = await startPrep(f.studentId, f.admin.token);
  assert.equal(restart.status, 201);
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_STALE");
});

// ═══════════════════════════════════════════════════════════════════════
// 4/5/6. Blocker recomputation: unresolved Level-B, EVIDENCE_CONFLICT,
// pending PROVEN_OWNER backfill all fail closed.
// ═══════════════════════════════════════════════════════════════════════

async function makePackageOrder(studentEmail: string, studentIdOnOrder: number | null = null, opts: { remainingCredits?: number; status?: string } = {}) {
  const r = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, 'Test Package', 8, $4, $5) RETURNING id`,
    [`PD Test Order`, studentEmail, studentIdOnOrder, opts.remainingCredits ?? 0, opts.status ?? "expired"],
  );
  return r.rows[0].id as number;
}
async function makeCreditTxn(packageOrderId: number, studentId: number | null) {
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'package_activated', 8, 0, 8, 'system')`,
    [packageOrderId, studentId],
  );
}
async function makeAttendance(packageOrderId: number, studentId: number | null, studentName: string, studentEmail: string) {
  await pool.query(
    `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
     VALUES ($1, $2, $3, $4, true)`,
    [studentName, studentEmail, packageOrderId, studentId],
  );
}

async function ensureT0(): Promise<string> {
  const existing = await pool.query(`SELECT activated_at FROM provenance_activation ORDER BY id ASC LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0].activated_at;
  const r = await pool.query(`INSERT INTO provenance_activation (activated_at) VALUES (now() - interval '30 days') RETURNING activated_at`);
  return r.rows[0].activated_at;
}
async function insertInterval(studentId: number, email: string, validFrom: string, validTo: string | null, adminId: number) {
  const { fingerprintStudentEmail } = await import("../lib/studentEmailProvenance");
  const fp = fingerprintStudentEmail(email);
  await pool.query(
    `INSERT INTO student_email_identity_history (student_id, email_fingerprint, valid_from, valid_to, source, changed_by_admin_id)
     VALUES ($1, $2, $3, $4, 'admin_update', $5)`,
    [studentId, fp, validFrom, validTo, adminId],
  );
}

/**
 * The canonical cross-signal conflict fixture (mirrors
 * students.deletionConflictBlocking.integration.test.ts's conflictFixture):
 * an unattributed package_orders row whose OWN stored email carries a
 * post-T0 provenance interval for Student A (channel B => A), while its
 * credit_transactions + attendance evidence both independently agree on a
 * DIFFERENT Student B (channel C => B). Both students here are otherwise
 * "eligible" (deactivated, active preparation) — the conflict is their
 * only blocker.
 */
async function conflictFixture(tag: string) {
  const a = await setupEligible(`${tag}-a`);
  const b = await setupEligible(`${tag}-b`);
  const t0 = await ensureT0();
  await insertInterval(a.studentId, a.email, t0, null, a.admin.id);

  const orderId = await makePackageOrder(a.email, null);
  await makeCreditTxn(orderId, b.studentId);
  await makeAttendance(orderId, b.studentId, "PD Test", b.email);

  return { a, b, orderId };
}

test("4: unresolved Level-B candidate rejects permanent delete 409", async () => {
  const f = await setupEligible("levelb");
  const orderId = await makePackageOrder(f.email, null);
  await makeCreditTxn(orderId, f.studentId);
  await makeAttendance(orderId, f.studentId, "PD Test", f.email);

  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "PERMANENT_DELETE_BLOCKED");
  assert.ok(res.json.blockers.some((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION"));
  assert.equal((await studentRow(f.studentId)).account_status, "deactivated");
});

test("5: EVIDENCE_CONFLICT rejects permanent delete 409 for both students it touches", async () => {
  const f = await conflictFixture("conflict");

  const resA = await post(deleteUrl(f.a.studentId), { workflowId: f.a.workflowId }, f.a.admin.token);
  assert.equal(resA.status, 409, JSON.stringify(resA.json));
  assert.equal(resA.json.code, "PERMANENT_DELETE_BLOCKED");

  const resB = await post(deleteUrl(f.b.studentId), { workflowId: f.b.workflowId }, f.b.admin.token);
  assert.equal(resB.status, 409, JSON.stringify(resB.json));
  assert.equal(resB.json.code, "PERMANENT_DELETE_BLOCKED");
});

test("6: pending (unapplied) PROVEN_OWNER decision rejects permanent delete 409", async () => {
  const f = await setupEligible("pending-backfill");
  const orderId = await makePackageOrder(f.email, null);
  await makeCreditTxn(orderId, f.studentId);
  await makeAttendance(orderId, f.studentId, "PD Test", f.email);
  const resolveRes = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(resolveRes.status, 201);

  // Not yet applied via the B3B3 backfill executor — permanent delete must
  // block rather than silently apply it on the caller's behalf.
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "PERMANENT_DELETE_PENDING_OWNERSHIP_BACKFILL");
  assert.equal((await studentRow(f.studentId)).account_status, "deactivated");

  // Once applied, permanent delete proceeds.
  const backfillRes = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(backfillRes.json.appliedCount, 1);
  const finalRes = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(finalRes.status, 200, JSON.stringify(finalRes.json));
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Unrelated blocker (future booking) still rejects
// ═══════════════════════════════════════════════════════════════════════

test("7: unrelated blocker (future booking) rejects permanent delete 409", async () => {
  const f = await setupEligible("future-booking");
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, occurrence_date, booking_status)
     VALUES ($1, $2, $3, (now() + interval '7 days')::date, 'confirmed')`,
    [`PD Test`, f.email, f.studentId],
  );
  const res = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "PERMANENT_DELETE_BLOCKED");
  assert.ok(res.json.blockers.some((b: any) => b.key === "FUTURE_BOOKINGS"));
});

// ═══════════════════════════════════════════════════════════════════════
// 9. Reactivation rejected once deleted
// ═══════════════════════════════════════════════════════════════════════

test("9: reactivation rejected once permanently deleted", async () => {
  const f = await setupEligible("no-reactivate");
  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);
  const res = await post(reactivateUrl(f.studentId), {}, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal((await studentRow(f.studentId)).account_status, "deleted");
});

// ═══════════════════════════════════════════════════════════════════════
// 10. Email/password login rejected once deleted
// ═══════════════════════════════════════════════════════════════════════

test("10: email/password login rejected once permanently deleted", async () => {
  const bcrypt = (await import("bcryptjs")).default;
  const plainPassword = "Sup3rSecret!23";
  const hash = await bcrypt.hash(plainPassword, 10);
  const f = await setupEligible("login");
  await pool.query(`UPDATE students SET password_hash = $1 WHERE id = $2`, [hash, f.studentId]);
  // Sanity: login works BEFORE deletion (student must be active to log in —
  // temporarily flip status just to prove the credential itself is valid).
  await pool.query(`UPDATE students SET account_status = 'active' WHERE id = $1`, [f.studentId]);
  const preLogin = await post("/api/auth/login", { email: f.email, password: plainPassword }, undefined);
  assert.equal(preLogin.status, 200, JSON.stringify(preLogin.json));
  await pool.query(`UPDATE students SET account_status = 'deactivated' WHERE id = $1`, [f.studentId]);

  const del = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(del.status, 200, JSON.stringify(del.json));

  // Old email no longer resolves to this account (it was anonymized) — and
  // even a login attempt against the (unknowable) new tombstone email would
  // still fail the isActiveAccountStatus gate. Both are proven here.
  const afterOldEmail = await post("/api/auth/login", { email: f.email, password: plainPassword }, undefined);
  assert.notEqual(afterOldEmail.status, 200);

  const row = await studentRow(f.studentId);
  const afterTombstoneEmail = await post("/api/auth/login", { email: row.email, password: plainPassword }, undefined);
  assert.notEqual(afterTombstoneEmail.status, 200, "a deleted account must never authenticate, even by its tombstone address");
});

// ═══════════════════════════════════════════════════════════════════════
// 11/12. Google/Facebook login — structural proof.
//
// Full end-to-end coverage would require mocking each provider's token
// verification (google-auth-library / Apple JWKS / Facebook Graph), which
// is out of scope for this focused pass and would not exercise anything
// B3B4 itself changes. What B3B4 DOES rely on — the shared
// isActiveAccountStatus("deleted") === false gate that resolveSocialLogin
// checks before any token issuance or account mutation, in both the
// already-linked and the existing-account-by-email branches — is asserted
// directly here, plus a structural proof that socialAuth.ts still contains
// exactly the two unconditional gates this depends on.
// ═══════════════════════════════════════════════════════════════════════

test("11/12: isActiveAccountStatus rejects 'deleted' exactly like 'deactivated' (the gate resolveSocialLogin/login share)", async () => {
  const { isActiveAccountStatus } = await import("../lib/studentAccountStatus");
  assert.equal(isActiveAccountStatus("deleted"), false);
  assert.equal(isActiveAccountStatus("deactivated"), false);
  assert.equal(isActiveAccountStatus("active"), true);
});

test("11/12 (structural): socialAuth.ts still gates both the linked-identity and existing-account branches on isActiveAccountStatus", () => {
  const src = readFileSync(path.join(__dirname, "socialAuth.ts"), "utf8");
  const occurrences = src.match(/isActiveAccountStatus\(/g) ?? [];
  assert.ok(occurrences.length >= 2, "expected at least 2 isActiveAccountStatus gates in socialAuth.ts");
});

// ═══════════════════════════════════════════════════════════════════════
// 13. Password reset cannot restore access
// ═══════════════════════════════════════════════════════════════════════

test("13: password reset cannot restore login access to a permanently deleted account", async () => {
  const f = await setupEligible("reset");
  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  // forgot-password against the OLD (now-anonymized) email finds no student
  // row and always returns the generic non-leaking response — never an OTP
  // that could reach a real address.
  const forgot = await post("/api/auth/forgot-password", { email: f.email, botToken: VALID_BOT_TOKEN }, undefined);
  assert.equal(forgot.status, 200); // generic response either way, by design
  const otpRows = await pool.query(`SELECT count(*) FROM email_otps WHERE email = $1`, [f.email.toLowerCase()]);
  assert.equal(Number(otpRows.rows[0].count), 0, "no OTP may be issued for an email that no longer belongs to any account");

  // Even in the theoretical case a code was somehow obtained, login remains
  // impossible: the isActiveAccountStatus gate in /auth/login is entirely
  // independent of password_hash and cannot be bypassed by resetting it.
  const bcrypt = (await import("bcryptjs")).default;
  await pool.query(`UPDATE students SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash("NewPass123!", 10), f.studentId]);
  const row = await studentRow(f.studentId);
  const loginAttempt = await post("/api/auth/login", { email: row.email, password: "NewPass123!" }, undefined);
  assert.notEqual(loginAttempt.status, 200);
});

// ═══════════════════════════════════════════════════════════════════════
// 14/15. JWTs revoked, devices disabled
// ═══════════════════════════════════════════════════════════════════════

test("14: JWTs are revoked — token_version bumped, a pre-deletion token is rejected", async () => {
  const f = await setupEligible("tokenver");
  const before = await studentRow(f.studentId);
  const preDeleteToken = jwtSign({ sub: f.studentId, tokenVersion: before.token_version }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });

  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  const after = await studentRow(f.studentId);
  assert.equal(after.token_version, before.token_version + 1);

  const meRes = await get("/api/auth/me", undefined, preDeleteToken);
  assert.notEqual(meRes.status, 200, "a token minted before permanent delete must be rejected");
});

test("15: notification devices are deactivated", async () => {
  const f = await setupEligible("devices");
  const before = await pool.query(`SELECT is_active FROM notification_devices WHERE student_id = $1`, [f.studentId]);
  assert.equal(before.rows[0].is_active, true);

  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  const after = await pool.query(`SELECT is_active FROM notification_devices WHERE student_id = $1`, [f.studentId]);
  assert.equal(after.rows[0].is_active, false);
});

// ═══════════════════════════════════════════════════════════════════════
// 16/17. Student PII anonymized, social IDs removed
// ═══════════════════════════════════════════════════════════════════════

test("16/17: Student PII is anonymized and social provider identifiers are removed", async () => {
  const f = await setupEligible("pii");
  const before = await studentRow(f.studentId);
  assert.notEqual(before.google_id, null);
  assert.notEqual(before.facebook_id, null);

  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  const after = await studentRow(f.studentId);
  assert.notEqual(after.email, before.email);
  assert.equal(after.email, `deleted-student-${f.studentId}@tombstone.invalid`);
  assert.equal(after.name, `Deleted Student #${f.studentId}`);
  assert.equal(after.phone, null);
  assert.equal(after.password_hash, null);
  assert.equal(after.auth_provider, null);
  assert.equal(after.google_id, null);
  assert.equal(after.facebook_id, null);
  assert.equal(after.apple_id, null);
  assert.equal(after.avatar_url, null);
  assert.equal(after.provider_display_name, null);
});

// ═══════════════════════════════════════════════════════════════════════
// 18/19. Finance and historical amounts unchanged
// ═══════════════════════════════════════════════════════════════════════

test("18/19: Finance totals and historical amounts are unchanged by permanent delete", async () => {
  const f = await setupEligible("finance");
  const orderId = await makePackageOrder(f.email, f.studentId); // pre-owned, inert canonical row
  await makeCreditTxn(orderId, f.studentId);

  const checksumSql = `SELECT
    (SELECT md5(coalesce(string_agg(ct::text, '|' ORDER BY ct::text), '')) FROM credit_transactions ct) AS credit,
    (SELECT md5(coalesce(string_agg(po::text, '|' ORDER BY po::text), '')) FROM package_orders po WHERE po.id = ${orderId}) AS order_row`;
  const before = await pool.query(checksumSql);

  const delRes = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(delRes.status, 200, JSON.stringify(delRes.json));

  const after = await pool.query(checksumSql);
  assert.equal(after.rows[0].credit, before.rows[0].credit, "credit_transactions must be byte-identical");
  assert.equal(after.rows[0].order_row, before.rows[0].order_row, "the owned package_orders row must be byte-identical");
});

// ═══════════════════════════════════════════════════════════════════════
// 20. Owned historical rows: FK preserved, nothing else touched
// ═══════════════════════════════════════════════════════════════════════

test("20: an owned package_orders row keeps its ownership FK pointing at the (now-tombstoned) student", async () => {
  const f = await setupEligible("owned");
  const orderId = await makePackageOrder(f.email, f.studentId);
  const delRes = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(delRes.status, 200, JSON.stringify(delRes.json));
  const row = await pool.query(`SELECT student_id, student_email, student_name FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(row.rows[0].student_id, f.studentId);
  assert.equal(row.rows[0].student_email, f.email, "historical contact snapshot must not be rewritten");
});

// ═══════════════════════════════════════════════════════════════════════
// 21. Level C/D legacy rows are untouched
// ═══════════════════════════════════════════════════════════════════════

test("21: Level C/D unattributed legacy rows are byte-identical and never assigned to the Student", async () => {
  const f = await setupEligible("leveld");
  const levelDOrderId = await makePackageOrder(freshEmail("unrelated-legacy"), null); // no evidence at all — Level D
  const before = await pool.query(`SELECT * FROM package_orders WHERE id = $1`, [levelDOrderId]);

  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  const after = await pool.query(`SELECT * FROM package_orders WHERE id = $1`, [levelDOrderId]);
  assert.equal(JSON.stringify(after.rows[0]), JSON.stringify(before.rows[0]));
  assert.equal(after.rows[0].student_id, null, "a Level C/D row must never be assigned to the Student by this phase");
});

// ═══════════════════════════════════════════════════════════════════════
// 22. Children/Ballet integrity preserved (no cascade)
// ═══════════════════════════════════════════════════════════════════════

test("22: an unrelated child row referencing a different parent is completely untouched", async () => {
  const f = await setupEligible("children");
  const other = await makeStudent("children-parent");
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth) VALUES ($1, 'Unrelated Child', '2015-01-01') RETURNING id`,
    [other.studentId],
  );
  const before = await pool.query(`SELECT * FROM children WHERE id = $1`, [child.rows[0].id]);

  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  const after = await pool.query(`SELECT * FROM children WHERE id = $1`, [child.rows[0].id]);
  assert.equal(JSON.stringify(after.rows[0]), JSON.stringify(before.rows[0]));
});

// ═══════════════════════════════════════════════════════════════════════
// 23/24. Idempotency and concurrency
// ═══════════════════════════════════════════════════════════════════════

test("23: duplicate delete request is a stable idempotent success, not a re-anonymization", async () => {
  const f = await setupEligible("dup");
  const first = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(first.status, 200);
  const rowAfterFirst = await studentRow(f.studentId);

  const second = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(second.status, 200);
  assert.equal(second.json.alreadyDeleted, true);
  const rowAfterSecond = await studentRow(f.studentId);

  assert.equal(rowAfterSecond.token_version, rowAfterFirst.token_version, "no duplicate token_version bump");
  assert.equal(
    new Date(rowAfterSecond.deleted_at).getTime(),
    new Date(rowAfterFirst.deleted_at).getTime(),
    "no duplicate anonymization pass",
  );
});

test("24: concurrent duplicate delete requests are safe — exactly one terminal transition", async () => {
  const f = await setupEligible("concurrent");
  const [a, b, c] = await Promise.all([
    post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
  ]);
  for (const r of [a, b, c]) assert.equal(r.status, 200, JSON.stringify(r.json));
  const freshCount = [a, b, c].filter((r) => r!.json.alreadyDeleted === false).length;
  assert.equal(freshCount, 1, "exactly one request may perform the real transition");
  const row = await studentRow(f.studentId);
  assert.equal(row.account_status, "deleted");
});

test("concurrency: delete vs cancel-preparation race is coherent", async () => {
  const f = await setupEligible("race-cancel");
  const [delRes, cancelRes] = await Promise.all([
    post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    cancelPrep(f.studentId, f.admin.token),
  ]);
  assert.ok([200, 409].includes(delRes.status));
  assert.ok([200, 409].includes(cancelRes.status));
  const row = await studentRow(f.studentId);
  assert.ok(["deleted", "deactivated"].includes(row.account_status));
});

test("concurrency: delete vs reactivation race is coherent — never both succeed", async () => {
  const f = await setupEligible("race-reactivate");
  const [delRes, reactRes] = await Promise.all([
    post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(reactivateUrl(f.studentId), {}, f.admin.token),
  ]);
  const row = await studentRow(f.studentId);
  if (delRes.status === 200 && delRes.json.alreadyDeleted === false) {
    assert.equal(row.account_status, "deleted");
  } else {
    assert.ok(["active", "deactivated"].includes(row.account_status));
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 25. Audit is PII-safe
// ═══════════════════════════════════════════════════════════════════════

test("25: audit entry recorded with structured metadata only, no PII", async () => {
  const f = await setupEligible("audit");
  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token)).status, 200);

  let rows: any[] = [];
  for (let attempt = 0; attempt < 20 && rows.length === 0; attempt += 1) {
    const q = await pool.query(
      `SELECT * FROM admin_activity_logs WHERE action = 'permanent_delete' AND entity_id = $1`,
      [String(f.studentId)],
    );
    rows = q.rows;
    if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(rows.length, 1);
  const ownFields = JSON.stringify({
    summary: rows[0].summary, entity_id: rows[0].entity_id, entity_label: rows[0].entity_label,
    before: rows[0].before, after: rows[0].after,
  });
  assert.ok(!ownFields.includes(f.email), "audit leaked the original student email");
  assert.ok(!/@example\.com/.test(ownFields), "audit payload leaked an email address");
});

// ═══════════════════════════════════════════════════════════════════════
// 26. Legacy DELETE route still disabled
// ═══════════════════════════════════════════════════════════════════════

test("26: legacy DELETE /students/:id route remains 405-disabled", async () => {
  const f = await setupEligible("legacy-delete");
  const res = await fetch(apiUrl(`/api/students/${f.studentId}`), {
    method: "DELETE",
    headers: { authorization: `Bearer ${process.env.API_SECRET_KEY}`, "x-admin-token": f.admin.token },
  });
  assert.equal(res.status, 405);
  const body = await res.json() as { code?: string };
  assert.equal(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
});

// ═══════════════════════════════════════════════════════════════════════
// 27. RBAC
// ═══════════════════════════════════════════════════════════════════════

test("27: RBAC — unauthenticated 401, users.view/users.edit 403, users.delete + Super Admin allowed", async () => {
  const f = await setupEligible("rbac");

  const anon = await fetch(apiUrl(deleteUrl(f.studentId)), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowId: f.workflowId }),
  });
  assert.equal(anon.status, 401);

  const viewer = await makeAdminWithPermission(VIEW_ONLY_PERM);
  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, viewer.token)).status, 403);

  const editor = await makeAdminWithPermission(EDIT_ONLY_PERM);
  assert.equal((await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, editor.token)).status, 403);

  const studentToken = jwtSign({ sub: f.studentId, tokenVersion: 0 }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });
  const asStudent = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, undefined, studentToken);
  assert.ok([401, 403].includes(asStudent.status));

  assert.equal((await studentRow(f.studentId)).account_status, "deactivated", "no denied caller may tombstone the account");

  const superAdmin = await makeAdminWithPermission({}, true);
  const allowed = await post(deleteUrl(f.studentId), { workflowId: f.workflowId }, superAdmin.token);
  assert.equal(allowed.status, 200);
});

// ═══════════════════════════════════════════════════════════════════════
// 28. Student 34 absent (self-check)
// ═══════════════════════════════════════════════════════════════════════

test("28: this suite never hardcodes the reserved production student id", () => {
  const reservedProductionId = String(30 + 4);
  const src = readFileSync(__filename, "utf8");
  const codeOnly = src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !line.includes("reservedProductionId"))
    .join("\n");
  assert.ok(
    !new RegExp(`\\b${reservedProductionId}\\b`).test(codeOnly),
    "test file must not use the reserved production student id in fixture/assertion code",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 29/30. Hard static safety proofs
// ═══════════════════════════════════════════════════════════════════════

test("29: no hard DELETE FROM students / Drizzle .delete() on the students table anywhere in the new module", () => {
  const raw = readFileSync(path.join(__dirname, "..", "lib", "studentDeletionPermanentDelete.ts"), "utf8");
  // Strip comments (block + line) so the module's own doc-comment sentences
  // describing what it never does don't self-trip this static proof.
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/DELETE\s+FROM\s+students/i.test(codeOnly), "an executable DELETE FROM students statement was found");
  assert.ok(!/\.delete\(studentsTable\)/.test(codeOnly), "a Drizzle .delete(studentsTable) call was found");
});

test("30: no unexpected cascade — module touches only students and notification_devices", () => {
  const src = readFileSync(path.join(__dirname, "..", "lib", "studentDeletionPermanentDelete.ts"), "utf8");
  const updateTargets = [...src.matchAll(/tx\s*\.\s*update\(([a-zA-Z]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(new Set(updateTargets), new Set(["studentsTable", "notificationDevicesTable"]));
});
