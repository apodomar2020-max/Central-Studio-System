import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ATTENDANCE_REVERSAL_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_attendance_reversal";
const url = new URL(DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/disposable|test|local/i.test(url.pathname) || /railway/i.test(DATABASE_URL)) {
  throw new Error("Refusing non-disposable database");
}
process.env.DATABASE_URL = DATABASE_URL;

const NOW = new Date("2026-08-10T12:00:00.000Z");
let pool: typeof import("@workspace/db").pool;
let calculate: typeof import("./attendanceReversalService").calculateAttendanceReversalEligibility;
let studentId: number;
let branchId: number;
let roomId: number;
let scheduleId: number;

before(async () => {
  pool = (await import("@workspace/db")).pool;
  calculate = (await import("./attendanceReversalService")).calculateAttendanceReversalEligibility;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  studentId = (await pool.query(`insert into students (name,email,account_type) values ('F1 Student',$1,'student') returning id`, [`f1-${suffix}@example.com`])).rows[0].id;
  branchId = (await pool.query(`insert into studio_branches (name) values ($1) returning id`, [`F1 Branch ${suffix}`])).rows[0].id;
  roomId = (await pool.query(`insert into studio_rooms (branch_id,name) values ($1,$2) returning id`, [branchId, `F1 Room ${suffix}`])).rows[0].id;
  const classId = (await pool.query(`insert into classes (title,category) values ($1,'Dance') returning id`, [`F1 Class ${suffix}`])).rows[0].id;
  scheduleId = (await pool.query(`insert into schedules (class_id,branch_id,room_id,start_time,end_time) values ($1,$2,$3,'10:00','11:00') returning id`, [classId, branchId, roomId])).rows[0].id;
});
after(async () => { await pool.end(); });

