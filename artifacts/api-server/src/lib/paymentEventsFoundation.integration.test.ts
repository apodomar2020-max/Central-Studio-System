/**
 * Finance Phase 2A DB Foundation — Step 5.
 *
 * Proves the row-level CHECK/FK/composite-FK/index/trigger constraints on
 * payment_events (migration 0080_payment_events_foundation.sql) hold exactly
 * as specified.
 *
 * No writer exists for this table in this repository — every insert here
 * goes directly through raw SQL, deliberately exercising the table's own
 * constraints and trigger in isolation, not any future event writer.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PAYMENT_EVENTS_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_payment_events";

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

let pool: typeof import("@workspace/db").pool;
let classId: number;
let scheduleId: number;
let adminId: number;
let packageOrderCounter = 0;

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

async function makeBooking(label: string): Promise<number> {
  const studentEmail = `pe-booking-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const result = await pool.query(
    `INSERT INTO bookings (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', 'confirmed', 'paid', 'pay_at_studio') RETURNING id`,
    [`PE Booking Test ${label}`, studentEmail, scheduleId, classId],
  );
  return result.rows[0].id as number;
}

/** Creates a paid payment_records row (a plausible target for most events) and returns its id. */
async function makePaidPaymentRecord(label: string): Promise<number> {
  const bookingId = await makeBooking(label);
  const result = await pool.query(
    `INSERT INTO payment_records
       (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status,
        confirmed_payment_method, paid_at, paid_amount_minor)
     VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot',
             2000, 0, 2000, 'paid', 'cash', now(), 2000)
     RETURNING id`,
    [bookingId],
  );
  return result.rows[0].id as number;
}

/** Creates an unpaid payment_records row (for created/failed/cancelled events). */
async function makeUnpaidPaymentRecord(label: string): Promise<number> {
  const bookingId = await makeBooking(label);
  const result = await pool.query(
    `INSERT INTO payment_records
       (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status)
     VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot',
             2000, 0, 2000, 'unpaid')
     RETURNING id`,
    [bookingId],
  );
  return result.rows[0].id as number;
}

