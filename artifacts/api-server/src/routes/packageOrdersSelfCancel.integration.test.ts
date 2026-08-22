/**
 * Wave 3.1 (Gap 3) — real-route integration coverage for the pendingPayment
 * self-service package cancellation route, over real HTTP against a real
 * Postgres row lock, matching the established convention in this file's
 * siblings (packageOrders.activation.integration.test.ts).
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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let packageId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(label: string): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `pkg-selfcancel-${Date.now()}-${studentCounter}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ($1, $2, '0100000000', 'student', '2000-01-01', true) RETURNING id`,
    [`Package Self-Cancel Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `pkg-selfcancel-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key", "x-admin-token": adminToken(), ...(init.headers as Record<string, string> | undefined) },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function makePendingOrder(student: { id: number; email: string }): Promise<number> {
  const res = await asStudent(studentToken(student.id, student.email), "/api/package-orders", {
    method: "POST",
    body: JSON.stringify({ packageId, participantType: "self" }),
  });
  const body = await jsonBody(res);
  assert.equal(res.status, 201, `expected order creation to succeed: ${JSON.stringify(body)}`);
  return body.id as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const packageOrdersRouter = (await import("./packageOrders")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", packageOrdersRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Package Self-Cancel Super', true) RETURNING id`,
      [`pkg-selfcancel-super-${run}`, `pkg-selfcancel-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 500, 8, 6, true) RETURNING id`,
    [`Package Self-Cancel Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("a pendingPayment order can be self-cancelled by its owner", async () => {
  const student = await makeStudent("happy");
  const orderId = await makePendingOrder(student);

  const res = await asStudent(studentToken(student.id, student.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.status, "cancelled");
});

test("cancelling an already-cancelled order is idempotent", async () => {
  const student = await makeStudent("dup");
  const orderId = await makePendingOrder(student);
  const first = await asStudent(studentToken(student.id, student.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });
  assert.equal(first.status, 200);
  const second = await asStudent(studentToken(student.id, student.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });
  assert.equal(second.status, 200);
});

test("an active (already-activated, paid) order cannot be self-cancelled — must use the Admin refund workflow", async () => {
  const student = await makeStudent("active");
  const orderId = await makePendingOrder(student);
  const activateRes = await asAdmin(`/api/package-orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", confirmedPaymentMethod: "cash" }),
  });
  assert.equal(activateRes.status, 200, `expected activation to succeed: ${JSON.stringify(await jsonBody(activateRes))}`);

  const res = await asStudent(studentToken(student.id, student.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "not_cancellable");

  const row = await pool.query(`SELECT status FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(row.rows[0].status, "active", "an active order must remain untouched by a rejected self-cancel attempt");
});

test("another student cannot cancel someone else's pending order (404, never leaked)", async () => {
  const owner = await makeStudent("owner");
  const attacker = await makeStudent("attacker");
  const orderId = await makePendingOrder(owner);

  const res = await asStudent(studentToken(attacker.id, attacker.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 404);

  const row = await pool.query(`SELECT status FROM package_orders WHERE id = $1`, [orderId]);
  assert.equal(row.rows[0].status, "pendingPayment", "the order must remain untouched by another student's attempt");
});

test("no refund is fabricated by the pendingPayment self-cancel path — nothing was ever collected", async () => {
  const student = await makeStudent("norefund");
  const orderId = await makePendingOrder(student);
  await asStudent(studentToken(student.id, student.email), `/api/package-orders/${orderId}/cancel`, { method: "PATCH" });

  const refunds = await pool.query(
    `SELECT count(*)::int AS n FROM payment_refunds pr JOIN payment_records rec ON rec.id = pr.payment_record_id WHERE rec.package_order_id = $1`,
    [orderId],
  );
  assert.equal(refunds.rows[0].n, 0);
});
