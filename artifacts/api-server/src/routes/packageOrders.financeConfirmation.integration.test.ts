/**
 * Finance Phase 2C — real-route integration coverage for
 * `confirmCanonicalPaymentRecord` as wired into PATCH /package-orders/:id's
 * activation transaction (see artifacts/api-server/src/lib/financeConfirmation.ts
 * and the activation handler in ./packageOrders.ts).
 *
 * Companion to packageOrders.activation.integration.test.ts (which covers the
 * pre-existing Payment Integrity Hotfix guard) — this file covers ONLY the
 * new Finance confirmation/fulfillment behavior layered on top of it:
 * payment_records transitioning to "paid", the "confirmed" and
 * "activation_credits_issued" payment_events rows, the legacy_missing
 * compatibility path, post-commit push timing, and DB-failure atomicity.
 *
 * Same boot/auth/safety-gate conventions as the activation test file: real
 * Express router + real admin auth middleware over HTTP, disposable-DB guard,
 * DISPOSABLE_HOTFIX_DATABASE_URL / central_studio_disposable_hotfix.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

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

type PushCall = { notificationId: number; visibleAtCallTime: boolean };
const pushCalls: PushCall[] = [];
let forceNextPushRejection = false;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let secondAdminId: number;
let packageId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(adminId = superAdminId): string {
  return jwtSign({ sub: adminId, username: `pkg-finance-super-${adminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function asAdmin(path: string, init: RequestInit = {}, adminId?: number): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(adminId),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function asStudentJwt(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  // No x-api-key here: requireAuth's extractToken checks x-api-key BEFORE
  // Authorization, so sending both would make it authenticate as the shared
  // API key (not a student JWT) and req.studentJwtVerified would never be set.
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function activate(id: number, body: Record<string, unknown> = {}, adminId?: number): Promise<Response> {
  return asAdmin(`/api/package-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active", ...body }) }, adminId);
}

async function activationCreditCount(packageOrderId: number): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'package_activated'`,
    [packageOrderId],
  );
  return result.rows[0].n as number;
}

async function creditTransactionIdFor(packageOrderId: number): Promise<number | null> {
  const result = await pool.query(
    `SELECT id FROM credit_transactions WHERE package_order_id = $1 AND type = 'package_activated' LIMIT 1`,
    [packageOrderId],
  );
  return result.rows[0]?.id ?? null;
}

async function orderStatus(id: number): Promise<string> {
  const result = await pool.query(`SELECT status FROM package_orders WHERE id = $1`, [id]);
  return result.rows[0].status as string;
}

async function paymentRecordFor(packageOrderId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT * FROM payment_records WHERE flow_type = 'package_purchase' AND package_order_id = $1`,
    [packageOrderId],
  );
  return result.rows[0];
}

async function paymentRecordCount(packageOrderId: number): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'package_purchase' AND package_order_id = $1`,
    [packageOrderId],
  );
  return result.rows[0].n as number;
}

async function paymentEventCount(paymentRecordId: number, eventType: string): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events WHERE payment_record_id = $1 AND event_type = $2`,
    [paymentRecordId, eventType],
  );
  return result.rows[0].n as number;
}

async function notificationCount(studentId: number, relatedEntityId: number, type: string): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM notifications
     WHERE target = $1 AND type = $2 AND related_entity_type = 'package_order' AND related_entity_id = $3 AND is_draft = false`,
    [`student:${studentId}`, type, relatedEntityId],
  );
  return result.rows[0].n as number;
}

/** Creates a fresh pendingPayment package order via the REAL POST route (so a
 * genuine pending_confirmation payment_records row exists), returning the
 * order id, the payment_records id, and the finalPayableAmountMinor. */
