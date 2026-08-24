/**
 * Phase B3B3 — Proven ownership backfill executor.
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * students router. Follows the harness conventions of
 * students.deletionManualResolution.integration.test.ts.
 *
 * IMPORTANT: this suite never references student id 34 or any other
 * hardcoded production id — every student used here is created fresh in
 * this disposable database by this test run.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_OWNERSHIP_BACKFILL_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_ownership_backfill";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-ownership-backfill-identity-provenance-pepper".padEnd(64, "0");

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
  return `ob-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`OB Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`ob-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`ob-admin-${Date.now()}-${adminSeq}`, `ob-admin-${Date.now()}-${adminSeq}@example.com`, "x", `OB Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `ob-admin-${adminSeq}`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
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

function backfillUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-backfill`;
}
function resolveUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-resolutions`;
}

/**
 * Level-B fixture + active preparation + (optionally) a recorded decision.
 */
async function setupLevelB(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const { studentId, email } = await makeStudent(tag, accountStatus);
  const orderId = await makePackageOrder(email, null);
  const creditId = await makeCreditTxn(orderId, studentId);
  const attendanceId = await makeAttendance(orderId, studentId, `OB Test ${tag}`, email);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  return { studentId, email, orderId, creditId, attendanceId, admin };
}

async function setupPrepared(tag: string) {
  const f = await setupLevelB(tag);
  const startRes = await startPrep(f.studentId, f.admin.token);
  assert.equal(startRes.status, 201);
  return { ...f, workflowId: startRes.json.id as number };
}

async function setupResolved(tag: string, decision: "PROVEN_OWNER" | "NOT_THIS_STUDENT" | "UNRESOLVED" = "PROVEN_OWNER") {
  const f = await setupPrepared(tag);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision,
  }, f.admin.token);
  assert.equal(res.status, 201);
  return { ...f, resolutionId: res.json.id as number };
}

async function ownerOf(orderId: number): Promise<number | null> {
  const r = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [orderId]);
  return r.rows[0].student_id === null ? null : Number(r.rows[0].student_id);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Valid PROVEN_OWNER backfill
// ═══════════════════════════════════════════════════════════════════════

test("1: PROVEN_OWNER decision backfills package_orders.student_id", async () => {
  const f = await setupResolved("apply");
  assert.equal(await ownerOf(f.orderId), null);

  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 1);
  assert.equal(res.json.results.length, 1);
  assert.equal(res.json.results[0].domain, "package_orders");
  assert.equal(res.json.results[0].targetRecordId, f.orderId);
  assert.equal(res.json.results[0].action, "APPLIED");
  assert.equal(res.json.results[0].resolutionId, f.resolutionId);
  assert.equal(await ownerOf(f.orderId), f.studentId);
});

// ═══════════════════════════════════════════════════════════════════════
// 2/3/5/6. Non-PROVEN_OWNER and non-Level-B are never consumed
// ═══════════════════════════════════════════════════════════════════════

test("2: UNRESOLVED decision is never backfilled", async () => {
  const f = await setupResolved("unresolved", "UNRESOLVED");
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), null);
});

test("3: NOT_THIS_STUDENT decision is never backfilled", async () => {
  const f = await setupResolved("notthis", "NOT_THIS_STUDENT");
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), null);
});

