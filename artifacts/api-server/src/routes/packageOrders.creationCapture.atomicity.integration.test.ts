/**
 * Finance Phase 2B-1 release correction: proves the creation transaction is
 * genuinely all-or-nothing at each of its three internal failure points, by
 * injecting a real Postgres-level failure via a temporary trigger — not a
 * hope-it-fails-if-we-retry-enough approach. Each test:
 *   1. attaches a BEFORE INSERT trigger on one target table that always
 *      raises an exception (simulating that specific insert failing);
 *   2. drives the real POST /api/package-orders route over HTTP;
 *   3. asserts the response is not 201 and that every row this request
 *      would have written — package_orders, payment_records,
 *      payment_events, promotion_redemptions — is absent;
 *   4. detaches the trigger.
 *
 * This is real transactional proof: the trigger fires inside the same
 * database transaction the route's db.transaction(...) opened, so a
 * successful rollback here is Postgres's own ROLLBACK, not an application-
 * level simulation.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CAPTURE_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_capture";

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

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let packageId: number;
let promotionId: number;
let promotionCodeId: number;
let promotionCode: string;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function makeStudent(run: string): Promise<{ id: number; email: string }> {
  const email = `pkg-atomic-${run}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ('Atomicity Test', $1, '0100000000', 'student', '2000-01-01', true) RETURNING id`,
    [email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function attachFailTrigger(table: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_inject_failure_${table}() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected test failure on %', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER test_inject_failure_${table}_trigger
    BEFORE INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION test_inject_failure_${table}();
  `);
}

async function detachFailTrigger(table: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS test_inject_failure_${table}_trigger ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS test_inject_failure_${table}()`);
}

async function countsFor(studentId: number): Promise<{ orders: number; records: number; events: number; redemptions: number; notifications: number }> {
  const orders = await pool.query(`SELECT count(*)::int AS n FROM package_orders WHERE student_id = $1`, [studentId]);
  const records = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE student_id = $1`, [studentId]);
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe JOIN payment_records pr ON pr.id = pe.payment_record_id WHERE pr.student_id = $1`,
    [studentId],
  );
  const redemptions = await pool.query(`SELECT count(*)::int AS n FROM promotion_redemptions WHERE student_id = $1`, [studentId]);
  const notifications = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE target = $1 AND type = 'package_created'`,
    [`student:${studentId}`],
  );
  return {
    orders: orders.rows[0].n as number,
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    redemptions: redemptions.rows[0].n as number,
    notifications: notifications.rows[0].n as number,
  };
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
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 400, 8, 6, true) RETURNING id`,
    [`Atomicity Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;

  const promo = await pool.query(
    `INSERT INTO promotions (name, type, discount_type, discount_value, is_active, rules_config)
     VALUES ($1, 'code', 'percentage', 10, true, '{}') RETURNING id`,
    [`Atomicity Test Promotion ${run}`],
  );
  promotionId = promo.rows[0].id as number;
  promotionCode = `ATOMIC-${run}`.toUpperCase().slice(0, 40);
  const code = await pool.query(
    `INSERT INTO promotion_codes (promotion_id, code) VALUES ($1, $2) RETURNING id`,
    [promotionId, promotionCode],
  );
  promotionCodeId = code.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// Each of these three requests carries the SAME real, eligible promo code
// registered in `before()` (not a re-derived per-test string that would
// silently mismatch and cause an early promotion_not_eligible 409 instead
// of actually exercising the trigger) — so a payment_records/payment_events
// failure genuinely proves "if Finance capture fails, the promotion must
// not be redeemed", not merely "an ineligible promo writes nothing".

test("a payment_records insert failure leaves zero package orders, payment records, payment events, notifications, and redemptions (and the promotion is not redeemed)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run);
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("payment_records");
  try {
    const res = await fetch(apiUrl("/api/package-orders"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ packageId, promoCode: promotionCode }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while payment_records insert is failing");
    const counts = await countsFor(student.id);
    assert.deepEqual(counts, { orders: 0, records: 0, events: 0, redemptions: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_records");
  }
});

test("a payment_events insert failure leaves zero package orders, payment records, payment events, notifications, and redemptions (and the promotion is not redeemed)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run);
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("payment_events");
  try {
    const res = await fetch(apiUrl("/api/package-orders"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ packageId, promoCode: promotionCode }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while payment_events insert is failing");
    const counts = await countsFor(student.id);
    assert.deepEqual(counts, { orders: 0, records: 0, events: 0, redemptions: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_events");
  }
});

test("a promotion_redemptions insert failure rolls back the package order, payment record, payment event, and notification row too", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const student = await makeStudent(run);
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("promotion_redemptions");
  try {
    const res = await fetch(apiUrl("/api/package-orders"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ packageId, promoCode: promotionCode }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while promotion_redemptions insert is failing");
    const counts = await countsFor(student.id);
    assert.deepEqual(counts, { orders: 0, records: 0, events: 0, redemptions: 0, notifications: 0 }, "promotion redemption failure must roll back the order, record, event, and notification row too, not leave partial state");
  } finally {
    await detachFailTrigger("promotion_redemptions");
  }
});
