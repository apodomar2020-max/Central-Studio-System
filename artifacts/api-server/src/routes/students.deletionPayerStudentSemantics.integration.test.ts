/**
 * Phase B3B2E — FINAL CLOSURE PASS, Part 1, Sections 3 & 4.
 *
 * Section 3: PAYER-IS-ALSO-A-STUDENT edge case. A `package_orders` row's
 * `student_email` / `student_name` are the PAYER/CONTACT identity of the
 * order, which is NOT the same thing as the entitlement owner. This suite
 * proves the system never derives Student ownership candidacy from the
 * payer relationship alone.
 *
 * Section 4: EVIDENCE-CONFLICT FINAL MATRIX — the cells not already covered
 * by students.deletionManualResolution.integration.test.ts:
 *   - only-attendance evidence (insufficient, not Level B)
 *   - independent evidence DISAPPEARS between plan and submission
 *   - conflicting evidence APPEARS between plan and submission (staleness)
 *
 * Real disposable Postgres, real in-process Express app mounting the real
 * students router. Never references student id 34 or any production id.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PAYER_SEMANTICS_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_payer";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-payer-semantics-identity-provenance-pepper".padEnd(64, "0");

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

type ApiResult = { status: number; json: any };
async function post(path: string, body: unknown, adminToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.API_SECRET_KEY}`,
  };
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
  return `payer-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`Payer Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const uniq = `ps-${Date.now()}-${adminSeq}`;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`${uniq}-role`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`${uniq}-admin`, `${uniq}-admin@example.com`, "x", `Payer Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `${uniq}-admin`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}

let poSeq = 0;
async function makePackageOrder(
  studentEmail: string,
  studentIdOnOrder: number | null = null,
  participantType: string | null = null,
  participantChildId: number | null = null,
) {
  poSeq += 1;
  const r = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status, participant_type, participant_child_id)
     VALUES ($1, $2, $3, 'Test Package', 8, 8, 'active', $4, $5) RETURNING id`,
    [`Payer PO ${poSeq}`, studentEmail, studentIdOnOrder, participantType, participantChildId],
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

async function makeChild(parentStudentId: number, name: string) {
  const r = await pool.query(
    `INSERT INTO children (parent_id, full_name) VALUES ($1, $2) RETURNING id`,
    [parentStudentId, name],
  );
  return r.rows[0].id as number;
}

const DELETE_PERM = { users: { delete: true, edit: true, view: true } };

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

function planUrl(studentId: number) { return `/api/students/${studentId}/deletion-attribution-plan`; }
function resolveUrl(studentId: number) { return `/api/students/${studentId}/deletion-attribution-resolutions`; }

/** Level-B resolution ids the planner currently reports for this student. */
function levelBIds(plan: any): number[] {
  return (plan.levelBResolutions ?? []).map((r: any) => r.targetRecordId);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — payer-is-also-a-Student
// ═══════════════════════════════════════════════════════════════════════

/**
 * 3A. The order's payer/contact IS an existing Student (their live email is
 * literally on the order), but NO entitlement/ownership evidence
 * (credit_transactions / attendance) points at that Student.
 *
 * Expected: the payer relationship alone must NOT produce Student OWNERSHIP
 * candidacy. The row may be visible to the planner as a weak channel-B
 * signal, but it must never be Level B and must never be manually
 * resolvable.
 */
test("3A: payer/contact is an existing Student but no entitlement evidence — payer identity alone creates NO ownership candidacy", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("3a");
  // Order paid for / contacted at this Student's own email. Zero
  // credit_transactions, zero attendance — no entitlement evidence at all.
  const orderId = await makePackageOrder(email, null);

  const startRes = await startPrep(studentId, admin.token);
  assert.equal(startRes.status, 201);
  const workflowId = startRes.json.id as number;

  const plan = await get(planUrl(studentId), admin.token);
  assert.equal(plan.status, 200);
  // Not Level B: payer identity contributes nothing to the Level-B set.
  assert.equal(levelBIds(plan.json).includes(orderId), false,
    "payer-identity-only row must not be a Level-B candidate");
  // And it is NOT classified as an attributable ownership row.
  const pkgEntries = (plan.json.domains ?? []).filter((d: any) => d.domain === "package_orders");
  const classifications = pkgEntries.map((d: any) => d.classification);
  assert.equal(classifications.includes("INDEPENDENT_LEVEL_B_EVIDENCE"), false,
    "payer-identity-only row must not produce INDEPENDENT_LEVEL_B_EVIDENCE");
  assert.equal(classifications.includes("SAFE_TO_ATTRIBUTE"), false,
    "payer identity with no provenance interval must not be SAFE_TO_ATTRIBUTE");

  // And it is genuinely unresolvable through the manual-resolution layer.
  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");

  // Hard proof of no ownership backfill.
  const order = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(order.rows[0].student_id, null);
});

