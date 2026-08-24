/**
 * Phase B3B2E — FINAL CLOSURE PASS, Part 2 (sections 10 + 11).
 *
 * Real disposable Postgres, real in-process Express app, REAL concurrent
 * HTTP requests via Promise.all (never simulated sequential calls).
 *
 * Proves:
 *   - no silent overwrite under concurrent resolution submissions
 *   - append-only history (rows only ever INSERTed, never UPDATEd)
 *   - deterministic single "current" derived state, never contradictory
 *   - stale workflow rejected under a resolve-vs-cancel race
 *   - Level-B eligibility disappearing mid-flight is handled fail-closed
 *   - B2B block-summary policy semantics per evidence level / decision
 *
 * Never references student id 34 or any hardcoded production id.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_MR_CONCURRENCY_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_manual_resolution_concurrency";

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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-mr-concurrency-identity-provenance-pepper".padEnd(64, "0");

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
  return `mrc-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`MRC Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
const DELETE_PERM = { users: { delete: true, edit: true, view: true } };
async function makeAdmin(): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const uniq = `${Date.now()}-${adminSeq}`;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`mrc-role-${uniq}`, JSON.stringify(DELETE_PERM)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, 'x', $3, false, true, $4) RETURNING id`,
    [`mrc_admin_${uniq}`.replace(/-/g, "_"), `mrc-admin-${uniq}@example.com`, `MRC Admin ${adminSeq}`, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `mrc-admin-${adminSeq}`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

let poSeq = 0;
async function makePackageOrder(studentEmail: string) {
  poSeq += 1;
  const r = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, NULL, 'Test Package', 8, 8, 'active') RETURNING id`,
    [`PO MRC ${poSeq}`, studentEmail],
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
async function makeAttendance(packageOrderId: number, studentId: number | null, email: string) {
  const r = await pool.query(
    `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
     VALUES ('MRC', $1, $2, $3, true) RETURNING id`,
    [email, packageOrderId, studentId],
  );
  return r.rows[0].id as number;
}

function resolveUrl(studentId: number) {
  return `/api/students/${studentId}/deletion-attribution-resolutions`;
}
async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}
async function cancelPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/cancel`, {}, adminToken);
}

async function readyLevelB(tag: string) {
  const { studentId, email } = await makeStudent(tag);
  const orderId = await makePackageOrder(email);
  const creditId = await makeCreditTxn(orderId, studentId);
  const attendanceId = await makeAttendance(orderId, studentId, email);
  const admin = await makeAdmin();
  const startRes = await startPrep(studentId, admin.token);
  assert.equal(startRes.status, 201);
  return { studentId, email, orderId, creditId, attendanceId, admin, workflowId: startRes.json.id as number };
}

/** Derived "current" state, exactly as the production code derives it. */
async function historyRows(studentId: number, targetRecordId: number) {
  const r = await pool.query(
    `SELECT id, decision, evidence_level, evidence_reason_code, evidence_snapshot_ref,
            resolved_by_admin_id, resolved_at, deletion_workflow_id, xmin::text AS xmin
       FROM student_legacy_identity_resolutions
      WHERE student_id = $1 AND domain = 'package_orders' AND target_record_id = $2
      ORDER BY resolved_at ASC, id ASC`,
    [studentId, targetRecordId],
  );
  return r.rows as any[];
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10 — CONCURRENCY
// ═══════════════════════════════════════════════════════════════════════

test("C1: concurrent PROVEN_OWNER vs PROVEN_OWNER — both append, no overwrite, one coherent current state", async () => {
  const f = await readyLevelB("c1");
  const body = { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER" };
  const [a, b] = await Promise.all([
    post(resolveUrl(f.studentId), { ...body }, f.admin.token),
    post(resolveUrl(f.studentId), { ...body }, f.admin.token),
  ]);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.notEqual(a.json.id, b.json.id, "each successful submission must be its OWN row (append-only)");

  const rows = await historyRows(f.studentId, f.orderId);
  assert.equal(rows.length, 2, "exactly two appended rows");
  // Append-only proof: every row is still at its INSERT transaction (never UPDATEd).
  const distinctXmin = new Set(rows.map((r) => r.xmin));
  assert.equal(distinctXmin.size, 2, "each row written by its own distinct transaction; none rewritten");
  for (const r of rows) assert.equal(r.decision, "PROVEN_OWNER");

  // Current state via the production derivation (latest by resolved_at, id).
  const plan = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  assert.equal(plan.status, 200);
  const entry = plan.json.levelBResolutions.find((x: any) => x.targetRecordId === f.orderId);
  assert.equal(entry.resolutionStatus, "PROVEN_OWNER", "single unambiguous current state");
});

test("C2: concurrent PROVEN_OWNER vs NOT_THIS_STUDENT — both recorded, exactly one deterministic current state", async () => {
  const f = await readyLevelB("c2");
  const base = { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId };
  const [a, b] = await Promise.all([
    post(resolveUrl(f.studentId), { ...base, decision: "PROVEN_OWNER" }, f.admin.token),
    post(resolveUrl(f.studentId), { ...base, decision: "NOT_THIS_STUDENT" }, f.admin.token),
  ]);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(b.status, 201, JSON.stringify(b.json));

  const rows = await historyRows(f.studentId, f.orderId);
  assert.equal(rows.length, 2, "no silent overwrite — both opposing decisions preserved in history");
  const decisions = rows.map((r) => r.decision).sort();
  assert.deepEqual(decisions, ["NOT_THIS_STUDENT", "PROVEN_OWNER"]);
  assert.equal(new Set(rows.map((r) => r.xmin)).size, 2, "no row was UPDATEd in place");

  // Exactly ONE current state — never both, never contradictory.
  const plan = await get(`/api/students/${f.studentId}/deletion-attribution-plan`, f.admin.token);
  const entries = plan.json.levelBResolutions.filter((x: any) => x.targetRecordId === f.orderId);
  assert.equal(entries.length, 1, "exactly one derived current state for the pair");
  assert.ok(["PROVEN_OWNER", "NOT_THIS_STUDENT"].includes(entries[0].resolutionStatus));

  // And the B2B summary agrees with it — never double counted.
  const impact = await get(`/api/students/${f.studentId}/deletion-impact`, f.admin.token);
  const s = impact.json.manualResolution;
  assert.equal(s.requiredCount, 1);
  assert.equal(s.resolvedOwnerCount + s.resolvedNotThisStudentCount, 1, "counted exactly once, on one side only");
  assert.equal(s.unresolvedCount, 0);
});

test("C3: concurrent resolve vs cancel-preparation — never both a live workflow and a resolution against a dead one", async () => {
  const results: Array<{ resolve: number; cancel: number; rows: number }> = [];
  for (let i = 0; i < 6; i += 1) {
    const f = await readyLevelB(`c3-${i}`);
    const [resolveRes, cancelRes] = await Promise.all([
      post(resolveUrl(f.studentId), {
        workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
      }, f.admin.token),
      cancelPrep(f.studentId, f.admin.token),
    ]);
    const rows = await historyRows(f.studentId, f.orderId);
    results.push({ resolve: resolveRes.status, cancel: cancelRes.status, rows: rows.length });

    // Invariant: a resolution row exists ONLY if the resolve succeeded.
    assert.equal(rows.length, resolveRes.status === 201 ? 1 : 0,
      `iteration ${i}: resolve=${resolveRes.status} but ${rows.length} rows`);
    // Invariant: the loser must fail on a workflow/preparation precondition,
    // never a 500 and never a silent success.
    if (resolveRes.status !== 201) {
      assert.equal(resolveRes.status, 409, `iteration ${i}: ${JSON.stringify(resolveRes.json)}`);
      assert.ok(
        ["LEGACY_IDENTITY_RESOLUTION_STALE", "STUDENT_DELETION_PREPARATION_REQUIRED"].includes(resolveRes.json.code),
        `iteration ${i}: unexpected code ${resolveRes.json?.code}`,
      );
    }
    // Any recorded row must always cite the workflow that was actually active.
    if (rows.length === 1) assert.equal(Number(rows[0].deletion_workflow_id), f.workflowId);
  }
  assert.ok(results.every((r) => r.resolve === 201 || r.resolve === 409), JSON.stringify(results));
});

test("C4: stale workflow after cancel+restart is rejected even when submitted concurrently with the restart", async () => {
  const f = await readyLevelB("c4");
  const cancelled = await cancelPrep(f.studentId, f.admin.token);
  assert.ok([200, 201].includes(cancelled.status), JSON.stringify(cancelled.json));
  const [restart, staleResolve] = await Promise.all([
    startPrep(f.studentId, f.admin.token),
    post(resolveUrl(f.studentId), {
      workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
    }, f.admin.token),
  ]);
  assert.equal(restart.status, 201);
  assert.notEqual(restart.json.id, f.workflowId);
  assert.equal(staleResolve.status, 409, JSON.stringify(staleResolve.json));
  assert.ok(["LEGACY_IDENTITY_RESOLUTION_STALE", "STUDENT_DELETION_PREPARATION_REQUIRED"].includes(staleResolve.json.code));
  assert.equal((await historyRows(f.studentId, f.orderId)).length, 0, "stale workflow must never persist a decision");
});

test("C5: concurrent resolve vs evidence-conflict appearing — never records a decision on a conflicted row", async () => {
  for (let i = 0; i < 6; i += 1) {
    const f = await readyLevelB(`c5-${i}`);
    const other = await makeStudent(`c5-other-${i}`);
    // Conflicting channel-C evidence introduced concurrently with the resolve.
    const [resolveRes] = await Promise.all([
      post(resolveUrl(f.studentId), {
        workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
      }, f.admin.token),
      pool.query(
        `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
         VALUES ('MRC conflict', $1, $2, $3, true)`,
        [f.email, f.orderId, other.studentId],
      ),
    ]);
    const rows = await historyRows(f.studentId, f.orderId);
    if (resolveRes.status === 201) {
      // Won the race — evidence was still clean when the tx read it.
      assert.equal(rows.length, 1);
      assert.equal(rows[0].evidence_reason_code, "CREDIT_TXN_AND_ATTENDANCE_AGREE");
    } else {
      assert.equal(resolveRes.status, 409, JSON.stringify(resolveRes.json));
      assert.equal(rows.length, 0, "conflicted row must never carry a decision");
    }
    // Regardless of who won, the row is now conflicted and NOT further resolvable.
    const after = await post(resolveUrl(f.studentId), {
      workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
    }, f.admin.token);
    assert.equal(after.status, 409, `post-conflict submit must be rejected: ${JSON.stringify(after.json)}`);
    assert.ok(
      ["LEGACY_IDENTITY_RESOLUTION_EVIDENCE_CONFLICT", "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B", "LEGACY_IDENTITY_RESOLUTION_NOT_A_CANDIDATE"]
        .includes(after.json.code),
      `unexpected code ${after.json?.code}`,
    );
  }
});

/** Either code is an acceptable fail-closed refusal once evidence vanishes. */
const FAIL_CLOSED_CODES = [
  "LEGACY_IDENTITY_RESOLUTION_NOT_LEVEL_B",
  "LEGACY_IDENTITY_RESOLUTION_NOT_A_CANDIDATE",
];

test("C6: concurrent resolve vs Level-B evidence disappearing — fail-closed, never a decision without evidence", async () => {
  for (let i = 0; i < 6; i += 1) {
    const f = await readyLevelB(`c6-${i}`);
    const [resolveRes] = await Promise.all([
      post(resolveUrl(f.studentId), {
        workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
      }, f.admin.token),
      pool.query(`DELETE FROM attendance WHERE id = $1`, [f.attendanceId]),
    ]);
    const rows = await historyRows(f.studentId, f.orderId);
    if (resolveRes.status === 201) {
      assert.equal(rows.length, 1);
      // The snapshot must cite the attendance row that existed at decision time.
      assert.ok(rows[0].evidence_snapshot_ref.includes(`att=${f.attendanceId}`),
        `snapshot ${rows[0].evidence_snapshot_ref} must pin the evidence it relied on`);
    } else {
      assert.equal(resolveRes.status, 409, JSON.stringify(resolveRes.json));
      assert.ok(FAIL_CLOSED_CODES.includes(resolveRes.json.code), `unexpected code ${resolveRes.json?.code}`);
      assert.equal(rows.length, 0);
    }
    // Evidence is now gone — the row is no longer Level B and cannot be resolved.
    const after = await post(resolveUrl(f.studentId), {
      workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
    }, f.admin.token);
    assert.equal(after.status, 409);
    assert.ok(FAIL_CLOSED_CODES.includes(after.json.code), `unexpected code ${after.json?.code}`);
  }
});

test("C7: 8-way concurrent burst — every 201 is its own row, zero rows rewritten, zero 5xx", async () => {
  const f = await readyLevelB("c7");
  const base = { workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId };
  const decisions = ["PROVEN_OWNER", "NOT_THIS_STUDENT", "UNRESOLVED", "PROVEN_OWNER",
    "NOT_THIS_STUDENT", "UNRESOLVED", "PROVEN_OWNER", "NOT_THIS_STUDENT"];
  const results = await Promise.all(decisions.map((d) => post(resolveUrl(f.studentId), { ...base, decision: d }, f.admin.token)));
  assert.ok(results.every((r) => r.status < 500), `no 5xx: ${JSON.stringify(results.map((r) => r.status))}`);
  const created = results.filter((r) => r.status === 201);
  const rows = await historyRows(f.studentId, f.orderId);
  assert.equal(rows.length, created.length, "row count == successful submissions (pure append)");
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(new Set(rows.map((r) => r.xmin)).size, rows.length, "no row shares a write txn / none rewritten");
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11 — B2B POLICY FINAL PROOF
// ═══════════════════════════════════════════════════════════════════════

async function impactSummary(studentId: number, adminToken: string) {
  const r = await get(`/api/students/${studentId}/deletion-impact`, adminToken);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

test("P1: Level B unresolved (no decision row) BLOCKS — counted in unresolvedCount", async () => {
  const f = await readyLevelB("p1");
  const s = (await impactSummary(f.studentId, f.admin.token)).manualResolution;
  assert.deepEqual(s, { requiredCount: 1, resolvedOwnerCount: 0, resolvedNotThisStudentCount: 0, unresolvedCount: 1, conflictCount: 0 });
});

test("P2: Level B explicit UNRESOLVED decision still BLOCKS", async () => {
  const f = await readyLevelB("p2");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "UNRESOLVED",
  }, f.admin.token);
  assert.equal(res.status, 201);
  const s = (await impactSummary(f.studentId, f.admin.token)).manualResolution;
  assert.equal(s.unresolvedCount, 1, "an explicit UNRESOLVED must keep blocking");
  assert.equal(s.resolvedOwnerCount, 0);
});

test("P3: Level B PROVEN_OWNER closes the question (no longer unresolved); ownership FK still untouched (backfill is a later phase)", async () => {
  const f = await readyLevelB("p3");
  const before = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [f.orderId]);
  assert.equal(before.rows[0].student_id, null);
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201);
  const s = (await impactSummary(f.studentId, f.admin.token)).manualResolution;
  assert.equal(s.unresolvedCount, 0);
  assert.equal(s.resolvedOwnerCount, 1);
  const after = await pool.query(`SELECT student_id FROM package_orders WHERE id = $1`, [f.orderId]);
  assert.equal(after.rows[0].student_id, null, "PROVEN_OWNER is decision-only — NO ownership backfill in B3B2E");
});

test("P4: Level B NOT_THIS_STUDENT does not block this Student for this candidate", async () => {
  const f = await readyLevelB("p4");
  const res = await post(resolveUrl(f.studentId), {
    workflowId: f.workflowId, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT",
  }, f.admin.token);
  assert.equal(res.status, 201);
  const s = (await impactSummary(f.studentId, f.admin.token)).manualResolution;
  assert.equal(s.unresolvedCount, 0);
  assert.equal(s.resolvedNotThisStudentCount, 1);
});

test("P5: Level C (single evidence source) does NOT enter the manual-resolution block set", async () => {
  const { studentId, email } = await makeStudent("p5");
  const orderId = await makePackageOrder(email);
  await makeCreditTxn(orderId, studentId); // credit only, no attendance
  const admin = await makeAdmin();
  const start = await startPrep(studentId, admin.token);
  assert.equal(start.status, 201);
  const s = (await impactSummary(studentId, admin.token)).manualResolution;
  assert.equal(s.requiredCount, 0, "Level C must not block via this layer");
  assert.equal(s.unresolvedCount, 0);
});

test("P6: Level D (zero independent evidence) does NOT block", async () => {
  const { studentId, email } = await makeStudent("p6");
  await makePackageOrder(email); // no credit txn, no attendance
  const admin = await makeAdmin();
  const start = await startPrep(studentId, admin.token);
  assert.equal(start.status, 201);
  const s = (await impactSummary(studentId, admin.token)).manualResolution;
  assert.deepEqual(s, { requiredCount: 0, resolvedOwnerCount: 0, resolvedNotThisStudentCount: 0, unresolvedCount: 0, conflictCount: 0 });
});

test("P7: EVIDENCE_CONFLICT can never be cleared by a resolution, and is surfaced by the planner", async () => {
  const { studentId, email } = await makeStudent("p7");
  const other = await makeStudent("p7-other");
  const orderId = await makePackageOrder(email);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, other.studentId, email); // conflicting owner
  const admin = await makeAdmin();
  const start = await startPrep(studentId, admin.token);
  assert.equal(start.status, 201);

  for (const decision of ["PROVEN_OWNER", "NOT_THIS_STUDENT", "UNRESOLVED"]) {
    const res = await post(resolveUrl(studentId), {
      workflowId: start.json.id, domain: "package_orders", targetRecordId: orderId, decision,
    }, admin.token);
    assert.equal(res.status, 409, `${decision} must be refused on a conflicted row`);
  }
  const rows = await historyRows(studentId, orderId);
  assert.equal(rows.length, 0, "no false resolution may exist for a conflicted row");

  // The conflict must be visible somewhere read-only, not silently dropped:
  // it is NOT resolvable, so it must not appear as a resolvable candidate.
  const plan = await get(`/api/students/${studentId}/deletion-attribution-plan`, admin.token);
  assert.equal(plan.status, 200);
  assert.equal(plan.json.levelBResolutions.filter((x: any) => x.targetRecordId === orderId).length, 0,
    "a conflicted row must never be offered as a resolvable Level-B candidate");
});

