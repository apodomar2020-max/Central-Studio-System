/**
 * Real route + database integration tests for Phase 2 terminal-state backend
 * hardening on the Ballet payment-lifecycle endpoints.
 *
 * Confirms:
 *   PATCH /admin/ballet/payments/:id/status              (Confirm Payment)
 *   PATCH /admin/ballet/applications/:applicationId/subscription/expiry (Adjust Expiry)
 * both reject when the parent application is in a terminal status
 * (rejected/cancelled/withdrawn), including the "stale client" scenario
 * where the application became terminal after the request was formed, and
 * that existing non-terminal behavior + audit semantics are unchanged.
 *
 * Boots the ACTUAL Express router (routes/adminBalletPayments.ts) behind the
 * ACTUAL auth middleware, issues real HTTP requests, and asserts on real row
 * state in a disposable local Postgres database — same convention as
 * balletCancellationRouteIntegration.test.ts / bookingOccurrenceIntegrity.route.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.BALLET_OVERVIEW_TEST_DATABASE_URL
  ?? "postgres://localhost:5432/central_studio_disposable_ballet_overview";

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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
// Typed via @workspace/db's own exported `pool` rather than importing `pg`'s
// types directly in this file — @workspace/db already depends on `pg` and
// resolves cleanly under this project's moduleResolution:"bundler" config;
// a bare `import("pg").Pool` type query does not (no local `pg` dependency
// here), which is exactly what caused this file's TS2307.
let pool: (typeof import("@workspace/db"))["pool"];
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

let fullAccessAdminId: number;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

function adminToken(adminId: number, username: string): string {
  return jwtSign({ sub: adminId, username, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(fullAccessAdminId, `route-test-full-${RUN}`),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const applicationIds: number[] = [];
const paymentIds: number[] = [];

async function createApplication(status: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_applications (parent_name, parent_phone, parent_email, child_name, status)
     VALUES ('Overview Test Parent', '0100000000', $1, 'Overview Test Child', $2) RETURNING id`,
    [`overview-test-${RUN}-${applicationIds.length}@example.invalid`, status],
  );
  const id = rows[0].id;
  applicationIds.push(id);
  return id;
}

async function createPendingPayment(applicationId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method)
     VALUES ($1, 2500, 'pending', 'inPerson') RETURNING id`,
    [applicationId],
  );
  const id = rows[0].id;
  paymentIds.push(id);
  return id;
}

/** A paid payment whose subscription window currently contains today — the
 * only shape PATCH .../subscription/expiry will consider "adjustable". */
async function createAdjustableActivePayment(applicationId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
     VALUES ($1, 2500, 'paid', 'inPerson', now(), (current_date - interval '5 days')::date, (current_date + interval '25 days')::date) RETURNING id`,
    [applicationId],
  );
  const id = rows[0].id;
  paymentIds.push(id);
  return id;
}

async function paymentRow(paymentId: number): Promise<{ status: string; subscriptionExpiresAt: string | null }> {
  const { rows } = await pool.query(
    `SELECT status, subscription_expires_at::text AS "subscriptionExpiresAt" FROM ballet_payments WHERE id = $1`,
    [paymentId],
  );
  return rows[0];
}

async function activityLogCount(action: string, entityId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs WHERE action = $1 AND entity_id = $2`,
    [action, entityId],
  );
  return rows[0].n;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  // No ".ts" suffix — this project's moduleResolution:"bundler" rejects an
  // explicit ".ts" extension on a relative specifier (TS5097) unless
  // allowImportingTsExtensions is set, which it isn't project-wide. tsx
  // resolves the extensionless specifier to the .ts file at runtime exactly
  // like every non-test source file in this codebase already does.
  const { requireAuth } = await import("../middlewares/auth");
  const adminBalletPaymentsRouter = (await import("./adminBalletPayments")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(adminBalletPaymentsRouter);
  await new Promise<void>((resolvePromise) => {
    // Wrapped in an explicit no-arg arrow (not `resolvePromise` passed
    // directly) so the callback's inferred type is unambiguously `() =>
    // void`, matching the 3-arg listen(port, hostname, callback) overload
    // cleanly — passing the Promise executor's resolve function directly
    // left TS unable to pick an overload (TS2769), even though the runtime
    // behavior here is identical either way.
    server = app.listen(0, "127.0.0.1", () => resolvePromise());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    fullAccessAdminId = existingSuper.rows[0].id;
  } else {
    const su = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Route Test Super', true) RETURNING id`,
      [`route-test-full-${RUN}`, `route-test-full-${RUN}@example.com`],
    );
    fullAccessAdminId = su.rows[0].id;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (paymentIds.length > 0) await pool.query(`DELETE FROM ballet_payments WHERE id = ANY($1::int[])`, [paymentIds]);
  if (applicationIds.length > 0) {
    await pool.query(
      `DELETE FROM admin_activity_logs WHERE entity_type = 'ballet_payment' AND entity_id = ANY($1::text[])`,
      [(paymentIds.length > 0 ? paymentIds : [-1]).map(String)],
    );
    await pool.query(`DELETE FROM ballet_applications WHERE id = ANY($1::int[])`, [applicationIds]);
  }
  await pool.end();
});