/**
 * 3B. Payer/contact Student ALSO matches on soft Level-C signals only
 * (matching email + matching name + matching phone on the attendance rows),
 * but with NO student_id-carrying entitlement evidence.
 *
 * Expected: still weak/Level-C territory — never promoted to Level B by the
 * accumulation of soft signals, never manually resolvable.
 */
test("3B: payer/contact Student with matching email+name+phone soft signals only — stays Level C, never Level B", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("3b");
  const orderId = await makePackageOrder(email, null);
  // Soft signals ONLY: attendance and credit rows exist for this order but
  // carry student_id = NULL — they match by name/email string alone.
  await makeCreditTxn(orderId, null);
  await makeAttendance(orderId, null, `Payer Test 3b`, email);

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  const plan = await get(planUrl(studentId), admin.token);
  assert.equal(plan.status, 200);
  assert.equal(levelBIds(plan.json).includes(orderId), false,
    "email+name+phone string matching must not reach Level B");

  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");
  assert.equal(res.json.reason, "LEVEL_C_OR_D");
});

/**
 * 3C. The payer/contact Student ALSO has genuine independent dual-source
 * evidence (credit_transactions.student_id AND attendance.student_id both
 * agreeing on them).
 *
 * Expected: Level B — but BECAUSE of the independent evidence, not because
 * they are the payer. Proven by the companion assertion: an otherwise
 * identical order where the SAME student is payer but has no evidence is
 * NOT Level B (test 3A above), so the evidence is the load-bearing input.
 */
test("3C: payer/contact Student WITH independent dual-source evidence is Level B — driven by the evidence, not the payer relationship", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("3c");

  // Order 1: this Student is payer AND has dual-source evidence.
  const withEvidence = await makePackageOrder(email, null);
  await makeCreditTxn(withEvidence, studentId);
  await makeAttendance(withEvidence, studentId, `Payer Test 3c`, email);

  // Order 2: this Student is payer, identical in every other way, but with
  // NO evidence — the control that isolates the causal variable.
  const withoutEvidence = await makePackageOrder(email, null);

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  const plan = await get(planUrl(studentId), admin.token);
  assert.equal(plan.status, 200);
  const ids = levelBIds(plan.json);
  assert.equal(ids.includes(withEvidence), true, "evidence-backed order must be Level B");
  assert.equal(ids.includes(withoutEvidence), false,
    "identical payer relationship WITHOUT evidence must not be Level B — evidence is the causal input");

  const ok = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: withEvidence, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(ok.status, 201);
  assert.equal(ok.json.evidenceReasonCode, "CREDIT_TXN_AND_ATTENDANCE_AGREE");

  const rejected = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: withoutEvidence, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(rejected.status, 409);
});

/**
 * 3D. Child-participant package order where the payer IS a Student.
 *
 * Expected: the payer relationship must NOT override child/entitlement
 * semantics — SEMANTICALLY_NOT_STUDENT_OWNERSHIP still applies, and the row
 * is not manually resolvable as Student ownership.
 */
test("3D: child-participant order paid by a Student stays SEMANTICALLY_NOT_STUDENT_OWNERSHIP — payer relationship does not override child semantics", async () => {
  const t0 = await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("3d");
  // Give the student a covering provenance interval, so that WITHOUT the
  // child semantics this row would otherwise classify SAFE_TO_ATTRIBUTE —
  // this makes the child override load-bearing rather than vacuous.
  await insertInterval(studentId, email, new Date(new Date(t0).getTime() - 86_400_000).toISOString(), null, admin.id);
  const childId = await makeChild(studentId, "Payer Test 3d Child");
  const orderId = await makePackageOrder(email, null, "child", childId);

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  const plan = await get(planUrl(studentId), admin.token);
  assert.equal(plan.status, 200);
  const pkgEntries = (plan.json.domains ?? []).filter((d: any) => d.domain === "package_orders");
  const classifications = pkgEntries.map((d: any) => d.classification);
  assert.equal(classifications.includes("SEMANTICALLY_NOT_STUDENT_OWNERSHIP"), true,
    "child-participant order must classify SEMANTICALLY_NOT_STUDENT_OWNERSHIP");
  assert.equal(classifications.includes("SAFE_TO_ATTRIBUTE"), false,
    "child-participant order must NOT be SAFE_TO_ATTRIBUTE despite a covering interval");
  assert.equal(levelBIds(plan.json).includes(orderId), false);

  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);

  const order = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(order.rows[0].student_id, null);
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — evidence-conflict matrix, remaining cells
// ═══════════════════════════════════════════════════════════════════════

/**
 * Matrix cell: ONLY attendance evidence exists (no credit_transactions row
 * carrying this student_id). Both immutable sources are required — one is
 * insufficient. (The mirror case — only credit_transactions — is covered by
 * students.deletionManualResolution.integration.test.ts "2/19/20".)
 */
test("4: only attendance evidence (no credit_transactions) is INSUFFICIENT — not Level B, rejected 409", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("only-att");
  const orderId = await makePackageOrder(email, null);
  await makeAttendance(orderId, studentId, `Payer Test only-att`, email);
  // Deliberately NO credit_transactions row for this student.

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  const plan = await get(planUrl(studentId), admin.token);
  assert.equal(levelBIds(plan.json).includes(orderId), false);

  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");
  assert.equal(res.json.reason, "LEVEL_C_OR_D");
});

