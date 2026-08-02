import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_CONSUMPTION_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_consumption";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Refusing non-local database");
  if (!/disposable|local|test/i.test(url.pathname)) throw new Error("Refusing database without disposable/local/test name");
  if (/rlwy\.net|railway/i.test(databaseUrl)) throw new Error("Refusing Railway database");
}
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

let pool: typeof import("@workspace/db").pool;
let db: typeof import("@workspace/db").db;
let allocateAttendanceConsumption: typeof import("./selectConsumptionLot").allocateAttendanceConsumption;
let nextCreditValueMinor: typeof import("./selectConsumptionLot").nextCreditValueMinor;
let studentId: number;
let scheduleId: number;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  db = dbModule.db;
  ({ allocateAttendanceConsumption, nextCreditValueMinor } = await import("./selectConsumptionLot"));

  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Allocation Student', $1, '0100000000', 'student') RETURNING id`,
    [`allocation-${Date.now()}@example.com`],
  );
  studentId = student.rows[0].id as number;
  const klass = await pool.query(`INSERT INTO classes (title, category, is_active) VALUES ('Allocation Class', 'general', true) RETURNING id`);
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00') RETURNING id`,
    [klass.rows[0].id],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => { await pool.end(); });

async function makeOrder(label: string, credits: number): Promise<number> {
  const result = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_name, total_credits, remaining_credits, status, participant_type)
     VALUES ('Allocation Student', $1, $2, $3, $4, $4, 'active', 'self') RETURNING id`,
    [`allocation-${label}-${Date.now()}@example.com`, studentId, label, credits],
  );
  return result.rows[0].id as number;
}

async function issueLot(params: {
  orderId: number;
  credits: number;
  totalValueMinor: number | null;
  sourceType?: "purchased" | "bonus" | "manual_complimentary";
  transactionType?: "package_activated" | "package_bonus" | "manual_adjustment";
  expiresAt?: string | null;
  createdAt?: string;
}): Promise<number> {
  const tx = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', $3, $4, 0, $4, 'test') RETURNING id`,
    [params.orderId, studentId, params.transactionType ?? "package_activated", params.credits],
  );
  const lot = await pool.query(
    `INSERT INTO package_credit_lots
       (package_order_id, source_type, credits_issued, credits_remaining, total_value_minor, value_basis,
        expires_at, issuing_credit_transaction_id, created_by, created_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 'test', coalesce($8::timestamptz, now())) RETURNING id`,
    [params.orderId, params.sourceType ?? "purchased", params.credits, params.totalValueMinor,
      params.totalValueMinor == null ? "unknown" : "recorded_purchase_price", params.expiresAt ?? null,
      tx.rows[0].id, params.createdAt ?? null],
  );
  return lot.rows[0].id as number;
}

async function makeDeduction(orderId: number): Promise<{ attendanceId: number; creditTransactionId: number }> {
  const attendance = await pool.query(
    `INSERT INTO attendance
       (student_name, student_email, student_id, participant_type, package_order_id, schedule_id,
        attendance_source, payment_source, credit_deducted, status)
     VALUES ('Allocation Student', $1, $2, 'self', $3, $4, 'walk_in', 'walk_in_package_credit', true, 'checked_in') RETURNING id`,
    [`allocation-${Date.now()}-${Math.random()}@example.com`, studentId, orderId, scheduleId],
  );
  const credit = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after,
        attendance_id, reference_id, reference_type, created_by)
     VALUES ($1, $2, 'self', 'attendance_deduction', -1, 1, 0, $3, $3, 'attendance', 'test') RETURNING id`,
    [orderId, studentId, attendance.rows[0].id],
  );
  return { attendanceId: attendance.rows[0].id as number, creditTransactionId: credit.rows[0].id as number };
}

async function allocate(orderId: number, deduction: { attendanceId: number; creditTransactionId: number }) {
  return db.transaction((tx) => allocateAttendanceConsumption(tx, {
    creditTransactionId: deduction.creditTransactionId,
    packageOrderId: orderId,
    attendanceId: deduction.attendanceId,
    bookingId: null,
    createdBy: "test",
  }));
}

test("exact integer formula distributes 1000 minor units across 3 credits as 333, 333, 334", async () => {
  assert.deepEqual([3, 2, 1].map((creditsRemaining) => nextCreditValueMinor({
    totalValueMinor: 1000, creditsIssued: 3, creditsRemaining,
  })), [333, 333, 334]);

  const orderId = await makeOrder("rounding", 3);
  await issueLot({ orderId, credits: 3, totalValueMinor: 1000 });
  const values = [];
  for (let index = 0; index < 3; index += 1) {
    values.push((await allocate(orderId, await makeDeduction(orderId))).totalValueMinor);
  }
  assert.deepEqual(values, [333, 333, 334]);
  assert.equal(values.reduce((sum, value) => sum + value, 0), 1000);
});

test("selector uses earliest expiration, then FIFO createdAt, then lowest id", async () => {
  const orderId = await makeOrder("selection", 3);
  const late = await issueLot({ orderId, credits: 1, totalValueMinor: 100, expiresAt: "2031-01-01T00:00:00Z" });
  await issueLot({ orderId, credits: 1, totalValueMinor: 50, sourceType: "bonus", transactionType: "package_bonus", expiresAt: "2020-01-01T00:00:00Z" });
  const fifoOld = await issueLot({ orderId, credits: 1, totalValueMinor: 200, sourceType: "bonus", transactionType: "package_bonus", expiresAt: "2030-01-01T00:00:00Z", createdAt: "2029-01-01T00:00:00Z" });
  const fifoNew = await issueLot({ orderId, credits: 1, totalValueMinor: 300, sourceType: "manual_complimentary", transactionType: "manual_adjustment", expiresAt: "2030-01-01T00:00:00Z", createdAt: "2029-02-01T00:00:00Z" });

  const selected = [];
  for (let index = 0; index < 3; index += 1) selected.push((await allocate(orderId, await makeDeduction(orderId))).lotId);
  assert.deepEqual(selected, [fifoOld, fifoNew, late]);
});

test("concurrent exact retries return one allocation and decrement the lot once", async () => {
  const orderId = await makeOrder("idempotency", 2);
  const lotId = await issueLot({ orderId, credits: 2, totalValueMinor: 200 });
  const deduction = await makeDeduction(orderId);
  const [first, retry] = await Promise.all([allocate(orderId, deduction), allocate(orderId, deduction)]);
  assert.equal(first.id, retry.id);
  const allocations = await pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE credit_transaction_id = $1`, [deduction.creditTransactionId]);
  assert.equal(allocations.rows[0].n, 1);
  const lot = await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [lotId]);
  assert.equal(lot.rows[0].credits_remaining, 1);
});

test("non-attendance credit transaction types cannot create consumption allocations", async () => {
  const orderId = await makeOrder("non-attendance", 1);
  const lotId = await issueLot({ orderId, credits: 1, totalValueMinor: 100 });
  const deduction = await makeDeduction(orderId);
  await pool.query(`UPDATE credit_transactions SET type = 'manual_adjustment' WHERE id = $1`, [deduction.creditTransactionId]);
  await assert.rejects(allocate(orderId, deduction), /Only a matching attendance deduction/);
  const allocations = await pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE credit_transaction_id = $1`, [deduction.creditTransactionId]);
  assert.equal(allocations.rows[0].n, 0);
  const lot = await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [lotId]);
  assert.equal(lot.rows[0].credits_remaining, 1);
});
