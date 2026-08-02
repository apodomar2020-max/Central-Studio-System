import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PACKAGE_REFUND_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_package_refund";

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
let calculatePackageRefundEligibility: typeof import("./packageRefundService").calculatePackageRefundEligibility;
let requestPackageRefund: typeof import("./packageRefundService").requestPackageRefund;
let approvePackageRefund: typeof import("./packageRefundService").approvePackageRefund;
let rejectPackageRefund: typeof import("./packageRefundService").rejectPackageRefund;
let completePackageRefund: typeof import("./packageRefundService").completePackageRefund;
let failPackageRefund: typeof import("./packageRefundService").failPackageRefund;
let expirePackageOrderCredits: typeof import("./packageCreditExpiration").expirePackageOrderCredits;
let studentId: number;
let adminId: number;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  ({
    calculatePackageRefundEligibility,
    requestPackageRefund,
    approvePackageRefund,
    rejectPackageRefund,
    completePackageRefund,
    failPackageRefund,
  } = await import("./packageRefundService"));
  ({ expirePackageOrderCredits } = await import("./packageCreditExpiration"));
  const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Refund Student', $1, '0100000000', 'student') RETURNING id`,
    [`refund-${run}@example.com`],
  );
  studentId = student.rows[0].id as number;
  const admin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Refund Admin', true) RETURNING id`,
    [`refund-admin-${run}`, `refund-admin-${run}@example.com`],
  );
  adminId = admin.rows[0].id as number;
});

after(async () => { await pool.end(); });

async function makePackage(params: {
  label: string;
  paidAmountMinor: number;
  lots: Array<{
    sourceType?: "purchased" | "bonus" | "manual_complimentary" | "manual_paid" | "legacy_unknown";
    creditsIssued: number;
    creditsRemaining?: number;
    totalValueMinor: number | null;
    valueBasis?: "recorded_purchase_price" | "estimated_catalog_price" | "unknown";
    expiresAt?: string | null;
  }>;
}): Promise<{ orderId: number; lotIds: number[]; paymentRecordId: number }> {
  const remainingCredits = params.lots.reduce((sum, lot) => sum + (lot.creditsRemaining ?? lot.creditsIssued), 0);
  const totalCredits = params.lots.reduce((sum, lot) => sum + lot.creditsIssued, 0);
  const order = await pool.query(
    `INSERT INTO package_orders
       (student_name, student_email, student_id, package_name, total_credits, remaining_credits,
        status, participant_type, expires_at)
     VALUES ('Refund Student', $1, $2, $3, $4, $5, 'active', 'self', '2026-09-01T12:00:00Z') RETURNING id`,
    [`refund-${params.label}-${Date.now()}@example.com`, studentId, params.label, totalCredits, remainingCredits],
  );
  const orderId = order.rows[0].id as number;
  const payment = await pool.query(
    `INSERT INTO payment_records
       (flow_type, package_order_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, refunded_amount_minor,
        status, paid_at, confirmed_payment_method, confirming_admin_id)
     VALUES ('package_purchase', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot',
             $2, 0, $2, $2, 0, 'paid', now(), 'cash', $3) RETURNING id`,
    [orderId, params.paidAmountMinor, adminId],
  );
  const lotIds: number[] = [];
  for (const [index, lot] of params.lots.entries()) {
    const transaction = await pool.query(
      `INSERT INTO credit_transactions
         (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
       VALUES ($1, $2, 'self', $3, $4, 0, $4, 'test') RETURNING id`,
      [orderId, studentId, index === 0 ? "package_activated" : "package_bonus", lot.creditsIssued],
    );
    const inserted = await pool.query(
      `INSERT INTO package_credit_lots
         (package_order_id, source_type, credits_issued, credits_remaining, total_value_minor, value_basis,
          expires_at, issuing_credit_transaction_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test') RETURNING id`,
      [
        orderId,
        lot.sourceType ?? "purchased",
        lot.creditsIssued,
        lot.creditsRemaining ?? lot.creditsIssued,
        lot.totalValueMinor,
        lot.valueBasis ?? (lot.totalValueMinor == null ? "unknown" : "recorded_purchase_price"),
        lot.expiresAt === undefined ? "2026-09-01T12:00:00Z" : lot.expiresAt,
        transaction.rows[0].id,
      ],
    );
    lotIds.push(inserted.rows[0].id as number);
  }
  return { orderId, lotIds, paymentRecordId: payment.rows[0].id as number };
}

