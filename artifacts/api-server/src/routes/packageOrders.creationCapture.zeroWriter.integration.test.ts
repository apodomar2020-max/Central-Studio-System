/**
 * Finance Phase 2B-1 release correction: zero-unintended-writer proof.
 *
 * A successful package-order creation must write exactly one package_order,
 * one payment_records row, and one payment_events "created" row — nothing
 * in payment_refunds, credit_transactions, or activation_credits_issued
 * events. This is a fresh-database, single-purpose check, separate from
 * the main creationCapture suite so its baseline counts are unambiguous.
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

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function totals() {
  const [orders, records, events, refunds, credits, activationEvents] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM package_orders`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM payment_refunds`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE type = 'package_activated'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE event_type = 'activation_credits_issued'`),
  ]);
  return {
    orders: orders.rows[0].n as number,
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    refunds: refunds.rows[0].n as number,
    activationCredits: credits.rows[0].n as number,
    activationEvents: activationEvents.rows[0].n as number,
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
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ($1, 'per_class', 300, 8, 6, true) RETURNING id`,
    [`Zero Writer Test Package ${run}`],
  );
  packageId = pkg.rows[0].id as number;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("a successful creation writes exactly +1 order, +1 payment record, +1 created event, and nothing else", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `pkg-zerowriter-${run}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ('Zero Writer Test', $1, '0100000000', 'student', true) RETURNING id`,
    [email],
  );
  const studentId = student.rows[0].id as number;
  const token = jwtSign({ sub: studentId, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);

  const before = await totals();
  const res = await fetch(apiUrl("/api/package-orders"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId }),
  });
  assert.equal(res.status, 201);
  const after = await totals();

  assert.equal(after.orders, before.orders + 1);
  assert.equal(after.records, before.records + 1);
  assert.equal(after.events, before.events + 1);
  assert.equal(after.refunds, before.refunds, "payment_refunds must remain unchanged");
  assert.equal(after.activationCredits, before.activationCredits, "credit_transactions must gain no package_activated row");
  assert.equal(after.activationEvents, before.activationEvents, "no activation_credits_issued event may be created");
});
