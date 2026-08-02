import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { isSeatReservedBooking } from "./bookingStatus";

const DATABASE_URL = process.env.DISPOSABLE_ATTENDANCE_REVERSAL_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_attendance_reversal";
const databaseUrl = new URL(DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || !/disposable|test|local/i.test(databaseUrl.pathname) || /railway/i.test(DATABASE_URL)) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = DATABASE_URL;

const NOW = new Date("2026-08-10T12:00:00.000Z");
let pool: typeof import("@workspace/db").pool;
let requestReversal: typeof import("./attendanceReversalService").requestAttendanceReversal;
let approveReversal: typeof import("./attendanceReversalService").approveAttendanceReversal;
let rejectReversal: typeof import("./attendanceReversalService").rejectAttendanceReversal;
let failReversal: typeof import("./attendanceReversalService").failAttendanceReversal;
let completeReversal: typeof import("./attendanceReversalService").completeAttendanceReversal;
let calculateRefund: typeof import("./packageRefundService").calculatePackageRefundEligibility;
let requestRefund: typeof import("./packageRefundService").requestPackageRefund;
let approveRefund: typeof import("./packageRefundService").approvePackageRefund;
let completeRefund: typeof import("./packageRefundService").completePackageRefund;
let expireCredits: typeof import("./packageCreditExpiration").expirePackageOrderCredits;
let studentId: number;
let adminId: number;
let scheduleId: number;
let branchId: number;
let roomId: number;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  ({
    requestAttendanceReversal: requestReversal,
    approveAttendanceReversal: approveReversal,
    rejectAttendanceReversal: rejectReversal,
    failAttendanceReversal: failReversal,
    completeAttendanceReversal: completeReversal,
  } = await import("./attendanceReversalService"));
  ({
    calculatePackageRefundEligibility: calculateRefund,
    requestPackageRefund: requestRefund,
    approvePackageRefund: approveRefund,
    completePackageRefund: completeRefund,
  } = await import("./packageRefundService"));
  ({ expirePackageOrderCredits: expireCredits } = await import("./packageCreditExpiration"));
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  studentId = (await pool.query(`insert into students (name,email,account_type) values ('F2 Student',$1,'student') returning id`, [`f2-${suffix}@example.com`])).rows[0].id;
  adminId = (await pool.query(`insert into system_users (username,email,password_hash,full_name,is_super_admin)
    values ($1,$2,'x','F2 Admin',true) returning id`, [`f2-admin-${suffix}`, `f2-admin-${suffix}@example.com`])).rows[0].id;
  branchId = (await pool.query(`insert into studio_branches (name) values ($1) returning id`, [`F2 Branch ${suffix}`])).rows[0].id;
  roomId = (await pool.query(`insert into studio_rooms (branch_id,name) values ($1,$2) returning id`, [branchId, `F2 Room ${suffix}`])).rows[0].id;
  const classId = (await pool.query(`insert into classes (title,category) values ($1,'Dance') returning id`, [`F2 Class ${suffix}`])).rows[0].id;
  scheduleId = (await pool.query(`insert into schedules (class_id,branch_id,room_id,start_time,end_time) values ($1,$2,$3,'10:00','11:00') returning id`, [classId, branchId, roomId])).rows[0].id;
});
after(async () => { await pool.end(); });

type Fixture = {
  attendanceId: number;
  bookingId: number | null;
  orderId: number;
  lotId: number;
  allocationId: number;
  paymentRecordId: number | null;
};

