import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_EXPIRATION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_expiration";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Refusing non-local database");
  if (!/disposable|local|test/i.test(url.pathname)) throw new Error("Refusing database without disposable/local/test name");
  if (/rlwy\.net|railway/i.test(databaseUrl)) throw new Error("Refusing Railway database");
}
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

const NOW = new Date("2026-08-02T12:00:00.000Z");
let pool: typeof import("@workspace/db").pool;
let db: typeof import("@workspace/db").db;
let expirePackageOrderCredits: typeof import("./packageCreditExpiration").expirePackageOrderCredits;
let runPackageCreditExpirationBatch: typeof import("./packageCreditExpiration").runPackageCreditExpirationBatch;
let allocateAttendanceConsumption: typeof import("./packageCredits/selectConsumptionLot").allocateAttendanceConsumption;
let studentId: number;
let scheduleId: number;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  ({ expirePackageOrderCredits, runPackageCreditExpirationBatch } = await import("./packageCreditExpiration"));
  ({ allocateAttendanceConsumption } = await import("./packageCredits/selectConsumptionLot"));
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Expiration Student', $1, '0100000000', 'student') RETURNING id`,
    [`expiration-${Date.now()}@example.com`],
  );
  studentId = student.rows[0].id as number;
  const klass = await pool.query(`INSERT INTO classes (title, category, is_active) VALUES ('Expiration Class', 'general', true) RETURNING id`);
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00') RETURNING id`,
    [klass.rows[0].id],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => { await pool.end(); });

async function makeOrder(label: string, credits: number, expiresAt = "2026-08-01T12:00:00.000Z"): Promise<number> {
  const result = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_name, total_credits, remaining_credits,
        status, participant_type, expires_at)
     VALUES ('Expiration Student', $1, $2, $3, $4, $4, 'active', 'self', $5) RETURNING id`,
    [`expiration-${label}-${Date.now()}@example.com`, studentId, label, credits, expiresAt],
  );
  return result.rows[0].id as number;
}

async function issueLot(params: {
  orderId: number;
  credits: number;
  totalValueMinor: number | null;
  sourceType?: "purchased" | "bonus" | "manual_complimentary";
  transactionType?: "package_activated" | "package_bonus" | "manual_adjustment";
  expiresAt?: string;
}): Promise<number> {
  const transaction = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', $3, $4, 0, $4, 'test') RETURNING id`,
    [params.orderId, studentId, params.transactionType ?? "package_activated", params.credits],
  );
  const lot = await pool.query(
    `INSERT INTO package_credit_lots
       (package_order_id, source_type, credits_issued, credits_remaining, total_value_minor,
        value_basis, expires_at, issuing_credit_transaction_id, created_by)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'test') RETURNING id`,
    [params.orderId, params.sourceType ?? "purchased", params.credits, params.totalValueMinor,
      params.totalValueMinor == null ? "unknown" : "recorded_purchase_price",
      params.expiresAt ?? "2026-08-01T12:00:00Z", transaction.rows[0].id],
  );
  return lot.rows[0].id as number;
}

async function expirationRows(orderId: number) {
  return pool.query(
    `SELECT a.*, t.type AS transaction_type, t.delta, t.balance_before, t.balance_after
     FROM package_credit_allocations a
     JOIN credit_transactions t ON t.id = a.credit_transaction_id
     WHERE a.package_order_id = $1 AND a.event_type = 'expiration'
     ORDER BY a.id`,
    [orderId],
  );
}

test("basic purchased expiration retires credits and records studio-level attribution only", async () => {
  const orderId = await makeOrder("basic", 3);
  const lotId = await issueLot({ orderId, credits: 3, totalValueMinor: 1000 });
  const result = await expirePackageOrderCredits(orderId, { now: NOW });
  assert.equal(result.expiredCredits, 3);
  const order = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [orderId]);
  assert.deepEqual(order.rows[0], { remaining_credits: 0, status: "expired" });
  const lot = await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [lotId]);
  assert.equal(lot.rows[0].credits_remaining, 0);
  const rows = await expirationRows(orderId);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].credits, 3);
  assert.equal(rows.rows[0].total_value_minor, 1000);
  assert.equal(rows.rows[0].transaction_type, "credit_expired");
  assert.equal(rows.rows[0].delta, -3);
  for (const field of ["attendance_id", "booking_id", "schedule_id", "branch_id", "room_id"]) assert.equal(rows.rows[0][field], null);
});

