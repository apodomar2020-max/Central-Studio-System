/**
 * Student Account Deletion — Phase B0 regression coverage.
 *
 * DELETE /students/:id used to perform a raw, untransacted hard delete with
 * zero audit logging that could either violate FK/CHECK constraints
 * (promotion_redemptions RESTRICT, bookings/payment_records
 * participant_shape CHECK after children ON DELETE CASCADE -> SET NULL) or,
 * for a dependency-free student, silently succeed without anonymizing PII
 * and without leaving any audit trail.
 *
 * This suite proves the route is now permanently disabled (405,
 * STUDENT_ACCOUNT_DELETION_DISABLED) for every authorized caller including
 * Super Admin, that the normal auth/permission gates in front of it are
 * unchanged (401 unauthenticated, 403 insufficient permission), and that no
 * row anywhere in the DB is mutated by hitting this route — including
 * financial rows, which must be byte-identical before and after.
 *
 * Harness mirrors auth.security04b.integration.test.ts / packageOrders
 * creationCapture suite: real in-process Express app over the actual
 * students + adminAuth routers, against a disposable local Postgres DB.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDENT_DELETION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_student_deletion";

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
process.env.ADMIN_JWT_SECRET = "test-admin-secret-student-deletion";
delete process.env.REDIS_URL;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const runSlug = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function makeRole(label: string, permissions: Record<string, unknown>): Promise<number> {
  const role = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Student Deletion ${label} ${run}`, JSON.stringify(permissions)],
  );
  return role.rows[0].id as number;
}

async function makeAdmin(label: string, opts: { roleId?: number | null; isSuperAdmin?: boolean } = {}): Promise<number> {
  const user = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, is_active, role_id)
     VALUES ($1, $2, 'x', $3, $4, true, $5) RETURNING id`,
    [
      `sd-${label}-${runSlug}`,
      `sd-${label}-${runSlug}@example.com`,
      `Student Deletion ${label}`,
      opts.isSuperAdmin ?? false,
      opts.roleId ?? null,
    ],
  );
  return user.rows[0].id as number;
}

function adminToken(adminId: number, isSuperAdmin = false): string {
  return jwtSign({ sub: adminId, username: `sd-${adminId}`, isSuperAdmin, roleId: null }, process.env.ADMIN_JWT_SECRET!);
}

async function asAdmin(path: string, token: string | undefined, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers["x-admin-token"] = token;
  return fetch(apiUrl(path), { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
}

async function makeStudent(label: string, accountType: "student" | "parent" = "student"): Promise<number> {
  const email = `sd-${runSlug}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified)
     VALUES ($1, $2, '0100000000', $3, '2000-01-01', true) RETURNING id`,
    [`Student Deletion ${label}`, email, accountType],
  );
  return result.rows[0].id as number;
}

async function makeChild(parentId: number, label: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth, gender) VALUES ($1, $2, '2015-01-01', 'female') RETURNING id`,
    [parentId, `Child ${label}`],
  );
  return result.rows[0].id as number;
}

async function makePromotionRedemption(studentId: number, label: string): Promise<number> {
  const promo = await pool.query(
    `INSERT INTO promotions (name, type, discount_type, discount_value, is_active, rules_config)
     VALUES ($1, 'automatic', 'percentage', 10, true, '{}') RETURNING id`,
    [`SD Promo ${label} ${run}`],
  );
  const redemption = await pool.query(
    `INSERT INTO promotion_redemptions (promotion_id, student_id, discount_amount, original_subtotal, final_subtotal)
     VALUES ($1, $2, 10, 100, 90) RETURNING id`,
    [promo.rows[0].id as number, studentId],
  );
  return redemption.rows[0].id as number;
}

async function makeChildBooking(parentId: number, childId: number, label: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_type, participant_child_id, status, booking_status, payment_status)
     VALUES ($1, $2, $3, 'child', $4, 'confirmed', 'confirmed', 'not_required') RETURNING id`,
    [`Booking ${label}`, `sd-${runSlug}-${label}-booking@example.com`, parentId, childId],
  );
  return result.rows[0].id as number;
}

async function makePaidBookingWithPaymentRecord(studentId: number, label: string): Promise<{ bookingId: number; paymentRecordId: number }> {
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, participant_type, status, booking_status, payment_status)
     VALUES ($1, $2, $3, 'self', 'confirmed', 'confirmed', 'paid') RETURNING id`,
    [`Paid Booking ${label}`, `sd-${runSlug}-${label}-paid@example.com`, studentId],
  );
  const bookingId = booking.rows[0].id as number;
  const record = await pool.query(
    `INSERT INTO payment_records (
       flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
       gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, refunded_amount_minor,
       currency, confirmed_payment_method, status, paid_at, student_id, participant_type
     ) VALUES (
       'single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot',
       10000, 0, 10000, 10000, 0,
       'EGP', 'cash', 'paid', now(), $2, 'self'
     ) RETURNING id`,
    [bookingId, studentId],
  );
  return { bookingId, paymentRecordId: record.rows[0].id as number };
}

async function makeEmailOtp(studentId: number, label: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO email_otps (student_id, email, code, purpose) VALUES ($1, $2, 'v1:${"a".repeat(64)}', 'verify') RETURNING id`,
    [studentId, `sd-${runSlug}-${label}-otp@example.com`],
  );
  return result.rows[0].id as number;
}

type Counts = Record<string, number>;

const DEPENDENT_TABLES = [
  "bookings",
  "payment_records",
  "package_orders",
  "credit_transactions",
  "email_otps",
  "children",
  "promotion_redemptions",
  "students",
  "admin_activity_logs",
] as const;

async function snapshotCounts(): Promise<Counts> {
  const counts: Counts = {};
  for (const table of DEPENDENT_TABLES) {
    const result = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = result.rows[0].n as number;
  }
  return counts;
}

async function rowExists(table: string, id: number): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return result.rows.length > 0;
}

async function paymentRecordRow(id: number): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT * FROM payment_records WHERE id = $1`, [id]);
  return result.rows[0];
}

let superAdminId: number;
let superAdminToken: string;
let noDeletePermAdminId: number;
let noDeletePermToken: string;
let usersDeleteAdminId: number;
let usersDeleteToken: string;

before(async () => {
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const studentsRouter = (await import("./students")).default;
  const adminAuthRouter = (await import("./adminAuth")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", adminAuthRouter);
  app.use("/api", studentsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  superAdminId = await makeAdmin("super", { isSuperAdmin: true });
  superAdminToken = adminToken(superAdminId, true);

  const emptyRoleId = await makeRole("no-perm", {});
  noDeletePermAdminId = await makeAdmin("no-perm", { roleId: emptyRoleId });
  noDeletePermToken = adminToken(noDeletePermAdminId, false);

  const usersDeleteRoleId = await makeRole("users-delete", { users: { delete: true } });
  usersDeleteAdminId = await makeAdmin("users-delete", { roleId: usersDeleteRoleId });
  usersDeleteToken = adminToken(usersDeleteAdminId, false);
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── 1/2/3: basic disable behavior ──────────────────────────────────────────

test("Super Admin hitting DELETE /students/:id receives 405 STUDENT_ACCOUNT_DELETION_DISABLED, row untouched", async () => {
  const studentId = await makeStudent("zero-deps");
  const before = await snapshotCounts();

  const res = await asAdmin(`/api/students/${studentId}`, superAdminToken, { method: "DELETE" });
  assert.equal(res.status, 405);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
  assert.equal(typeof body.error, "string");

  assert.equal(await rowExists("students", studentId), true, "student row must still exist (case 2 & 3: zero-dependents student that used to succeed)");
  const after = await snapshotCounts();
  assert.deepEqual(after, before, "no dependent row counts changed");
});

// ─── 4: promotion_redemptions RESTRICT case never reaches the DB delete ────

test("a student with a promotion_redemptions row gets 405, not the old FK RESTRICT 500", async () => {
  const studentId = await makeStudent("promo-redeem");
  await makePromotionRedemption(studentId, "promo-redeem");
  const before = await snapshotCounts();

  const res = await asAdmin(`/api/students/${studentId}`, superAdminToken, { method: "DELETE" });
  assert.equal(res.status, 405);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");

  assert.equal(await rowExists("students", studentId), true);
  const after = await snapshotCounts();
  assert.deepEqual(after, before);
});

// ─── 5: parent with child-scoped activity never reaches the constraint violation ──

test("a parent with an active child-scoped booking gets 405, not the old participant_shape constraint violation", async () => {
  const parentId = await makeStudent("parent-child-activity", "parent");
  const childId = await makeChild(parentId, "parent-child-activity");
  const bookingId = await makeChildBooking(parentId, childId, "parent-child-activity");
  const before = await snapshotCounts();

  const res = await asAdmin(`/api/students/${parentId}`, superAdminToken, { method: "DELETE" });
  assert.equal(res.status, 405);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");

  assert.equal(await rowExists("students", parentId), true);
  assert.equal(await rowExists("children", childId), true);
  assert.equal(await rowExists("bookings", bookingId), true);
  const after = await snapshotCounts();
  assert.deepEqual(after, before);
});

// ─── 6/7: financial rows byte-identical before/after ───────────────────────

test("a paid booking + payment_record are byte-identical before and after hitting DELETE", async () => {
  const studentId = await makeStudent("financial-identity");
  const { bookingId, paymentRecordId } = await makePaidBookingWithPaymentRecord(studentId, "financial-identity");
  const recordBefore = await paymentRecordRow(paymentRecordId);
  const bookingBeforeResult = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const bookingBefore = bookingBeforeResult.rows[0];
  const before = await snapshotCounts();

  const res = await asAdmin(`/api/students/${studentId}`, superAdminToken, { method: "DELETE" });
  assert.equal(res.status, 405);

  const recordAfter = await paymentRecordRow(paymentRecordId);
  const bookingAfterResult = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const bookingAfter = bookingAfterResult.rows[0];
  assert.deepEqual(recordAfter, recordBefore, "payment_records row must be byte-identical");
  assert.deepEqual(bookingAfter, bookingBefore, "bookings row must be byte-identical");
  const after = await snapshotCounts();
  assert.deepEqual(after, before);
});

// ─── 8: no audit event claims a deletion occurred ──────────────────────────

test("no admin_activity_logs row claims a student deletion occurred", async () => {
  const studentId = await makeStudent("audit-check");
  const before = await pool.query(`SELECT count(*)::int AS n FROM admin_activity_logs`);

  const res = await asAdmin(`/api/students/${studentId}`, superAdminToken, { method: "DELETE" });
  assert.equal(res.status, 405);

  const after = await pool.query(`SELECT count(*)::int AS n FROM admin_activity_logs`);
  assert.equal(after.rows[0].n, before.rows[0].n, "no new admin_activity_logs rows from hitting the disabled route");

  const claimingDelete = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs WHERE action = 'delete' AND entity_type IN ('student', 'parent')`,
  );
  assert.equal(claimingDelete.rows[0].n, 0, "no audit row ever claims a student/parent delete succeeded");
});

// ─── 9: unauthenticated caller still gets the normal 401, not the 405 body ─

test("unauthenticated caller gets 401 from requireAdminAuth, not the 405 body", async () => {
  const studentId = await makeStudent("unauth-check");
  const res = await asAdmin(`/api/students/${studentId}`, undefined, { method: "DELETE" });
  assert.equal(res.status, 401);
  const body = await res.json() as Record<string, unknown>;
  assert.notEqual(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
  assert.equal(await rowExists("students", studentId), true);
});

// ─── 10: insufficient-permission caller gets 403 from requireAdminPermission ─

test("admin without users.delete gets 403 from requireAdminPermission, not the 405 body", async () => {
  const studentId = await makeStudent("no-perm-check");
  const res = await asAdmin(`/api/students/${studentId}`, noDeletePermToken, { method: "DELETE" });
  assert.equal(res.status, 403);
  const body = await res.json() as Record<string, unknown>;
  assert.notEqual(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
  assert.equal(await rowExists("students", studentId), true);
});

test("admin with explicit users.delete permission still gets 405, never the old 204", async () => {
  const studentId = await makeStudent("users-delete-perm-check");
  const res = await asAdmin(`/api/students/${studentId}`, usersDeleteToken, { method: "DELETE" });
  assert.equal(res.status, 405);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.code, "STUDENT_ACCOUNT_DELETION_DISABLED");
  assert.equal(await rowExists("students", studentId), true);
});
