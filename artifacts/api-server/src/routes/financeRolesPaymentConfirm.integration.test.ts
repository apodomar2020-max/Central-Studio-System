/**
 * Finance Roles & Permissions integration — real-route coverage proving
 * finance.paymentsConfirm is required to activate (= confirm payment for) a
 * package order, IN ADDITION to the existing packageOrders.approve
 * permission, and that a denied request produces zero writes.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_HOTFIX_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_hotfix";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

let approveOnlyAdminId: number;
let approveAndConfirmAdminId: number;
let packageDefinitionId: number;
let studentId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(adminId: number): string {
  return jwtSign({ sub: adminId, username: `finance-pay-confirm-${adminId}`, isSuperAdmin: false, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, adminId: number, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(adminId),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function createPendingOrder(): Promise<number> {
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Finance Roles Test Pkg', 8, 8, 'pendingPayment') RETURNING id`,
    ["Finance Roles Test Student", `finance-roles-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, studentId, packageDefinitionId],
  );
  return order.rows[0].id as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const packageOrdersRouter = (await import("./packageOrders")).default;
  const bookingsRouter = (await import("./bookings")).default;
  const attendanceRouter = (await import("./attendance")).default;
  const balletPaymentsRouter = (await import("./adminBalletPayments")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", packageOrdersRouter);
  app.use("/api", bookingsRouter);
  app.use("/api", attendanceRouter);
  app.use("/api", balletPaymentsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Finance Roles Student ${run}`, `finance-roles-student-${run}@example.com`],
  );
  studentId = student.rows[0].id as number;

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 1000, 8, 6, true) RETURNING id`,
    [`Finance Roles Pkg ${run}`],
  );
  packageDefinitionId = pkg.rows[0].id as number;

  // approveOnly — the exact pre-existing permission shape, no finance.* at all.
  const approveOnlyRole = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Finance Roles Pay Approve-Only ${run}`, JSON.stringify({
      packageOrders: { view: true, approve: true },
      bookings: { view: true, edit: true },
      attendance: { view: true, checkIn: true },
      qr: { scan: true, checkIn: true, packageDeduct: true },
      "ballet.payments": { view: true, edit: true },
    })],
  );
  approveOnlyAdminId = (await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', 'Approve Only', false, $3) RETURNING id`,
    [`finance-roles-pay-approve-${run}`, `finance-roles-pay-approve-${run}@example.com`, approveOnlyRole.rows[0].id],
  )).rows[0].id as number;

  const approveAndConfirmRole = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Finance Roles Pay Approve+Confirm ${run}`, JSON.stringify({ packageOrders: { view: true, approve: true }, finance: { paymentsConfirm: true } })],
  );
  approveAndConfirmAdminId = (await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', 'Approve And Confirm', false, $3) RETURNING id`,
    [`finance-roles-pay-both-${run}`, `finance-roles-pay-both-${run}@example.com`, approveAndConfirmRole.rows[0].id],
  )).rows[0].id as number;
});

async function writeSnapshot(): Promise<Record<string, number>> {
  const tables = [
    "package_orders", "bookings", "attendance", "credit_transactions",
    "payment_records", "payment_events", "notifications", "ballet_payments",
  ];
  const entries = await Promise.all(tables.map(async (table) => {
    const result = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    return [table, result.rows[0].n as number] as const;
  }));
  return Object.fromEntries(entries);
}

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("packageOrders.approve alone is NOT enough to confirm payment (activate) — 403, zero writes", async () => {
  const orderId = await createPendingOrder();
  const before = await pool.query(`SELECT status, remaining_credits, activated_at FROM package_orders WHERE id = $1`, [orderId]);
  const ledgerBefore = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`, [orderId]);

  const res = await asAdmin(`/api/package-orders/${orderId}`, approveOnlyAdminId, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", confirmedPaymentMethod: "cash" }),
  });
  assert.equal(res.status, 403);

  const after = await pool.query(`SELECT status, remaining_credits, activated_at FROM package_orders WHERE id = $1`, [orderId]);
  assert.deepEqual(after.rows[0], before.rows[0], "denied activation must produce zero writes to the order row");
  const ledgerAfter = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`, [orderId]);
  assert.equal(ledgerAfter.rows[0].n, ledgerBefore.rows[0].n, "denied activation must create zero credit ledger rows");
});

test("packageOrders.approve + finance.paymentsConfirm together succeed in confirming payment", async () => {
  const orderId = await createPendingOrder();
  const res = await asAdmin(`/api/package-orders/${orderId}`, approveAndConfirmAdminId, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", confirmedPaymentMethod: "cash" }),
  });
  assert.equal(res.status, 200);
  const after = await pool.query(`SELECT status FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(after.rows[0].status, "active");
});

test("non-payment edits (e.g. notes) still only require packageOrders.approve, unaffected by the new gate", async () => {
  const orderId = await createPendingOrder();
  const res = await asAdmin(`/api/package-orders/${orderId}`, approveOnlyAdminId, {
    method: "PATCH",
    body: JSON.stringify({ notes: "unrelated edit" }),
  });
  assert.equal(res.status, 200, "the new finance.paymentsConfirm gate must not fire for non-payment edits");
});

test("booking Pay-at-Studio confirmation without finance.paymentsConfirm returns 403 and writes nothing", async () => {
  const before = await writeSnapshot();
  const res = await asAdmin("/api/bookings/2147483647", approveOnlyAdminId, {
    method: "PATCH",
    body: JSON.stringify({ paymentStatus: "paid", confirmedPaymentMethod: "cash" }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await writeSnapshot(), before);
});

test("Studio Walk-in Pay-at-Studio confirmation without finance.paymentsConfirm returns 403 and writes nothing", async () => {
  const before = await writeSnapshot();
  const res = await asAdmin("/api/attendance", approveOnlyAdminId, {
    method: "POST",
    body: JSON.stringify({
      studentEmail: "denied-walkin@example.invalid",
      studentName: "Denied Walk-in",
      classId: 2147483647,
      scheduleId: 2147483647,
      paid: true,
      settlementMode: "pay_at_studio",
    }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await writeSnapshot(), before);
});

test("Ballet assessment payment confirmation without finance.paymentsConfirm returns 403 and writes nothing", async () => {
  const before = await writeSnapshot();
  const res = await asAdmin("/api/admin/ballet/payments/2147483647/status", approveOnlyAdminId, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", paymentMethod: "inPerson" }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await writeSnapshot(), before);
});

test("Ballet subscription payment confirmation without finance.paymentsConfirm returns 403 and writes nothing", async () => {
  const before = await writeSnapshot();
  const res = await asAdmin("/api/admin/ballet/applications/2147483647/payments/2147483647/status", approveOnlyAdminId, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", paymentMethod: "inPerson" }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await writeSnapshot(), before);
});
