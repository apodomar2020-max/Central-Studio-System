/**
 * Phase B3B2E — Level-B / EVIDENCE_CONFLICT deletion-blocking policy.
 *
 * BINDING POLICY UNDER TEST (part 1): ANY unresolved Level-B legacy candidate
 * blocks permanent deletion — whether there is no decision row at all, an
 * explicit UNRESOLVED decision, or an EVIDENCE_CONFLICT. PROVEN_OWNER and
 * NOT_THIS_STUDENT clear it. See the LEVEL-B BLOCKING POLICY block below.
 *
 * BINDING POLICY UNDER TEST (part 2): an EVIDENCE_CONFLICT is NOT Level C/D and is
 * NOT out of scope. It is known, actionable cross-signal ambiguity about who
 * owns a legacy row, it can never be truthfully resolved while it stands,
 * and it therefore BLOCKS permanent deletion for every Student whose
 * canonical deletion plan contains it. Fail-closed.
 *
 * These tests exercise the REAL endpoints against a real disposable
 * Postgres, with real fixtures — no mocking of the derivation layer.
 *
 * IMPORTANT: never references student id 34 or any hardcoded production id.
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
process.env.IDENTITY_PROVENANCE_PEPPER = "test-conflict-blocking-identity-provenance-pepper".padEnd(64, "0");

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

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
  return `cb-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, email_verified)
     VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`CB Test ${tag}`, email, accountStatus],
  );
  return { studentId: r.rows[0].id as number, email };
}

let adminSeq = 0;
async function makeAdminWithPermission(perm: Record<string, unknown>): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`cb-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, false, true, $5) RETURNING id`,
    [`cb-admin-${Date.now()}-${adminSeq}`, `cb-admin-${Date.now()}-${adminSeq}@example.com`, "x", `CB Admin ${adminSeq}`, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `cb-admin-${adminSeq}`, isSuperAdmin: false, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

async function startPrep(studentId: number, adminToken: string) {
  return post(`/api/students/${studentId}/deletion-preparation/start`, {}, adminToken);
}

let poSeq = 0;
async function makePackageOrder(studentEmail: string) {
  poSeq += 1;
  const r = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, NULL, 'Test Package', 8, 8, 'active') RETURNING id`,
    [`CB PO Test ${poSeq}`, studentEmail],
  );
  return r.rows[0].id as number;
}
async function makeCreditTxn(packageOrderId: number, studentId: number) {
  const r = await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'package_activated', 8, 0, 8, 'system') RETURNING id`,
    [packageOrderId, studentId],
  );
  return r.rows[0].id as number;
}
async function makeAttendance(packageOrderId: number, studentId: number, studentName: string, studentEmail: string) {
  const r = await pool.query(
    `INSERT INTO attendance (student_name, student_email, package_order_id, student_id, credit_deducted)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [studentName, studentEmail, packageOrderId, studentId],
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
  const r = await pool.query(
    `INSERT INTO student_email_identity_history (student_id, email_fingerprint, valid_from, valid_to, source, changed_by_admin_id)
     VALUES ($1, $2, $3, $4, 'admin_update', $5) RETURNING id`,
    [studentId, fp, validFrom, validTo, adminId],
  );
  return r.rows[0].id as number;
}

function impactUrl(studentId: number) { return `/api/students/${studentId}/deletion-impact`; }
function resolveUrl(studentId: number) { return `/api/students/${studentId}/deletion-attribution-resolutions`; }

/**
 * Builds THE canonical cross-signal conflict fixture:
 *   - a package_orders row with student_id NULL whose OWN stored email is
 *     Student A's email, covered by a post-T0 provenance interval for A
 *     (channel B => A), while
 *   - its credit_transactions + attendance evidence both agree on Student B
 *     (channel C => B).
 *
 * Student B is the interesting subject: the row is NOT email-attributable to
 * B at all, so B has NO other legacy blocker — B's ONLY Level-B-relevant
 * candidate is this EVIDENCE_CONFLICT row.
 */
