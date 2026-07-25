/**
 * Finance Phase 2A DB Foundation — Step 4.
 *
 * Proves the row-level CHECK/UNIQUE/FK constraints on payment_refunds
 * (migration 0079_payment_refunds_foundation.sql) hold exactly as specified.
 *
 * No writer exists for this table in this repository — every insert here
 * goes directly through raw SQL, deliberately exercising the table's own
 * constraints in isolation, not any future refund route.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PAYMENT_REFUNDS_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_payment_refunds";

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

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

async function makeBooking(label: string): Promise<number> {
  const studentEmail = `pf-booking-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const result = await pool.query(
    `INSERT INTO bookings (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', 'confirmed', 'paid', 'pay_at_studio') RETURNING id`,
    [`PF Booking Test ${label}`, studentEmail, scheduleId, classId],
  );
  return result.rows[0].id as number;
}

/** Creates a paid payment_records row (a plausible refund target) and returns its id. */
async function makePaymentRecord(label: string): Promise<number> {
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

/** A minimal, fully valid underReview payment_refunds row. */
async function insertRefund(overrides: Record<string, unknown>): Promise<number> {
  const fields: Record<string, unknown> = {
    status: "underReview",
    requested_amount_minor: 1000,
    approved_amount_minor: null,
    refunded_amount_minor: null,
    refund_method: "cash",
    requested_reason: "Test refund request",
    reviewed_by_admin_id: null,
    processed_by_admin_id: null,
    reviewed_at: null,
    processed_at: null,
    failed_reason: null,
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `INSERT INTO payment_refunds (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0].id as number;
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('PF Test Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('PF Test Class', 'general', $1, true) RETURNING id`,
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
     VALUES ($1, $2, 'x', 'PF Test Admin', true) RETURNING id`,
    [`pf-admin-${Date.now()}`, `pf-admin-${Date.now()}@example.com`],
  );
  adminId = admin.rows[0].id as number;
});

after(async () => {
  await pool.end();
});

// ─── Basic structure ─────────────────────────────────────────────────────

test("basic: a valid underReview refund succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("b1");
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId }));
});

test("basic: FK to a missing payment record fails", async () => {
  await assert.rejects(
    insertRefund({ payment_record_id: 999_999_999 }),
    (err: unknown) => pgErrorCode(err) === "23503",
  );
});

test("basic: deleting a referenced payment record is blocked by RESTRICT", async () => {
  const paymentRecordId = await makePaymentRecord("b3");
  await insertRefund({ payment_record_id: paymentRecordId });
  await assert.rejects(
    pool.query(`DELETE FROM payment_records WHERE id = $1`, [paymentRecordId]),
    // ON DELETE RESTRICT reports 23001 (restrict_violation), distinct from
    // 23503 — confirmed directly against this disposable DB, matching the
    // credit_transactions/payment_records RESTRICT behavior already proven
    // in the prior Finance Phase 2A tasks.
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

test("basic: an unsupported status fails", async () => {
  const paymentRecordId = await makePaymentRecord("b4");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, status: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("basic: an unsupported refund method fails", async () => {
  const paymentRecordId = await makePaymentRecord("b5");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, refund_method: "bogus" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Amount rules ────────────────────────────────────────────────────────

test("amounts: requested amount zero fails", async () => {
  const paymentRecordId = await makePaymentRecord("a1");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, requested_amount_minor: 0 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: requested amount negative fails", async () => {
  const paymentRecordId = await makePaymentRecord("a1b");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, requested_amount_minor: -100 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: approved amount zero fails", async () => {
  const paymentRecordId = await makePaymentRecord("a2");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "approved",
      approved_amount_minor: 0, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: approved amount negative fails", async () => {
  const paymentRecordId = await makePaymentRecord("a2b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "approved",
      approved_amount_minor: -50, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: approved amount above requested fails", async () => {
  const paymentRecordId = await makePaymentRecord("a3");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, requested_amount_minor: 500, status: "approved",
      approved_amount_minor: 600, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: refunded amount zero fails", async () => {
  const paymentRecordId = await makePaymentRecord("a4");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, requested_amount_minor: 500, status: "refunded",
      approved_amount_minor: 500, refunded_amount_minor: 0,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: refunded amount negative fails", async () => {
  const paymentRecordId = await makePaymentRecord("a4b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, requested_amount_minor: 500, status: "refunded",
      approved_amount_minor: 500, refunded_amount_minor: -1,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: refunded amount without approved amount fails", async () => {
  const paymentRecordId = await makePaymentRecord("a5");
  await assert.rejects(
    pool.query(
      `INSERT INTO payment_refunds (payment_record_id, status, requested_amount_minor, refunded_amount_minor, refund_method, requested_reason)
       VALUES ($1, 'underReview', 500, 100, 'cash', 'test')`,
      [paymentRecordId],
    ),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: refunded amount above approved fails", async () => {
  const paymentRecordId = await makePaymentRecord("a6");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, requested_amount_minor: 500, status: "refunded",
      approved_amount_minor: 400, refunded_amount_minor: 450,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Status matrix ───────────────────────────────────────────────────────

test("status: underReview — a valid row succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("st1");
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId, status: "underReview" }));
});

test("status: underReview with reviewer evidence fails", async () => {
  const paymentRecordId = await makePaymentRecord("st1b");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, status: "underReview", reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString() }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: approved — a valid row succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("st2");
  await assert.doesNotReject(insertRefund({
    payment_record_id: paymentRecordId, status: "approved",
    approved_amount_minor: 800, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  }));
});

test("status: approved without reviewer fails", async () => {
  const paymentRecordId = await makePaymentRecord("st2b");
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId, status: "approved", approved_amount_minor: 800 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: rejected — a valid row succeeds, preserving the original request", async () => {
  const paymentRecordId = await makePaymentRecord("st3");
  const id = await insertRefund({
    payment_record_id: paymentRecordId, status: "rejected", requested_amount_minor: 750, requested_reason: "Preserved reason",
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  });
  const row = await pool.query(`SELECT requested_amount_minor, requested_reason FROM payment_refunds WHERE id = $1`, [id]);
  assert.equal(row.rows[0].requested_amount_minor, 750);
  assert.equal(row.rows[0].requested_reason, "Preserved reason");
});

test("status: rejected with an approved amount fails", async () => {
  const paymentRecordId = await makePaymentRecord("st3b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "rejected",
      approved_amount_minor: 500, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: processing — a valid row succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("st4");
  await assert.doesNotReject(insertRefund({
    payment_record_id: paymentRecordId, status: "processing",
    approved_amount_minor: 800, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  }));
});

test("status: processing with processed admin/time fails (no separate payout-initiation actor in this phase)", async () => {
  const paymentRecordId = await makePaymentRecord("st4b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "processing",
      approved_amount_minor: 800, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: refunded — a valid row succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("st5");
  await assert.doesNotReject(insertRefund({
    payment_record_id: paymentRecordId, status: "refunded",
    approved_amount_minor: 800, refunded_amount_minor: 800,
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
  }));
});

test("status: refunded without processor evidence fails", async () => {
  const paymentRecordId = await makePaymentRecord("st5b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "refunded",
      approved_amount_minor: 800, refunded_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed — a valid row succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("st6");
  await assert.doesNotReject(insertRefund({
    payment_record_id: paymentRecordId, status: "failed",
    approved_amount_minor: 800,
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    failed_reason: "Bank transfer rejected",
  }));
});

test("status: failed without processor evidence fails", async () => {
  const paymentRecordId = await makePaymentRecord("st6b");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "failed",
      approved_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      failed_reason: "Bank transfer rejected",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed without failed_reason fails", async () => {
  const paymentRecordId = await makePaymentRecord("st6c");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "failed",
      approved_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed with an empty-string failed_reason fails", async () => {
  const paymentRecordId = await makePaymentRecord("st6e");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "failed",
      approved_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
      failed_reason: "",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed with a whitespace-only failed_reason fails", async () => {
  const paymentRecordId = await makePaymentRecord("st6f");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "failed",
      approved_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
      failed_reason: "   \t\n  ",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed with a refunded amount fails", async () => {
  const paymentRecordId = await makePaymentRecord("st6d");
  await assert.rejects(
    insertRefund({
      payment_record_id: paymentRecordId, status: "failed",
      approved_amount_minor: 800, refunded_amount_minor: 800,
      reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
      processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
      failed_reason: "Bank transfer rejected",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Open-refund index ───────────────────────────────────────────────────

test("open-refund: first underReview row for a payment record succeeds", async () => {
  const paymentRecordId = await makePaymentRecord("oi1");
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId }));
});

test("open-refund: a second underReview row for the same payment record fails with 23505", async () => {
  const paymentRecordId = await makePaymentRecord("oi2");
  await insertRefund({ payment_record_id: paymentRecordId });
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("open-refund: an approved refund blocks another open refund on the same payment record", async () => {
  const paymentRecordId = await makePaymentRecord("oi3");
  await insertRefund({
    payment_record_id: paymentRecordId, status: "approved",
    approved_amount_minor: 500, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  });
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("open-refund: a processing refund blocks another open refund on the same payment record", async () => {
  const paymentRecordId = await makePaymentRecord("oi4");
  await insertRefund({
    payment_record_id: paymentRecordId, status: "processing",
    approved_amount_minor: 500, reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  });
  await assert.rejects(
    insertRefund({ payment_record_id: paymentRecordId }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("open-refund: a rejected refund allows a later new underReview refund on the same payment record", async () => {
  const paymentRecordId = await makePaymentRecord("oi5");
  await insertRefund({
    payment_record_id: paymentRecordId, status: "rejected",
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
  });
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId }));
});

test("open-refund: a refunded refund allows a later new underReview refund on the same payment record", async () => {
  const paymentRecordId = await makePaymentRecord("oi6");
  await insertRefund({
    payment_record_id: paymentRecordId, status: "refunded",
    approved_amount_minor: 500, refunded_amount_minor: 500,
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
  });
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId }));
});

test("open-refund: a failed refund allows a later new underReview refund on the same payment record", async () => {
  const paymentRecordId = await makePaymentRecord("oi7");
  await insertRefund({
    payment_record_id: paymentRecordId, status: "failed",
    approved_amount_minor: 500,
    reviewed_by_admin_id: adminId, reviewed_at: new Date().toISOString(),
    processed_by_admin_id: adminId, processed_at: new Date().toISOString(),
    failed_reason: "Payout attempt failed",
  });
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordId }));
});

test("open-refund: different payment records may each independently have an open refund", async () => {
  const paymentRecordIdA = await makePaymentRecord("oi8a");
  const paymentRecordIdB = await makePaymentRecord("oi8b");
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordIdA }));
  await assert.doesNotReject(insertRefund({ payment_record_id: paymentRecordIdB }));
});