async function makeCanonicalPendingOrder(run: string, label: string): Promise<{ id: number; studentId: number; studentEmail: string; paymentRecordId: number; finalPayableAmountMinor: number }> {
  const email = `pkg-finance-${run}-${label}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ($1, $2, '0100000000', 'student', '2000-01-01', true) RETURNING id`,
    [`Package Finance Test ${label}`, email],
  );
  const studentId = student.rows[0].id as number;
  const token = studentToken(studentId, email);
  const res = await asStudentJwt("/api/package-orders", token, {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
  const order = await jsonBody(res);
  assert.equal(res.status, 201, `setup: package order creation must succeed (got ${res.status}: ${JSON.stringify(order)})`);
  const record = await paymentRecordFor(order.id as number);
  assert.ok(record, "setup: a canonical payment_records row must exist after POST /package-orders");
  return {
    id: order.id as number,
    studentId,
    studentEmail: email,
    paymentRecordId: record!.id as number,
    finalPayableAmountMinor: record!.final_payable_amount_minor as number,
  };
}

/** Simulates a legacy/pre-Phase-2B package order: inserted directly via SQL,
 * bypassing POST /package-orders, so NO payment_records row exists for it. */
async function makeLegacyPendingOrder(run: string, label: string, totalCredits = 8): Promise<{ id: number; studentId: number; studentEmail: string }> {
  const studentEmail = `pkg-finance-legacy-${run}-${label}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`Package Finance Legacy Test ${label}`, studentEmail],
  );
  const studentId = student.rows[0].id as number;
  const order = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Legacy Test Package', $5, $5, 'pendingPayment')
     RETURNING id`,
    [`Package Finance Legacy Test ${label}`, studentEmail, studentId, packageId, totalCredits],
  );
  return { id: order.rows[0].id as number, studentId, studentEmail };
}

async function attachFailTrigger(table: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_inject_failure_pkgfin_${table}() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected test failure on %', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER test_inject_failure_pkgfin_${table}_trigger
    BEFORE UPDATE OR INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION test_inject_failure_pkgfin_${table}();
  `);
}

async function detachFailTrigger(table: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS test_inject_failure_pkgfin_${table}_trigger ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS test_inject_failure_pkgfin_${table}()`);
}

async function waitForPushCalls(expected: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pushCalls.length >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

before(async () => {
  // Registered before packageOrders.ts (and therefore before its own
  // `import { sendPushNotification } from "../lib/pushNotifications"`) is
  // ever imported, so the router receives the mocked binding — same pattern
  // as packageOrders.notificationPostCommit.integration.test.ts.
  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async (input: { notificationId?: number | null }) => {
        if (forceNextPushRejection) {
          forceNextPushRejection = false;
          throw new Error("injected test push failure");
        }
        const observerClient = await pool.connect();
        try {
          const result = await observerClient.query(`SELECT 1 FROM notifications WHERE id = $1`, [input.notificationId]);
          pushCalls.push({ notificationId: input.notificationId!, visibleAtCallTime: (result.rowCount ?? 0) > 0 });
        } finally {
          observerClient.release();
        }
        return { sent: 0, failed: 0, skipped: true, reason: "push_disabled" };
      },
      sendBroadcastPushNotification: async () => ({ sent: 0, failed: 0 }),
    },
  });

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
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const superAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Package Finance Super', true) RETURNING id`,
    [`pkg-finance-super-${run}`, `pkg-finance-super-${run}@example.com`],
  );
  superAdminId = superAdmin.rows[0].id as number;
  const secondAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Package Finance Second Admin', true) RETURNING id`,
    [`pkg-finance-second-${run}`, `pkg-finance-second-${run}@example.com`],
  );
  secondAdminId = secondAdmin.rows[0].id as number;

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 1000, 8, 6, true) RETURNING id`,
    [`Finance Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  mock.reset();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── A1-A9: canonical confirmation happy path ────────────────────────────

test("A1-A4: canonical pending payment confirms successfully, transitions to paid with the correct amount, and sets paidAt once", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId, finalPayableAmountMinor } = await makeCanonicalPendingOrder(run, "a1");

  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, JSON.stringify(await jsonBody(res)));

  const record = await paymentRecordFor(id);
  assert.equal(record!.status, "paid");
  assert.equal(record!.paid_amount_minor, finalPayableAmountMinor);
  assert.equal(record!.final_payable_amount_minor, finalPayableAmountMinor);
  assert.ok(record!.paid_at, "paidAt must be set");
  const paidAtFirst = record!.paid_at;

  // Re-check (idempotent query, not a second confirmation attempt) — paidAt is stable.
  const recordAgain = await paymentRecordFor(id);
  assert.equal(new Date(recordAgain!.paid_at as string).getTime(), new Date(paidAtFirst as string).getTime(), "paidAt must remain stable across a legitimate re-check");
  assert.equal(record!.id, paymentRecordId);
});