/** Creates a package_orders row and returns its id (for credit_transactions FK). */
async function makePackageOrder(label: string): Promise<number> {
  packageOrderCounter += 1;
  const studentEmail = `pe-po-${label}-${packageOrderCounter}-${Date.now()}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`PE PO Test ${label}`, studentEmail],
  );
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months) VALUES ($1, 'per_class', 1000, 8, 6) RETURNING id`,
    [`PE Test Package ${label}-${packageOrderCounter}-${Date.now()}`],
  );
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'PE Test Package', 8, 8, 'pendingPayment') RETURNING id`,
    [`PE PO Test ${label}`, studentEmail, student.rows[0].id, pkg.rows[0].id],
  );
  return order.rows[0].id as number;
}

async function makeCreditTransaction(label: string): Promise<number> {
  const packageOrderId = await makePackageOrder(label);
  const result = await pool.query(
    `INSERT INTO credit_transactions (package_order_id, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, 'package_activated', 8, 0, 8, 'test-seed') RETURNING id`,
    [packageOrderId],
  );
  return result.rows[0].id as number;
}

/** Creates an approved payment_refunds row on the given payment record and returns its id. */
async function makeApprovedRefund(paymentRecordId: number): Promise<number> {
  const result = await pool.query(
    `INSERT INTO payment_refunds
       (payment_record_id, status, requested_amount_minor, approved_amount_minor, refund_method, requested_reason,
        reviewed_by_admin_id, reviewed_at)
     VALUES ($1, 'approved', 2000, 2000, 'cash', 'test refund', $2, now())
     RETURNING id`,
    [paymentRecordId, adminId],
  );
  return result.rows[0].id as number;
}

/** A minimal, fully valid `created` payment_events row. */
async function insertEvent(overrides: Record<string, unknown>): Promise<number> {
  const fields: Record<string, unknown> = {
    payment_refund_id: null,
    event_type: "created",
    amount_minor: null,
    previous_status: null,
    new_status: "unpaid",
    credit_transaction_id: null,
    actor_type: "admin",
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `INSERT INTO payment_events (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0].id as number;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('PE Test Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('PE Test Class', 'general', $1, true) RETURNING id`,
    [instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;

  const admin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'PE Test Admin', true) RETURNING id`,
    [`pe-admin-${Date.now()}`, `pe-admin-${Date.now()}@example.com`],
  );
  adminId = admin.rows[0].id as number;
});

after(async () => {
  await pool.end();
});

// ─── Basic structure and FKs ─────────────────────────────────────────────

test("basic: a valid event referencing a real payment record succeeds", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("b1");
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordId }));
});

test("basic: a missing payment record fails", async () => {
  await assert.rejects(
    insertEvent({ payment_record_id: 999_999_999 }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("basic: a missing credit transaction fails when supplied", async () => {
  const paymentRecordId = await makePaidPaymentRecord("b3");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
      previous_status: "paid", new_status: "paid", credit_transaction_id: 999_999_999,
    }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("basic: a missing refund fails when supplied", async () => {
  const paymentRecordId = await makePaidPaymentRecord("b4");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "paid", new_status: "refunded", amount_minor: 1000,
      payment_refund_id: 999_999_999,
    }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("basic: a refund belonging to another payment record fails through the composite FK", async () => {
  const paymentRecordA = await makePaidPaymentRecord("b5a");
  const paymentRecordB = await makePaidPaymentRecord("b5b");
  const refundOnB = await makeApprovedRefund(paymentRecordB);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordA, event_type: "refund_payout_completed",
      previous_status: "paid", new_status: "refunded", amount_minor: 1000,
      payment_refund_id: refundOnB,
    }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("basic: deleting a referenced payment record is blocked", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("b6");
  await insertEvent({ payment_record_id: paymentRecordId });
  await assert.rejects(
    pool.query(`DELETE FROM payment_records WHERE id = $1`, [paymentRecordId]),
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

test("basic: deleting a referenced refund is blocked", async () => {
  const paymentRecordId = await makePaidPaymentRecord("b7");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await insertEvent({
    payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
    previous_status: "paid", new_status: "refunded", amount_minor: 1000,
    payment_refund_id: refundId,
  });
  await assert.rejects(
    pool.query(`DELETE FROM payment_refunds WHERE id = $1`, [refundId]),
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

test("basic: deleting a referenced credit transaction is blocked", async () => {
  const paymentRecordId = await makePaidPaymentRecord("b8");
  const creditTransactionId = await makeCreditTransaction("b8");
  await insertEvent({
    payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
    previous_status: "paid", new_status: "paid", credit_transaction_id: creditTransactionId,
  });
  await assert.rejects(
    pool.query(`DELETE FROM credit_transactions WHERE id = $1`, [creditTransactionId]),
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

// ─── Vocabulary ───────────────────────────────────────────────────────────

test("vocabulary: an unsupported event type fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("v1");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("vocabulary: an unsupported actor type fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("v2");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, actor_type: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("vocabulary: an unsupported previous_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("v3");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, previous_status: "bogus", new_status: "unpaid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("vocabulary: an unsupported new_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("v4");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, new_status: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("vocabulary: a negative amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("v5");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "confirmed",
      previous_status: "unpaid", new_status: "paid", amount_minor: -1,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Event matrix (ten event types) ───────────────────────────────────────

test("event: created — a valid row succeeds", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e1");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "created",
    previous_status: null, new_status: "unpaid",
  }));
});

test("event: created with a non-null previous_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e1b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "created", previous_status: "unpaid", new_status: "unpaid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created with an invalid new_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e1c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "created", new_status: "paid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created with a non-null amount fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e1d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "created", amount_minor: 100 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created with a forbidden refund reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e1e");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "created", payment_refund_id: refundId }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created_and_confirmed — a valid row succeeds", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e2");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "created_and_confirmed",
    previous_status: null, amount_minor: 2000, new_status: "paid",
  }));
});

test("event: created_and_confirmed with an invalid previous_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e2b");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "created_and_confirmed",
      previous_status: "unpaid", amount_minor: 2000, new_status: "paid",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created_and_confirmed with an invalid new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e2c");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "created_and_confirmed",
      previous_status: null, amount_minor: 2000, new_status: "unpaid",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created_and_confirmed with a zero amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e2d");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "created_and_confirmed",
      previous_status: null, amount_minor: 0, new_status: "paid",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: created_and_confirmed with a forbidden credit reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e2e");
  const creditTransactionId = await makeCreditTransaction("e2e");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "created_and_confirmed",
      previous_status: null, amount_minor: 2000, new_status: "paid",
      credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: confirmed — a valid row succeeds", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e3");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "confirmed",
    previous_status: "pending_confirmation", amount_minor: 2000, new_status: "paid",
  }));
});

test("event: confirmed with an invalid previous_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e3b");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "confirmed",
      previous_status: "cancelled", amount_minor: 2000, new_status: "paid",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: confirmed with an invalid new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e3c");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "confirmed",
      previous_status: "unpaid", amount_minor: 2000, new_status: "pending_confirmation",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: confirmed with a null amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e3d");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "confirmed",
      previous_status: "unpaid", amount_minor: null, new_status: "paid",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: confirmed with a forbidden refund reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e3e");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "confirmed",
      previous_status: "unpaid", amount_minor: 2000, new_status: "paid",
      payment_refund_id: refundId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: method_changed — a valid row succeeds (no writer in this phase, row-level shape only)", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e4");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "method_changed",
    previous_status: "paid", new_status: "paid", amount_minor: null,
  }));
});

test("event: method_changed with previous_status null fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e4b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "method_changed", previous_status: null, new_status: "paid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: method_changed with previous_status differing from new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e4c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "method_changed", previous_status: "paid", new_status: "refunded" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: method_changed with a non-null amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e4d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "method_changed", previous_status: "paid", new_status: "paid", amount_minor: 100 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: method_changed with a forbidden credit reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e4e");
  const creditTransactionId = await makeCreditTransaction("e4e");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "method_changed",
      previous_status: "paid", new_status: "paid", credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: activation_credits_issued — a valid row succeeds", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e5");
  const creditTransactionId = await makeCreditTransaction("e5");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
    previous_status: "paid", new_status: "paid", credit_transaction_id: creditTransactionId,
  }));
});

test("event: activation_credits_issued with an invalid previous_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e5b");
  const creditTransactionId = await makeCreditTransaction("e5b");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
      previous_status: "unpaid", new_status: "paid", credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: activation_credits_issued with an invalid new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e5c");
  const creditTransactionId = await makeCreditTransaction("e5c");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
      previous_status: "paid", new_status: "refunded", credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: activation_credits_issued with a non-null amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e5d");
  const creditTransactionId = await makeCreditTransaction("e5d");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "activation_credits_issued",
      previous_status: "paid", new_status: "paid", amount_minor: 100, credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: activation event without credit_transaction_id fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e5e");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "activation_credits_issued", previous_status: "paid", new_status: "paid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: waived — a valid row succeeds, using previous_status NULL (not 'unpaid')", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e6");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "waived",
    previous_status: null, amount_minor: 0, new_status: "waived",
  }));
});

test("event: waived with previous_status 'unpaid' fails (must be NULL — direct complimentary creation)", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e6b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "waived", previous_status: "unpaid", amount_minor: 0, new_status: "waived" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: waived with a non-zero amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e6c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "waived", previous_status: null, amount_minor: 100, new_status: "waived" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: waived with an invalid new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e6d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "waived", previous_status: null, amount_minor: 0, new_status: "paid" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: waived with a forbidden refund reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e6e");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "waived", previous_status: null, amount_minor: 0, new_status: "waived", payment_refund_id: refundId }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: failed — a valid row succeeds", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e7");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "failed",
    previous_status: "pending_confirmation", new_status: "failed",
  }));
});

test("event: failed with an invalid previous_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e7b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "failed", previous_status: "paid", new_status: "failed" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: failed with an invalid new_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e7c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "failed", previous_status: "unpaid", new_status: "cancelled" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: failed with a non-null amount fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e7d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "failed", previous_status: "unpaid", new_status: "failed", amount_minor: 1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: failed with a forbidden credit reference fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e7e");
  const creditTransactionId = await makeCreditTransaction("e7e");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "failed", previous_status: "unpaid", new_status: "failed", credit_transaction_id: creditTransactionId }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: cancelled — a valid row succeeds", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e8");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "cancelled",
    previous_status: "unpaid", new_status: "cancelled",
  }));
});

test("event: cancelled with an invalid previous_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e8b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "cancelled", previous_status: "paid", new_status: "cancelled" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: cancelled with an invalid new_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e8c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "cancelled", previous_status: "unpaid", new_status: "failed" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: cancelled with a non-null amount fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e8d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "cancelled", previous_status: "unpaid", new_status: "cancelled", amount_minor: 1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: cancelled with a forbidden refund reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e8e");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "cancelled", previous_status: "failed", new_status: "cancelled", payment_refund_id: refundId }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: voided — a valid row succeeds (reserved, no writer in this phase)", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e9");
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "voided",
    previous_status: "waived", new_status: "cancelled",
  }));
});

test("event: a paid -> cancelled voided event fails (no reversal lifecycle for monetary rows in this phase)", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e9b");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "voided", previous_status: "paid", new_status: "cancelled" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: a refunded -> cancelled voided event fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e9c");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "voided", previous_status: "refunded", new_status: "cancelled" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: voided with an invalid new_status fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e9d");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "voided", previous_status: "unpaid", new_status: "failed" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: voided with a non-null amount fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("e9e");
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordId, event_type: "voided", previous_status: "unpaid", new_status: "cancelled", amount_minor: 1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: refund_payout_completed — a valid row succeeds", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
    previous_status: "paid", amount_minor: 2000, new_status: "refunded",
    payment_refund_id: refundId,
  }));
});

test("event: a second partial refund event may use previous_status partially_refunded", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10b");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
    previous_status: "partially_refunded", amount_minor: 500, new_status: "partially_refunded",
    payment_refund_id: refundId,
  }));
});

test("event: refund_payout_completed with an invalid previous_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10c");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "unpaid", amount_minor: 2000, new_status: "refunded",
      payment_refund_id: refundId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: refund_payout_completed with an invalid new_status fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10d");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "paid", amount_minor: 2000, new_status: "paid",
      payment_refund_id: refundId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: refund_payout_completed with a zero amount fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10e");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "paid", amount_minor: 0, new_status: "refunded",
      payment_refund_id: refundId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: a refund event without payment_refund_id fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10f");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "paid", amount_minor: 2000, new_status: "refunded",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("event: refund_payout_completed with a forbidden credit reference fails", async () => {
  const paymentRecordId = await makePaidPaymentRecord("e10g");
  const refundId = await makeApprovedRefund(paymentRecordId);
  const creditTransactionId = await makeCreditTransaction("e10g");
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
      previous_status: "paid", amount_minor: 2000, new_status: "refunded",
      payment_refund_id: refundId, credit_transaction_id: creditTransactionId,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Composite refund/payment integrity ─────────────────────────────────

test("composite: a matching (payment_refund_id, payment_record_id) pair succeeds", async () => {
  const paymentRecordId = await makePaidPaymentRecord("c1");
  const refundId = await makeApprovedRefund(paymentRecordId);
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordId, event_type: "refund_payout_completed",
    previous_status: "paid", amount_minor: 2000, new_status: "refunded",
    payment_refund_id: refundId,
  }));
});

test("composite: a mismatched pair fails", async () => {
  const paymentRecordA = await makePaidPaymentRecord("c2a");
  const paymentRecordB = await makePaidPaymentRecord("c2b");
  const refundOnB = await makeApprovedRefund(paymentRecordB);
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordA, event_type: "refund_payout_completed",
      previous_status: "paid", amount_minor: 2000, new_status: "refunded",
      payment_refund_id: refundOnB,
    }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("composite: a null payment_refund_id on a non-refund event does not interfere with the ordinary payment_record FK", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("c3");
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordId, payment_refund_id: null }));
  await assert.rejects(
    insertEvent({ payment_record_id: 999_999_999, payment_refund_id: null }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

// ─── Idempotency indexes ─────────────────────────────────────────────────

test("idempotency: a duplicate non-null event idempotency key fails", async () => {
  const key = `evt-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const paymentRecordA = await makeUnpaidPaymentRecord("i1a");
  const paymentRecordB = await makeUnpaidPaymentRecord("i1b");
  await insertEvent({ payment_record_id: paymentRecordA, idempotency_key: key });
  await assert.rejects(
    insertEvent({ payment_record_id: paymentRecordB, idempotency_key: key }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("idempotency: multiple null idempotency keys succeed", async () => {
  const paymentRecordA = await makeUnpaidPaymentRecord("i2a");
  const paymentRecordB = await makeUnpaidPaymentRecord("i2b");
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordA, idempotency_key: null }));
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordB, idempotency_key: null }));
});

