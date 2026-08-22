/**
 * Finance Roles & Permissions integration — real-route coverage proving:
 *  - refund reads require finance.view, including from the Ballet page.
 *  - refund mutation requires finance.refundsManage IN ADDITION to the
 *    existing ballet.payments.edit permission, and a denied attempt
 *    produces zero writes.
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

let viewOnlyFinanceAdminId: number;
let noReadAdminId: number;
let editOnlyAdminId: number;
let editPlusRefundsManageAdminId: number;
let superAdminId: number;
let applicationId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function tokenFor(adminId: number, isSuperAdmin = false): string {
  return jwtSign({ sub: adminId, username: `finance-roles-refund-${adminId}`, isSuperAdmin, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, adminId: number, init: RequestInit = {}, isSuperAdmin = false): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": tokenFor(adminId, isSuperAdmin),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function createUnderReviewRefund(): Promise<number> {
  const payment = await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method, paid_at) VALUES ($1, 1000, 'paid', 'inPerson', now()) RETURNING id`,
    [applicationId],
  );
  const refund = await pool.query(
    `INSERT INTO ballet_refunds (application_id, payment_id, status, refund_method, requested_reason, requested_amount_egp) VALUES ($1, $2, 'underReview', 'cash', 'Test reason', 1000) RETURNING id`,
    [applicationId, payment.rows[0].id],
  );
  return refund.rows[0].id as number;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const refundsRouter = (await import("./balletCancellationRefunds")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", refundsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const application = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status)
     VALUES (NULL, 'Finance Roles Parent', '0100000000', $1, $2, 'accepted') RETURNING id`,
    [`finance-roles-refund-parent-${run}@example.com`, `Finance Roles Child ${run}`],
  );
  applicationId = application.rows[0].id as number;

  async function makeAdmin(label: string, permissions: Record<string, unknown>): Promise<number> {
    const role = await pool.query(
      `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
      [`Finance Roles Refund ${label} ${run}`, JSON.stringify(permissions)],
    );
    const user = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', $3, false, $4) RETURNING id`,
      [`finance-roles-refund-${label}-${run}`, `finance-roles-refund-${label}-${run}@example.com`, `Finance Roles Refund ${label}`, role.rows[0].id],
    );
    return user.rows[0].id as number;
  }

  viewOnlyFinanceAdminId = await makeAdmin("finance-view", { finance: { view: true } });
  noReadAdminId = await makeAdmin("no-read", { dashboard: { view: true } });
  editOnlyAdminId = await makeAdmin("edit-only", { "ballet.payments": { view: true, edit: true } });
  editPlusRefundsManageAdminId = await makeAdmin("edit-plus-refunds", { "ballet.payments": { view: true, edit: true }, finance: { refundsManage: true } });
  superAdminId = await makeAdmin("super", {});
  await pool.query(`UPDATE system_users SET is_super_admin = true WHERE id = $1`, [superAdminId]);
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("finance.view alone can read the refunds list", async () => {
  const res = await asAdmin("/api/admin/ballet/refunds", viewOnlyFinanceAdminId);
  assert.equal(res.status, 200);
});

test("neither permission present returns 403 on the refunds list", async () => {
  const res = await asAdmin("/api/admin/ballet/refunds", noReadAdminId);
  assert.equal(res.status, 403);
});

test("Super Admin can read refunds without explicit finance grants", async () => {
  const res = await asAdmin("/api/admin/ballet/refunds", superAdminId, {}, true);
  assert.equal(res.status, 200);
});

// ─── Mutation: finance.refundsManage required in addition to ballet.payments.edit ──

test("ballet.payments.edit alone is NOT enough to approve a refund — 403, zero writes", async () => {
  const refundId = await createUnderReviewRefund();
  const before = await pool.query(`SELECT status, approved_amount_egp FROM ballet_refunds WHERE id = $1`, [refundId]);

  const res = await asAdmin(`/api/admin/ballet/refunds/${refundId}/approve`, editOnlyAdminId, {
    method: "POST",
    body: JSON.stringify({ approvedAmountEgp: 1000, refundMethod: "cash" }),
  });
  assert.equal(res.status, 403);

  const after = await pool.query(`SELECT status, approved_amount_egp FROM ballet_refunds WHERE id = $1`, [refundId]);
  assert.deepEqual(after.rows[0], before.rows[0], "a view-only/edit-only admin must produce zero writes when attempting a refund mutation");
});

test("a view-only Finance admin also cannot approve a refund — 403, zero writes", async () => {
  const refundId = await createUnderReviewRefund();
  const before = await pool.query(`SELECT status FROM ballet_refunds WHERE id = $1`, [refundId]);
  const res = await asAdmin(`/api/admin/ballet/refunds/${refundId}/approve`, viewOnlyFinanceAdminId, {
    method: "POST",
    body: JSON.stringify({ approvedAmountEgp: 1000, refundMethod: "cash" }),
  });
  assert.equal(res.status, 403);
  const after = await pool.query(`SELECT status FROM ballet_refunds WHERE id = $1`, [refundId]);
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("ballet.payments.edit + finance.refundsManage together can approve a refund", async () => {
  const refundId = await createUnderReviewRefund();
  const res = await asAdmin(`/api/admin/ballet/refunds/${refundId}/approve`, editPlusRefundsManageAdminId, {
    method: "POST",
    body: JSON.stringify({ approvedAmountEgp: 1000, refundMethod: "cash" }),
  });
  assert.equal(res.status, 200);
  const after = await pool.query(`SELECT status FROM ballet_refunds WHERE id = $1`, [refundId]);
  assert.equal(after.rows[0].status, "approved");
});

test("Super Admin can mutate refunds without explicit grants", async () => {
  const refundId = await createUnderReviewRefund();
  const res = await asAdmin(`/api/admin/ballet/refunds/${refundId}/approve`, superAdminId, {
    method: "POST",
    body: JSON.stringify({ approvedAmountEgp: 1000, refundMethod: "cash" }),
  }, true);
  assert.equal(res.status, 200);
});