test("A5: confirmed method is stored exactly as submitted (cash and kashier)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cash = await makeCanonicalPendingOrder(run, "method-cash");
  const kashier = await makeCanonicalPendingOrder(run, "method-kashier");

  await activate(cash.id, { confirmedPaymentMethod: "cash" });
  await activate(kashier.id, { confirmedPaymentMethod: "kashier" });

  assert.equal((await paymentRecordFor(cash.id))!.confirmed_payment_method, "cash");
  assert.equal((await paymentRecordFor(kashier.id))!.confirmed_payment_method, "kashier");
});

test("A25: confirmedPaymentMethod 'unknown' is accepted as an explicit choice and stored exactly as 'unknown'", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingOrder(run, "a25");

  const res = await activate(id, { confirmedPaymentMethod: "unknown" });
  assert.equal(res.status, 200);
  assert.equal((await paymentRecordFor(id))!.confirmed_payment_method, "unknown");
});

test("A6, A22: confirmingAdminId is server-derived from the authenticated admin, never from a forged request body value", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingOrder(run, "a6");

  const forgedPaidAt = "2000-01-01T00:00:00.000Z";
  const res = await activate(id, {
    confirmedPaymentMethod: "cash",
    confirmingAdminId: 999_999_999,
    paidAt: forgedPaidAt,
    paidAmountMinor: 1,
  }, secondAdminId);
  assert.equal(res.status, 200);

  const record = await paymentRecordFor(id);
  assert.equal(record!.confirming_admin_id, secondAdminId, "confirmingAdminId must equal the AUTHENTICATED admin, not any forged body value");
  assert.notEqual(record!.confirming_admin_id, 999_999_999);
  assert.notEqual(record!.paid_at, forgedPaidAt, "the client-supplied paidAt must be ignored");
});

test("A7, A8, A9: exactly one confirmed event, one activation_credits_issued event linked to the real credit row, and one credit transaction", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a7");

  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200);

  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
  assert.equal(await paymentEventCount(paymentRecordId, "activation_credits_issued"), 1);
  assert.equal(await activationCreditCount(id), 1);

  const creditTransactionId = await creditTransactionIdFor(id);
  const linked = await pool.query(
    `SELECT credit_transaction_id FROM payment_events WHERE payment_record_id = $1 AND event_type = 'activation_credits_issued'`,
    [paymentRecordId],
  );
  assert.equal(linked.rows[0].credit_transaction_id, creditTransactionId, "activation_credits_issued must link to the ACTUAL credit_transactions row inserted by this activation");
});

test("A10: notification is inserted exactly once", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, studentId } = await makeCanonicalPendingOrder(run, "a10");

  await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(await notificationCount(studentId, id, "package_activated"), 1);
});

// ─── A11-A12: post-commit push timing ────────────────────────────────────

test("A11: push occurs only after the activation transaction commits", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingOrder(run, "a11");

  const before = pushCalls.length;
  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200);
  await waitForPushCalls(before + 1);

  assert.equal(pushCalls.length, before + 1, "exactly one push dispatch for this activation");
  assert.equal(pushCalls[pushCalls.length - 1].visibleAtCallTime, true, "the row must already be visible over an independent connection — proof of post-commit dispatch");
});

test("A12: a push failure does not roll back the confirmation", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a12");

  forceNextPushRejection = true;
  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, "the route must still return success even though the post-commit push rejects");

  const record = await paymentRecordFor(id);
  assert.equal(record!.status, "paid", "payment_records must still be committed");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
  assert.equal(await paymentEventCount(paymentRecordId, "activation_credits_issued"), 1);
  assert.equal(await activationCreditCount(id), 1);
});

// ─── A13: repeat against already-active order (pre-existing 409 still holds) ─

