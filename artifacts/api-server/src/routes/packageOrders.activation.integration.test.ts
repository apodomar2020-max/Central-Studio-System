/**
 * Real-route integration coverage for the Pre-Phase-2 Payment Integrity
 * Hotfix's package-activation guard.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values. Boots
 * the actual Express router and real admin auth middleware over HTTP; never
 * calls route-internal helpers directly, matching the established convention
 * in adminBalletMultipleSchedules.integration.test.ts.
 *
 * What this proves, end to end, over real HTTP against a real Postgres row
 * lock — not merely at the unit level:
 *   - First activation succeeds and issues exactly one package_activated
 *     credit_transactions row.
 *   - A repeated PATCH {status:"active"} on an already-active order is
 *     rejected (409 PACKAGE_ORDER_NOT_ACTIVATABLE), not silently re-applied.
 *   - Two concurrent activation requests against the SAME order produce
 *     exactly one successful activation and exactly one credit row — the
 *     FOR UPDATE lock, not application timing, decides the winner.
 *   - An order that already has a package_activated row (independent of its
 *     current `status` column) can never receive a second one.
 *   - Every non-pendingPayment source status (fullyUsed, expired, cancelled)
 *     is rejected.
 *   - The notification/audit-log side effects fire at most once per order.
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
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
// Typed via @workspace/db's own export rather than `import("pg").Pool`:
// api-server has no direct pg/@types/pg dependency of its own (only
// @workspace/db does), so referencing the package directly here is
// unresolvable under this file's tsconfig. `pool`'s already-correct type
// flows through @workspace/db's own export instead — zero new dependency.
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let packageId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `pkg-activate-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function activate(id: number): Promise<Response> {
  // Finance Phase 2C: confirmedPaymentMethod is now required for this
  // transition (this file predates that change) — every call through this
  // helper represents a genuine activation attempt, so it always supplies
  // one, matching the pre-existing tests' original intent unchanged.
  return asAdmin(`/api/package-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active", confirmedPaymentMethod: "cash" }) });
}

async function activationCreditCount(packageOrderId: number): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'package_activated'`,
    [packageOrderId],
  );
  return result.rows[0].n as number;
}

async function activationLots(packageOrderId: number): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT l.*, t.type AS issuing_transaction_type
     FROM package_credit_lots l
     JOIN credit_transactions t ON t.id = l.issuing_credit_transaction_id
     WHERE l.package_order_id = $1 AND t.type = 'package_activated'
     ORDER BY l.id`,
    [packageOrderId],
  );
  return result.rows as Array<Record<string, unknown>>;
}

/** Creates a fresh pendingPayment package order, ready to be activated. */
async function makePendingOrder(
  run: string,
  label: string,
  totalCredits = 8,
  purchaseUnitPriceMinor: number | null = null,
): Promise<{ id: number; studentEmail: string; studentId: number }> {
  const studentEmail = `pkg-activate-${run}-${label}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`Package Activate Test ${label}`, studentEmail],
  );
  const studentId = student.rows[0].id as number;
  const order = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, purchase_unit_price_minor, status)
     VALUES ($1, $2, $3, $4, 'Activation Test Package', $5, $5, $6, 'pendingPayment')
     RETURNING id`,
    [`Package Activate Test ${label}`, studentEmail, studentId, packageId, totalCredits, purchaseUnitPriceMinor],
  );
  return { id: order.rows[0].id as number, studentEmail, studentId };
}

async function orderStatus(id: number): Promise<string> {
  const result = await pool.query(`SELECT status FROM package_orders WHERE id = $1`, [id]);
  return result.rows[0].status as string;
}