// ─── Confirm Payment (PATCH /admin/ballet/payments/:id/status) ─────────────

test("Confirm Payment: succeeds for a non-terminal application (existing behavior preserved)", async () => {
  const applicationId = await createApplication("accepted");
  const paymentId = await createPendingPayment(applicationId);
  const res = await asAdmin(`/admin/ballet/payments/${paymentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate: "2030-01-01", expiresAt: "2030-01-31" }),
  });
  assert.equal(res.status, 200);
  const row = await paymentRow(paymentId);
  assert.equal(row.status, "paid");
  assert.equal(await activityLogCount("markPaid", paymentId), 1, "exactly one markPaid audit entry for a successful confirmation");
});

for (const terminalStatus of ["rejected", "cancelled", "withdrawn"]) {
  test(`Confirm Payment: rejected for a "${terminalStatus}" application, and the payment row is not mutated`, async () => {
    const applicationId = await createApplication(terminalStatus);
    const paymentId = await createPendingPayment(applicationId);
    const res = await asAdmin(`/admin/ballet/payments/${paymentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paid", startDate: "2030-01-01", expiresAt: "2030-01-31" }),
    });
    assert.equal(res.status, 422);
    const body = await res.json() as { code?: string };
    assert.equal(body.code, "BALLET_APPLICATION_TERMINAL");
    const row = await paymentRow(paymentId);
    assert.equal(row.status, "pending", "payment must remain untouched when the parent application is terminal");
    assert.equal(await activityLogCount("markPaid", paymentId), 0, "no audit entry must be written for a rejected mutation");
  });
}

test("Confirm Payment: stale client — application becomes terminal after the pending payment already existed", async () => {
  const applicationId = await createApplication("assignedToLevel");
  const paymentId = await createPendingPayment(applicationId);
  // Simulate a concurrent actor cancelling the application after the first
  // admin's Confirm Payment dialog was already open with this payment loaded.
  await pool.query(`UPDATE ballet_applications SET status = 'cancelled' WHERE id = $1`, [applicationId]);

  const res = await asAdmin(`/admin/ballet/payments/${paymentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate: "2030-01-01", expiresAt: "2030-01-31" }),
  });
  assert.equal(res.status, 422);
  const body = await res.json() as { code?: string };
  assert.equal(body.code, "BALLET_APPLICATION_TERMINAL");
  const row = await paymentRow(paymentId);
  assert.equal(row.status, "pending");
});

// ─── Adjust Expiry (PATCH /admin/ballet/applications/:applicationId/subscription/expiry) ─

test("Adjust Expiry: succeeds for a non-terminal application with a currently-active paid cycle (existing behavior preserved)", async () => {
  const applicationId = await createApplication("active");
  const paymentId = await createAdjustableActivePayment(applicationId);
  const before = await paymentRow(paymentId);

  const res = await asAdmin(`/admin/ballet/applications/${applicationId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 10, reason: "studioHoliday", note: "test" }),
  });
  assert.equal(res.status, 200);
  const after = await paymentRow(paymentId);
  assert.notEqual(after.subscriptionExpiresAt, before.subscriptionExpiresAt);
  assert.equal(await activityLogCount("adjustExpiry", paymentId), 1, "exactly one adjustExpiry audit entry for a successful adjustment");
});

for (const terminalStatus of ["rejected", "cancelled", "withdrawn"]) {
  test(`Adjust Expiry: rejected for a "${terminalStatus}" application, and the payment row is not mutated`, async () => {
    const applicationId = await createApplication(terminalStatus);
    const paymentId = await createAdjustableActivePayment(applicationId);
    const before = await paymentRow(paymentId);

    const res = await asAdmin(`/admin/ballet/applications/${applicationId}/subscription/expiry`, {
      method: "PATCH",
      body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 10, reason: "studioHoliday", note: "test" }),
    });
    assert.equal(res.status, 422);
    const body = await res.json() as { code?: string };
    assert.equal(body.code, "BALLET_APPLICATION_TERMINAL");
    const after = await paymentRow(paymentId);
    assert.equal(after.subscriptionExpiresAt, before.subscriptionExpiresAt, "expiry must remain untouched when the parent application is terminal");
    assert.equal(await activityLogCount("adjustExpiry", paymentId), 0);
  });
}