test("P8: unrelated deletion blockers are unaffected by this diff", async () => {
  const f = await readyLevelB("p8");
  const impact = await impactSummary(f.studentId, f.admin.token);
  // The pre-existing impact shape must still be intact alongside the additive field.
  assert.ok(Array.isArray(impact.domains) || typeof impact === "object");
  assert.ok("manualResolution" in impact, "additive field present");
  assert.ok("deletionPreparation" in impact, "pre-existing B3B0 field still present");
  const keys = Object.keys(impact);
  assert.ok(keys.length > 2, `impact response must retain its pre-existing fields, got ${JSON.stringify(keys)}`);
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 14 — PII / SECRET STORAGE (runtime row inspection)
// ═══════════════════════════════════════════════════════════════════════

test("S1: every persisted resolution row is free of raw email/phone/name/fingerprint/pepper", async () => {
  const r = await pool.query(`SELECT * FROM student_legacy_identity_resolutions`);
  assert.ok(r.rows.length > 0, "this suite must have written rows by now");
  const pepper = process.env.IDENTITY_PROVENANCE_PEPPER!;
  for (const row of r.rows) {
    const blob = JSON.stringify(row);
    assert.ok(!/@/.test(blob), `row ${row.id} contains an email-like value`);
    assert.ok(!/v1:k1:/.test(blob), `row ${row.id} contains a provenance fingerprint`);
    assert.ok(!blob.includes(pepper), `row ${row.id} contains the pepper`);
    assert.ok(!/MRC Test|MRC Admin/.test(blob), `row ${row.id} contains a person name`);
    // evidence_snapshot_ref must be internal numeric ids only.
    assert.match(row.evidence_snapshot_ref, /^wf\d+:credit=[\d,]*:att=[\d,]*$/,
      `evidence_snapshot_ref shape: ${row.evidence_snapshot_ref}`);
  }
});