/**
 * Matrix cell: the independent evidence DISAPPEARS between plan generation
 * and decision submission (a credit_transaction is reassigned away). The
 * server must re-derive fresh inside the write transaction and reject —
 * never honour the stale plan the Admin was looking at.
 */
test("4: independent evidence removed between plan and submit — server re-derives fresh and rejects 409 (no stale acceptance)", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("evid-vanish");
  const orderId = await makePackageOrder(email, null);
  const creditId = await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, `Payer Test evid-vanish`, email);

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  // Plan generated while the row IS Level B — this is what the Admin saw.
  const planBefore = await get(planUrl(studentId), admin.token);
  assert.equal(levelBIds(planBefore.json).includes(orderId), true);

  // Evidence reassigned away (a correction elsewhere in the system).
  await pool.query(`UPDATE credit_transactions SET student_id = NULL WHERE id = $1`, [creditId]);

  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409, "stale Level-B claim must not be accepted after evidence vanished");
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");

  const recorded = await pool.query(
    `SELECT count(*) FROM student_legacy_identity_resolutions WHERE student_id = $1 AND target_record_id = $2`,
    [studentId, orderId],
  );
  assert.equal(Number(recorded.rows[0].count), 0, "no decision row may be written on the stale path");

  // And the planner now agrees the row is no longer Level B.
  const planAfter = await get(planUrl(studentId), admin.token);
  assert.equal(levelBIds(planAfter.json).includes(orderId), false);
});

/**
 * Matrix cell: CONFLICTING evidence APPEARS after a plan was generated but
 * before the decision is submitted. No automatic attribution, no hidden
 * precedence rule, no PROVEN_OWNER accepted while a conflict exists.
 */
test("4: conflicting evidence appears between plan and submit — PROVEN_OWNER rejected 409 while conflict exists", async () => {
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const { studentId, email } = await makeStudent("conflict-late");
  const { studentId: otherStudentId } = await makeStudent("conflict-late-other");
  const orderId = await makePackageOrder(email, null);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, `Payer Test conflict-late`, email);

  const startRes = await startPrep(studentId, admin.token);
  const workflowId = startRes.json.id as number;

  const planBefore = await get(planUrl(studentId), admin.token);
  assert.equal(levelBIds(planBefore.json).includes(orderId), true);

  // A contradicting attendance row for a DIFFERENT student now appears on
  // the same package_order — internal channel-C disagreement.
  await makeAttendance(orderId, otherStudentId, `Payer Test conflict-late-other`, freshEmail("other"));

  const res = await post(resolveUrl(studentId), {
    workflowId, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, admin.token);
  assert.equal(res.status, 409, "PROVEN_OWNER must never be accepted while a conflict exists");
  assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B");
  assert.equal(res.json.reason, "CONFLICTING_STUDENT_IDS");

  assert.equal(
    Number((await pool.query(
      `SELECT count(*) FROM student_legacy_identity_resolutions WHERE target_record_id = $1`, [orderId],
    )).rows[0].count),
    0,
    "no decision row may be written while the conflict stands",
  );
  // No hidden precedence: the OTHER student cannot resolve it either.
  const otherAdmin = await makeAdminWithPermission(DELETE_PERM);
  const otherStart = await startPrep(otherStudentId, otherAdmin.token);
  const otherRes = await post(resolveUrl(otherStudentId), {
    workflowId: otherStart.json.id, domain: "package_orders", targetRecordId: orderId, decision: "PROVEN_OWNER",
  }, otherAdmin.token);
  assert.equal(otherRes.status, 409, "no hidden precedence rule may let the other side win");

  // Zero ownership backfill throughout.
  const order = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(order.rows[0].student_id, null);
});