test("full unused purchased package returns its complete paid value", async () => {
  const fixture = await makePackage({ label: "full", paidAmountMinor: 1200, lots: [{ creditsIssued: 4, totalValueMinor: 1200 }] });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.refundableAmountMinor, 1200);
  assert.equal(result.refundableCredits, 4);
  assert.equal(result.refundableLots.length, 1);
  assert.deepEqual(result.integrityWarnings, []);
});

test("partial consumption refunds only the exact unconsumed tail", async () => {
  const fixture = await makePackage({
    label: "partial",
    paidAmountMinor: 1200,
    lots: [{ creditsIssued: 4, creditsRemaining: 2, totalValueMinor: 1200 }],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.refundableAmountMinor, 600);
  assert.equal(result.refundableLots[0].consumedCredits, 2);
});

test("1000 minor units across three credits leaves the exact 667 remainder", async () => {
  const fixture = await makePackage({
    label: "rounding",
    paidAmountMinor: 1000,
    lots: [{ creditsIssued: 3, creditsRemaining: 2, totalValueMinor: 1000 }],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.refundableAmountMinor, 667);
});

test("bonus lots are excluded from refundable value", async () => {
  const fixture = await makePackage({
    label: "bonus",
    paidAmountMinor: 1000,
    lots: [
      { creditsIssued: 2, totalValueMinor: 1000 },
      { sourceType: "bonus", creditsIssued: 2, totalValueMinor: 0, valueBasis: "unknown" },
    ],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.refundableAmountMinor, 1000);
  assert.equal(result.excludedLots.length, 1);
  assert.equal(result.excludedLots[0].reason, "bonus");
});

test("expired purchased lots are excluded", async () => {
  const fixture = await makePackage({
    label: "expired",
    paidAmountMinor: 1000,
    lots: [{ creditsIssued: 2, totalValueMinor: 1000, expiresAt: "2026-08-01T12:00:00Z" }],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.refundableAmountMinor, 0);
  assert.equal(result.excludedLots[0].reason, "expired");
  assert.ok(result.integrityWarnings.includes("no_refundable_value"));
});

test("unknown purchased value is excluded without estimation", async () => {
  const fixture = await makePackage({
    label: "unknown",
    paidAmountMinor: 1000,
    lots: [{ creditsIssued: 2, totalValueMinor: null, valueBasis: "unknown" }],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.refundableAmountMinor, 0);
  assert.equal(result.excludedLots[0].reason, "unknown_value");
});

test("refund eligibility fails rather than truncating value above payment capacity", async () => {
  const fixture = await makePackage({
    label: "capacity",
    paidAmountMinor: 900,
    lots: [{ creditsIssued: 2, totalValueMinor: 1000 }],
  });
  const result = await calculatePackageRefundEligibility(fixture.orderId, { now: NOW });
  assert.equal(result.refundableAmountMinor, 1000);
  assert.equal(result.paymentCapacityMinor, 900);
  assert.equal(result.eligible, false);
  assert.ok(result.integrityWarnings.includes("refundable_value_exceeds_payment_capacity"));
});

test("migration enforces refund idempotency and refund-retirement linkage", async () => {
  const fixture = await makePackage({ label: "constraints", paidAmountMinor: 500, lots: [{ creditsIssued: 1, totalValueMinor: 500 }] });
  const keySuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const key = `request-${keySuffix}`;
  const completionKey = `completion-${keySuffix}`;
  const refund = await pool.query(
    `INSERT INTO payment_refunds
       (payment_record_id, requested_amount_minor, refund_method, requested_reason,
        request_idempotency_key, completion_idempotency_key)
     VALUES ($1, 500, 'cash', 'test', $2, $3) RETURNING id`,
    [fixture.paymentRecordId, key, completionKey],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO payment_refunds
         (payment_record_id, requested_amount_minor, refund_method, requested_reason, request_idempotency_key)
       VALUES ($1, 500, 'cash', 'duplicate', $2)`,
      [fixture.paymentRecordId, key],
    ),
    (error: unknown) => (error as { code?: string }).code === "23505",
  );
  const retirementTx = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_refund_retirement', -1, 1, 0, 'test') RETURNING id`,
    [fixture.orderId, studentId],
  );
  const values = [fixture.lotIds[0], retirementTx.rows[0].id, fixture.orderId];
  await assert.rejects(
    pool.query(
      `INSERT INTO package_credit_allocations
         (lot_id, event_type, credit_transaction_id, package_order_id, credits, total_value_minor,
          value_basis, policy_version, created_by)
       VALUES ($1, 'refund_retirement', $2, $3, 1, 500, 'recorded_purchase_price', 'test', 'test')`,
      values,
    ),
    (error: unknown) => (error as { code?: string }).code === "23514",
  );
  await assert.doesNotReject(pool.query(
    `INSERT INTO package_credit_allocations
       (lot_id, event_type, credit_transaction_id, package_order_id, payment_refund_id, credits,
        total_value_minor, value_basis, policy_version, created_by)
     VALUES ($1, 'refund_retirement', $2, $3, $4, 1, 500, 'recorded_purchase_price', 'test', 'test')`,
    [...values, refund.rows[0].id],
  ));

  const secondFixture = await makePackage({ label: "constraint-keys", paidAmountMinor: 500, lots: [{ creditsIssued: 1, totalValueMinor: 500 }] });
  await assert.rejects(
    pool.query(
      `INSERT INTO payment_refunds
         (payment_record_id, requested_amount_minor, refund_method, requested_reason, completion_idempotency_key)
       VALUES ($1, 500, 'cash', 'duplicate completion', $2)`,
      [secondFixture.paymentRecordId, completionKey],
    ),
    (error: unknown) => (error as { code?: string }).code === "23505",
  );

  const duplicateRetirementTx = await pool.query(
    `INSERT INTO credit_transactions
       (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_refund_retirement', -1, 1, 0, 'test') RETURNING id`,
    [fixture.orderId, studentId],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO package_credit_allocations
         (lot_id, event_type, credit_transaction_id, package_order_id, payment_refund_id, credits,
          total_value_minor, value_basis, policy_version, created_by)
       VALUES ($1, 'refund_retirement', $2, $3, $4, 1, 500, 'recorded_purchase_price', 'test', 'test')`,
      [fixture.lotIds[0], duplicateRetirementTx.rows[0].id, fixture.orderId, refund.rows[0].id],
    ),
    (error: unknown) => (error as { code?: string }).code === "23505",
  );
  await assert.rejects(
    pool.query(`DELETE FROM payment_refunds WHERE id = $1`, [refund.rows[0].id]),
    (error: unknown) => (error as { code?: string }).code === "23001",
  );
});

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestAndApprove(orderId: number) {
  const requested = await requestPackageRefund({
    packageOrderId: orderId,
    refundMethod: "cash",
    requestedReason: "Package refund test",
    requestedByAdminId: adminId,
    requestIdempotencyKey: uniqueKey("request"),
    now: NOW,
  });
  const approved = await approvePackageRefund({ refundId: requested.refund.id, reviewedByAdminId: adminId, now: NOW });
  return { requested, approved };
}

test("request and approval do not change credits", async () => {
  const fixture = await makePackage({ label: "lifecycle-request", paidAmountMinor: 1000, lots: [{ creditsIssued: 2, totalValueMinor: 1000 }] });
  const requested = await requestPackageRefund({
    packageOrderId: fixture.orderId,
    refundMethod: "cash",
    requestedReason: "No mutation before payout",
    requestedByAdminId: adminId,
    requestIdempotencyKey: uniqueKey("request-no-write"),
    now: NOW,
  });
  assert.equal(requested.refund.status, "underReview");
  let state = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [fixture.orderId]);
  assert.deepEqual(state.rows[0], { remaining_credits: 2, status: "active" });
  const approved = await approvePackageRefund({ refundId: requested.refund.id, reviewedByAdminId: adminId, now: NOW });
  assert.equal(approved.refund.status, "approved");
  state = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [fixture.orderId]);
  assert.deepEqual(state.rows[0], { remaining_credits: 2, status: "active" });
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE payment_refund_id = $1`, [requested.refund.id])).rows[0].n, 0);
});

test("rejection does not change credits", async () => {
  const fixture = await makePackage({ label: "lifecycle-reject", paidAmountMinor: 500, lots: [{ creditsIssued: 1, totalValueMinor: 500 }] });
  const requested = await requestPackageRefund({
    packageOrderId: fixture.orderId,
    refundMethod: "cash",
    requestedReason: "Reject test",
    requestedByAdminId: adminId,
    requestIdempotencyKey: uniqueKey("request-reject"),
    now: NOW,
  });
  const rejected = await rejectPackageRefund({ refundId: requested.refund.id, reviewedByAdminId: adminId, now: NOW });
  assert.equal(rejected.refund.status, "rejected");
  assert.equal((await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [fixture.orderId])).rows[0].remaining_credits, 1);
  assert.equal((await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [fixture.lotIds[0]])).rows[0].credits_remaining, 1);
});

test("failed payout does not change credits", async () => {
  const fixture = await makePackage({ label: "lifecycle-fail", paidAmountMinor: 500, lots: [{ creditsIssued: 1, totalValueMinor: 500 }] });
  const { approved } = await requestAndApprove(fixture.orderId);
  const failed = await failPackageRefund({ refundId: approved.refund.id, processedByAdminId: adminId, failedReason: "External payout failed", now: NOW });
  assert.equal(failed.refund.status, "failed");
  assert.equal((await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [fixture.orderId])).rows[0].remaining_credits, 1);
});