async function activityLogCount(entityId: number, action: string): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM admin_activity_logs
     WHERE module = 'packageOrders' AND entity_type = 'package_order' AND entity_id = $1 AND action = $2`,
    [String(entityId), action],
  );
  return result.rows[0].n as number;
}

// createStudentNotification resolves a studentId to a `notifications.target`
// of the form "student:<id>" (notifications.ts:41) — there is no per-student
// email/id column on the notifications table itself.
async function notificationCount(studentId: number, relatedEntityId: number, type: string): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM notifications
     WHERE target = $1 AND type = $2 AND related_entity_type = 'package_order' AND related_entity_id = $3 AND is_draft = false`,
    [`student:${studentId}`, type, relatedEntityId],
  );
  return result.rows[0].n as number;
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
  await new Promise<void>((resolve) => {
    // A bare arrow wrapper, not `resolve` itself: Express's listen callback
    // signature is `(error?: Error) => void`, which is not assignable to
    // the Promise executor's `resolve: (value?: void) => void` — passing
    // resolve directly is a real parameter-type mismatch, not suppressible
    // noise. Wrapping makes the call site's actual signature explicit.
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Package Activate Super', true) RETURNING id`,
      [`pkg-activate-super-${run}`, `pkg-activate-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months) VALUES ($1, 'per_class', 1000, 8, 6) RETURNING id`,
    [`Activation Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  // createStudentNotification dispatches its push-delivery-log write via a
  // fire-and-forget setTimeout(0) (notifications.ts) — give it one tick to
  // land before closing the pool, or teardown races an in-flight query.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── 1–3: first activation, exact credit count, repeated activation ─────────

test("first activation succeeds, credits are issued, and status becomes active", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makePendingOrder(run, "first");

  const res = await activate(id);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.status, "active");
  assert.equal(await orderStatus(id), "active");
  assert.equal(await activationCreditCount(id), 1, "exactly one package_activated credit row must exist");
  const lots = await activationLots(id);
  assert.equal(lots.length, 1, "activation must issue exactly one purchased lot");
  assert.equal(lots[0].source_type, "purchased");
  assert.equal(lots[0].credits_issued, 8);
  assert.equal(lots[0].credits_remaining, 8);
  assert.equal(lots[0].issuing_transaction_type, "package_activated");
  assert.equal(lots[0].total_value_minor, null);
  assert.equal(lots[0].value_basis, "unknown");
});

test("activation values its purchased lot only from the order price snapshot", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makePendingOrder(run, "snapshot-value", 6, 12_345);
  await pool.query(`UPDATE price_packages SET price_egp = 999999 WHERE id = $1`, [packageId]);

  assert.equal((await activate(id)).status, 200);
  const [lot] = await activationLots(id);
  assert.equal(lot.total_value_minor, 74_070);
  assert.equal(lot.value_basis, "recorded_purchase_price");
});

test("activation propagates immutable self and child participant ownership to credits", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const self = await makePendingOrder(run, "participant-self");
  await pool.query(
    `UPDATE package_orders SET participant_type = 'self', participant_child_id = NULL WHERE id = $1`,
    [self.id],
  );
  assert.equal((await activate(self.id)).status, 200);

  const childOrder = await makePendingOrder(run, "participant-child");
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth, gender)
     VALUES ($1, 'Activation Child', '2015-01-01', 'female') RETURNING id`,
    [childOrder.studentId],
  );
  const childId = child.rows[0].id as number;
  await pool.query(
    `UPDATE package_orders SET participant_type = 'child', participant_child_id = $2 WHERE id = $1`,
    [childOrder.id, childId],
  );
  assert.equal((await activate(childOrder.id)).status, 200);

  const rows = await pool.query(
    `SELECT package_order_id, participant_type, participant_child_id
     FROM credit_transactions
     WHERE package_order_id IN ($1, $2) AND type = 'package_activated'
     ORDER BY package_order_id`,
    [self.id, childOrder.id],
  );
  assert.equal(rows.rowCount, 2);
  const selfCredit = rows.rows.find((row) => row.package_order_id === self.id);
  const childCredit = rows.rows.find((row) => row.package_order_id === childOrder.id);
  assert.deepEqual(
    [selfCredit.participant_type, selfCredit.participant_child_id],
    ["self", null],
  );
  assert.deepEqual(
    [childCredit.participant_type, childCredit.participant_child_id],
    ["child", childId],
  );
});

test("Phase C purchase configuration state constraint accepts only canonical nullable values", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const order = await makePendingOrder(run, "configuration-state");
  await pool.query(
    `UPDATE package_orders SET purchase_eligibility_configuration_state = 'configured' WHERE id = $1`,
    [order.id],
  );
  await assert.rejects(
    pool.query(
      `UPDATE package_orders SET purchase_eligibility_configuration_state = 'invented' WHERE id = $1`,
      [order.id],
    ),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code: string }).code === "23514"
    ),
  );
});

