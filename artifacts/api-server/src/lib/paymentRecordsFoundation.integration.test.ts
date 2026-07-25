/**
 * Finance Phase 2A DB Foundation — Step 3.
 *
 * Proves the row-level CHECK/UNIQUE/FK constraints and the
 * guard_payment_record_source_integrity() trigger on payment_records
 * (migration 0078_payment_records_foundation.sql) hold exactly as specified.
 *
 * No writer exists for this table in this repository — every insert here
 * goes directly through raw SQL, deliberately exercising the table's own
 * constraints and trigger in isolation, not any future application route.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PAYMENT_RECORDS_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_payment_records";

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
let packageId: number;

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

async function makeStudent(label: string): Promise<number> {
  const email = `pr-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ($1, $2, '0100000000', 'student') RETURNING id`,
    [`PR Test ${label}`, email],
  );
  return result.rows[0].id as number;
}

async function makePackageOrder(label: string): Promise<number> {
  const studentId = await makeStudent(`po-${label}`);
  const result = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'PR Test Package', 8, 8, 'pendingPayment') RETURNING id`,
    [`PR Test ${label}`, `unused-${label}@example.com`, studentId, packageId],
  );
  return result.rows[0].id as number;
}

let classId: number;
let scheduleId: number;

async function makeBooking(label: string): Promise<number> {
  const studentEmail = `pr-booking-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const result = await pool.query(
    `INSERT INTO bookings (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', 'confirmed', 'pending_payment', 'pay_at_studio') RETURNING id`,
    [`PR Booking Test ${label}`, studentEmail, scheduleId, classId],
  );
  return result.rows[0].id as number;
}

/** A minimal, fully valid single_class_booking payment_records row (unpaid). */
async function insertPaymentRecord(overrides: Record<string, unknown>): Promise<number> {
  const fields: Record<string, unknown> = {
    flow_type: "single_class_booking",
    booking_id: null,
    package_order_id: null,
    source_deleted_at: null,
    capture_origin: "live_capture",
    backfill_batch_id: null,
    occurred_at: new Date().toISOString(),
    evidence_class: "confirmed",
    amount_availability: "exact",
    amount_source: "creation_snapshot",
    gross_amount_minor: 1000,
    discount_amount_minor: 0,
    final_payable_amount_minor: 1000,
    paid_amount_minor: 0,
    refunded_amount_minor: 0,
    status: "unpaid",
    ...overrides,
  };
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query(
    `INSERT INTO payment_records (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  return result.rows[0].id as number;
}

// pool.connect() is overloaded (promise vs. callback signatures); extracting
// its return type directly via `ReturnType<typeof pool.connect>` resolves to
// the wrong (void-returning, callback) overload. Routing through a small
// async wrapper that actually calls it with no arguments forces TS to infer
// the real promise-overload return type instead.
async function connectClient() {
  return pool.connect();
}
type PgClient = Awaited<ReturnType<typeof connectClient>>;

async function withTransaction<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months) VALUES ($1, 'per_class', 1000, 8, 6) RETURNING id`,
    [`PR Test Package ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  packageId = pkg.rows[0].id as number;

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('PR Test Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('PR Test Class', 'general', $1, true) RETURNING id`,
    [instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  await pool.end();
});

// ─── Source integrity ────────────────────────────────────────────────────

test("source: valid package_purchase insert succeeds", async () => {
  const packageOrderId = await makePackageOrder("s1");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "package_purchase", package_order_id: packageOrderId, booking_id: null,
  }));
});

test("source: valid single_class_booking insert succeeds", async () => {
  const bookingId = await makeBooking("s2");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId }));
});

test("source: valid studio_walkin insert succeeds", async () => {
  const bookingId = await makeBooking("s3");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "studio_walkin", booking_id: bookingId }));
});

test("source: wrong FK for flow type fails", async () => {
  const packageOrderId = await makePackageOrder("s4");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", package_order_id: packageOrderId, booking_id: null }),
    (err: unknown) => pgErrorCode(err) === "23514" || pgErrorCode(err) === "P0001",
  );
});

test("source: both FKs set fails", async () => {
  const packageOrderId = await makePackageOrder("s5a");
  const bookingId = await makeBooking("s5b");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", package_order_id: packageOrderId, booking_id: bookingId }),
    (err: unknown) => pgErrorCode(err) === "23514" || pgErrorCode(err) === "P0001",
  );
});