type Fixture = { attendanceId: number; orderId: number; lotId: number; allocationId: number; deductionId: number; bookingId: number | null };
async function fixture(params: {
  label: string;
  sourceType?: string;
  totalValueMinor?: number | null;
  valueBasis?: string;
  expiresAt?: string | null;
  paymentSource?: string;
  booking?: boolean;
  orderStatus?: string;
}): Promise<Fixture> {
  const sourceType = params.sourceType ?? "purchased";
  const totalValueMinor = params.totalValueMinor === undefined ? 500 : params.totalValueMinor;
  const valueBasis = params.valueBasis ?? (totalValueMinor == null ? "unknown" : "recorded_purchase_price");
  const order = await pool.query(`insert into package_orders
    (student_name,student_email,student_id,participant_type,package_name,total_credits,remaining_credits,status,expires_at)
    values ('F1 Student',$1,$2,'self',$3,1,0,$4,$5) returning id`,
    [`f1-${params.label}-${Date.now()}@example.com`, studentId, params.label, params.orderStatus ?? "fullyUsed", params.expiresAt ?? "2026-09-01T00:00:00Z"]);
  const orderId = order.rows[0].id as number;
  const bookingId = params.booking ? (await pool.query(`insert into bookings
    (student_name,student_email,account_owner_student_id,participant_type,booking_scope,schedule_id,package_order_id,status,booking_status,payment_mode)
    values ('F1 Student',$1,$2,'self','self',$3,$4,'attended','attended','package_credit') returning id`,
    [`f1-${params.label}@example.com`, studentId, scheduleId, orderId])).rows[0].id as number : null;
  const attendanceId = (await pool.query(`insert into attendance
    (student_name,student_email,student_id,participant_type,attendance_source,payment_source,schedule_id,booking_id,package_order_id,credit_deducted,status)
    values ('F1 Student',$1,$2,'self',$3,$4,$5,$6,$7,$8,'checked_in') returning id`, [
      `f1-${params.label}@example.com`, studentId, bookingId ? "booking" : "walk_in",
      params.paymentSource ?? (bookingId ? "booking_package_credit" : "walk_in_package_credit"), scheduleId, bookingId, orderId,
      (params.paymentSource ?? "").includes("pay_at_studio") ? false : true,
    ])).rows[0].id as number;
  const issuingId = (await pool.query(`insert into credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,created_by)
    values ($1,$2,'self',$3,1,0,1,'test') returning id`, [orderId, studentId, sourceType === "bonus" ? "package_bonus" : "package_activated"])).rows[0].id;
  const lotId = (await pool.query(`insert into package_credit_lots
    (package_order_id,source_type,credits_issued,credits_remaining,total_value_minor,value_basis,expires_at,issuing_credit_transaction_id,created_by)
    values ($1,$2,1,0,$3,$4,$5,$6,'test') returning id`, [orderId, sourceType, totalValueMinor, valueBasis, params.expiresAt ?? "2026-09-01T00:00:00Z", issuingId])).rows[0].id as number;
  const deductionId = (await pool.query(`insert into credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,reference_id,reference_type,booking_id,attendance_id,created_by)
    values ($1,$2,'self','attendance_deduction',-1,1,0,$3,$4,$5,$6,'test') returning id`,
    [orderId, studentId, bookingId ?? attendanceId, bookingId ? "booking" : "attendance", bookingId, attendanceId])).rows[0].id as number;
  const allocationId = (await pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,attendance_id,booking_id,schedule_id,branch_id,room_id,credits,unit_value_minor,total_value_minor,value_basis,policy_version,created_by)
    values ($1,'consumption',$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,'test','test') returning id`,
    [lotId, deductionId, orderId, attendanceId, bookingId, scheduleId, branchId, roomId, totalValueMinor, totalValueMinor ?? 0, valueBasis])).rows[0].id as number;
  return { attendanceId, orderId, lotId, allocationId, deductionId, bookingId };
}

test("normal purchased attendance returns exact value and historical branch/room", async () => {
  const f = await fixture({ label: "normal", booking: true });
  const result = await calculate(f.attendanceId, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.originalAllocatedValueMinor, 500);
  assert.equal(result.branchId, branchId);
  assert.equal(result.roomId, roomId);
  assert.equal(result.futureRefundEligibilityClassification, "purchased_recorded");
  assert.deepEqual(result.requiredPermissions, ["attendance.reverse", "finance.refundsManage"]);
  assert.equal(result.bookingEffectPreview, "booking_attendance_reversal_required");
});

test("bonus attendance is eligible, zero-valued and promotional", async () => {
  const f = await fixture({ label: "bonus", sourceType: "bonus", totalValueMinor: 0, valueBasis: "unknown" });
  const result = await calculate(f.attendanceId, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.originalAllocatedValueMinor, 0);
  assert.equal(result.futureRefundEligibilityClassification, "bonus_zero_value");
  assert.deepEqual(result.requiredPermissions, ["attendance.reverse"]);
});

test("restored credit preserves purchased provenance", async () => {
  const root = await fixture({ label: "root" });
  const target = await fixture({ label: "restored", sourceType: "restored" });
  await pool.query(`update package_credit_lots set restored_from_allocation_id=$1 where id=$2`, [root.allocationId, target.lotId]);
  const result = await calculate(target.attendanceId, { now: NOW });
  assert.equal(result.futureRefundEligibilityClassification, "restored_from_purchased");
  assert.equal(result.paymentBackedProvenance?.cashBacked, true);
  assert.equal(result.paymentBackedProvenance?.rootLotId, root.lotId);
});

test("expiry is preserved and an expired restoration requires immediate expiration", async () => {
  const current = await fixture({ label: "current", expiresAt: "2026-09-01T00:00:00Z" });
  const expired = await fixture({ label: "expired", expiresAt: "2026-08-01T00:00:00Z" });
  assert.deepEqual((await calculate(current.attendanceId, { now: NOW })).requiresImmediateExpiration, false);
  const result = await calculate(expired.attendanceId, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.restoredCreditUsable, false);
  assert.equal(result.requiresImmediateExpiration, true);
  assert.equal(new Date(result.originalExpiresAt!).toISOString(), "2026-08-01T00:00:00.000Z");
});

test("paid walk-in and missing allocation return controlled results", async () => {
  const paid = await fixture({ label: "paid", paymentSource: "walk_in_pay_at_studio" });
  assert.equal((await calculate(paid.attendanceId)).nonEligibilityReason, "paid_direct_walkin");
  const missingId = (await pool.query(`insert into attendance
    (student_name,student_email,student_id,participant_type,attendance_source,payment_source,package_order_id,credit_deducted,status)
    values ('F1 Student','missing@example.com',$1,'self','walk_in','walk_in_package_credit',$2,true,'checked_in') returning id`, [studentId, paid.orderId])).rows[0].id;
  assert.equal((await calculate(missingId)).nonEligibilityReason, "missing_consumption_allocation");
});

test("legacy booking-deduction-only attendance requires manual review", async () => {
  const f = await fixture({ label: "legacy-booking", booking: true });
  await pool.query(`delete from package_credit_allocations where id=$1`, [f.allocationId]);
  await pool.query(`update credit_transactions set type='booking_deduction' where id=$1`, [f.deductionId]);
  const result = await calculate(f.attendanceId);
  assert.equal(result.eligible, false);
  assert.equal(result.nonEligibilityReason, "legacy_booking_deduction_only");
});

test("manual-paid and refund-cancelled packages are blocked", async () => {
  const manual = await fixture({ label: "manual", sourceType: "manual_paid" });
  assert.equal((await calculate(manual.attendanceId)).nonEligibilityReason, "manual_paid_unsupported");
  const cancelled = await fixture({ label: "cancelled", orderStatus: "cancelled" });
  assert.equal((await calculate(cancelled.attendanceId)).nonEligibilityReason, "package_refund_cancelled");
});

test("active prior reversal produces controlled already-reversed result", async () => {
  const f = await fixture({ label: "prior" });
  await pool.query(`insert into attendance_reversals
    (attendance_id,original_consumption_allocation_id,package_order_id,status,request_idempotency_key,reason_code,reason,requested_by)
    values ($1,$2,$3,'requested',$4,'mistake','Recorded in error','admin:test')`, [f.attendanceId, f.allocationId, f.orderId, crypto.randomUUID()]);
  assert.equal((await calculate(f.attendanceId)).nonEligibilityReason, "already_reversed");
});

test("database enforces idempotency, completion shape and completed uniqueness", async () => {
  const f = await fixture({ label: "constraints" });
  const key = crypto.randomUUID();
  const insertRequested = `insert into attendance_reversals
    (attendance_id,original_consumption_allocation_id,package_order_id,status,request_idempotency_key,reason_code,reason,requested_by)
    values ($1,$2,$3,'requested',$4,'mistake','Recorded in error','admin:test')`;
  await pool.query(insertRequested, [f.attendanceId, f.allocationId, f.orderId, key]);
  await assert.rejects(pool.query(insertRequested, [f.attendanceId, f.allocationId, f.orderId, key]), (e: unknown) => (e as { code?: string }).code === "23505");
  await assert.rejects(pool.query(`insert into attendance_reversals
    (attendance_id,original_consumption_allocation_id,package_order_id,status,request_idempotency_key,reason_code,reason,requested_by,completed_by,completed_at)
    values ($1,$2,$3,'completed',$4,'mistake','Recorded in error','admin:test','admin:test',now())`,
    [f.attendanceId, f.allocationId, f.orderId, crypto.randomUUID()]), (e: unknown) => (e as { code?: string }).code === "23514");
  const completed = `insert into attendance_reversals
    (attendance_id,original_consumption_allocation_id,package_order_id,status,request_idempotency_key,reason_code,reason,requested_by,completed_by,completed_at,resulting_credit_transaction_id,resulting_reversal_allocation_id,resulting_restored_lot_id)
    values ($1,$2,$3,'completed',$4,'mistake','Recorded in error','admin:test','admin:test',now(),$5,$6,$7)`;
  await pool.query(completed, [f.attendanceId, f.allocationId, f.orderId, crypto.randomUUID(), f.deductionId, f.allocationId, f.lotId]);
  await assert.rejects(pool.query(completed, [f.attendanceId, f.allocationId, f.orderId, crypto.randomUUID(), f.deductionId, f.allocationId, f.lotId]), (e: unknown) => (e as { code?: string }).code === "23505");
});

test("allocation reversal linkage constraints and uniqueness are enforced", async () => {
  const f = await fixture({ label: "allocation-constraints" });
  const makeTx = async () => (await pool.query(`insert into credit_transactions
    (package_order_id,student_id,participant_type,type,delta,balance_before,balance_after,created_by)
    values ($1,$2,'self','attendance_reversal',1,0,1,'test') returning id`, [f.orderId, studentId])).rows[0].id;
  const nonReversalTx = await makeTx();
  await assert.rejects(pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,credits,total_value_minor,value_basis,policy_version,reverses_allocation_id,created_by)
    values ($1,'expiration',$2,$3,1,0,'unknown','test',$4,'test')`, [f.lotId, nonReversalTx, f.orderId, f.allocationId]), (e: unknown) => (e as { code?: string }).code === "23514");
  const missingLinkTx = await makeTx();
  await assert.rejects(pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,credits,total_value_minor,value_basis,policy_version,created_by)
    values ($1,'reversal',$2,$3,1,500,'recorded_purchase_price','test','test')`, [f.lotId, missingLinkTx, f.orderId]), (e: unknown) => (e as { code?: string }).code === "23514");
  const payment = await pool.query(`insert into payment_records
    (flow_type,package_order_id,capture_origin,occurred_at,evidence_class,amount_availability,amount_source,gross_amount_minor,discount_amount_minor,final_payable_amount_minor,paid_amount_minor,status)
    values ('package_purchase',$1,'live_capture',now(),'confirmed','exact','creation_snapshot',500,0,500,0,'unpaid') returning id`, [f.orderId]);
  const refund = await pool.query(`insert into payment_refunds (payment_record_id,requested_amount_minor,refund_method,requested_reason) values ($1,500,'cash','test') returning id`, [payment.rows[0].id]);
  const refundLinkTx = await makeTx();
  await assert.rejects(pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,payment_refund_id,credits,total_value_minor,value_basis,policy_version,reverses_allocation_id,created_by)
    values ($1,'reversal',$2,$3,$4,1,500,'recorded_purchase_price','test',$5,'test')`, [f.lotId, refundLinkTx, f.orderId, refund.rows[0].id, f.allocationId]), (e: unknown) => (e as { code?: string }).code === "23514");
  const firstTx = await makeTx();
  await pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,attendance_id,credits,total_value_minor,value_basis,policy_version,reverses_allocation_id,created_by)
    values ($1,'reversal',$2,$3,$4,1,500,'recorded_purchase_price','test',$5,'test')`, [f.lotId, firstTx, f.orderId, f.attendanceId, f.allocationId]);
  const duplicateTx = await makeTx();
  await assert.rejects(pool.query(`insert into package_credit_allocations
    (lot_id,event_type,credit_transaction_id,package_order_id,credits,total_value_minor,value_basis,policy_version,reverses_allocation_id,created_by)
    values ($1,'reversal',$2,$3,1,500,'recorded_purchase_price','test',$4,'test')`, [f.lotId, duplicateTx, f.orderId, f.allocationId]), (e: unknown) => (e as { code?: string }).code === "23505");
});

test("migration is additive, journaled, and all new foreign keys restrict deletion", () => {
  const migration = readFileSync(resolve("lib/db/migrations/0097_attendance_reversal_foundation.sql"), "utf8");
  const journal = JSON.parse(readFileSync(resolve("lib/db/migrations/meta/_journal.json"), "utf8"));
  assert.equal(journal.entries.at(-1).tag, "0097_attendance_reversal_foundation");
  assert.match(migration, /attendance_reversals_completed_attendance_unique/);
  assert.match(migration, /attendance_reversals_completed_consumption_unique/);
  assert.match(migration, /package_credit_allocations_reversal_original_unique/);
  assert.equal([...migration.matchAll(/attendance_reversals[^;]*FOREIGN KEY[\s\S]*?ON DELETE (\w+)/g)].length, 7);
  assert.doesNotMatch(migration, /ON DELETE (?:cascade|set null)/i);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE FROM|INSERT INTO|DROP|TRUNCATE)\b/im);
  assert.doesNotMatch(migration, /CREATE\s+(?:OR REPLACE\s+)?(?:TRIGGER|FUNCTION|PROCEDURE)/i);
});