test("idempotency: the same provider reference may exist under different event types", async () => {
  const ref = `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const paymentRecordA = await makePaidPaymentRecord("i3a");
  const paymentRecordB = await makePaidPaymentRecord("i3b");
  const refundOnB = await makeApprovedRefund(paymentRecordB);
  await insertEvent({
    payment_record_id: paymentRecordA, event_type: "confirmed",
    previous_status: "unpaid", amount_minor: 2000, new_status: "paid", provider_reference: ref,
  });
  await assert.doesNotReject(insertEvent({
    payment_record_id: paymentRecordB, event_type: "refund_payout_completed",
    previous_status: "paid", amount_minor: 2000, new_status: "refunded",
    payment_refund_id: refundOnB, provider_reference: ref,
  }));
});

test("idempotency: the same provider reference under the same event type fails", async () => {
  const ref = `prov-dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const paymentRecordA = await makePaidPaymentRecord("i4a");
  const paymentRecordB = await makePaidPaymentRecord("i4b");
  await insertEvent({
    payment_record_id: paymentRecordA, event_type: "confirmed",
    previous_status: "unpaid", amount_minor: 2000, new_status: "paid", provider_reference: ref,
  });
  await assert.rejects(
    insertEvent({
      payment_record_id: paymentRecordB, event_type: "confirmed",
      previous_status: "unpaid", amount_minor: 2000, new_status: "paid", provider_reference: ref,
    }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("idempotency: multiple null provider references succeed", async () => {
  const paymentRecordA = await makeUnpaidPaymentRecord("i5a");
  const paymentRecordB = await makeUnpaidPaymentRecord("i5b");
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordA, provider_reference: null }));
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordB, provider_reference: null }));
});