async function fixture(params: {
  label: string;
  sourceType?: "purchased" | "bonus" | "manual_complimentary" | "manual_paid";
  totalValueMinor?: number;
  allocatedValueMinor?: number;
  valueBasis?: "recorded_purchase_price" | "estimated_catalog_price" | "unknown";
  creditsIssued?: number;
  creditsRemaining?: number;
  expiresAt?: string;
  booking?: boolean;
  paidWalkIn?: boolean;
  payment?: boolean;
}): Promise<Fixture> {
  const sourceType = params.sourceType ?? "purchased";
  const totalValueMinor = params.totalValueMinor ?? (sourceType === "purchased" ? 500 : 0);
  const valueBasis = params.valueBasis ?? (sourceType === "purchased" ? "recorded_purchase_price" : "unknown");
  const creditsIssued = params.creditsIssued ?? 1;
  const creditsRemaining = params.creditsRemaining ?? creditsIssued - 1;
  const allocatedValueMinor = params.allocatedValueMinor ?? (creditsIssued === 1 ? totalValueMinor : Math.floor(totalValueMinor / creditsIssued));
  const expiresAt = params.expiresAt ?? "2026-09-01T00:00:00Z";
  const orderStatus = creditsRemaining === 0 ? "fullyUsed" : "active";
  const orderId = (await pool.query(`insert into package_orders
    (student_name,student_email,student_id,participant_type,package_name,total_credits,remaining_credits,status,expires_at)
    values ('F2 Student',$1,$2,'self',$3,$4,$5,$6,$7) returning id`,
    [`f2-${params.label}-${Date.now()}@example.com`, studentId, params.label, creditsIssued, creditsRemaining, orderStatus, expiresAt])).rows[0].id;
  const bookingId = params.booking === false ? null : (await pool.query(`insert into bookings
    (student_name,student_email,account_owner_student_id,participant_type,booking_scope,schedule_id,package_order_id,status,booking_status,payment_mode)
    values ('F2 Student',$1,$2,'self','self',$3,$4,'attended','attended',$5) returning id`,
    [`f2-${params.label}@example.com`, studentId, scheduleId, orderId, params.paidWalkIn ? "pay_at_studio" : "package_credit"])).rows[0].id;
  const attendanceId = (await pool.query(`insert into attendance
    (student_name,student_email,student_id,participant_type,attendance_source,payment_source,schedule_id,booking_id,package_order_id,credit_deducted,status)
    values ('F2 Student',$1,$2,'self',$3,$4,$5,$6,$7,$8,'checked_in') returning id`, [
      `f2-${params.label}@example.com`, studentId, bookingId == null ? "walk_in" : "booking",
      params.paidWalkIn ? "walk_in_pay_at_studio" : bookingId == null ? "walk_in_package_credit" : "booking_package_credit",
      scheduleId, bookingId, params.paidWalkIn ? null : orderId, !params.paidWalkIn,
    ])).rows[0].id;
  const issuingTransactionId = (await pool.query(`insert into credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,created_by)
    values ($1,$2,'self',$3,$4,0,$4,'test') returning id`,
    [orderId, studentId, sourceType === "bonus" ? "package_bonus" : "package_activated", creditsIssued])).rows[0].id;
  const lotId = (await pool.query(`insert into package_credit_lots
    (package_order_id,source_type,credits_issued,credits_remaining,total_value_minor,value_basis,expires_at,issuing_credit_transaction_id,created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'test') returning id`,
    [orderId, sourceType, creditsIssued, creditsRemaining, totalValueMinor, valueBasis, expiresAt, issuingTransactionId])).rows[0].id;
  const deductionId = (await pool.query(`insert into credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,reference_id,reference_type,booking_id,attendance_id,created_by)
    values ($1,$2,'self','attendance_deduction',-1,$3,$4,$5,$6,$7,$8,'test') returning id`,
    [orderId, studentId, creditsRemaining + 1, creditsRemaining, bookingId ?? attendanceId, bookingId == null ? "attendance" : "booking", bookingId, attendanceId])).rows[0].id;
  const allocationId = (await pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,attendance_id,booking_id,schedule_id,branch_id,room_id,credits,unit_value_minor,total_value_minor,value_basis,policy_version,created_by)
    values ($1,'consumption',$2,$3,$4,$5,$6,$7,$8,1,$9,$9,$10,'test','test') returning id`,
    [lotId, deductionId, orderId, attendanceId, bookingId, scheduleId, branchId, roomId, allocatedValueMinor, valueBasis])).rows[0].id;
  let paymentRecordId: number | null = null;
  if (params.payment) {
    paymentRecordId = (await pool.query(`insert into payment_records
      (flow_type,package_order_id,capture_origin,occurred_at,evidence_class,amount_availability,amount_source,gross_amount_minor,discount_amount_minor,final_payable_amount_minor,paid_amount_minor,refunded_amount_minor,status,paid_at,confirmed_payment_method,confirming_admin_id)
      values ('package_purchase',$1,'live_capture',now(),'confirmed','exact','creation_snapshot',$2,0,$2,$2,0,'paid',now(),'cash',$3) returning id`,
      [orderId, totalValueMinor, adminId])).rows[0].id;
  }
  return { attendanceId, bookingId, orderId, lotId, allocationId, paymentRecordId };
}

async function approved(f: Fixture, params: { requester?: string; approver?: string; now?: Date } = {}) {
  const request = await requestReversal({
    attendanceId: f.attendanceId,
    requestIdempotencyKey: crypto.randomUUID(),
    reasonCode: "recorded_in_error",
    reason: "Attendance was recorded by mistake",
    requestedBy: params.requester ?? "admin:requester",
    now: params.now ?? NOW,
  });
  await approveReversal({ reversalId: request.reversal.id, approvedBy: params.approver ?? "admin:finance", now: params.now ?? NOW });
  return request.reversal.id;
}

test("purchased unexpired completion is append-only, exact, idempotent, and reconciles Booking history", async () => {
  const f = await fixture({ label: "purchased" });
  const reversalId = await approved(f);
  const [first, concurrent] = await Promise.all([
    completeReversal({ reversalId, completedBy: "admin:operator", now: NOW }),
    completeReversal({ reversalId, completedBy: "admin:operator", now: NOW }),
  ]);
  assert.equal(first.reversalAllocationId, concurrent.reversalAllocationId);
  assert.equal(first.restoredLotId, concurrent.restoredLotId);
  const replay = await completeReversal({ reversalId, completedBy: "admin:operator", now: NOW });
  assert.equal(replay.replayed, true);
  const rows = await pool.query(`select
    (select credits_remaining from package_credit_lots where id=$1) original_remaining,
    (select credits_remaining from package_credit_lots where id=$2) restored_remaining,
    (select remaining_credits from package_orders where id=$3) order_remaining,
    (select status from attendance where id=$4) attendance_status,
    (select booking_status from bookings where id=$5) booking_status`, [f.lotId, first.restoredLotId, f.orderId, f.attendanceId, f.bookingId]);
  assert.deepEqual(rows.rows[0], { original_remaining: 0, restored_remaining: 1, order_remaining: 1, attendance_status: "reversed", booking_status: "attendance_reversed" });
  const allocation = await pool.query(`select * from package_credit_allocations where id=$1`, [first.reversalAllocationId]);
  assert.equal(allocation.rows[0].reverses_allocation_id, f.allocationId);
  assert.equal(allocation.rows[0].lot_id, f.lotId);
  assert.equal(allocation.rows[0].total_value_minor, 500);
  assert.equal(allocation.rows[0].branch_id, branchId);
  assert.equal(allocation.rows[0].room_id, roomId);
  assert.equal(isSeatReservedBooking({ bookingStatus: "attendance_reversed" }), true);
});

test("bonus and complimentary reversals remain zero-valued and requester self-approval is allowed", async () => {
  for (const sourceType of ["bonus", "manual_complimentary"] as const) {
    const f = await fixture({ label: sourceType, sourceType });
    const reversalId = await approved(f, { requester: "admin:same", approver: "admin:same" });
    const result = await completeReversal({ reversalId, completedBy: "admin:same", now: NOW });
    const restored = await pool.query(`select source_type,total_value_minor,value_basis from package_credit_lots where id=$1`, [result.restoredLotId]);
    assert.deepEqual(restored.rows[0], { source_type: "restored", total_value_minor: 0, value_basis: "unknown" });
  }
});

test("1000/3 rounding is preserved and restored purchased value becomes refundable exactly once", async () => {
  const f = await fixture({ label: "rounding", totalValueMinor: 1000, allocatedValueMinor: 333, creditsIssued: 3, creditsRemaining: 2, payment: true });
  const reversalId = await approved(f);
  const result = await completeReversal({ reversalId, completedBy: "admin:operator", now: NOW });
  const restored = await pool.query(`select total_value_minor,credits_remaining from package_credit_lots where id=$1`, [result.restoredLotId]);
  assert.deepEqual(restored.rows[0], { total_value_minor: 333, credits_remaining: 1 });
  const refund = await calculateRefund(f.orderId, { now: NOW });
  assert.equal(refund.eligible, true);
  assert.equal(refund.refundableAmountMinor, 1000);
  assert.equal(refund.refundableCredits, 3);
});

test("expired restoration is atomically expired, preserves Branch reversal, and cannot expire twice", async () => {
  const f = await fixture({ label: "expired", expiresAt: "2026-08-01T00:00:00Z", booking: false, payment: true });
  const reversalId = await approved(f);
  const result = await completeReversal({ reversalId, completedBy: "admin:operator", now: NOW });
  assert.equal(result.restoredCreditUsable, false);
  assert.ok(result.expirationCreditTransactionId);
  const state = await pool.query(`select
    (select credits_remaining from package_credit_lots where id=$1) lot_remaining,
    (select remaining_credits from package_orders where id=$2) order_remaining,
    (select status from package_orders where id=$2) order_status,
    (select count(*)::int from package_credit_allocations where lot_id=$1 and event_type='expiration') expirations`, [result.restoredLotId, f.orderId]);
  assert.deepEqual(state.rows[0], { lot_remaining: 0, order_remaining: 0, order_status: "expired", expirations: 1 });
  const reversalAllocation = await pool.query(`select branch_id,total_value_minor from package_credit_allocations where id=$1`, [result.reversalAllocationId]);
  assert.deepEqual(reversalAllocation.rows[0], { branch_id: branchId, total_value_minor: 500 });
  const worker = await expireCredits(f.orderId, { now: NOW });
  assert.equal(worker.alreadyProcessed, true);
  assert.equal((await calculateRefund(f.orderId, { now: NOW })).refundableAmountMinor, 0);
});

test("paid walk-in and manual-paid provenance are blocked without financial or ledger writes", async () => {
  const paid = await fixture({ label: "paid-walkin", paidWalkIn: true });
  await assert.rejects(requestReversal({ attendanceId: paid.attendanceId, requestIdempotencyKey: crypto.randomUUID(), reasonCode: "mistake", reason: "Mistake", requestedBy: "admin" }), /not eligible/i);
  const manual = await fixture({ label: "manual-paid", sourceType: "manual_paid" });
  await assert.rejects(requestReversal({ attendanceId: manual.attendanceId, requestIdempotencyKey: crypto.randomUUID(), reasonCode: "mistake", reason: "Mistake", requestedBy: "admin" }), /not eligible/i);
  assert.equal((await pool.query(`select count(*)::int n from attendance_reversals where attendance_id=any($1)`, [[paid.attendanceId, manual.attendanceId]])).rows[0].n, 0);
});

test("request idempotency and active uniqueness serialize same and distinct keys", async () => {
  const same = await fixture({ label: "same-key" });
  const key = crypto.randomUUID();
  const input = { attendanceId: same.attendanceId, requestIdempotencyKey: key, reasonCode: "mistake", reason: "Mistake", requestedBy: "admin" };
  const [a, b] = await Promise.all([requestReversal(input), requestReversal(input)]);
  assert.equal(a.reversal.id, b.reversal.id);
  const distinct = await fixture({ label: "distinct-key" });
  const attempts = await Promise.allSettled([1, 2].map(() => requestReversal({ ...input, attendanceId: distinct.attendanceId, requestIdempotencyKey: crypto.randomUUID() })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await pool.query(`select count(*)::int n from attendance_reversals where attendance_id=$1 and status in ('requested','approved')`, [distinct.attendanceId])).rows[0].n, 1);
});

test("lifecycle transitions are controlled and financial approval requires a different actor", async () => {
  const financial = await fixture({ label: "separation" });
  const request = await requestReversal({ attendanceId: financial.attendanceId, requestIdempotencyKey: crypto.randomUUID(), reasonCode: "mistake", reason: "Mistake", requestedBy: "admin:same" });
  await assert.rejects(approveReversal({ reversalId: request.reversal.id, approvedBy: "admin:same" }), /different actor/i);
  await assert.rejects(completeReversal({ reversalId: request.reversal.id, completedBy: "admin" }), /approved/i);
  const rejected = await rejectReversal({ reversalId: request.reversal.id, rejectedBy: "admin:reviewer" });
  assert.equal(rejected.reversal.status, "rejected");
  assert.equal((await rejectReversal({ reversalId: request.reversal.id, rejectedBy: "admin:reviewer" })).replayed, true);
  const failedFixture = await fixture({ label: "failed" });
  const failedRequest = await requestReversal({ attendanceId: failedFixture.attendanceId, requestIdempotencyKey: crypto.randomUUID(), reasonCode: "mistake", reason: "Mistake", requestedBy: "admin" });
  assert.equal((await failReversal({ reversalId: failedRequest.reversal.id, failedBy: "admin:reviewer" })).reversal.status, "failed");
});

test("refund completion winning blocks reversal completion without partial writes", async () => {
  const f = await fixture({ label: "refund-wins", totalValueMinor: 1000, allocatedValueMinor: 500, creditsIssued: 2, creditsRemaining: 1, payment: true });
  const reversalId = await approved(f);
  const refund = await requestRefund({ packageOrderId: f.orderId, refundMethod: "cash", requestedReason: "Package cancellation", requestedByAdminId: adminId, requestIdempotencyKey: crypto.randomUUID(), now: NOW });
  await approveRefund({ refundId: refund.refund.id, reviewedByAdminId: adminId, now: NOW });
  await completeRefund({ refundId: refund.refund.id, processedByAdminId: adminId, completionIdempotencyKey: crypto.randomUUID(), transactionReference: crypto.randomUUID(), now: NOW });
  await assert.rejects(completeReversal({ reversalId, completedBy: "admin:operator", now: NOW }), /not eligible/i);
  assert.equal((await pool.query(`select count(*)::int n from credit_transactions where attendance_id=$1 and type='attendance_reversal'`, [f.attendanceId])).rows[0].n, 0);
  assert.equal((await pool.query(`select status from attendance where id=$1`, [f.attendanceId])).rows[0].status, "checked_in");
});

test("reversal winning is visible to Refund while promotional and corrupt ancestry never fabricate value", async () => {
  const purchased = await fixture({ label: "reversal-wins", totalValueMinor: 1000, allocatedValueMinor: 500, creditsIssued: 2, creditsRemaining: 1, payment: true });
  const purchasedResult = await completeReversal({ reversalId: await approved(purchased), completedBy: "admin:operator", now: NOW });
  assert.equal((await calculateRefund(purchased.orderId, { now: NOW })).refundableAmountMinor, 1000);
  await pool.query(`update package_credit_lots set restored_from_allocation_id=$1 where id=$2`, [purchasedResult.reversalAllocationId, purchasedResult.restoredLotId]);
  const corrupt = await calculateRefund(purchased.orderId, { now: NOW });
  assert.equal(corrupt.eligible, false);
  assert.ok(corrupt.integrityWarnings.includes("restored_lot_provenance_invalid"));

  const promotional = await fixture({ label: "promo-refund", sourceType: "bonus" });
  await completeReversal({ reversalId: await approved(promotional, { requester: "admin:same", approver: "admin:same" }), completedBy: "admin:same", now: NOW });
  assert.equal((await calculateRefund(promotional.orderId, { now: NOW })).refundableAmountMinor, 0);
});

test("a state conflict rolls back all completion writes", async () => {
  const f = await fixture({ label: "rollback" });
  const reversalId = await approved(f);
  await pool.query(`update bookings set status='cancelled',booking_status='cancelled' where id=$1`, [f.bookingId]);
  await assert.rejects(completeReversal({ reversalId, completedBy: "admin:operator", now: NOW }), /not eligible|state conflict/i);
  const state = await pool.query(`select
    (select status from attendance_reversals where id=$1) reversal_status,
    (select status from attendance where id=$2) attendance_status,
    (select remaining_credits from package_orders where id=$3) order_remaining,
    (select count(*)::int from credit_transactions where attendance_id=$2 and type='attendance_reversal') restoration_transactions`, [reversalId, f.attendanceId, f.orderId]);
  assert.deepEqual(state.rows[0], { reversal_status: "approved", attendance_status: "checked_in", order_remaining: 0, restoration_transactions: 0 });
});

test("0098 is additive and enforces active reversal uniqueness", () => {
  const migration = readFileSync(resolve("lib/db/migrations/0098_attendance_reversal_lifecycle.sql"), "utf8");
  const journal = JSON.parse(readFileSync(resolve("lib/db/migrations/meta/_journal.json"), "utf8"));
  assert.equal(journal.entries.at(-1).tag, "0098_attendance_reversal_lifecycle");
  assert.match(migration, /attendance_reversals_active_attendance_unique/);
  assert.match(migration, /attendance_reversals_active_consumption_unique/);
  assert.match(migration, /attendance_reversed/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE FROM|INSERT INTO|DROP|TRUNCATE)\b/im);
  assert.doesNotMatch(migration, /CREATE\s+(?:OR REPLACE\s+)?(?:TRIGGER|FUNCTION|PROCEDURE)/i);
});