async function conflictFixture(tag: string) {
  const studentA = await makeStudent(`${tag}-a`);
  const studentB = await makeStudent(`${tag}-b`);
  const t0 = await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const intervalId = await insertInterval(studentA.studentId, studentA.email, t0, null, admin.id);

  const orderId = await makePackageOrder(studentA.email);
  await makeCreditTxn(orderId, studentB.studentId);
  await makeAttendance(orderId, studentB.studentId, `CB Test ${tag}-b`, studentB.email);

  return { studentA, studentB, orderId, admin, intervalId };
}

// ═══════════════════════════════════════════════════════════════════════
// A. EVIDENCE_CONFLICT increases the blocking/unresolved counters.
// ═══════════════════════════════════════════════════════════════════════
test("A: EVIDENCE_CONFLICT is counted as required + unresolved + conflict in the B2B manualResolution summary", async () => {
  const f = await conflictFixture("counter");

  const impactB = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(impactB.status, 200, JSON.stringify(impactB.json));
  const mr = impactB.json.manualResolution;
  assert.equal(mr.conflictCount, 1, `expected exactly one conflict, got ${JSON.stringify(mr)}`);
  assert.equal(mr.requiredCount, 1, "a conflict is a REQUIRED case, not an excluded one");
  assert.equal(mr.unresolvedCount, 1, "a conflict is UNRESOLVED (and unresolvABLE) — it must not be dropped");
  assert.equal(mr.resolvedOwnerCount, 0);
  assert.equal(mr.resolvedNotThisStudentCount, 0);

  // The conflict blocks the OTHER side of the conflict too (Student A).
  const impactA = await get(impactUrl(f.studentA.studentId), f.admin.token);
  assert.equal(impactA.status, 200);
  assert.equal(impactA.json.manualResolution.conflictCount, 1, "the same conflict blocks Student A as well");
  assert.equal(impactA.json.canDelete, false);
});