// ─── Append-only trigger ─────────────────────────────────────────────────

test("append-only: UPDATE fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("a1");
  const id = await insertEvent({ payment_record_id: paymentRecordId });
  await assert.rejects(
    pool.query(`UPDATE payment_events SET reason = 'tampered' WHERE id = $1`, [id]),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("append-only: DELETE fails", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("a2");
  const id = await insertEvent({ payment_record_id: paymentRecordId });
  await assert.rejects(
    pool.query(`DELETE FROM payment_events WHERE id = $1`, [id]),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("append-only: the original row remains unchanged after each failure", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("a3");
  const id = await insertEvent({ payment_record_id: paymentRecordId, reason: "original" });
  await assert.rejects(pool.query(`UPDATE payment_events SET reason = 'tampered' WHERE id = $1`, [id]));
  await assert.rejects(pool.query(`DELETE FROM payment_events WHERE id = $1`, [id]));
  const row = await pool.query(`SELECT reason FROM payment_events WHERE id = $1`, [id]);
  assert.equal(row.rows[0].reason, "original");
});

test("append-only: inserting a later separate event still succeeds", async () => {
  const paymentRecordId = await makeUnpaidPaymentRecord("a4");
  const firstId = await insertEvent({ payment_record_id: paymentRecordId });
  await assert.rejects(pool.query(`UPDATE payment_events SET reason = 'tampered' WHERE id = $1`, [firstId]));
  await assert.doesNotReject(insertEvent({ payment_record_id: paymentRecordId, event_type: "failed", new_status: "failed" }));
});
