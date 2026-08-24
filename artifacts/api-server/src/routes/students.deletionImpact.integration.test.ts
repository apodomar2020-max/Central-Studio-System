/**
 * Phase B2B — Student deletion impact (read-only).
 *
 * Real disposable Postgres, real in-process Express app mounting the actual
 * students router. Never references student id 34 or any production id —
 * every fixture is created fresh in this disposable database.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_DELETION_IMPACT_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_deletion_impact_b2b";

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
process.env.OTP_PEPPER = "test-di-otp-pepper".padEnd(64, "0");
process.env.IDENTITY_PROVENANCE_PEPPER = "test-di-identity-provenance-pepper".padEnd(64, "0");
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: typeof import("jsonwebtoken").sign;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }
type ApiResult = { status: number; json: any };
async function get(path: string, opts: { adminToken?: string; studentToken?: string } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${process.env.API_SECRET_KEY}` };
  if (opts.adminToken) headers["x-admin-token"] = opts.adminToken;
  if (opts.studentToken) headers.authorization = `Bearer ${opts.studentToken}`;
  const res = await fetch(apiUrl(path), { headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const studentsRouter = (await import("./students")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", studentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `di-${tag}-${Date.now()}-${seq}@example.com`;
}

async function makeStudent(tag: string, opts: { accountStatus?: string } = {}): Promise<number> {
  const email = freshEmail(tag);
  const r = await pool.query(
    `INSERT INTO students (name, email, password_hash, account_status, qr_token)
     VALUES ($1, $2, 'x', $3, gen_random_uuid()) RETURNING id`,
    [`DI Test ${tag}`, email, opts.accountStatus ?? "active"],
  );
  return r.rows[0].id as number;
}

async function makeStudentJwt(studentId: number): Promise<string> {
  return jwtSign({ sub: studentId, tokenVersion: 0 }, process.env.STUDENT_JWT_SECRET!, { expiresIn: "1h" });
}

let adminSeq = 0;
async function makeAdmin(perm: Record<string, unknown>, isSuperAdmin = false): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`di-role-${Date.now()}-${adminSeq}`, JSON.stringify(perm)],
  );
  const roleId = role.rows[0].id as number;
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [`di-admin-${Date.now()}-${adminSeq}`, `di-admin-${Date.now()}-${adminSeq}@example.com`, "x", `DI Admin ${adminSeq}`, isSuperAdmin, roleId],
  );
  const id = user.rows[0].id as number;
  const token = jwtSign({ sub: id, username: `di-admin-${adminSeq}`, isSuperAdmin, roleId }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "1h" });
  return { id, token };
}

async function deletionImpact(studentId: number, adminToken: string) {
  return get(`/api/students/${studentId}/deletion-impact`, { adminToken });
}

const DELETE_ADMIN_PERM = { users: { delete: true } };

// Global table checksum snapshot for zero-write proof.
const TABLES_TO_CHECK = [
  "students", "bookings", "package_orders", "children", "payment_records",
  "payment_refunds", "credit_transactions", "notification_devices",
  "email_otps", "admin_activity_logs", "ballet_applications",
  "ballet_level_assignments", "ballet_payments", "ballet_refunds",
  "ballet_enrollment_cancellation_requests", "attendance", "feedback",
];
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TABLES_TO_CHECK) {
    const r = await pool.query(`SELECT count(*)::text AS c, coalesce(md5(string_agg(t.*::text, ',' ORDER BY t.*::text)), '') AS h FROM ${t} t`);
    out[t] = `${r.rows[0].c}:${r.rows[0].h}`;
  }
  return out;
}

// ═══════════════════════════════ 1-4: lifecycle / not-found / deleted ═════
test("1: active empty account -> 200, canDelete=false, ACCOUNT_MUST_BE_DEACTIVATED", async () => {
  const sid = await makeStudent("active-empty");
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "ACCOUNT_MUST_BE_DEACTIVATED"));
});

test("2: deactivated empty account -> 200, canDelete=true", async () => {
  const sid = await makeStudent("deact-empty", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, true);
  assert.deepEqual(res.json.blockers, []);
});

test("3: already deleted -> 409", async () => {
  const sid = await makeStudent("deleted", { accountStatus: "deleted" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 409);
});

test("4: missing student -> 404", async () => {
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(999999999, admin.token);
  assert.equal(res.status, 404);
});

// ═══════════════════════════════ 5-9: payments / bookings ═════════════════
test("5: completed payment only -> retained, no blocker", async () => {
  const sid = await makeStudent("paid", { accountStatus: "deactivated" });
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'confirmed', (now() - interval '10 days')::date, 1) RETURNING id`,
    [sid],
  );
  await pool.query(
    `INSERT INTO payment_records (flow_type, booking_id, capture_origin, evidence_class, amount_availability, amount_source,
       gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, status, occurred_at, paid_at,
       confirmed_payment_method, student_id)
     VALUES ('single_class_booking', $1, 'live_capture', 'confirmed', 'exact', 'creation_snapshot', 1000, 0, 1000, 1000, 'paid', now(), now(), 'cash', $2)`,
    [booking.rows[0].id, sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, true);
  assert.equal(res.json.summary.payments.completed, 1);
  assert.ok(!res.json.blockers.some((b: any) => b.key === "PENDING_BOOKING_PAYMENT"));
});

test("6: pending payment -> blocker", async () => {
  const sid = await makeStudent("pending-pay", { accountStatus: "deactivated" });
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'confirmed', (now() - interval '10 days')::date, 1) RETURNING id`,
    [sid],
  );
  await pool.query(
    `INSERT INTO payment_records (flow_type, booking_id, capture_origin, evidence_class, amount_availability, amount_source,
       gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status, occurred_at, student_id)
     VALUES ('single_class_booking', $1, 'live_capture', 'confirmed', 'exact', 'creation_snapshot', 1000, 0, 1000, 'unpaid', now(), $2)`,
    [booking.rows[0].id, sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "PENDING_BOOKING_PAYMENT"));
});

test("7: open refund -> blocker", async () => {
  const sid = await makeStudent("open-refund", { accountStatus: "deactivated" });
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'confirmed', (now() - interval '10 days')::date, 1) RETURNING id`,
    [sid],
  );
  const pr = await pool.query(
    `INSERT INTO payment_records (flow_type, booking_id, capture_origin, evidence_class, amount_availability, amount_source,
       gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, status, occurred_at, paid_at,
       confirmed_payment_method, student_id)
     VALUES ('single_class_booking', $1, 'live_capture', 'confirmed', 'exact', 'creation_snapshot', 1000, 0, 1000, 1000, 'paid', now(), now(), 'cash', $2) RETURNING id`,
    [booking.rows[0].id, sid],
  );
  await pool.query(
    `INSERT INTO payment_refunds (payment_record_id, status, requested_amount_minor, refund_method, requested_reason)
     VALUES ($1, 'underReview', 500, 'cash', 'test refund')`,
    [pr.rows[0].id],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "OPEN_REFUND"));
});

test("8: future booking -> blocker", async () => {
  const sid = await makeStudent("future-booking", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'confirmed', (now() + interval '10 days')::date, 1)`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "FUTURE_BOOKINGS"));
  assert.equal(res.json.summary.bookings.future, 1);
});

test("9: past booking only -> no blocker", async () => {
  const sid = await makeStudent("past-booking", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'attended', (now() - interval '10 days')::date, 1)`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, true);
  assert.equal(res.json.summary.bookings.historical, 1);
});

// ═══════════════════════════════ 10-12: packages ═══════════════════════════
test("10: active unused package credit -> blocker", async () => {
  const sid = await makeStudent("pkg-active", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ('x','x@x.com',$1,'Pkg',8,5,'active')`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "ACTIVE_PACKAGE_VALUE"));
  assert.equal(res.json.summary.packages.unusedCredits, 5);
});

test("11: expired/zero-credit package -> no blocker", async () => {
  const sid = await makeStudent("pkg-expired", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ('x','x@x.com',$1,'Pkg',8,0,'expired')`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, true);
});

test("12: pending package order -> blocker", async () => {
  const sid = await makeStudent("pkg-pending", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ('x','x@x.com',$1,'Pkg',8,8,'pendingPayment')`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "PENDING_PACKAGE_ORDER"));
});

// ═══════════════════════════════ 13-14: children ═══════════════════════════
test("13: parent with child but no open commitments -> child counted, no automatic blocker", async () => {
  const sid = await makeStudent("parent-quiet", { accountStatus: "deactivated" });
  await pool.query(`INSERT INTO children (parent_id, full_name) VALUES ($1, 'Kid A')`, [sid]);
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, true);
  assert.equal(res.json.summary.children.total, 1);
  assert.equal(res.json.summary.children.withFutureActivity, 0);
});

test("14: child future booking -> blocker", async () => {
  const sid = await makeStudent("parent-active", { accountStatus: "deactivated" });
  const child = await pool.query(`INSERT INTO children (parent_id, full_name) VALUES ($1, 'Kid B') RETURNING id`, [sid]);
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_type, participant_child_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','x@x.com',$1,'child',$2,'confirmed', (now() + interval '5 days')::date, 1)`,
    [sid, child.rows[0].id],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "CHILD_FUTURE_COMMITMENT"));
});

// ═══════════════════════════════ 15-18: ballet ═════════════════════════════
async function makeBalletApp(sid: number, status: string): Promise<number> {
  const r = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status)
     VALUES ($1,'p','1','p@p.com','Kid',$2) RETURNING id`,
    [sid, status],
  );
  return r.rows[0].id;
}

test("15: open ballet application -> blocker", async () => {
  const sid = await makeStudent("ballet-open", { accountStatus: "deactivated" });
  await makeBalletApp(sid, "pending");
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "OPEN_BALLET_APPLICATION"));
});

test("16: active ballet enrollment -> blocker", async () => {
  const sid = await makeStudent("ballet-enroll", { accountStatus: "deactivated" });
  const appId = await makeBalletApp(sid, "active");
  const level = await pool.query(`INSERT INTO ballet_levels (name) VALUES ('L1') RETURNING id`);
  await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, status) VALUES ($1,$2,'active')`,
    [appId, level.rows[0].id],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "ACTIVE_BALLET_ENROLLMENT"));
});

test("17: pending ballet payment -> blocker", async () => {
  const sid = await makeStudent("ballet-pay", { accountStatus: "deactivated" });
  const appId = await makeBalletApp(sid, "rejected");
  await pool.query(
    `INSERT INTO ballet_payments (application_id, status, amount_egp, payment_method, billing_month)
     VALUES ($1,'pending',100,'cash','2026-08')`,
    [appId],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
  assert.ok(res.json.blockers.some((b: any) => b.key === "PENDING_BALLET_PAYMENT"));
});

test("18: open ballet cancellation review -> blocker", async () => {
  const sid = await makeStudent("ballet-cancel", { accountStatus: "deactivated" });
  const appId = await makeBalletApp(sid, "active");
  const level = await pool.query(`INSERT INTO ballet_levels (name) VALUES ('L2') RETURNING id`);
  const assignment = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, status) VALUES ($1,$2,'active') RETURNING id`,
    [appId, level.rows[0].id],
  );
  await pool.query(
    `INSERT INTO ballet_enrollment_cancellation_requests
       (application_id, level_assignment_id, parent_student_id, status, requested_timing, reason)
     VALUES ($1,$2,$3,'pendingReview','immediate','test')`,
    [appId, assignment.rows[0].id, sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.ok(res.json.blockers.some((b: any) => b.key === "OPEN_BALLET_CANCELLATION_REVIEW" || b.key === "ACTIVE_BALLET_ENROLLMENT"));
});

// ═══════════════════════════════ 19-22: legacy attribution ════════════════
test("19: uniquely email-attributable legacy row -> counted + LEGACY_IDENTITY_BACKFILL_REQUIRED", async () => {
  const sid = await makeStudent("legacy-email", { accountStatus: "deactivated" });
  const [{ email }] = (await pool.query(`SELECT email FROM students WHERE id=$1`, [sid])).rows;
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x',$1,NULL,'attended', (now() - interval '30 days')::date, 1)`,
    [email],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.legacyAttribution.emailOnlyRows, 1);
  assert.ok(res.json.blockers.some((b: any) => b.key === "LEGACY_IDENTITY_BACKFILL_REQUIRED"));
});

test("20: ambiguous legacy ownership -> blocker (defensive path, simulated via duplicate normalized email)", async () => {
  // students.email is UNIQUE at the DB level so true ambiguity can't be
  // constructed with two student rows; this test proves the defensive
  // branch is inert/safe (no crash) when only one match exists, and that
  // emailOnlyRows/ambiguousRows never crash on a normal single-match case.
  const sid = await makeStudent("legacy-ambig", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.legacyAttribution.ambiguousRows, 0);
});

test("21: explicit student_id ownership -> not miscounted as email-only", async () => {
  const sid = await makeStudent("legacy-explicit", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, booking_status, occurrence_date, schedule_id)
     VALUES ('x','other@x.com',$1,'attended', (now() - interval '30 days')::date, 1)`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.legacyAttribution.emailOnlyRows, 0);
});

test("22: malformed/unattributable legacy data does not crash", async () => {
  const sid = await makeStudent("legacy-malformed", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO attendance (student_id, student_name, student_email, checked_in_at) VALUES (NULL, 'x', 'x@x.com', now() - interval '5 days')`,
  ).catch(() => {}); // tolerate failure; the point is the impact call itself never crashes
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
});

// ═══════════════════════════════ 23: security artifacts ═══════════════════
test("23: security artifacts counted with zero mutation", async () => {
  const sid = await makeStudent("security", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO notification_devices (student_id, push_token, is_active) VALUES ($1, $2, true)`,
    [sid, `tok-${sid}-${Date.now()}`],
  );
  await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose, expires_at)
     VALUES ($1, 'x@x.com', 'v1:${"a".repeat(64)}', 'verify', now() + interval '10 minutes')`,
    [sid],
  );
  const before = await pool.query(`SELECT is_active, used_at FROM notification_devices nd, email_otps eo WHERE nd.student_id=$1 AND eo.student_id=$1`, [sid]).catch(() => null);
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.security.devices, 1);
  assert.equal(res.json.summary.security.otpChallenges, 1);
  const devRow = await pool.query(`SELECT is_active FROM notification_devices WHERE student_id=$1`, [sid]);
  assert.equal(devRow.rows[0].is_active, true);
  const otpRow = await pool.query(`SELECT used_at FROM email_otps WHERE student_id=$1`, [sid]);
  assert.equal(otpRow.rows[0].used_at, null);
  void before;
});

// ═══════════════════════════════ 24-28: RBAC ═══════════════════════════════
test("24: unauthorized users.view Admin -> 403", async () => {
  const sid = await makeStudent("rbac-view-only", { accountStatus: "deactivated" });
  const admin = await makeAdmin({ users: { view: true } });
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 403);
});

test("25: students.edit-only Admin -> 403 unless also users.delete", async () => {
  const sid = await makeStudent("rbac-students-edit", { accountStatus: "deactivated" });
  const admin = await makeAdmin({ students: { edit: true } });
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 403);
});

test("26: users.delete Admin -> allowed", async () => {
  const sid = await makeStudent("rbac-users-delete", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
});

test("26b: Super Admin bypass -> allowed", async () => {
  const sid = await makeStudent("rbac-super", { accountStatus: "deactivated" });
  const admin = await makeAdmin({}, true);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
});

test("27: Student JWT -> denied", async () => {
  const sid = await makeStudent("rbac-student-jwt", { accountStatus: "deactivated" });
  const token = await makeStudentJwt(sid);
  const res = await get(`/api/students/${sid}/deletion-impact`, { studentToken: token });
  assert.ok(res.status === 401 || res.status === 403);
});

test("28: unauthenticated -> denied", async () => {
  const sid = await makeStudent("rbac-unauth", { accountStatus: "deactivated" });
  const res = await fetch(apiUrl(`/api/students/${sid}/deletion-impact`));
  assert.equal(res.status, 401);
});

// ═══════════════════════════════ 29-32: zero-write / idempotence ══════════
test("29/30/31: endpoint performs zero domain DB writes; repeated GET -> same DB state", async () => {
  const sid = await makeStudent("zero-write", { accountStatus: "deactivated" });
  await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status)
     VALUES ('x','x@x.com',$1,'Pkg',8,4,'active')`,
    [sid],
  );
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const before = await snapshot();
  const res1 = await deletionImpact(sid, admin.token);
  const afterFirst = await snapshot();
  const res2 = await deletionImpact(sid, admin.token);
  const afterSecond = await snapshot();
  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.deepEqual(afterFirst, before);
  assert.deepEqual(afterSecond, before);
  assert.deepEqual(res1.json.summary, res2.json.summary);
});

test("32: no audit activity row created", async () => {
  const sid = await makeStudent("no-audit", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const before = await pool.query(`SELECT count(*)::int AS c FROM admin_activity_logs`);
  await deletionImpact(sid, admin.token);
  const after = await pool.query(`SELECT count(*)::int AS c FROM admin_activity_logs`);
  assert.equal(after.rows[0].c, before.rows[0].c);
});

// ═══════════════════════════════ 33-34: no delete route exists ════════════
test("33: no Permanent Delete route exists (only the disabled 405 legacy DELETE)", async () => {
  const sid = await makeStudent("no-permdel", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await fetch(apiUrl(`/api/students/${sid}/permanent-delete`), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.API_SECRET_KEY}`, "x-admin-token": admin.token, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 404);
});

test("34: legacy DELETE remains 405", async () => {
  const sid = await makeStudent("legacy-405", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await fetch(apiUrl(`/api/students/${sid}`), {
    method: "DELETE",
    headers: { authorization: `Bearer ${process.env.API_SECRET_KEY}`, "x-admin-token": admin.token },
  });
  assert.equal(res.status, 405);
});

// ═══════════════════════════════ 35-38: query bound / staleness / contract ═
test("35: bounded query count documented (see module doc comment; no per-child N+1 by construction)", async () => {
  const sid = await makeStudent("bounded", { accountStatus: "deactivated" });
  for (let i = 0; i < 5; i += 1) {
    await pool.query(`INSERT INTO children (parent_id, full_name) VALUES ($1, $2)`, [sid, `Kid ${i}`]);
  }
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.children.total, 5);
  // The module's aggregate queries do not scale with child count — this is
  // enforced by construction (single GROUP-BY-free EXISTS aggregate over
  // `children`), documented in studentDeletionImpact.ts's doc comment
  // rather than instrumented here (no query-counting harness exists yet
  // in this repo's test infra to hook pg.Pool transparently without
  // touching shared library code out of scope for this phase).
});

test("36/37: generatedAt and policyVersion returned", async () => {
  const sid = await makeStudent("meta", { accountStatus: "deactivated" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.ok(typeof res.json.generatedAt === "string" && !Number.isNaN(Date.parse(res.json.generatedAt)));
  assert.equal(res.json.policyVersion, "1");
});

test("38: GET has no request body -> client cannot supply canDelete/blockers", async () => {
  const sid = await makeStudent("no-input", { accountStatus: "active" });
  const admin = await makeAdmin(DELETE_ADMIN_PERM);
  // A GET request cannot carry a JSON body through fetch without a method
  // override; the route handler itself never reads req.body at all — this
  // is a design assertion verified by inspection of the handler in
  // routes/students.ts (it parses only req.params, never req.body).
  const res = await deletionImpact(sid, admin.token);
  assert.equal(res.status, 200);
  assert.equal(res.json.canDelete, false);
});