// ═══════════════════════════════════════════════════════════════════════
// B. A Student whose ONLY Level-B-relevant row is a conflict can never
//    reach canDelete === true.
// ═══════════════════════════════════════════════════════════════════════
test("B: a deactivated Student with ONLY an EVIDENCE_CONFLICT candidate cannot reach canDelete=true", async () => {
  const f = await conflictFixture("candelete");

  const impact = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(impact.status, 200, JSON.stringify(impact.json));
  assert.equal(impact.json.lifecycleStatus, "deactivated", "precondition: the only ordinary blocker is already cleared");
  assert.equal(impact.json.manualResolution.conflictCount, 1);
  assert.equal(impact.json.canDelete, false, "an unresolvable evidence conflict MUST block deletion");

  const blocker = impact.json.blockers.find((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION");
  assert.ok(blocker, `expected an AMBIGUOUS_LEGACY_ATTRIBUTION blocker, got ${JSON.stringify(impact.json.blockers)}`);
  assert.equal(blocker.count, 1);
  // Blockers and categories must stay coherent with each other.
  assert.ok(impact.json.categories.some((c: any) => c.key === "AMBIGUOUS_LEGACY_ATTRIBUTION" && c.classification === "blocker"));
  assert.ok(!impact.json.categories.some((c: any) => c.key === "OK"), "an OK category must never coexist with a blocker");
});

// ═══════════════════════════════════════════════════════════════════════
// C. Unrelated / clean composition still works — nothing was broken.
// ═══════════════════════════════════════════════════════════════════════
test("C: a clean deactivated Student with no legacy candidates still shows canDelete=true and zero counters", async () => {
  const { studentId } = await makeStudent("clean");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const impact = await get(impactUrl(studentId), admin.token);
  assert.equal(impact.status, 200, JSON.stringify(impact.json));
  assert.deepEqual(impact.json.manualResolution, {
    requiredCount: 0,
    resolvedOwnerCount: 0,
    resolvedNotThisStudentCount: 0,
    unresolvedCount: 0,
    conflictCount: 0,
  });
  assert.equal(impact.json.blockers.length, 0, JSON.stringify(impact.json.blockers));
  assert.equal(impact.json.canDelete, true);
  assert.deepEqual(impact.json.categories, [{ key: "OK", label: "No blockers", classification: "delete" }]);
});

test("C2: an ordinary (non-conflict) blocker still composes correctly alongside a zero conflict count", async () => {
  const { studentId } = await makeStudent("stillactive", "active");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const impact = await get(impactUrl(studentId), admin.token);
  assert.equal(impact.status, 200);
  assert.equal(impact.json.manualResolution.conflictCount, 0);
  assert.equal(impact.json.canDelete, false);
  assert.ok(impact.json.blockers.some((b: any) => b.key === "ACCOUNT_MUST_BE_DEACTIVATED"));
  assert.ok(!impact.json.blockers.some((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION"), "no conflict blocker may be invented when conflictCount is 0");
});

// ═══════════════════════════════════════════════════════════════════════
// D. A conflict can never be falsely resolved (re-confirmation under the
//    new counting behaviour) — for EVERY decision value, both sides.
// ═══════════════════════════════════════════════════════════════════════
test("D: a conflicted row is rejected 409 for PROVEN_OWNER, NOT_THIS_STUDENT and UNRESOLVED alike, for both students", async () => {
  const f = await conflictFixture("reject");
  const startA = await startPrep(f.studentA.studentId, f.admin.token);
  assert.equal(startA.status, 201);
  const startB = await startPrep(f.studentB.studentId, f.admin.token);
  assert.equal(startB.status, 201);

  for (const [studentId, workflowId] of [
    [f.studentA.studentId, startA.json.id],
    [f.studentB.studentId, startB.json.id],
  ] as Array<[number, number]>) {
    for (const decision of ["PROVEN_OWNER", "NOT_THIS_STUDENT", "UNRESOLVED"]) {
      const res = await post(resolveUrl(studentId), {
        workflowId, domain: "package_orders", targetRecordId: f.orderId, decision,
      }, f.admin.token);
      assert.equal(res.status, 409, `${decision} for student ${studentId}: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.code, "LEGACY_IDENTITY_RESOLUTION_EVIDENCE_CONFLICT");
    }
  }

  // Fail-closed proof: nothing was persisted for either student.
  const rows = await pool.query(
    `SELECT count(*) FROM student_legacy_identity_resolutions WHERE target_record_id = $1`,
    [f.orderId],
  );
  assert.equal(Number(rows.rows[0].count), 0, "a conflicted row must never produce a resolution record");
});

// ═══════════════════════════════════════════════════════════════════════
// E. Regression: the conflict must not silently vanish from the summary.
//    Before the B3B2E conflict-policy fix, computeManualResolutionBlockSummary
//    skipped conflicted candidates outright, so this student reported
//    requiredCount=0 / unresolvedCount=0 and looked fully unblocked.
// ═══════════════════════════════════════════════════════════════════════
test("E: regression — a conflict-only Student never reports an all-zero manualResolution summary", async () => {
  const f = await conflictFixture("regression");
  const impact = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(impact.status, 200);
  const mr = impact.json.manualResolution;
  const allZero = mr.requiredCount === 0 && mr.unresolvedCount === 0;
  assert.equal(allZero, false, `conflict silently vanished from the summary: ${JSON.stringify(mr)}`);
  assert.ok(mr.requiredCount >= 1);
  assert.ok(mr.unresolvedCount >= 1);
  assert.ok(mr.conflictCount >= 1);

  // And the planner still surfaces it as EVIDENCE_CONFLICT (unchanged).
  const startB = await startPrep(f.studentB.studentId, f.admin.token);
  assert.equal(startB.status, 201);
  const plan = await get(`/api/students/${f.studentB.studentId}/deletion-attribution-plan`, f.admin.token);
  assert.equal(plan.status, 200);
  assert.ok(
    plan.json.domains.some((d: any) => d.domain === "package_orders" && d.classification === "EVIDENCE_CONFLICT"),
    `planner lost the conflict: ${JSON.stringify(plan.json.domains)}`,
  );
  // A conflicted row is never offered as resolvable.
  assert.ok(!(plan.json.levelBResolutions ?? []).some((r: any) => r.targetRecordId === f.orderId));
});

// ═══════════════════════════════════════════════════════════════════════
// F. Once the conflicting evidence genuinely disappears, the summary
//    follows the new canonical evidence state.
// ═══════════════════════════════════════════════════════════════════════
test("F: removing the conflicting signal turns the row into a plain Level-B candidate and clears the block", async () => {
  const f = await conflictFixture("cleared");

  const before = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(before.json.manualResolution.conflictCount, 1);
  assert.equal(before.json.canDelete, false);

  // Remove the ONLY thing making this a conflict for Student B: Student A's
  // covering provenance interval over the row's stored email. Now the row's
  // sole surviving ownership signal is Student B's own credit+attendance
  // evidence — a plain, non-conflicted Level-B candidate.
  await pool.query(`DELETE FROM student_email_identity_history WHERE id = $1`, [f.intervalId]);

  const after = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(after.status, 200);
  const mr = after.json.manualResolution;
  assert.equal(mr.conflictCount, 0, "the conflict genuinely no longer exists");
  assert.equal(mr.requiredCount, 1, "it is still a Level-B case requiring a decision");
  assert.equal(mr.unresolvedCount, 1, "still undecided, but no longer a conflict");
  // The row is no longer a CONFLICT, but it is still an UNRESOLVED Level-B
  // candidate — and per the binding Level-B policy that still blocks, through
  // the same AMBIGUOUS_LEGACY_ATTRIBUTION path.
  assert.ok(
    after.json.blockers.some((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION" && b.count === 1),
    `an unresolved Level-B candidate must still block: ${JSON.stringify(after.json.blockers)}`,
  );
  assert.equal(after.json.canDelete, false, "unresolved Level-B blocks even when it is not a conflict");

  // And it is now genuinely resolvable (the conflict rejection is gone).
  const startB = await startPrep(f.studentB.studentId, f.admin.token);
  assert.equal(startB.status, 201);
  const res = await post(resolveUrl(f.studentB.studentId), {
    workflowId: startB.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.evidenceLevel, "B");

  const settled = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(settled.json.manualResolution.resolvedOwnerCount, 1);
  assert.equal(settled.json.manualResolution.unresolvedCount, 0);
  assert.ok(
    !settled.json.blockers.some((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION"),
    "with the only Level-B candidate resolved, the manual-resolution blocker lifts",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// G. Storage boundary: no unrestricted free-text field is accepted or
//    persisted by the manual-resolution decision layer.
// ═══════════════════════════════════════════════════════════════════════
test("G: the resolution request rejects any free-text field and the table has no free-text column", async () => {
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'student_legacy_identity_resolutions' ORDER BY column_name`,
  );
  const colNames = cols.rows.map((r: any) => r.column_name);
  assert.ok(!colNames.includes("notes"), `free-text column present: ${colNames.join(", ")}`);
  assert.deepEqual(colNames, [
    "created_at",
    "decision",
    "deletion_workflow_id",
    "domain",
    "evidence_level",
    "evidence_reason_code",
    "evidence_snapshot_ref",
    "id",
    "resolved_at",
    "resolved_by_admin_id",
    "student_id",
    "target_record_id",
  ]);

  // The API must refuse an unknown/free-text field rather than ignore it.
  const { studentId, email } = await makeStudent("notes-rejected");
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const orderId = await makePackageOrder(email);
  await makeCreditTxn(orderId, studentId);
  await makeAttendance(orderId, studentId, "CB Test notes-rejected", email);
  const start = await startPrep(studentId, admin.token);
  assert.equal(start.status, 201);

  const withNotes = await post(resolveUrl(studentId), {
    workflowId: start.json.id,
    domain: "package_orders",
    targetRecordId: orderId,
    decision: "PROVEN_OWNER",
    notes: "parent email is jane.doe@example.com, card ending 4242",
  }, admin.token);
  assert.equal(withNotes.status, 400, `free-text must be rejected outright: ${JSON.stringify(withNotes.json)}`);

  const persisted = await pool.query(
    `SELECT count(*) FROM student_legacy_identity_resolutions WHERE student_id = $1`,
    [studentId],
  );
  assert.equal(Number(persisted.rows[0].count), 0, "the rejected request must persist nothing");
});

// ═══════════════════════════════════════════════════════════════════════
// LEVEL-B BLOCKING POLICY (Phase B3B2E final).
//
//   Level B + no decision row     → BLOCK
//   Level B + UNRESOLVED          → BLOCK
//   Level B + EVIDENCE_CONFLICT   → BLOCK
//   Level B + PROVEN_OWNER        → manual-resolution blocker cleared
//   Level B + NOT_THIS_STUDENT    → manual-resolution blocker cleared
//
// All three blocking shapes must travel the SAME blocker path
// (AMBIGUOUS_LEGACY_ATTRIBUTION), and clearing them must not disturb
// composition with unrelated blockers.
// ═══════════════════════════════════════════════════════════════════════

/**
 * A plain (non-conflicted) Level-B candidate: a legacy package_orders row
 * stored under an email that belongs to NO provenance interval, whose only
 * ownership signal is the student's own credit + attendance evidence.
 */
async function plainLevelBFixture(tag: string, accountStatus: "active" | "deactivated" = "deactivated") {
  const student = await makeStudent(tag, accountStatus);
  await ensureT0();
  const admin = await makeAdminWithPermission(DELETE_PERM);
  const orderId = await makePackageOrder(freshEmail(`${tag}-orphan`));
  await makeCreditTxn(orderId, student.studentId);
  await makeAttendance(orderId, student.studentId, `CB Test ${tag}`, student.email);
  return { student, orderId, admin };
}

function ambiguousBlocker(impact: ApiResult) {
  return impact.json.blockers.find((b: any) => b.key === "AMBIGUOUS_LEGACY_ATTRIBUTION");
}

test("LB-A: an ordinary unresolved Level-B candidate with NO decision row at all blocks canDelete", async () => {
  const f = await plainLevelBFixture("lb-none");
  const impact = await get(impactUrl(f.student.studentId), f.admin.token);
  assert.equal(impact.status, 200, JSON.stringify(impact.json));
  assert.equal(impact.json.lifecycleStatus, "deactivated");
  const mr = impact.json.manualResolution;
  assert.equal(mr.requiredCount, 1, JSON.stringify(mr));
  assert.equal(mr.unresolvedCount, 1, JSON.stringify(mr));
  assert.equal(mr.conflictCount, 0, "this fixture is deliberately NOT a conflict");
  const blocker = ambiguousBlocker(impact);
  assert.ok(blocker, `expected AMBIGUOUS_LEGACY_ATTRIBUTION, got ${JSON.stringify(impact.json.blockers)}`);
  assert.equal(blocker.count, 1);
  assert.equal(impact.json.canDelete, false, "Level B + no resolution MUST block");
  assert.ok(!impact.json.categories.some((c: any) => c.key === "OK"));
});

test("LB-B: an explicit UNRESOLVED decision on a Level-B candidate blocks canDelete", async () => {
  const f = await plainLevelBFixture("lb-unresolved");
  const start = await startPrep(f.student.studentId, f.admin.token);
  assert.equal(start.status, 201, JSON.stringify(start.json));
  const rec = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "UNRESOLVED",
  }, f.admin.token);
  assert.equal(rec.status, 201, JSON.stringify(rec.json));

  const impact = await get(impactUrl(f.student.studentId), f.admin.token);
  const mr = impact.json.manualResolution;
  assert.equal(mr.requiredCount, 1, JSON.stringify(mr));
  assert.equal(mr.unresolvedCount, 1, "an explicit UNRESOLVED still counts as unresolved");
  assert.equal(mr.resolvedOwnerCount, 0);
  assert.equal(mr.resolvedNotThisStudentCount, 0);
  assert.ok(ambiguousBlocker(impact), JSON.stringify(impact.json.blockers));
  assert.equal(impact.json.canDelete, false, "Level B + UNRESOLVED MUST block");
});

test("LB-C: an EVIDENCE_CONFLICT Level-B candidate blocks canDelete via the SAME blocker path", async () => {
  const f = await conflictFixture("lb-conflict");
  const impact = await get(impactUrl(f.studentB.studentId), f.admin.token);
  assert.equal(impact.json.manualResolution.conflictCount, 1);
  assert.equal(impact.json.manualResolution.unresolvedCount, 1);
  const blocker = ambiguousBlocker(impact);
  assert.ok(blocker, JSON.stringify(impact.json.blockers));
  assert.equal(blocker.count, 1);
  assert.equal(impact.json.canDelete, false, "Level B + EVIDENCE_CONFLICT MUST block");
});

test("LB-D: PROVEN_OWNER on the only Level-B candidate lifts the manual-resolution blocker", async () => {
  const f = await plainLevelBFixture("lb-proven");
  const start = await startPrep(f.student.studentId, f.admin.token);
  assert.equal(start.status, 201);
  const rec = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(rec.status, 201, JSON.stringify(rec.json));

  const impact = await get(impactUrl(f.student.studentId), f.admin.token);
  const mr = impact.json.manualResolution;
  assert.equal(mr.requiredCount, 1);
  assert.equal(mr.resolvedOwnerCount, 1);
  assert.equal(mr.unresolvedCount, 0, JSON.stringify(mr));
  assert.ok(!ambiguousBlocker(impact), `blocker must lift: ${JSON.stringify(impact.json.blockers)}`);
  assert.equal(impact.json.blockers.length, 0, JSON.stringify(impact.json.blockers));
  assert.equal(impact.json.canDelete, true, "nothing else blocks, so canDelete follows");
});

test("LB-E: NOT_THIS_STUDENT on the only Level-B candidate lifts the blocker for THIS student", async () => {
  const f = await plainLevelBFixture("lb-notthis");
  const start = await startPrep(f.student.studentId, f.admin.token);
  assert.equal(start.status, 201);
  const rec = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "NOT_THIS_STUDENT",
  }, f.admin.token);
  assert.equal(rec.status, 201, JSON.stringify(rec.json));

  const impact = await get(impactUrl(f.student.studentId), f.admin.token);
  const mr = impact.json.manualResolution;
  assert.equal(mr.resolvedNotThisStudentCount, 1, JSON.stringify(mr));
  assert.equal(mr.unresolvedCount, 0, JSON.stringify(mr));
  assert.ok(!ambiguousBlocker(impact), JSON.stringify(impact.json.blockers));
  assert.equal(impact.json.canDelete, true);
});

test("LB-F: composition — an unrelated blocker still holds canDelete=false with a clean manual resolution", async () => {
  // Resolve the Level-B candidate first (deletion preparation, and therefore
  // resolution recording, requires a deactivated account), then reintroduce a
  // separate, unrelated blocker (ACCOUNT_MUST_BE_DEACTIVATED) directly in the
  // fixture data. It must survive independently of the now-clean manual
  // resolution state.
  const f = await plainLevelBFixture("lb-compose");
  const start = await startPrep(f.student.studentId, f.admin.token);
  assert.equal(start.status, 201);
  const rec = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(rec.status, 201, JSON.stringify(rec.json));

  const clean = await get(impactUrl(f.student.studentId), f.admin.token);
  assert.equal(clean.json.manualResolution.unresolvedCount, 0);
  assert.equal(clean.json.canDelete, true, "precondition: nothing blocks once Level-B is resolved");

  // Now introduce the unrelated blocker.
  await pool.query(`UPDATE students SET account_status = 'active' WHERE id = $1`, [f.student.studentId]);

  const impact = await get(impactUrl(f.student.studentId), f.admin.token);
  assert.equal(impact.json.manualResolution.unresolvedCount, 0, "manual resolution is clean");
  assert.ok(!ambiguousBlocker(impact), "no manual-resolution blocker remains");
  assert.ok(
    impact.json.blockers.some((b: any) => b.key === "ACCOUNT_MUST_BE_DEACTIVATED"),
    `the unrelated blocker must survive: ${JSON.stringify(impact.json.blockers)}`,
  );
  assert.equal(impact.json.canDelete, false, "composition with other blockers must not be broken");
});

test("LB-G: with two Level-B rows, resolving only one still blocks", async () => {
  const f = await plainLevelBFixture("lb-two");
  // A second, independent plain Level-B candidate for the same student.
  const secondOrder = await makePackageOrder(freshEmail("lb-two-orphan-2"));
  await makeCreditTxn(secondOrder, f.student.studentId);
  await makeAttendance(secondOrder, f.student.studentId, "CB Test lb-two", f.student.email);

  const start = await startPrep(f.student.studentId, f.admin.token);
  assert.equal(start.status, 201);

  const both = await get(impactUrl(f.student.studentId), f.admin.token);
  assert.equal(both.json.manualResolution.requiredCount, 2, JSON.stringify(both.json.manualResolution));
  assert.equal(both.json.manualResolution.unresolvedCount, 2);
  assert.equal(both.json.canDelete, false);

  const rec = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: f.orderId, decision: "PROVEN_OWNER",
  }, f.admin.token);
  assert.equal(rec.status, 201, JSON.stringify(rec.json));

  const partial = await get(impactUrl(f.student.studentId), f.admin.token);
  const mr = partial.json.manualResolution;
  assert.equal(mr.resolvedOwnerCount, 1, JSON.stringify(mr));
  assert.equal(mr.unresolvedCount, 1, "one candidate is still outstanding");
  const blocker = ambiguousBlocker(partial);
  assert.ok(blocker, JSON.stringify(partial.json.blockers));
  assert.equal(blocker.count, 1, "the blocker count tracks only what is still unresolved");
  assert.equal(partial.json.canDelete, false, "a partially resolved set MUST still block");

  // LB-H: resolving the remainder lifts the blocker entirely.
  const rec2 = await post(resolveUrl(f.student.studentId), {
    workflowId: start.json.id, domain: "package_orders", targetRecordId: secondOrder, decision: "NOT_THIS_STUDENT",
  }, f.admin.token);
  assert.equal(rec2.status, 201, JSON.stringify(rec2.json));

  const done = await get(impactUrl(f.student.studentId), f.admin.token);
  const mr2 = done.json.manualResolution;
  assert.equal(mr2.requiredCount, 2, JSON.stringify(mr2));
  assert.equal(mr2.unresolvedCount, 0, JSON.stringify(mr2));
  assert.equal(mr2.resolvedOwnerCount, 1);
  assert.equal(mr2.resolvedNotThisStudentCount, 1);
  assert.ok(!ambiguousBlocker(done), JSON.stringify(done.json.blockers));
  assert.equal(done.json.canDelete, true, "all Level-B rows resolved and nothing else blocks");
});