test("expiration captures the exact 667 remainder after a 333 consumption", async () => {
  const orderId = await makeOrder("partial", 3);
  const lotId = await issueLot({
    orderId,
    credits: 3,
    totalValueMinor: 1000,
    expiresAt: "2026-08-03T12:00:00Z",
  });
  const attendance = await pool.query(
    `INSERT INTO attendance
       (student_name, student_email, student_id, participant_type, package_order_id, schedule_id,
        attendance_source, payment_source, credit_deducted, status)
     VALUES ('Expiration Student', $1, $2, 'self', $3, $4, 'walk_in', 'walk_in_package_credit', true, 'checked_in') RETURNING id`,
    [`expiration-consumption-${Date.now()}@example.com`, studentId, orderId, scheduleId],
  );
  const deduction = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after,
        attendance_id, reference_id, reference_type, created_by)
     VALUES ($1, $2, 'self', 'attendance_deduction', -1, 3, 2, $3, $3, 'attendance', 'test') RETURNING id`,
    [orderId, studentId, attendance.rows[0].id],
  );
  const consumption = await db.transaction((tx) => allocateAttendanceConsumption(tx, {
    creditTransactionId: deduction.rows[0].id,
    packageOrderId: orderId,
    attendanceId: attendance.rows[0].id,
    bookingId: null,
    createdBy: "test",
  }));
  assert.equal(consumption.totalValueMinor, 333);
  await pool.query(`UPDATE package_orders SET remaining_credits = 2 WHERE id = $1`, [orderId]);

  await expirePackageOrderCredits(orderId, { now: NOW });
  const rows = await expirationRows(orderId);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].credits, 2);
  assert.equal(rows.rows[0].total_value_minor, 667);
  const lot = await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [lotId]);
  assert.equal(lot.rows[0].credits_remaining, 0);
});

test("bonus and unknown lots expire without fabricated monetary value", async () => {
  const bonusOrder = await makeOrder("bonus", 2);
  await issueLot({ orderId: bonusOrder, credits: 2, totalValueMinor: 0, sourceType: "bonus", transactionType: "package_bonus" });
  await expirePackageOrderCredits(bonusOrder, { now: NOW });
  const bonus = await expirationRows(bonusOrder);
  assert.equal(bonus.rows[0].total_value_minor, 0);

  const unknownOrder = await makeOrder("unknown", 2);
  await issueLot({ orderId: unknownOrder, credits: 2, totalValueMinor: null });
  await expirePackageOrderCredits(unknownOrder, { now: NOW });
  const unknown = await expirationRows(unknownOrder);
  assert.equal(unknown.rows[0].total_value_minor, 0);
  assert.equal(unknown.rows[0].unit_value_minor, null);
  assert.equal(unknown.rows[0].value_basis, "unknown");
});

test("multiple lots create one operational transaction and allocation per lot", async () => {
  const orderId = await makeOrder("multi-lot", 3);
  await issueLot({ orderId, credits: 1, totalValueMinor: 100 });
  await issueLot({ orderId, credits: 2, totalValueMinor: 0, sourceType: "bonus", transactionType: "package_bonus" });
  const result = await expirePackageOrderCredits(orderId, { now: NOW });
  assert.equal(result.expirationTransactions, 2);
  assert.equal(result.expirationAllocations, 2);
  const rows = await expirationRows(orderId);
  assert.equal(rows.rowCount, 2);
  assert.deepEqual(rows.rows.map((row) => row.delta), [-1, -2]);
  assert.deepEqual(rows.rows.map((row) => row.balance_after), [2, 0]);
});

test("duplicate execution and batch restart are idempotent", async () => {
  const directOrder = await makeOrder("duplicate", 2);
  await issueLot({ orderId: directOrder, credits: 2, totalValueMinor: 200 });
  const attempts = await Promise.all([
    expirePackageOrderCredits(directOrder, { now: NOW }),
    expirePackageOrderCredits(directOrder, { now: NOW }),
  ]);
  assert.deepEqual(attempts.map((attempt) => attempt.alreadyProcessed).sort(), [false, true]);
  assert.equal((await expirationRows(directOrder)).rowCount, 1);

  const batchOne = await makeOrder("batch-one", 1);
  await issueLot({ orderId: batchOne, credits: 1, totalValueMinor: 100 });
  const batchTwo = await makeOrder("batch-two", 1);
  await issueLot({ orderId: batchTwo, credits: 1, totalValueMinor: 100 });
  assert.equal((await runPackageCreditExpirationBatch({ batchSize: 1, now: NOW })).processed, 1);
  assert.equal((await runPackageCreditExpirationBatch({ batchSize: 1, now: NOW })).processed, 1);
  assert.equal((await runPackageCreditExpirationBatch({ batchSize: 1, now: NOW })).processed, 0);
});