test("5: Level C row (one evidence source only) can never be backfilled", async () => {
  const { studentId, email } = await makeStudent("levelc");
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId); // credit only — no attendance
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  // A resolution cannot even be recorded for a Level-C row...
  const resolveRes = await post(resolveUrl(studentId), {
    workflowId: startRes.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(resolveRes.status, 409);
  // ...and the backfill executor applies nothing.
  const res = await post(backfillUrl(studentId), { workflowId: startRes.json.id }, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(orderId), null);
});

test("5b: Level D row (no independent evidence at all) can never be backfilled", async () => {
  const { studentId, email } = await makeStudent("leveld");
  const orderId = await makePackageOrder(email, null);
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const startRes = await startPrep(studentId, admin.token);
  const res = await post(backfillUrl(studentId), { workflowId: startRes.json.id }, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(orderId), null);
});

test("6: client cannot forge a target/owner — extra body fields are rejected 400", async () => {
  const f = await setupResolved("forged");
  const other = await makeStudent("forged-other");
  const otherOrder = await makePackageOrder(other.email, null);

  for (const forged of [
    { workflowId: f.workflowId, targetRecordId: otherOrder },
    { workflowId: f.workflowId, studentId: other.studentId },
    { workflowId: f.workflowId, domain: "bookings" },
    { workflowId: f.workflowId, ownerStudentId: other.studentId },
    { workflowId: f.workflowId, evidenceLevel: "B" },
  ]) {
    const res = await post(backfillUrl(f.studentId), forged, f.admin.token);
    assert.equal(res.status, 400, `forged body ${JSON.stringify(forged)} was not rejected`);
  }
  // Nothing was applied to the unrelated order, and the legitimate target
  // is still untouched by the rejected calls.
  assert.equal(await ownerOf(otherOrder), null);
  assert.equal(await ownerOf(f.orderId), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 7/8/9/10/11. Precondition rejections (fail closed, not silent no-op)
// ═══════════════════════════════════════════════════════════════════════

test("7: active (non-deactivated) student rejected 409", async () => {
  const f = await setupResolved("reactivate");
  await pool.query(`UPDATE students SET account_status = 'active' WHERE id = $1`, [f.studentId]);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_NOT_DEACTIVATED");
  assert.equal(await ownerOf(f.orderId), null);
});

test("8: no active preparation rejected 409", async () => {
  const f = await setupLevelB("noprep");
  const res = await post(backfillUrl(f.studentId), { workflowId: 999999 }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
  assert.equal(await ownerOf(f.orderId), null);
});

test("9: cancelled preparation rejected 409", async () => {
  const f = await setupResolved("cancelled");
  const cancelRes = await cancelPrep(f.studentId, f.admin.token);
  assert.equal(cancelRes.status, 200);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "STUDENT_DELETION_PREPARATION_REQUIRED");
  assert.equal(await ownerOf(f.orderId), null);
});

test("10: stale resolution (workflow restarted since the decision) is not consumed", async () => {
  const f = await setupResolved("stale");
  // Restart the workflow: the durable decision now belongs to a superseded
  // workflow and must not be applied under the new one.
  assert.equal((await cancelPrep(f.studentId, f.admin.token)).status, 200);
  const restart = await startPrep(f.studentId, f.admin.token);
  assert.equal(restart.status, 201);
  const newWorkflowId = restart.json.id as number;
  assert.notEqual(newWorkflowId, f.workflowId);

  // Backfilling under the NEW workflow finds no eligible decision.
  const res = await post(backfillUrl(f.studentId), { workflowId: newWorkflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), null);

  // Backfilling under the OLD workflow id fails closed as stale.
  const staleRes = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(staleRes.status, 409);
  assert.equal(staleRes.json.code, "LEGACY_IDENTITY_RESOLUTION_STALE");
  assert.equal(await ownerOf(f.orderId), null);
});

test("11: evidence changed since the decision — backfill applies nothing", async () => {
  const f = await setupResolved("evidence-gone");
  // The attendance row that made this Level B is removed after the decision.
  await pool.query(`DELETE FROM attendance WHERE id = $1`, [f.attendanceId]);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 12/13. Idempotency and hard ownership conflict
// ═══════════════════════════════════════════════════════════════════════

test("12: repeated execution is idempotent — no duplicate side effects", async () => {
  const f = await setupResolved("idempotent");
  const first = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(first.status, 200);
  assert.equal(first.json.appliedCount, 1);
  assert.equal(await ownerOf(f.orderId), f.studentId);

  const auditAfterFirst = await pool.query(
    `SELECT count(*) FROM admin_activity_logs WHERE action = 'deletion_attribution_ownership_backfill' AND entity_id = $1`,
    [String(f.studentId)],
  );

  const second = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(second.status, 200);
  assert.equal(second.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), f.studentId);

  const auditAfterSecond = await pool.query(
    `SELECT count(*) FROM admin_activity_logs WHERE action = 'deletion_attribution_ownership_backfill' AND entity_id = $1`,
    [String(f.studentId)],
  );
  assert.equal(Number(auditAfterSecond.rows[0].count), Number(auditAfterFirst.rows[0].count));
});

test("13: target already owned by a DIFFERENT student is never overwritten", async () => {
  const f = await setupResolved("conflict");
  const other = await makeStudent("conflict-other");
  // Someone else's ownership lands on the row after the decision was taken.
  await pool.query(`UPDATE package_orders SET student_id = $1 WHERE id = $2`, [other.studentId, f.orderId]);

  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  // The row has left the candidate universe (student_id no longer NULL), so
  // nothing is even attempted — and critically, the other student's
  // ownership is intact.
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 0);
  assert.equal(await ownerOf(f.orderId), other.studentId);
});

// ═══════════════════════════════════════════════════════════════════════
// 14/15/16. Concurrency
// ═══════════════════════════════════════════════════════════════════════

test("14: concurrent duplicate execution is safe — one coherent final owner", async () => {
  const f = await setupResolved("concurrent");
  const [a, b, c] = await Promise.all([
    post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
  ]);
  for (const r of [a, b, c]) assert.equal(r.status, 200);
  const totalApplied = a!.json.appliedCount + b!.json.appliedCount + c!.json.appliedCount;
  assert.equal(totalApplied, 1, "the FK must be applied exactly once across concurrent runs");
  assert.equal(await ownerOf(f.orderId), f.studentId);
});

test("15: resolve/backfill race is safe", async () => {
  const f = await setupResolved("race-resolve");
  const [backfillRes, resolveRes] = await Promise.all([
    post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    post(resolveUrl(f.studentId), {
      workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT",
    }, f.admin.token),
  ]);
  assert.equal(backfillRes.status, 200);
  // Either ordering is coherent: if the backfill won, the FK is set and the
  // later resolution attempt sees an already-owned row (409); if the new
  // decision won, the FK stays NULL. Never both, never a different owner.
  const owner = await ownerOf(f.orderId);
  if (backfillRes.json.appliedCount === 1) {
    assert.equal(owner, f.studentId);
  } else {
    assert.equal(owner, null);
  }
  assert.ok([201, 409].includes(resolveRes.status), `unexpected resolve status ${resolveRes.status}`);
});

test("16: cancel/backfill race is safe", async () => {
  const f = await setupResolved("race-cancel");
  const [backfillRes, cancelRes] = await Promise.all([
    post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token),
    cancelPrep(f.studentId, f.admin.token),
  ]);
  assert.ok([200, 409].includes(backfillRes.status), `unexpected backfill status ${backfillRes.status}`);
  assert.equal(cancelRes.status, 200);
  const owner = await ownerOf(f.orderId);
  if (backfillRes.status === 200 && backfillRes.json.appliedCount === 1) {
    assert.equal(owner, f.studentId);
  } else {
    assert.equal(owner, null);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 17/18/19/20. Nothing but the canonical FK changes
// ═══════════════════════════════════════════════════════════════════════

test("17/20: only package_orders.student_id changes — every other column byte-identical", async () => {
  const f = await setupResolved("only-fk");
  const before = await pool.query(`SELECT * FROM package_orders WHERE id = $1`, [f.orderId]);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.appliedCount, 1);
  const afterRow = await pool.query(`SELECT * FROM package_orders WHERE id = $1`, [f.orderId]);

  const beforeRow = before.rows[0];
  const changed: string[] = [];
  for (const key of Object.keys(beforeRow)) {
    if (JSON.stringify(beforeRow[key]) !== JSON.stringify(afterRow.rows[0][key])) changed.push(key);
  }
  assert.deepEqual(changed, ["student_id"], `unexpected column changes: ${changed.join(", ")}`);
  // Explicit historical contact-snapshot assertions (item 20).
  assert.equal(afterRow.rows[0].student_email, beforeRow.student_email);
  assert.equal(afterRow.rows[0].student_name, beforeRow.student_name);
});

test("18: Finance is unchanged — credit_transactions checksum identical", async () => {
  const f = await setupResolved("finance");
  const checksumSql = `SELECT md5(string_agg(t.row_text, '|' ORDER BY t.row_text)) AS checksum
                       FROM (SELECT ct::text AS row_text FROM credit_transactions ct) t`;
  const before = await pool.query(checksumSql);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);
  const afterChecksum = await pool.query(checksumSql);
  assert.equal(afterChecksum.rows[0].checksum, before.rows[0].checksum);
});

test("19: provenance is unchanged", async () => {
  const f = await setupResolved("provenance");
  const provSql = `SELECT
    (SELECT md5(coalesce(string_agg(h::text, '|' ORDER BY h::text), '')) FROM student_email_identity_history h) AS hist,
    (SELECT md5(coalesce(string_agg(a::text, '|' ORDER BY a::text), '')) FROM provenance_activation a) AS act`;
  const before = await pool.query(provSql);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);
  const afterProv = await pool.query(provSql);
  assert.equal(afterProv.rows[0].hist, before.rows[0].hist);
  assert.equal(afterProv.rows[0].act, before.rows[0].act);
});

// ═══════════════════════════════════════════════════════════════════════
// 21/22/23. Downstream reads and append-only history
// ═══════════════════════════════════════════════════════════════════════

test("21: planner no longer lists the row as an unresolved Level-B candidate", async () => {
  const f = await setupResolved("planner");
  const planBefore = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  assert.equal(planBefore.status, 200);
  assert.ok(planBefore.json.levelBResolutions.some((r: any) => r.targetRecordId === f.orderId));

  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);

  const planAfter = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  assert.equal(planAfter.status, 200);
  assert.ok(
    !planAfter.json.levelBResolutions.some((r: any) => r.targetRecordId === f.orderId),
    "row must fall out of the Level-B candidate set once the ownership FK is set",
  );
});

test("22: deletion-impact manual-resolution counts drop after backfill", async () => {
  const f = await setupResolved("impact");
  const before = await get(`/api/students/${f.studentId}/deletion-impact`, f.admin.token);
  assert.equal(before.status, 200);
  assert.equal(before.json.manualResolution.requiredCount, 1);
  assert.equal(before.json.manualResolution.resolvedOwnerCount, 1);

  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);

  const afterImpact = await get(`/api/students/${f.studentId}/deletion-impact`, f.admin.token);
  assert.equal(afterImpact.status, 200);
  assert.equal(afterImpact.json.manualResolution.requiredCount, 0);
  assert.equal(afterImpact.json.manualResolution.unresolvedCount, 0);
});

test("23: append-only resolution history is preserved by the backfill", async () => {
  const f = await setupResolved("history");
  const beforeRows = await pool.query(
    `SELECT * FROM student_legacy_identity_resolutions WHERE student_id = $1 ORDER BY id`, [f.studentId],
  );
  const beforeTotal = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`);

  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);

  const afterRows = await pool.query(
    `SELECT * FROM student_legacy_identity_resolutions WHERE student_id = $1 ORDER BY id`, [f.studentId],
  );
  const afterTotal = await pool.query(`SELECT count(*) FROM student_legacy_identity_resolutions`);
  assert.equal(Number(afterTotal.rows[0].count), Number(beforeTotal.rows[0].count));
  assert.deepEqual(
    afterRows.rows.map((r: any) => JSON.stringify(r)),
    beforeRows.rows.map((r: any) => JSON.stringify(r)),
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 24/25. RBAC and audit
// ═══════════════════════════════════════════════════════════════════════

test("24: RBAC — unauthenticated 401, users.view/users.edit 403, users.delete + Super Admin allowed", async () => {
  const f = await setupResolved("rbac");

  const anon = await fetch(apiUrl(backfillUrl(f.studentId)), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowId: f.workflowId }),
  });
  assert.equal(anon.status, 401);

  const viewer = await makeAdminWithPermission(VIEW_ONLY_PERM);
  assert.equal((await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, viewer.token)).status, 403);

  const editor = await makeAdminWithPermission(EDIT_ONLY_PERM);
  assert.equal((await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, editor.token)).status, 403);

  const studentToken = jwtSign({ sub: f.studentId, tokenVersion: 0 }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });
  const asStudent = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, undefined, studentToken);
  assert.ok([401, 403].includes(asStudent.status), `student JWT got ${asStudent.status}`);

  assert.equal(await ownerOf(f.orderId), null, "no denied caller may mutate ownership");

  const superAdmin = await makeAdminWithPermission({}, true);
  const allowed = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, superAdmin.token);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.appliedCount, 1);
});

test("25: audit entry recorded with structured metadata only, no PII", async () => {
  const f = await setupResolved("audit");
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);

  // logActivity is fire-and-after-response; give it a moment to land.
  let rows: any[] = [];
  for (let attempt = 0; attempt < 20 && rows.length === 0; attempt += 1) {
    const q = await pool.query(
      `SELECT * FROM admin_activity_logs WHERE action = 'deletion_attribution_ownership_backfill' AND entity_id = $1`,
      [String(f.studentId)],
    );
    rows = q.rows;
    if (rows.length === 0) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(rows.length, 1);
  const serialized = JSON.stringify(rows[0]);
  assert.ok(serialized.includes(String(f.orderId)), "audit must reference the internal target id");
  assert.ok(!serialized.includes(f.email), "audit leaked the student email");
  // The only PII-shaped field on the row is the standard actor snapshot
  // (the acting ADMIN, written by the shared logActivity convention for
  // every audited mutation). The backfill's own payload — summary,
  // entity_id, before/after — must contain no student-side PII at all.
  const ownFields = JSON.stringify({
    summary: rows[0].summary,
    entity_id: rows[0].entity_id,
    entity_label: rows[0].entity_label,
    before: rows[0].before,
    after: rows[0].after,
  });
  assert.ok(!/@/.test(ownFields), `audit payload leaked an email address: ${ownFields}`);
  assert.ok(!ownFields.includes("OB Test"), "audit payload leaked a student name");
});

// ═══════════════════════════════════════════════════════════════════════
// 26. Hard safety boundary
// ═══════════════════════════════════════════════════════════════════════

test("26: backfill never deletes/anonymizes the student account", async () => {
  const f = await setupResolved("boundary");
  const before = await pool.query(`SELECT * FROM students WHERE id = $1`, [f.studentId]);
  const res = await post(backfillUrl(f.studentId), { workflowId: f.workflowId }, f.admin.token);
  assert.equal(res.json.appliedCount, 1);
  const afterStudent = await pool.query(`SELECT * FROM students WHERE id = $1`, [f.studentId]);
  assert.equal(afterStudent.rows.length, 1);
  assert.deepEqual(JSON.stringify(afterStudent.rows[0]), JSON.stringify(before.rows[0]));
  assert.equal(afterStudent.rows[0].account_status, "deactivated");
});