test("A13: repeated activation against an already-active order returns the existing 409 with zero additional Finance writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a13");

  const first = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(first.status, 200);

  const second = await activate(id, { confirmedPaymentMethod: "kashier" });
  assert.equal(second.status, 409);
  assert.equal((await jsonBody(second)).code, "PACKAGE_ORDER_NOT_ACTIVATABLE");

  assert.equal((await paymentRecordFor(id))!.confirmed_payment_method, "cash", "the second attempt's method must NOT have overwritten the first");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
  assert.equal(await paymentEventCount(paymentRecordId, "activation_credits_issued"), 1);
  assert.equal(await activationCreditCount(id), 1);
});

// ─── A14: concurrency ─────────────────────────────────────────────────────

test("A14: concurrent duplicate activation requests produce exactly one activation, one paid transition, one confirmed event, one activation_credits_issued event, and one credit row", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a14");

  const [a, b] = await Promise.all([
    activate(id, { confirmedPaymentMethod: "cash" }),
    activate(id, { confirmedPaymentMethod: "kashier" }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);

  assert.equal((await paymentRecordFor(id))!.status, "paid");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
  assert.equal(await paymentEventCount(paymentRecordId, "activation_credits_issued"), 1);
  assert.equal(await activationCreditCount(id), 1);
});

// ─── A15-A16: DB-failure atomicity ────────────────────────────────────────

test("A15: a DB failure injected during credit_transactions insert rolls back the Finance transition too", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a15");

  await attachFailTrigger("credit_transactions");
  try {
    const res = await activate(id, { confirmedPaymentMethod: "cash" });
    assert.notEqual(res.status, 200, "activation must not succeed while credit_transactions insert is failing");
  } finally {
    await detachFailTrigger("credit_transactions");
  }

  assert.equal(await orderStatus(id), "pendingPayment", "package_orders must remain unmutated");
  assert.equal((await paymentRecordFor(id))!.status, "pending_confirmation", "payment_records must remain pending_confirmation — the whole transaction rolled back");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0, "no confirmed event may persist");
  assert.equal(await activationCreditCount(id), 0);
});

test("A16: a DB failure injected on the package_orders update (after payment_records has already transitioned in-tx) rolls back everything", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a16");

  await attachFailTrigger("package_orders");
  try {
    const res = await activate(id, { confirmedPaymentMethod: "cash" });
    assert.notEqual(res.status, 200, "activation must not succeed while package_orders update is failing");
  } finally {
    await detachFailTrigger("package_orders");
  }

  assert.equal(await orderStatus(id), "pendingPayment");
  assert.equal((await paymentRecordFor(id))!.status, "pending_confirmation", "the confirmCanonicalPaymentRecord UPDATE must have rolled back along with everything else in the same transaction");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0);
  assert.equal(await activationCreditCount(id), 0);
});

// ─── A17-A18: legacy_missing path ─────────────────────────────────────────

test("A17: a package order with no existing payment_records row still activates via the legacy_missing path", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeLegacyPendingOrder(run, "a17");
  assert.equal(await paymentRecordCount(id), 0, "setup: legacy order must have no payment_records row");

  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, JSON.stringify(await jsonBody(res)));
  assert.equal(res.headers.get("x-finance-compatibility"), "legacy_payment_record_missing");

  assert.equal(await orderStatus(id), "active");
  assert.equal(await activationCreditCount(id), 1, "credit issuance must proceed normally even without a Finance record");
  assert.equal(await paymentRecordCount(id), 0, "no payment_records row may be fabricated");
});