test("completion retires all entitlement but refunds only recorded purchased value", async () => {
  const fixture = await makePackage({
    label: "lifecycle-complete",
    paidAmountMinor: 1000,
    lots: [
      { creditsIssued: 2, totalValueMinor: 1000 },
      { sourceType: "bonus", creditsIssued: 1, totalValueMinor: 0, valueBasis: "unknown" },
      { sourceType: "manual_complimentary", creditsIssued: 1, totalValueMinor: 0, valueBasis: "unknown" },
      { sourceType: "legacy_unknown", creditsIssued: 1, totalValueMinor: null, valueBasis: "unknown" },
    ],
  });
  const { approved } = await requestAndApprove(fixture.orderId);
  const completed = await completePackageRefund({
    refundId: approved.refund.id,
    processedByAdminId: adminId,
    completionIdempotencyKey: uniqueKey("complete"),
    transactionReference: uniqueKey("cash-ref"),
    now: NOW,
  });
  assert.equal(completed.refund.refundedAmountMinor, 1000);
  assert.equal(completed.retiredCredits, 5);
  assert.equal(completed.allocations, 4);
  const order = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [fixture.orderId]);
  assert.deepEqual(order.rows[0], { remaining_credits: 0, status: "cancelled" });
  const lots = await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE package_order_id = $1 ORDER BY id`, [fixture.orderId]);
  assert.deepEqual(lots.rows.map((row) => row.credits_remaining), [0, 0, 0, 0]);
  const allocations = await pool.query(
    `SELECT total_value_minor, credits FROM package_credit_allocations WHERE payment_refund_id = $1 ORDER BY id`,
    [approved.refund.id],
  );
  assert.deepEqual(allocations.rows.map((row) => row.total_value_minor), [1000, 0, 0, 0]);
  assert.equal(allocations.rows.reduce((sum, row) => sum + row.credits, 0), 5);
  const payment = await pool.query(`SELECT refunded_amount_minor, status FROM payment_records WHERE id = $1`, [completed.refund.paymentRecordId]);
  assert.deepEqual(payment.rows[0], { refunded_amount_minor: 1000, status: "refunded" });
});

test("completion preserves the exact 667 remainder for 1000 across three credits", async () => {
  const fixture = await makePackage({ label: "complete-rounding", paidAmountMinor: 1000, lots: [{ creditsIssued: 3, creditsRemaining: 2, totalValueMinor: 1000 }] });
  const { approved } = await requestAndApprove(fixture.orderId);
  const completed = await completePackageRefund({
    refundId: approved.refund.id,
    processedByAdminId: adminId,
    completionIdempotencyKey: uniqueKey("complete-rounding"),
    transactionReference: uniqueKey("rounding-ref"),
    now: NOW,
  });
  assert.equal(completed.refund.refundedAmountMinor, 667);
  const allocation = await pool.query(`SELECT credits, total_value_minor FROM package_credit_allocations WHERE payment_refund_id = $1`, [approved.refund.id]);
  assert.deepEqual(allocation.rows[0], { credits: 2, total_value_minor: 667 });
  const payment = await pool.query(`SELECT refunded_amount_minor, status FROM payment_records WHERE id = $1`, [completed.refund.paymentRecordId]);
  assert.deepEqual(payment.rows[0], { refunded_amount_minor: 667, status: "partially_refunded" });
});

test("duplicate and concurrent completion create one retirement only", async () => {
  const fixture = await makePackage({ label: "complete-idempotent", paidAmountMinor: 600, lots: [{ creditsIssued: 2, totalValueMinor: 600 }] });
  const { approved } = await requestAndApprove(fixture.orderId);
  const completionIdempotencyKey = uniqueKey("complete-concurrent");
  const transactionReference = uniqueKey("concurrent-ref");
  const attempts = await Promise.all([
    completePackageRefund({ refundId: approved.refund.id, processedByAdminId: adminId, completionIdempotencyKey, transactionReference, now: NOW }),
    completePackageRefund({ refundId: approved.refund.id, processedByAdminId: adminId, completionIdempotencyKey, transactionReference, now: NOW }),
  ]);
  assert.deepEqual(attempts.map((attempt) => attempt.replayed).sort(), [false, true]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE payment_refund_id = $1`, [approved.refund.id])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE payment_refund_id = $1`, [approved.refund.id])).rows[0].n, 1);
  const retry = await completePackageRefund({ refundId: approved.refund.id, processedByAdminId: adminId, completionIdempotencyKey, transactionReference, now: NOW });
  assert.equal(retry.replayed, true);
});

test("refund completion and expiration serialize without double retirement", async () => {
  const fixture = await makePackage({ label: "expiration-race", paidAmountMinor: 700, lots: [{ creditsIssued: 1, totalValueMinor: 700 }] });
  const { approved } = await requestAndApprove(fixture.orderId);
  await pool.query(`UPDATE package_orders SET expires_at = '2026-08-02T23:00:00Z' WHERE id = $1`, [fixture.orderId]);
  await pool.query(`UPDATE package_credit_lots SET expires_at = '2026-08-02T23:00:00Z' WHERE package_order_id = $1`, [fixture.orderId]);
  const completion = completePackageRefund({
    refundId: approved.refund.id,
    processedByAdminId: adminId,
    completionIdempotencyKey: uniqueKey("race-complete"),
    transactionReference: uniqueKey("race-ref"),
    now: new Date("2026-08-02T12:00:00Z"),
  });
  const expiration = expirePackageOrderCredits(fixture.orderId, { now: new Date("2026-08-04T12:00:00Z") });
  const outcomes = await Promise.allSettled([completion, expiration]);
  assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
  const allocations = await pool.query(
    `SELECT event_type, count(*)::int AS n FROM package_credit_allocations WHERE package_order_id = $1 GROUP BY event_type`,
    [fixture.orderId],
  );
  assert.equal(allocations.rows.reduce((sum, row) => sum + row.n, 0), 1);
  assert.ok(["refund_retirement", "expiration"].includes(allocations.rows[0].event_type));
  assert.equal((await pool.query(`SELECT credits_remaining FROM package_credit_lots WHERE id = $1`, [fixture.lotIds[0]])).rows[0].credits_remaining, 0);
});

test("completion cannot exceed paid amount after eligibility changes", async () => {
  const fixture = await makePackage({ label: "complete-capacity", paidAmountMinor: 1000, lots: [{ creditsIssued: 2, totalValueMinor: 1000 }] });
  const { approved } = await requestAndApprove(fixture.orderId);
  await pool.query(
    `UPDATE payment_records SET gross_amount_minor = 900, final_payable_amount_minor = 900, paid_amount_minor = 900 WHERE id = $1`,
    [approved.refund.paymentRecordId],
  );
  await assert.rejects(
    completePackageRefund({
      refundId: approved.refund.id,
      processedByAdminId: adminId,
      completionIdempotencyKey: uniqueKey("capacity-complete"),
      transactionReference: uniqueKey("capacity-ref"),
      now: NOW,
    }),
    (error: unknown) => (error as { code?: string }).code === "PACKAGE_REFUND_NOT_ELIGIBLE",
  );
  assert.equal((await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [fixture.orderId])).rows[0].remaining_credits, 2);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM package_credit_allocations WHERE payment_refund_id = $1`, [approved.refund.id])).rows[0].n, 0);
});
