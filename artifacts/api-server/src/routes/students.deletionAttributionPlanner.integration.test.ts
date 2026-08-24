/**
 * Phase B3B1 — Read-only historical attribution planner.
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * students router. Follows the same harness conventions as
 * students.deletionPreparation.integration.test.ts /
 * students.deletionImpact.integration.test.ts.
 *
 * This suite never references student id 34 or any other hardcoded
 * production id — every student used here is created fresh in this
 * disposable database by this test run.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ATTRIBUTION_PLANNER_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_attribution_planner";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-attribution-planner-identity-provenance-pepper".padEnd(64, "0");

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;
let fingerprintStudentEmail: typeof import("../lib/studentEmailProvenance").fingerprintStudentEmail;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; json: any };
async function post(path: string, body: unknown, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${process.env.API_SECRET_KEY}` };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function get(path: string, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${process.env.API_SECRET_KEY}` };
  if (adminToken) headers["x-admin-token"] = adminToken;
  const res = await fetch(apiUrl(path), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const provenanceModule = await import("../lib/studentEmailProvenance");
  fingerprintStudentEmail = provenanceModule.fingerprintStudentEmail;

  const expressModule = await import("express");
  const express = expressModule.default;
  const studentsRouter = (await import("./students")).default;

  app = express();
  app.use(express.json());
  app.use("/api", studentsRouter);
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
  return `ap-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`AP Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(`INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`, [`ap-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)]);
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`ap-admin-${Date.now()}-${adminSeq}`, `ap-admin-${Date.now()}-${adminSeq}@example.com`, "x", `AP Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `ap-admin-${adminSeq}`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

function studentJwt(studentId: number): string {
  return jwtSign({ sub: studentId, tokenVersion: 0 }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });
}

async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}

async function ensureT0(): Promise<string> {
  const existing = await pool.query(`SELECT activated_at FROM provenance_activation ORDER BY id ASC LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0].activated_at;
  const r = await pool.query(`INSERT INTO provenance_activation (activated_at) VALUES (now() - interval '30 days') RETURNING activated_at`);
  return r.rows[0].activated_at;
}

async function makeAttendanceRow(): Promise<number> {
  const r = await pool.query(
    `INSERT INTO attendance (student_name, student_email, status) VALUES ('AP Attendance Fixture', $1, 'checked_in') RETURNING id`,
    [freshEmail("attendance-fixture")],
  );
  return r.rows[0].id as number;
}

async function insertFeedback(studentId: number | null, email: string, createdAt: string | null | "default" = "default") {
  const attendanceId = await makeAttendanceRow();
  const seqTag = ++seq;
  if (createdAt === "default") {
    await pool.query(
      `INSERT INTO feedback (attendance_id, student_id, student_email_snapshot, student_name_snapshot, rating, comment, client_submission_id)
       VALUES ($1, $2, $3, 'AP Feedback Fixture', 4, 'x', $4)`,
      [attendanceId, studentId, email, `ap-sub-${Date.now()}-${seqTag}`],
    );
  } else {
    await pool.query(
      `INSERT INTO feedback (attendance_id, student_id, student_email_snapshot, student_name_snapshot, rating, comment, client_submission_id, created_at)
       VALUES ($1, $2, $3, 'AP Feedback Fixture', 4, 'x', $4, $5)`,
      [attendanceId, studentId, email, `ap-sub-${Date.now()}-${seqTag}`, createdAt],
    );
  }
}

async function insertInterval(studentId: number, email: string, validFrom: string, validTo: string | null, adminId: number) {
  const fp = fingerprintStudentEmail(email);
  await pool.query(
    `INSERT INTO student_email_identity_history (student_id, email_fingerprint, valid_from, valid_to, source, changed_by_admin_id)
     VALUES ($1, $2, $3, $4, 'admin_update', $5)`,
    [studentId, fp, validFrom, validTo, adminId],
  );
}

const DELETE_PERM = { users: { delete: true, edit: true, view: true } };
const EDIT_ONLY_PERM = { users: { view: true, edit: true } };

// ── 1-7: preparation requirement / RBAC ─────────────────────────────────

test("1: active student rejected (409)", async () => {
  const { studentId } = await makeStudent("active", "active");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 409);
});

test("2: deactivated, no active preparation, rejected (409 STUDENT_DELETION_PREPARATION_REQUIRED)", async () => {
  const { studentId } = await makeStudent("no-prep");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
});

test("3: deactivated WITH active preparation allowed (200)", async () => {
  const { studentId } = await makeStudent("with-prep");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.studentId, studentId);
  assert.equal(res.json.preparationStatus, "PREPARING");
});

test("4: deleted-status student rejected (409, raw SQL fixture)", async () => {
  const { studentId } = await makeStudent("deleted");
  await pool.query(`UPDATE students SET account_status = 'deleted' WHERE id = $1`, [studentId]);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 409);
});

test("5: unauthorized admin (no users.delete) denied (403)", async () => {
  const { studentId } = await makeStudent("rbac-403");
  const admin = await makeAdminWithPermission(EDIT_ONLY_PERM);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 403);
});

test("6: users.delete admin allowed", async () => {
  const { studentId } = await makeStudent("rbac-ok");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
});

test("7: student JWT denied", async () => {
  const { studentId } = await makeStudent("rbac-student-jwt");
  const res = await fetch(apiUrl(`/api/students/${studentId}/deletion-attribution-plan`), {
    headers: { authorization: `Bearer ${studentJwt(studentId)}` },
  });
  assert.ok(res.status === 401 || res.status === 403);
});

// ── 8-17: classification correctness ─────────────────────────────────────

test("8: explicit studentId already set -> ALREADY_ATTRIBUTED", async () => {
  const { studentId, email } = await makeStudent("already-attr");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertFeedback(studentId, email);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const feedbackEntry = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "ALREADY_ATTRIBUTED");
  assert.ok(feedbackEntry, "expected feedback ALREADY_ATTRIBUTED entry");
  assert.equal(feedbackEntry.count, 1);
});

test("9: current-email-match-alone is NOT sufficient (no covering interval -> not SAFE_TO_ATTRIBUTE)", async () => {
  const { studentId, email } = await makeStudent("email-alone");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  // No student_email_identity_history interval created at all.
  await insertFeedback(null, email);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const safe = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "SAFE_TO_ATTRIBUTE");
  assert.equal(safe, undefined, "must not be SAFE_TO_ATTRIBUTE without a covering interval");
});

test("10: pre-T0 row remains UNPROVEN_PRE_T0 even with covering-looking email match", async () => {
  const t0 = await ensureT0();
  const { studentId, email } = await makeStudent("pre-t0");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertInterval(studentId, email, t0, null, admin.id);
  const preT0Ts = new Date(new Date(t0).getTime() - 10 * 24 * 3600 * 1000).toISOString();
  await insertFeedback(null, email, preT0Ts);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const unproven = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "UNPROVEN_PRE_T0");
  assert.ok(unproven, "expected UNPROVEN_PRE_T0");
  const safe = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "SAFE_TO_ATTRIBUTE");
  assert.equal(safe, undefined);
});

test("11+12: post-T0 row inside covering interval -> SAFE_TO_ATTRIBUTE, boundary semantics [valid_from, valid_to)", async () => {
  const { studentId, email } = await makeStudent("safe-interval");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const validFrom = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
  const validTo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  await insertInterval(studentId, email, validFrom, validTo, admin.id);
  // exactly at valid_from -> included
  await insertFeedback(null, email, validFrom);
  // exactly at valid_to -> excluded (half-open)
  await insertFeedback(null, email, validTo);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const safeEntry = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "SAFE_TO_ATTRIBUTE");
  assert.ok(safeEntry, "expected SAFE_TO_ATTRIBUTE for the at-from row");
  assert.equal(safeEntry.count, 1, "exactly one row (at-from) safe; at-to row must be excluded by half-open semantics");
});

// NOTE (Section 3 re-derivation finding): bookings.created_at,
// package_orders.created_at, and feedback.created_at are all DB-level
// NOT NULL with defaultNow() — a genuinely null legacy timestamp cannot
// occur via any real insert path in these three domains. MISSING_REQUIRED_
// TIMESTAMP is therefore implemented defensively in
// studentDeletionAttributionPlanner.ts (classifyRow returns it whenever
// `timestamp` is falsy) but is not independently exercisable through a
// legitimate Postgres fixture without bypassing the NOT NULL constraint
// itself. This is reported explicitly rather than silently faked.
test("16: MISSING_REQUIRED_TIMESTAMP is unreachable via real inserts (schema-level NOT NULL proof)", async () => {
  const result = await pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name IN ('bookings','package_orders','feedback') AND column_name = 'created_at'`,
  );
  for (const row of result.rows) {
    assert.equal(row.is_nullable, "NO", `${row.column_name} must remain NOT NULL for this finding to hold`);
  }
});

test("17: malformed/empty legacy email -> MALFORMED_LEGACY_IDENTITY", async () => {
  const { studentId } = await makeStudent("malformed");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertFeedback(null, "not-an-email");
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  const malformed = res.json.domains.find((d: any) => d.domain === "feedback" && d.classification === "MALFORMED_LEGACY_IDENTITY");
  assert.ok(malformed);
});

// ── 18: package order payer/contact negative control (the critical test) ──

test("18: package_orders participantType=child payer/contact NOT attributed despite perfect temporal match", async () => {
  const { studentId, email } = await makeStudent("child-payer");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const validFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await insertInterval(studentId, email, validFrom, null, admin.id);
  const rowTs = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  const child = await pool.query(`INSERT INTO children (parent_id, full_name, date_of_birth) VALUES ($1, 'Kid', '2015-01-01') RETURNING id`, [studentId]);
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, participant_type, participant_child_id, package_name, total_credits, remaining_credits, status, created_at)
     VALUES ('AP Payer', $1, NULL, 'child', $2, 'AP Package', 5, 5, 'active', $3)`,
    [email, child.rows[0].id, rowTs],
  );
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const semantic = res.json.domains.find((d: any) => d.domain === "package_orders" && d.classification === "SEMANTICALLY_NOT_STUDENT_OWNERSHIP");
  assert.ok(semantic, "expected SEMANTICALLY_NOT_STUDENT_OWNERSHIP despite perfect temporal match");
  const safe = res.json.domains.find((d: any) => d.domain === "package_orders" && d.classification === "SAFE_TO_ATTRIBUTE");
  assert.equal(safe, undefined, "must NEVER be SAFE_TO_ATTRIBUTE for a child-entitlement order");
});

// ── 20-21: excluded domains ───────────────────────────────────────────────

test("20: attendance is entirely excluded from the planner's domain list", async () => {
  const { studentId } = await makeStudent("attendance-excl");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const hasAttendance = res.json.domains.some((d: any) => d.domain === "attendance");
  assert.equal(hasAttendance, false);
});

test("21: finance tables entirely excluded from planner domains", async () => {
  const { studentId } = await makeStudent("finance-excl");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(res.status, 200);
  const domainNames = res.json.domains.map((d: any) => d.domain);
  for (const forbidden of ["payment_records", "payment_refunds", "credit_transactions"]) {
    assert.equal(domainNames.includes(forbidden), false);
  }
});

// ── 22-23: no PII in response ──────────────────────────────────────────────

test("22-23: no raw email or fingerprint value ever appears in the API JSON response", async () => {
  const { studentId, email } = await makeStudent("no-pii");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertFeedback(null, email);
  const res = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  const body = JSON.stringify(res.json);
  assert.equal(body.includes(email), false, "raw email must never appear in response");
  assert.equal(/v1:k1:[0-9a-f]{64}/.test(body), false, "fingerprint must never appear in response");
});

// ── 25: determinism ────────────────────────────────────────────────────────

test("25: planner is deterministic across two calls (ignoring generatedAt)", async () => {
  const { studentId, email } = await makeStudent("determinism");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertFeedback(null, email);
  const first = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  const second = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  const strip = (j: any) => { const { generatedAt, ...rest } = j; return rest; };
  assert.deepEqual(strip(first.json), strip(second.json));
});

// ── 26: zero domain writes ─────────────────────────────────────────────────

test("26: repeated GET performs zero domain writes (before/after checksum)", async () => {
  const { studentId, email } = await makeStudent("zero-write");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);
  await insertFeedback(null, email);

  async function checksum() {
    const tables = ["students", "bookings", "package_orders", "feedback", "student_email_identity_history", "student_deletion_workflows"];
    const out: Record<string, string> = {};
    for (const t of tables) {
      const r = await pool.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM ${t} t`);
      out[t] = r.rows[0].h;
    }
    return out;
  }
  const before1 = await checksum();
  await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  const after1 = await checksum();
  assert.deepEqual(before1, after1);
});

// ── 32: bounded query count ─────────────────────────────────────────────

test("32: query count is fixed regardless of legacy row volume", async () => {
  const { studentId, email } = await makeStudent("query-bound");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(studentId, admin.token);

  async function countQueriesFor(n: number): Promise<number> {
    for (let i = 0; i < n; i++) {
      await insertFeedback(null, freshEmail("qbound"));
    }
    let count = 0;
    const orig: (...args: any[]) => any = pool.query.bind(pool);
    (pool as any).query = (...args: any[]) => { count += 1; return orig(...args); };
    await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
    (pool as any).query = orig;
    return count;
  }
  const small = await countQueriesFor(1);
  const large = await countQueriesFor(30);
  assert.equal(small, large, "query count must not scale with row volume");
});

// ── B3B1B: candidate-scoping cross-student isolation ─────────────────────
//
// Confirmed defect (B3B1B brief): the three domain queries (bookings,
// package_orders, feedback) had zero student-scoping filter — they read
// EVERY unattributed row in the entire table, system-wide, and every one of
// those rows got classified+tallied into the TARGET student's counts. An
// unrelated Student's legacy rows pollute the target's summary/domain
// counts even though they never become SAFE_TO_ATTRIBUTE (misattribution
// does not occur, but the counts are operationally meaningless).
//
// These tests prove per-domain isolation: generating Student A's plan
// before and after inserting many unrelated Student B rows must yield an
// IDENTICAL plan (ignoring generatedAt).

async function insertBookingRow(studentId: number | null, email: string | null, createdAt: string | null = null) {
  const seqTag = ++seq;
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, class_id, status, created_at)
     VALUES ('AP Booking Fixture', $1, $2, NULL, 'confirmed', COALESCE($3, now()))`,
    [email, studentId, createdAt],
  ).catch(async () => {
    const cls = await pool.query(`SELECT id FROM classes LIMIT 1`);
    await pool.query(
      `INSERT INTO bookings (student_name, student_email, account_owner_student_id, class_id, status, created_at)
       VALUES ('AP Booking Fixture', $1, $2, $3, 'confirmed', COALESCE($4, now()))`,
      [email, studentId, cls.rows[0]?.id ?? null, createdAt],
    );
  });
  void seqTag;
}

async function insertPackageOrderRow(studentId: number | null, email: string | null, participantType: "self" | "child" = "self", createdAt: string | null = null) {
  let childId: number | null = null;
  if (participantType === "child") {
    const parent = await makeStudent("iso-po-child-parent");
    const child = await pool.query(
      `INSERT INTO children (parent_id, full_name) VALUES ($1, 'AP Child Fixture') RETURNING id`,
      [parent.studentId],
    );
    childId = child.rows[0].id as number;
  }
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, participant_type, participant_child_id, package_name, total_credits, remaining_credits, status, created_at)
     VALUES ('AP Pkg Fixture', $1, $2, $3, $4, 'AP Package', 5, 5, 'active', COALESCE($5, now()))`,
    [email, studentId, participantType, childId, createdAt],
  );
}

function stripGeneratedAt(json: any) {
  const { generatedAt, ...rest } = json;
  return rest;
}

test("ISO-1: bookings cross-student isolation — unrelated Student B rows do not change Student A's plan", async () => {
  const a = await makeStudent("iso-bk-a");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(a.studentId, admin.token);
  // A's own genuinely relevant legacy row (no interval -> stays NO_MATCH, but IS a candidate).
  await insertBookingRow(null, a.email);

  const before = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(before.status, 200);

  // Unrelated Student B, with many unattributed legacy bookings of its own.
  const b = await makeStudent("iso-bk-b");
  for (let i = 0; i < 25; i++) {
    await insertBookingRow(null, b.email);
  }
  // Also an entirely random/never-a-student email, unattributed.
  for (let i = 0; i < 5; i++) {
    await insertBookingRow(null, freshEmail("iso-bk-random"));
  }

  const after = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(after.status, 200);

  assert.deepEqual(
    stripGeneratedAt(after.json),
    stripGeneratedAt(before.json),
    "Student A's plan must be unaffected by unrelated Student B's legacy bookings",
  );

  // Domain-specific: B's email must never appear anywhere in A's plan payload.
  const serialized = JSON.stringify(after.json);
  assert.ok(!serialized.includes(b.email), "Student B's email must never appear in Student A's plan");
});

test("ISO-2: package_orders cross-student isolation — unrelated Student B/C rows do not change Student A's plan", async () => {
  const a = await makeStudent("iso-po-a");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(a.studentId, admin.token);
  await insertPackageOrderRow(null, a.email, "self");

  const before = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(before.status, 200);

  const b = await makeStudent("iso-po-b");
  const c = await makeStudent("iso-po-c");
  for (let i = 0; i < 15; i++) await insertPackageOrderRow(null, b.email, "self");
  for (let i = 0; i < 15; i++) await insertPackageOrderRow(null, c.email, "child"); // payer/contact, unrelated

  const after = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(after.status, 200);

  assert.deepEqual(
    stripGeneratedAt(after.json),
    stripGeneratedAt(before.json),
    "Student A's plan must be unaffected by unrelated Student B/C legacy package_orders",
  );

  const serialized = JSON.stringify(after.json);
  assert.ok(!serialized.includes(b.email), "Student B's email must never appear in Student A's plan");
  assert.ok(!serialized.includes(c.email), "Student C's (child/payer) email must never appear in Student A's plan");
});

test("ISO-3: feedback cross-student isolation — unrelated Student B rows do not change Student A's plan", async () => {
  const a = await makeStudent("iso-fb-a");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(a.studentId, admin.token);
  await insertFeedback(null, a.email);

  const before = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(before.status, 200);

  const b = await makeStudent("iso-fb-b");
  for (let i = 0; i < 20; i++) await insertFeedback(null, b.email);
  for (let i = 0; i < 5; i++) await insertFeedback(null, freshEmail("iso-fb-random"));

  const after = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(after.status, 200);

  assert.deepEqual(
    stripGeneratedAt(after.json),
    stripGeneratedAt(before.json),
    "Student A's plan must be unaffected by unrelated Student B's legacy feedback",
  );

  const serialized = JSON.stringify(after.json);
  assert.ok(!serialized.includes(b.email), "Student B's email must never appear in Student A's plan");
});

test("ISO-4: cross-domain consolidated isolation — 30+ unrelated rows across all three domains at once leave A's summary byte-identical", async () => {
  const a = await makeStudent("iso-all-a");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(a.studentId, admin.token);
  await insertBookingRow(null, a.email);
  await insertPackageOrderRow(null, a.email, "self");
  await insertFeedback(null, a.email);

  const before = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(before.status, 200);

  const b = await makeStudent("iso-all-b");
  for (let i = 0; i < 12; i++) await insertBookingRow(null, b.email);
  for (let i = 0; i < 12; i++) await insertPackageOrderRow(null, b.email, "self");
  for (let i = 0; i < 12; i++) await insertFeedback(null, b.email);

  const after = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(after.status, 200);

  assert.deepEqual(stripGeneratedAt(after.json), stripGeneratedAt(before.json));
  assert.deepEqual(after.json.summary, before.json.summary);
});

test("ISO-5: NO_MATCH in A's plan never includes an unrelated row — an unrelated row is absent, not present-and-classified", async () => {
  const a = await makeStudent("iso-nomatch-a");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  await startPrep(a.studentId, admin.token);
  // A has no candidate rows at all.
  const before = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(before.status, 200);
  const beforeNoMatch = before.json.domains.filter((d: any) => d.classification === "NO_MATCH");
  assert.equal(beforeNoMatch.length, 0, "A has no candidates at all, so no NO_MATCH entries should exist yet");

  const b = await makeStudent("iso-nomatch-b");
  for (let i = 0; i < 10; i++) await insertFeedback(null, b.email);
  for (let i = 0; i < 10; i++) await insertBookingRow(null, b.email);

  const after = await get(`/api/students/${a.studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(after.status, 200);
  const afterNoMatch = after.json.domains.filter((d: any) => d.classification === "NO_MATCH");
  assert.equal(afterNoMatch.length, 0, "Student B's unrelated rows must not surface as NO_MATCH entries in Student A's plan");
  assert.deepEqual(stripGeneratedAt(after.json), stripGeneratedAt(before.json));
});