test("A18: the legacy_missing path creates no orphan payment_events row", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeLegacyPendingOrder(run, "a18");

  await activate(id, { confirmedPaymentMethod: "cash" });

  const orphanEvents = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe
     WHERE NOT EXISTS (SELECT 1 FROM payment_records pr WHERE pr.id = pe.payment_record_id AND pr.package_order_id = $1)
       AND pe.id IN (
         SELECT pe2.id FROM payment_events pe2
         JOIN credit_transactions ct ON ct.id = pe2.credit_transaction_id
         WHERE ct.package_order_id = $1
       )`,
    [id],
  );
  assert.equal(orphanEvents.rows[0].n, 0, "no payment_events row may exist without a corresponding payment_records row for this order");
});

// ─── A19-A20: multi-record / mismatched-record integrity — DB-constraint findings ──
//
// FINDING (verified against lib/db/src/schema/paymentRecords.ts): the table
// carries `unique("payment_records_flow_package_order_unique").on(flowType,
// packageOrderId)`. A second payment_records row with the SAME
// (flow_type='package_purchase', package_order_id) therefore cannot be
// inserted at all — Postgres rejects it with a unique-violation before
// confirmCanonicalPaymentRecord's SELECT could ever observe two rows. A19
// ("multiple_records") is DB-impossible to construct via a real insert; we
// prove the constraint itself here instead of forcing a fake runtime
// scenario.
//
// A20 ("wrong_flow_type" / "wrong_source_fk"): confirmCanonicalPaymentRecord's
// matchCondition already filters `flowType = params.flowType AND
// packageOrderId = params.packageOrderId` in the SQL WHERE clause itself
// (financeConfirmation.ts lines 66-70). Any row the query can possibly
// return therefore already satisfies both equalities by construction — the
// `wrong_flow_type`/`wrong_source_fk` branches in financeConfirmation.ts
// (lines 76-82) are unreachable given the current query, not merely hard to
// set up with today's schema constraints. This is a code-reading finding,
// not a DB-constraint finding, and is reported as dead code rather than
// tested at runtime, per the task's explicit instruction not to force a
// scenario that cannot occur.

test("A19: a second payment_records row for the same (flow_type, package_order_id) is rejected by the DB unique constraint", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingOrder(run, "a19");

  await assert.rejects(
    pool.query(
      `INSERT INTO payment_records
         (flow_type, package_order_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
          gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status)
       VALUES ('package_purchase', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 100000, 0, 100000, 'pending_confirmation')`,
      [id],
    ),
    /unique|duplicate key/i,
    "a second payment_records row for the same package_order_id must be rejected by payment_records_flow_package_order_unique",
  );
  assert.equal(await paymentRecordCount(id), 1, "still exactly the one original row");
});

// ─── A21: cancelled order cannot be activated (pre-existing guard) ───────────

test("A21: a cancelled package order cannot be activated, zero Finance writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a21");
  await pool.query(`UPDATE package_orders SET status = 'cancelled' WHERE id = $1`, [id]);

  const res = await activate(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PACKAGE_ORDER_NOT_ACTIVATABLE");

  assert.equal((await paymentRecordFor(id))!.status, "pending_confirmation", "the Finance record must remain untouched — the pre-existing status guard rejects the request before any Finance code runs");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0);
});

// ─── A23: no genuinely distinct DB-constraint scenario beyond A15/A16 ───────
// A23 skipped: every distinct failure-injection point reachable within the
// activation transaction (payment_records UPDATE, credit_transactions
// INSERT, package_orders UPDATE) is already covered by A15/A16 above (and
// the pre-existing atomicity suite covers the equivalent points for the
// CREATION transaction). No additional genuinely-distinct DB constraint
// violation scenario was found for this route.

// ─── A24: missing confirmedPaymentMethod on status:"active" ─────────────────

test("A24: sending status:'active' without confirmedPaymentMethod returns 400 CONFIRMED_PAYMENT_METHOD_REQUIRED with zero writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingOrder(run, "a24");

  const res = await activate(id, {});
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).code, "CONFIRMED_PAYMENT_METHOD_REQUIRED");

  assert.equal(await orderStatus(id), "pendingPayment");
  assert.equal((await paymentRecordFor(id))!.status, "pending_confirmation");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0);
  assert.equal(await activationCreditCount(id), 0);
});

test("A24b: an invalid confirmedPaymentMethod value also returns 400 CONFIRMED_PAYMENT_METHOD_REQUIRED", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingOrder(run, "a24b");

  const res = await activate(id, { confirmedPaymentMethod: "bitcoin" });
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).code, "CONFIRMED_PAYMENT_METHOD_REQUIRED");
  assert.equal(await orderStatus(id), "pendingPayment");
});