test("source: neither FK set fails", async () => {
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", package_order_id: null, booking_id: null }),
    (err: unknown) => pgErrorCode(err) === "23514" || pgErrorCode(err) === "P0001",
  );
});

test("source: a pre-tombstoned insert (source_deleted_at set on a fresh row) fails", async () => {
  const bookingId = await makeBooking("s6");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, source_deleted_at: new Date().toISOString() }),
    (err: unknown) => pgErrorCode(err) === "23514" || pgErrorCode(err) === "P0001",
  );
});

test("source: direct booking_id nulling without the marker fails", async () => {
  const bookingId = await makeBooking("s7");
  const id = await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await assert.rejects(
    pool.query(`UPDATE payment_records SET booking_id = NULL, source_deleted_at = now() WHERE id = $1`, [id]),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("source: direct source_deleted_at update without the marker fails", async () => {
  const bookingId = await makeBooking("s8");
  const id = await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await assert.rejects(
    withTransaction(async (client) => {
      await client.query(`UPDATE payment_records SET source_deleted_at = now() WHERE id = $1`, [id]);
    }),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("source: marker set but an invalid transition shape (both FKs touched) fails", async () => {
  const bookingId = await makeBooking("s9");
  const packageOrderId = await makePackageOrder("s9b");
  const id = await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await assert.rejects(
    withTransaction(async (client) => {
      await client.query(`SET LOCAL app.allow_payment_source_tombstone = 'on'`);
      await client.query(
        `UPDATE payment_records SET booking_id = NULL, package_order_id = $2, source_deleted_at = now() WHERE id = $1`,
        [id, packageOrderId],
      );
    }),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("source: an authorized booking tombstone (marker set, exact shape) succeeds", async () => {
  const bookingId = await makeBooking("s10");
  const id = await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await withTransaction(async (client) => {
    await client.query(`SET LOCAL app.allow_payment_source_tombstone = 'on'`);
    await client.query(`UPDATE payment_records SET booking_id = NULL, source_deleted_at = now() WHERE id = $1`, [id]);
  });
  const row = await pool.query(`SELECT booking_id, source_deleted_at FROM payment_records WHERE id = $1`, [id]);
  assert.equal(row.rows[0].booking_id, null);
  assert.ok(row.rows[0].source_deleted_at !== null);
});

test("source: a package_order_id mutation is impossible even with the marker set", async () => {
  const packageOrderId = await makePackageOrder("s11");
  const otherPackageOrderId = await makePackageOrder("s11b");
  const id = await insertPaymentRecord({ flow_type: "package_purchase", package_order_id: packageOrderId, booking_id: null });
  await assert.rejects(
    withTransaction(async (client) => {
      await client.query(`SET LOCAL app.allow_payment_source_tombstone = 'on'`);
      await client.query(`UPDATE payment_records SET package_order_id = $2 WHERE id = $1`, [id, otherPackageOrderId]);
    }),
    (err: unknown) => pgErrorCode(err) === "P0001",
  );
});

test("source: deleting a referenced package order is blocked by RESTRICT", async () => {
  const packageOrderId = await makePackageOrder("s12");
  await insertPaymentRecord({ flow_type: "package_purchase", package_order_id: packageOrderId, booking_id: null });
  await assert.rejects(
    pool.query(`DELETE FROM package_orders WHERE id = $1`, [packageOrderId]),
    // A plain ON DELETE RESTRICT violation reports 23001 (restrict_violation),
    // distinct from 23503 (foreign_key_violation) — confirmed directly
    // against this disposable DB (matches the credit_transactions RESTRICT
    // FK behavior confirmed in the prior Finance Phase 2A DB Hardening task).
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

test("source: a direct booking delete (bypassing the controlled transaction) is blocked while referenced", async () => {
  const bookingId = await makeBooking("s13");
  await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await assert.rejects(
    pool.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]),
    (err: unknown) => pgErrorCode(err) === "23001",
  );
});

// ─── Provenance and amounts ─────────────────────────────────────────────

test("provenance: exact <-> creation_snapshot is a valid pair", async () => {
  const bookingId = await makeBooking("p1");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId,
    amount_availability: "exact", amount_source: "creation_snapshot",
  }));
});

test("provenance: estimated_backfill <-> catalog_price_at_backfill_time is a valid pair (historical backfill row)", async () => {
  const batch = await pool.query(
    `INSERT INTO payment_backfill_batches (created_by, source_main_commit) VALUES ('test', '0000000000000000000000000000000000000000') RETURNING id`,
  );
  const bookingId = await makeBooking("p2");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId,
    capture_origin: "historical_backfill", backfill_batch_id: batch.rows[0].id,
    evidence_class: "legacy_operational_status",
    amount_availability: "estimated_backfill", amount_source: "catalog_price_at_backfill_time",
    status: "legacy_unverified",
  }));
});

test("provenance: unknown <-> unresolvable is a valid pair (historical backfill row, no amounts)", async () => {
  const batch = await pool.query(
    `INSERT INTO payment_backfill_batches (created_by, source_main_commit) VALUES ('test', '0000000000000000000000000000000000000000') RETURNING id`,
  );
  const bookingId = await makeBooking("p3");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId,
    capture_origin: "historical_backfill", backfill_batch_id: batch.rows[0].id,
    evidence_class: "legacy_operational_status",
    amount_availability: "unknown", amount_source: "unresolvable",
    gross_amount_minor: null, discount_amount_minor: null, final_payable_amount_minor: null,
    status: "legacy_unverified",
  }));
});

test("provenance: exact paired with catalog_price_at_backfill_time (invalid cross-pair) fails", async () => {
  const bookingId = await makeBooking("p4");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, amount_source: "catalog_price_at_backfill_time" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("provenance: unknown paired with creation_snapshot (invalid cross-pair) fails", async () => {
  const bookingId = await makeBooking("p5");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, amount_availability: "unknown", amount_source: "creation_snapshot" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: known availability (exact) requires all three amount fields", async () => {
  const bookingId = await makeBooking("a1");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, gross_amount_minor: null }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: unknown availability requires all three amount fields null", async () => {
  const batch = await pool.query(
    `INSERT INTO payment_backfill_batches (created_by, source_main_commit) VALUES ('test', '0000000000000000000000000000000000000000') RETURNING id`,
  );
  const bookingId = await makeBooking("a2");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId,
      capture_origin: "historical_backfill", backfill_batch_id: batch.rows[0].id,
      evidence_class: "legacy_operational_status",
      amount_availability: "unknown", amount_source: "unresolvable",
      gross_amount_minor: 100,
      status: "legacy_unverified",
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: a negative gross amount is rejected", async () => {
  const bookingId = await makeBooking("a3");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, gross_amount_minor: -1 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: discount above gross is rejected", async () => {
  const bookingId = await makeBooking("a4");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, gross_amount_minor: 100, discount_amount_minor: 200, final_payable_amount_minor: -100 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: invalid final-payable arithmetic (gross - discount mismatch) is rejected", async () => {
  const bookingId = await makeBooking("a5");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, gross_amount_minor: 1000, discount_amount_minor: 100, final_payable_amount_minor: 999 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("amounts: refunded above paid is rejected", async () => {
  const bookingId = await makeBooking("a6");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId,
      status: "paid", requested_payment_channel: null, confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
      paid_amount_minor: 1000, refunded_amount_minor: 2000,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Payment status matrix (nine statuses) ──────────────────────────────

test("status: unpaid — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st1");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "unpaid" }));
});

test("status: unpaid with a non-zero paid_amount_minor fails", async () => {
  const bookingId = await makeBooking("st1b");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "unpaid", paid_amount_minor: 100 }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: pending_confirmation — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st2");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "pending_confirmation" }));
});

