/**
 * Phase B3B2E — Level-B manual resolution decision layer.
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * students router. Follows the harness conventions of
 * students.deletionPreparation.integration.test.ts /
 * students.deletionAttributionPlanner.integration.test.ts.
 *
 * IMPORTANT: this suite never references student id 34 or any other
 * hardcoded production id — every student used here is created fresh in
 * this disposable database by this test run.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_MANUAL_RESOLUTION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_manual_resolution";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-manual-resolution-identity-provenance-pepper".padEnd(64, "0");

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; json: any };
async function post(path: string, body: unknown, adminToken?: string, studentToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (studentToken) {
    headers.authorization = `Bearer ${studentToken}`;
  } else {
    headers.authorization = `Bearer ${process.env.API_SECRET_KEY}`;
    if (adminToken) headers["x-admin-token"] = adminToken;
  }
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
  return `mr-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`MR Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`mr-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`mr-admin-${Date.now()}-${adminSeq}`, `mr-admin-${Date.now()}-${adminSeq}@example.com`, "x", `MR Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `mr-admin-${adminSeq}`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

function studentJwt(studentId: number): string {
  return jwtSign({ sub: studentId, tokenVersion: 0 }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });
}

async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}
async function cancelPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/cancel`, {}, adminToken);
}

let poSeq = 0;
async function makePackageOrder(studentEmail: string, studentIdOnOrder: number | null = null) {
  poSeq += 1;
  const r = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, 'Test Package', 8, 8, 'active') RETURNING id`,
    [`PO Test ${poSeq}`, studentEmail, studentIdOnOrder],
  );
  return r.rows[0].id as number;
}

async function makeCreditTxn(packageOrderId: number, studentId: number | null) {
  const r = await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'package_activated', 8, 0, 8, 'system') RETURNING id`,
    [packageOrderId, studentId],
  );
  return r.rows[0].id as number;
}

async function makeAttendance(packageOrderId: number, studentId: number | null, studentName: string, studentEmail: string) {
  const r = await pool.query(
    `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [studentName, studentEmail, packageOrderId, studentId],
  );
  return r.rows[0].id as number;
}

const DELETE_PERM = { users: { delete: true, edit: true, view: true } };
const VIEW_ONLY_PERM = { users: { view: true } };
const EDIT_ONLY_PERM = { users: { view: true, edit: true } };

async function setupLevelBFixture(tag: string) {
  const { studentId, email } = await makeStudent(tag);
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, `MR Test ${tag}`, email);
  return { studentId, email, orderId };
}

async function readyPreparation(tag: string) {
  const fixture = await setupLevelBFixture(tag);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(fixture.studentId, admin.token);
  assert.equal(startRes.status, 201);
  return { ...fixture, admin, workflowId: startRes.json.id as number };
}

function resolveUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-resolutions`;
}

// ═══════════════════════════════════════════════════════════════════════
// Core positive / evidence-derivation tests (items 1, 15, 16, 17)
// ═══════════════════════════════════════════════════════════════════════

test("1/15: Level B candidate can be resolved PROVEN_OWNER, recorded correctly", async () => {
  const f = await readyPreparation("levelb-owner");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
  assert.equal(res.json.decision, "PROVEN_OWNER");
  assert.equal(res.json.evidenceLevel, "B");
  assert.equal(res.json.evidenceReasonCode, "CREDIT_TXN_AND_ATTENDANCE_AGREE");

  const row = await pool.query(`SELECT * FROM student_legacy_identity_resolutions WHERE id = $1`, [res.json.id]);
  assert.equal(row.rows[0].decision, "PROVEN_OWNER");
  assert.equal(row.rows[0].student_id, f.studentId);
});

test("16: NOT_THIS_STUDENT decision recorded correctly", async () => {
  const f = await readyPreparation("levelb-notthis");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT",
  }, f.admin.token);
  assert.equal(res.status, 201);
  assert.equal(res.json.decision, "NOT_THIS_STUDENT");
});

test("17: UNRESOLVED decision recorded, distinct audit trail from no-resolution", async () => {
  const f = await readyPreparation("levelb-unresolved");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "UNRESOLVED",
  }, f.admin.token);
  assert.equal(res.status, 201);
  assert.equal(res.json.decision, "UNRESOLVED");
  const count = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions WHERE student_id = $1`, [f.studentId]);
  assert.equal(Number(count.rows[0].count), 1);
});

test("18: decision row stores no PII (schema + response)", async () => {
  const f = await readyPreparation("levelb-nopii");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
  const keys = Object.keys(res.json);
  for (const forbidden of ["email", "fingerprint", "payment", "child"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `response leaked ${forbidden}`);
  }
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'student_legacy_identity_resolutions'`,
  );
  const colNames = cols.rows.map((r: any) => r.column_name);
  for (const forbidden of ["email", "fingerprint", "payment", "child"]) {
    assert.ok(!colNames.some((c: string) => c.includes(forbidden)), `schema leaked ${forbidden}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Rejection / server re-derivation (items 2, 3, 4, 19, 20)
// ═══════════════════════════════════════════════════════════════════════

test("2/19/20: Level C candidate (only credit_transactions evidence) rejected 409 even though client claims resolution", async () => {
  const { studentId, email } = await makeStudent("levelc-credit-only");
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId);
  // No attendance row at all — only one independent source.
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  const res = await post(resolveUrl(studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");
});

test("3: Level D candidate (zero evidence) rejected 409", async () => {
  const { studentId, email } = await makeStudent("leveld-noevidence");
  const orderId = await makePackageOrder(email, null);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  const res = await post(resolveUrl(studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");
});

test("4: row with explicit canonical owner already set is rejected (not a candidate)", async () => {
  const { studentId, email } = await makeStudent("already-owned");
  const other = await makeStudent("already-owned-other");
  const orderId = await makePackageOrder(email, other.studentId);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, "x", email);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  const res = await post(resolveUrl(studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_A_CANDIDATE");
  assert.equal(res.json.reason, "ALREADY_OWNED");
});

test("22: conflicting evidence between sources (different student_ids) is rejected", async () => {
  const { studentId, email } = await makeStudent("conflict-a");
  const other = await makeStudent("conflict-b");
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, other.studentId, "x", email); // conflicting owner
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  const res = await post(resolveUrl(studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.reason, "CONFLICTING_STUDENT_IDS");
});

// ═══════════════════════════════════════════════════════════════════════
// Lifecycle preconditions (items 5, 6, 7, 8)
// ═══════════════════════════════════════════════════════════════════════

test("5: active (non-deactivated) student rejected", async () => {
  const { studentId, email } = await makeStudent("active-block", "active");
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, "x", email);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await post(resolveUrl(studentId), {
    workflowId: 999999, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_NOT_DEACTIVATED");
});

test("6: deactivated student with no active preparation rejected", async () => {
  const f = await setupLevelBFixture("no-prep");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: 999999, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
});

test("7: PREPARING + deactivated allowed (positive)", async () => {
  const f = await readyPreparation("preparing-ok");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
});

test("8: cancelled preparation (no active workflow at all) rejected 409", async () => {
  const f = await readyPreparation("cancelled-block");
  const cancelRes = await cancelPrep(f.studentId, f.admin.token);
  assert.equal(cancelRes.status, 200);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  // No active PREPARING workflow exists at all post-cancel (distinct from
  // the "referenced a stale-but-superseded-by-a-newer-active one" case
  // covered by test 21b) — the fresh re-check (Section 8) correctly
  // reports STUDENT_DELETION_PREPARATION_REQUIRED here.
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
});

test("21b: stale workflowId from a restarted preparation rejected", async () => {
  const f = await readyPreparation("restart-stale");
  await cancelPrep(f.studentId, f.admin.token);
  const restarted = await startPrep(f.studentId, f.admin.token);
  assert.equal(restarted.status, 201);
  assert.notEqual(restarted.json.id, f.workflowId);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_STALE");
  // Fresh workflowId succeeds.
  const res2 = await post(resolveUrl(f.studentId), {
    workflowId: restarted.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res2.status, 201);
});

// ═══════════════════════════════════════════════════════════════════════
// RBAC (items 9-14)
// ═══════════════════════════════════════════════════════════════════════

test("9: unauthenticated denied (no x-admin-token)", async () => {
  const f = await readyPreparation("rbac-unauth");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  });
  assert.equal(res.status, 401);
});

test("10: Student JWT denied", async () => {
  const f = await readyPreparation("rbac-student");
  const token = studentJwt(f.studentId);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, undefined, token);
  assert.ok(res.status === 401 || res.status === 403);
});

test("11: users.view-only denied 403", async () => {
  const f = await readyPreparation("rbac-view");
  const viewAdmin = await makeAdminWithPermission(VIEW_ONLY_PERM);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, viewAdmin.token);
  assert.equal(res.status, 403);
});

test("12: users.edit-only denied 403", async () => {
  const f = await readyPreparation("rbac-edit");
  const editAdmin = await makeAdminWithPermission(EDIT_ONLY_PERM);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, editAdmin.token);
  assert.equal(res.status, 403);
});

test("13: users.delete allowed 201", async () => {
  const f = await readyPreparation("rbac-delete");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
});

test("14: Super Admin allowed 201", async () => {
  const f = await setupLevelBFixture("rbac-super");
  const superAdmin = await makeAdminWithPermission({}, true);
  const startRes = await startPrep(f.studentId, superAdmin.token);
  assert.equal(startRes.status, 201);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, superAdmin.token);
  assert.equal(res.status, 201);
});

// ═══════════════════════════════════════════════════════════════════════
// Append-only history / idempotency (items 23, 26, 27)
// ═══════════════════════════════════════════════════════════════════════

test("23/26/27: repeated submits are append-only — prior history preserved, latest wins", async () => {
  const f = await readyPreparation("append-only");
  const r1 = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT",
  }, f.admin.token);
  assert.equal(r1.status, 201);
  const r2 = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(r2.status, 201);
  assert.notEqual(r1.json.id, r2.json.id);

  const rows = await pool.query(
    `SELECT decision FROM student_legacy_identity_resolutions WHERE student_id = $1 ORDER BY resolved_at ASC, id ASC`,
    [f.studentId],
  );
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].decision, "NOT_THIS_STUDENT");
  assert.equal(rows.rows[1].decision, "PROVEN_OWNER");

  // Latest-wins derivation used by B2B/planner: PROVEN_OWNER should count.
  const impact = await get(`/api/students/${f.studentId}/deletion-impact`, f.admin.token);
  assert.equal(impact.status, 200);
  assert.equal(impact.json.manualResolution.resolvedOwnerCount, 1);
  assert.equal(impact.json.manualResolution.resolvedNotThisStudentCount, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// Concurrency (items 24, 25)
// ═══════════════════════════════════════════════════════════════════════

test("24: two Admins resolving the same candidate simultaneously — both succeed, deterministic latest", async () => {
  const f = await readyPreparation("concurrent-ab");
  const admin2 = await makeAdminWithPermission(DELETE_PERM);
  const [r1, r2] = await Promise.all([
    post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" }, f.admin.token),
    post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT" }, admin2.token),
  ]);
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  const rows = await pool.query(
    `SELECT decision FROM student_legacy_identity_resolutions WHERE student_id = $1 ORDER BY resolved_at DESC, id DESC LIMIT 1`,
    [f.studentId],
  );
  assert.ok(["PROVEN_OWNER", "NOT_THIS_STUDENT"].includes(rows.rows[0].decision));
  const countAll = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions WHERE student_id = $1`, [f.studentId]);
  assert.equal(Number(countAll.rows[0].count), 2);
});

test("25: resolve vs cancel-preparation race is safe (no inconsistent state)", async () => {
  const f = await readyPreparation("resolve-vs-cancel");
  const [resolveRes, cancelRes] = await Promise.all([
    post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" }, f.admin.token),
    cancelPrep(f.studentId, f.admin.token),
  ]);
  assert.equal(cancelRes.status, 200);
  // Either outcome is acceptable per Section 18B: resolve succeeded just
  // before cancellation (201, and a resolution row exists), OR the fresh
  // active-workflow re-check caught the cancellation (409). What is NOT
  // acceptable is a resolution row existing that references a workflow
  // which is not (and never was, at time of insert) the active one.
  assert.ok([201, 409].includes(resolveRes.status));
  if (resolveRes.status === 201) {
    const row = await pool.query(`SELECT deletion_workflow_id FROM student_legacy_identity_resolutions WHERE id = $1`, [resolveRes.json.id]);
    assert.equal(Number(row.rows[0].deletion_workflow_id), f.workflowId);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// B2B / planner integration (items 28, 29, 30)
// ═══════════════════════════════════════════════════════════════════════

test("28: B2B manualResolution block counts correct across resolution states", async () => {
  const f1 = await readyPreparation("b2b-owner");
  await post(resolveUrl(f1.studentId), { workflowId: f1.workflowId, domain: "package_orders", targetRecordId: f1.orderId, decision: "PROVEN_OWNER" }, f1.admin.token);
  const impact1 = await get(`/api/students/${f1.studentId}/deletion-impact`, f1.admin.token);
  assert.equal(impact1.json.manualResolution.requiredCount, 1);
  assert.equal(impact1.json.manualResolution.resolvedOwnerCount, 1);
  assert.equal(impact1.json.manualResolution.unresolvedCount, 0);

  const f2 = await readyPreparation("b2b-unresolved");
  const impact2 = await get(`/api/students/${f2.studentId}/deletion-impact`, f2.admin.token);
  assert.equal(impact2.json.manualResolution.requiredCount, 1);
  assert.equal(impact2.json.manualResolution.unresolvedCount, 1);
  assert.equal(impact2.json.manualResolution.resolvedOwnerCount, 0);

  const f3 = await readyPreparation("b2b-notthis");
  await post(resolveUrl(f3.studentId), { workflowId: f3.workflowId, domain: "package_orders", targetRecordId: f3.orderId, decision: "NOT_THIS_STUDENT" }, f3.admin.token);
  const impact3 = await get(`/api/students/${f3.studentId}/deletion-impact`, f3.admin.token);
  assert.equal(impact3.json.manualResolution.resolvedNotThisStudentCount, 1);
});

test("29: planner levelBResolutions field correct for various states", async () => {
  const f = await readyPreparation("planner-status");
  const before = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  assert.equal(before.status, 200);
  const beforeEntry = before.json.levelBResolutions.find((e: any) => e.targetRecordId === f.orderId);
  assert.equal(beforeEntry.resolutionStatus, "NONE");

  await post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" }, f.admin.token);
  const after1 = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  const afterEntry = after1.json.levelBResolutions.find((e: any) => e.targetRecordId === f.orderId);
  assert.equal(afterEntry.resolutionStatus, "PROVEN_OWNER");
});

test("30: planner remains read-only (zero writes) after this addition", async () => {
  const f = await readyPreparation("planner-readonly");
  const before = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`);
  await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  const after1 = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`);
  assert.equal(before.rows[0].count, after1.rows[0].count);
});

// ═══════════════════════════════════════════════════════════════════════
// No-backfill / no-mutation proofs (items 31, 32, 33)
// ═══════════════════════════════════════════════════════════════════════

test("31: PROVEN_OWNER never writes package_orders.student_id", async () => {
  const f = await readyPreparation("no-backfill");
  await post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" }, f.admin.token);
  const order = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [f.orderId]);
  assert.equal(order.rows[0].student_id, null);
});

test("32: zero finance mutation — credit_transactions checksum unchanged before/after", async () => {
  const f = await readyPreparation("finance-checksum");
  const before = await pool.query(`SELECT md5(string_agg(id::text || ':' || delta::text || ':' || student_id::text, ',' ORDER BY id)) FROM credit_transactions`);
  await post(resolveUrl(f.studentId), { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" }, f.admin.token);
  const after1 = await pool.query(`SELECT md5(string_agg(id::text || ':' || delta::text || ':' || student_id::text, ',' ORDER BY id)) FROM credit_transactions`);
  assert.equal(before.rows[0].md5, after1.rows[0].md5);
});

test("33: zero provenance mutation — student_email_identity_history + provenance_activation unchanged across a resolution", async () => {
  const f = await readyPreparation("provenance-checksum");
  const snapshot = async () => {
    const hist = await pool.query(
      `SELECT coalesce(md5(string_agg(x::text, E'\n' ORDER BY x::text)), 'EMPTY') AS h, count(*) AS n FROM student_email_identity_history x`,
    );
    const act = await pool.query(
      `SELECT coalesce(md5(string_agg(x::text, E'\n' ORDER BY x::text)), 'EMPTY') AS h, count(*) AS n FROM provenance_activation x`,
    );
    return { hist: hist.rows[0], act: act.rows[0] };
  };
  const before = await snapshot();
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
  const after = await snapshot();
  assert.deepEqual(after, before, "provenance tables must be byte-identical across a manual resolution");
});

test("34/35 runtime companion: attendance + package_orders + students unchanged across a resolution (only the decision table grows)", async () => {
  const f = await readyPreparation("no-mutation-wide");
  const hashOf = async (table: string) => {
    const r = await pool.query(
      `SELECT coalesce(md5(string_agg(x::text, E'\n' ORDER BY x::text)), 'EMPTY') AS h FROM ${table} x`,
    );
    return r.rows[0].h as string;
  };
  const tables = ["students", "package_orders", "attendance", "credit_transactions", "feedback", "bookings", "student_deletion_workflows"];
  const before: Record<string, string> = {};
  for (const t of tables) before[t] = await hashOf(t);
  const decisionsBefore = Number((await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`)).rows[0].count);

  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);

  for (const t of tables) {
    assert.equal(await hashOf(t), before[t], `${t} must be byte-identical across a manual resolution`);
  }
  const decisionsAfter = Number((await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`)).rows[0].count);
  assert.equal(decisionsAfter, decisionsBefore + 1, "exactly one decision row is appended, nothing else changes");
});