test("repeated activation of an already-active order is rejected and issues no second credit row", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makePendingOrder(run, "repeat");

  const first = await activate(id);
  assert.equal(first.status, 200);
  assert.equal(await activationCreditCount(id), 1);

  const second = await activate(id);
  assert.equal(second.status, 409);
  const body = await jsonBody(second);
  assert.equal(body.code, "PACKAGE_ORDER_NOT_ACTIVATABLE");
  assert.equal(await activationCreditCount(id), 1, "no second credit row may be created by the repeated attempt");
  assert.equal((await activationLots(id)).length, 1, "no second lot may be created by the repeated attempt");
  assert.equal(await orderStatus(id), "active", "the order must remain active, not be mutated by the rejected attempt");
});

// ─── 4: concurrency ───────────────────────────────────────────────────────

test("two concurrent activation requests on the same order produce exactly one success, one credit row, and one safe conflict", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makePendingOrder(run, "concurrent");

  const [a, b] = await Promise.all([activate(id), activate(id)]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409], "exactly one request must succeed and the other must safely conflict");

  const loser = a.status === 409 ? a : b;
  const loserBody = await jsonBody(loser);
  assert.equal(loserBody.code, "PACKAGE_ORDER_NOT_ACTIVATABLE");

  assert.equal(await activationCreditCount(id), 1, "concurrent requests must never produce more than one credit row");
  assert.equal(await orderStatus(id), "active");
});

// ─── 5: historical activation-credit row without a matching current status ──

test("an order with a pre-existing package_activated credit row cannot be activated even if its status is pendingPayment", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makePendingOrder(run, "historical-credit");

  // Simulate a historical/legacy row where a package_activated credit exists
  // but the order's own status column was, for whatever reason, never moved
  // off pendingPayment — the credit-existence guard is independent
  // defense-in-depth beneath the status guard, per the hotfix design.
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'package_activated', 8, 0, 8, 'test-seed')`,
    [id],
  );
  assert.equal(await orderStatus(id), "pendingPayment");

  const res = await activate(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PACKAGE_ORDER_NOT_ACTIVATABLE");
  assert.equal(await activationCreditCount(id), 1, "still exactly the one seeded row — no second credit issued");
});

// ─── 6: invalid source statuses ──────────────────────────────────────────

for (const invalidStatus of ["fullyUsed", "expired", "cancelled", "active"]) {
  test(`an order in status "${invalidStatus}" cannot be activated`, async () => {
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { id } = await makePendingOrder(run, `invalid-${invalidStatus}`);
    await pool.query(`UPDATE package_orders SET status = $1 WHERE id = $2`, [invalidStatus, id]);

    const res = await activate(id);
    assert.equal(res.status, 409);
    assert.equal((await jsonBody(res)).code, "PACKAGE_ORDER_NOT_ACTIVATABLE");
    assert.equal(await activationCreditCount(id), 0);
    assert.equal(await orderStatus(id), invalidStatus, "the rejected attempt must not mutate status");
  });
}

// ─── 7: notification and audit side effects fire at most once ───────────────

test("notification and activity-log side effects occur no more than once across repeated attempts", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, studentId } = await makePendingOrder(run, "side-effects");

  const first = await activate(id);
  assert.equal(first.status, 200);
  const second = await activate(id);
  assert.equal(second.status, 409);

  assert.equal(await notificationCount(studentId, id, "package_activated"), 1, "exactly one activation notification");
  assert.equal(await activityLogCount(id, "activate"), 1, "exactly one 'activate' activity-log entry");
});

test("a 404 is returned for a nonexistent package order, not a 500", async () => {
  const res = await activate(999_999_999);
  assert.equal(res.status, 404);
});