test("status: paid — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st3");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId, status: "paid",
    confirmed_payment_method: "cash", paid_at: new Date().toISOString(), paid_amount_minor: 1000,
  }));
});

test("status: paid without paid_at fails", async () => {
  const bookingId = await makeBooking("st3b");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId, status: "paid",
      confirmed_payment_method: "cash", paid_amount_minor: 1000,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: partially_refunded — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st4");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId, status: "partially_refunded",
    confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
    paid_amount_minor: 1000, refunded_amount_minor: 400,
  }));
});

test("status: partially_refunded with refunded_amount_minor equal to paid fails (must be < paid)", async () => {
  const bookingId = await makeBooking("st4b");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId, status: "partially_refunded",
      confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
      paid_amount_minor: 1000, refunded_amount_minor: 1000,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: refunded — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st5");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId, status: "refunded",
    confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
    paid_amount_minor: 1000, refunded_amount_minor: 1000,
  }));
});

test("status: refunded with paid_amount_minor = 0 fails (must be > 0)", async () => {
  const bookingId = await makeBooking("st5b");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId, status: "refunded",
      confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
      gross_amount_minor: 0, discount_amount_minor: 0, final_payable_amount_minor: 0,
      paid_amount_minor: 0, refunded_amount_minor: 0,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: waived — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st6");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId, status: "waived",
    requested_payment_channel: "complimentary",
    gross_amount_minor: 1000, discount_amount_minor: 1000, final_payable_amount_minor: 0,
  }));
});

test("status: waived with a mismatched gross/discount fails", async () => {
  const bookingId = await makeBooking("st6b");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId, status: "waived",
      requested_payment_channel: "complimentary",
      gross_amount_minor: 1000, discount_amount_minor: 500, final_payable_amount_minor: 500,
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: failed — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st7");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "failed" }));
});

test("status: cancelled — a valid row succeeds", async () => {
  const bookingId = await makeBooking("st8");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "cancelled" }));
});

test("status: legacy_unverified — a valid row succeeds", async () => {
  const batch = await pool.query(
    `INSERT INTO payment_backfill_batches (created_by, source_main_commit) VALUES ('test', '0000000000000000000000000000000000000000') RETURNING id`,
  );
  const bookingId = await makeBooking("st9");
  await assert.doesNotReject(insertPaymentRecord({
    flow_type: "single_class_booking", booking_id: bookingId,
    capture_origin: "historical_backfill", backfill_batch_id: batch.rows[0].id,
    evidence_class: "legacy_operational_status",
    amount_availability: "unknown", amount_source: "unresolvable",
    gross_amount_minor: null, discount_amount_minor: null, final_payable_amount_minor: null,
    status: "legacy_unverified",
  }));
});

test("status: legacy_unverified with live_capture fails (historical rows can never be live)", async () => {
  const bookingId = await makeBooking("st9b");
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId, status: "legacy_unverified" }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

test("status: a historical_backfill row can never be paid or waived", async () => {
  const batch = await pool.query(
    `INSERT INTO payment_backfill_batches (created_by, source_main_commit) VALUES ('test', '0000000000000000000000000000000000000000') RETURNING id`,
  );
  const bookingId = await makeBooking("st10");
  await assert.rejects(
    insertPaymentRecord({
      flow_type: "single_class_booking", booking_id: bookingId,
      capture_origin: "historical_backfill", backfill_batch_id: batch.rows[0].id,
      evidence_class: "legacy_operational_status",
      amount_availability: "estimated_backfill", amount_source: "catalog_price_at_backfill_time",
      status: "paid", confirmed_payment_method: "cash", paid_at: new Date().toISOString(),
    }),
    (err: unknown) => pgErrorCode(err) === "23514",
  );
});

// ─── Unique constraints ──────────────────────────────────────────────────

test("unique: a duplicate package_order source fails", async () => {
  const packageOrderId = await makePackageOrder("u1");
  await insertPaymentRecord({ flow_type: "package_purchase", package_order_id: packageOrderId, booking_id: null });
  await assert.rejects(
    insertPaymentRecord({ flow_type: "package_purchase", package_order_id: packageOrderId, booking_id: null }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("unique: a duplicate booking source fails", async () => {
  const bookingId = await makeBooking("u2");
  await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId });
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingId }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("unique: a duplicate non-null creation_idempotency_key fails", async () => {
  const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bookingA = await makeBooking("u3a");
  const bookingB = await makeBooking("u3b");
  await insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingA, creation_idempotency_key: key });
  await assert.rejects(
    insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingB, creation_idempotency_key: key }),
    (err: unknown) => pgErrorCode(err) === "23505",
  );
});

test("unique: multiple rows with a null creation_idempotency_key succeed", async () => {
  const bookingA = await makeBooking("u4a");
  const bookingB = await makeBooking("u4b");
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingA, creation_idempotency_key: null }));
  await assert.doesNotReject(insertPaymentRecord({ flow_type: "single_class_booking", booking_id: bookingB, creation_idempotency_key: null }));
});
