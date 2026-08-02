import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  attendanceReversalsTable,
  attendanceTable,
  bookingsTable,
  creditTransactionsTable,
  db,
  packageCreditAllocationsTable,
  packageCreditLotsTable,
  packageOrdersTable,
} from "@workspace/db";
import { getCairoBusinessDate } from "./eligibility/dateOnly";
import { PACKAGE_CREDIT_EXPIRATION_POLICY_VERSION } from "./packageCreditExpiration";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AttendanceReversalServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AttendanceReversalServiceError";
  }
}

export const ATTENDANCE_REVERSAL_POLICY_VERSION = "attendance_reversal_v1_exact_original_value";

export type AttendanceReversalNonEligibilityReason =
  | "attendance_not_found"
  | "attendance_without_package_consumption"
  | "paid_direct_walkin"
  | "missing_consumption_allocation"
  | "legacy_booking_deduction_only"
  | "already_reversed"
  | "package_refund_cancelled"
  | "missing_lot"
  | "missing_package_order"
  | "manual_paid_unsupported"
  | "unsupported_package_state"
  | "integrity_conflict";

export type FutureRefundEligibilityClassification =
  | "purchased_recorded"
  | "purchased_estimated"
  | "bonus_zero_value"
  | "complimentary_zero_value"
  | "restored_from_purchased"
  | "restored_from_promotional"
  | "manual_paid_unsupported"
  | "legacy_unknown";

export type BookingEffectPreview =
  | "no_booking"
  | "booking_attendance_reversal_required"
  | "legacy_booking_manual_review";

export type AttendanceReversalEligibility = {
  attendanceId: number;
  eligible: boolean;
  nonEligibilityReason: AttendanceReversalNonEligibilityReason | null;
  integrityWarnings: string[];
  attendance: {
    studentId: number | null;
    studentName: string;
    studentEmail: string;
    participantType: string | null;
    participantChildId: number | null;
    attendanceSource: string | null;
    paymentSource: string | null;
    status: string;
  } | null;
  bookingId: number | null;
  bookingEffectPreview: BookingEffectPreview;
  packageOrderId: number | null;
  packageOrderStatus: string | null;
  originalConsumptionAllocationId: number | null;
  originalCreditTransactionId: number | null;
  originalLotId: number | null;
  originalLotSourceType: string | null;
  originalAllocatedValueMinor: number | null;
  originalValueBasis: string | null;
  originalExpiresAt: string | null;
  restoredCreditUsable: boolean;
  requiresImmediateExpiration: boolean;
  scheduleId: number | null;
  branchId: number | null;
  roomId: number | null;
  priorReversalId: number | null;
  priorReversalStatus: string | null;
  paymentBackedProvenance: {
    cashBacked: boolean;
    rootLotId: number;
    rootSourceType: string;
    rootValueBasis: string;
  } | null;
  futureRefundEligibilityClassification: FutureRefundEligibilityClassification | null;
  requiredPermissions: Array<"attendance.reverse" | "finance.refundsManage">;
  cashRefundImplied: false;
};

function empty(attendanceId: number, reason: AttendanceReversalNonEligibilityReason): AttendanceReversalEligibility {
  return {
    attendanceId, eligible: false, nonEligibilityReason: reason, integrityWarnings: [], attendance: null,
    bookingId: null, bookingEffectPreview: "no_booking", packageOrderId: null, packageOrderStatus: null,
    originalConsumptionAllocationId: null, originalCreditTransactionId: null, originalLotId: null,
    originalLotSourceType: null, originalAllocatedValueMinor: null, originalValueBasis: null,
    originalExpiresAt: null, restoredCreditUsable: false, requiresImmediateExpiration: false,
    scheduleId: null, branchId: null, roomId: null, priorReversalId: null, priorReversalStatus: null,
    paymentBackedProvenance: null, futureRefundEligibilityClassification: null,
    requiredPermissions: ["attendance.reverse"], cashRefundImplied: false,
  };
}

async function resolveProvenance(tx: Tx, lot: typeof packageCreditLotsTable.$inferSelect): Promise<{
  classification: FutureRefundEligibilityClassification;
  provenance: NonNullable<AttendanceReversalEligibility["paymentBackedProvenance"]> | null;
  integrityWarning: string | null;
}> {
  let current = lot;
  let restored = current.sourceType === "restored";
  const visited = new Set<number>();
  for (let depth = 0; current.sourceType === "restored"; depth += 1) {
    if (depth >= 32 || visited.has(current.id) || current.restoredFromAllocationId == null) {
      return { classification: "legacy_unknown", provenance: null, integrityWarning: "restored_lot_provenance_invalid" };
    }
    visited.add(current.id);
    const [source] = await tx.select({ lot: packageCreditLotsTable, allocation: packageCreditAllocationsTable })
      .from(packageCreditAllocationsTable)
      .innerJoin(packageCreditLotsTable, eq(packageCreditLotsTable.id, packageCreditAllocationsTable.lotId))
      .where(eq(packageCreditAllocationsTable.id, current.restoredFromAllocationId)).limit(1);
    if (
      !source
      || source.allocation.eventType !== "consumption"
      || source.allocation.packageOrderId !== lot.packageOrderId
      || source.lot.packageOrderId !== lot.packageOrderId
    ) {
      return { classification: "legacy_unknown", provenance: null, integrityWarning: "restored_lot_provenance_invalid" };
    }
    current = source.lot;
    restored = true;
  }
  const provenance = {
    cashBacked: current.sourceType === "purchased" && current.valueBasis === "recorded_purchase_price",
    rootLotId: current.id,
    rootSourceType: current.sourceType,
    rootValueBasis: current.valueBasis,
  };
  if (current.sourceType === "manual_paid") return { classification: "manual_paid_unsupported", provenance, integrityWarning: null };
  if (current.sourceType === "purchased") return {
    classification: restored ? "restored_from_purchased"
      : current.valueBasis === "recorded_purchase_price" ? "purchased_recorded" : "purchased_estimated",
    provenance,
    integrityWarning: null,
  };
  if (current.sourceType === "bonus") return { classification: restored ? "restored_from_promotional" : "bonus_zero_value", provenance, integrityWarning: null };
  if (current.sourceType === "manual_complimentary") return { classification: restored ? "restored_from_promotional" : "complimentary_zero_value", provenance, integrityWarning: null };
  return { classification: "legacy_unknown", provenance, integrityWarning: null };
}

async function calculateAttendanceReversalEligibilityInTransaction(
  tx: Tx,
  attendanceId: number,
  options: { now?: Date; excludeReversalId?: number } = {},
): Promise<AttendanceReversalEligibility> {
  const [attendance] = await tx.select().from(attendanceTable).where(eq(attendanceTable.id, attendanceId)).limit(1);
  if (!attendance) return empty(attendanceId, "attendance_not_found");
  const attendanceSummary = {
    studentId: attendance.studentId, studentName: attendance.studentName, studentEmail: attendance.studentEmail,
    participantType: attendance.participantType, participantChildId: attendance.participantChildId,
    attendanceSource: attendance.attendanceSource, paymentSource: attendance.paymentSource, status: attendance.status,
  };
  if (attendance.paymentSource === "booking_pay_at_studio" || attendance.paymentSource === "walk_in_pay_at_studio") {
    return { ...empty(attendanceId, "paid_direct_walkin"), attendance: attendanceSummary, bookingId: attendance.bookingId, cashRefundImplied: false };
  }

  const consumptions = await tx.select().from(packageCreditAllocationsTable).where(and(
    eq(packageCreditAllocationsTable.attendanceId, attendanceId),
    eq(packageCreditAllocationsTable.eventType, "consumption"),
  ));
  if (consumptions.length === 0) {
    const legacyConditions = [
      attendance.bookingId == null ? undefined : and(eq(creditTransactionsTable.bookingId, attendance.bookingId), eq(creditTransactionsTable.type, "booking_deduction")),
      and(eq(creditTransactionsTable.attendanceId, attendanceId), eq(creditTransactionsTable.type, "booking_deduction")),
    ].filter((value) => value !== undefined);
    const [legacy] = legacyConditions.length === 0 ? [] : await tx.select({ id: creditTransactionsTable.id })
      .from(creditTransactionsTable).where(or(...legacyConditions)).limit(1);
    const packageLike = attendance.paymentSource === "booking_package_credit"
      || attendance.paymentSource === "walk_in_package_credit" || attendance.packageOrderId != null || attendance.creditDeducted;
    const reason = legacy ? "legacy_booking_deduction_only"
      : packageLike ? "missing_consumption_allocation" : "attendance_without_package_consumption";
    return { ...empty(attendanceId, reason), attendance: attendanceSummary, bookingId: attendance.bookingId };
  }
  if (consumptions.length !== 1) return {
    ...empty(attendanceId, "integrity_conflict"), attendance: attendanceSummary,
    integrityWarnings: ["multiple_consumption_allocations"], bookingId: attendance.bookingId,
  };
  const consumption = consumptions[0];
  const [creditTransaction] = await tx.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.id, consumption.creditTransactionId)).limit(1);
  if (!creditTransaction || creditTransaction.type !== "attendance_deduction") return {
    ...empty(attendanceId, "integrity_conflict"), attendance: attendanceSummary,
    integrityWarnings: ["consumption_credit_transaction_invalid"], bookingId: attendance.bookingId,
  };
  const [order] = await tx.select().from(packageOrdersTable).where(eq(packageOrdersTable.id, consumption.packageOrderId)).limit(1);
  if (!order) return { ...empty(attendanceId, "missing_package_order"), attendance: attendanceSummary, bookingId: attendance.bookingId };
  const [lot] = await tx.select().from(packageCreditLotsTable).where(eq(packageCreditLotsTable.id, consumption.lotId)).limit(1);
  if (!lot) return { ...empty(attendanceId, "missing_lot"), attendance: attendanceSummary, bookingId: attendance.bookingId, packageOrderId: order.id };

  const warnings: string[] = [];
  if (consumption.packageOrderId !== lot.packageOrderId || creditTransaction.packageOrderId !== order.id) warnings.push("package_order_link_mismatch");
  if (consumption.attendanceId !== attendance.id) warnings.push("attendance_link_mismatch");
  if ((consumption.bookingId ?? null) !== (attendance.bookingId ?? null)) warnings.push("booking_link_mismatch");
  if ((consumption.scheduleId ?? null) !== (attendance.scheduleId ?? null)) warnings.push("schedule_link_mismatch");
  if (attendance.packageOrderId != null && attendance.packageOrderId !== order.id) warnings.push("attendance_package_order_mismatch");

  const priorConditions = [
    eq(attendanceReversalsTable.originalConsumptionAllocationId, consumption.id),
    inArray(attendanceReversalsTable.status, ["requested", "approved", "completed"]),
  ];
  if (options.excludeReversalId != null) priorConditions.push(ne(attendanceReversalsTable.id, options.excludeReversalId));
  const [prior] = await tx.select().from(attendanceReversalsTable).where(and(...priorConditions)).limit(1);
  const [existingReversalAllocation] = await tx.select({ id: packageCreditAllocationsTable.id })
    .from(packageCreditAllocationsTable).where(and(
      eq(packageCreditAllocationsTable.eventType, "reversal"),
      eq(packageCreditAllocationsTable.reversesAllocationId, consumption.id),
    )).limit(1);
  const [refundRetirement] = await tx.select({ id: packageCreditAllocationsTable.id })
    .from(packageCreditAllocationsTable).where(and(
      eq(packageCreditAllocationsTable.packageOrderId, order.id),
      eq(packageCreditAllocationsTable.eventType, "refund_retirement"),
    )).limit(1);
  const [booking] = attendance.bookingId == null ? [] : await tx.select().from(bookingsTable)
    .where(eq(bookingsTable.id, attendance.bookingId)).limit(1);
  const bookingEffectPreview: BookingEffectPreview = attendance.bookingId == null ? "no_booking"
    : booking && (booking.bookingStatus === "attended" || booking.status === "attended")
      ? "booking_attendance_reversal_required" : "legacy_booking_manual_review";
  if (attendance.bookingId != null && !booking) warnings.push("booking_missing");
  if (booking && booking.id !== consumption.bookingId) warnings.push("booking_allocation_mismatch");
  if (booking && booking.bookingStatus !== "attended" && booking.bookingStatus !== "completed") warnings.push("booking_not_attended");
  const { classification, provenance, integrityWarning } = await resolveProvenance(tx, lot);
  if (integrityWarning) warnings.push(integrityWarning);
  const expiryPassed = lot.expiresAt != null
    && getCairoBusinessDate(new Date(lot.expiresAt)) < getCairoBusinessDate(options.now ?? new Date());
  const requiredPermissions: AttendanceReversalEligibility["requiredPermissions"] = ["attendance.reverse"];
  if (consumption.totalValueMinor > 0 || provenance?.cashBacked) requiredPermissions.push("finance.refundsManage");

  let reason: AttendanceReversalNonEligibilityReason | null = null;
  if (warnings.length > 0) reason = "integrity_conflict";
  else if (prior || existingReversalAllocation) reason = "already_reversed";
  else if (order.status === "cancelled" || refundRetirement) reason = "package_refund_cancelled";
  else if (classification === "manual_paid_unsupported") reason = "manual_paid_unsupported";
  else if (!["active", "fullyUsed", "expired"].includes(order.status)) reason = "unsupported_package_state";

  return {
    attendanceId, eligible: reason == null, nonEligibilityReason: reason, integrityWarnings: warnings,
    attendance: attendanceSummary, bookingId: attendance.bookingId, bookingEffectPreview,
    packageOrderId: order.id, packageOrderStatus: order.status,
    originalConsumptionAllocationId: consumption.id, originalCreditTransactionId: creditTransaction.id,
    originalLotId: lot.id, originalLotSourceType: lot.sourceType,
    originalAllocatedValueMinor: consumption.totalValueMinor, originalValueBasis: consumption.valueBasis,
    originalExpiresAt: lot.expiresAt, restoredCreditUsable: !expiryPassed,
    requiresImmediateExpiration: expiryPassed, scheduleId: consumption.scheduleId,
    branchId: consumption.branchId, roomId: consumption.roomId,
    priorReversalId: prior?.id ?? null,
    priorReversalStatus: prior?.status ?? (existingReversalAllocation ? "completed_allocation_only" : null),
    paymentBackedProvenance: provenance, futureRefundEligibilityClassification: classification,
    requiredPermissions, cashRefundImplied: false,
  };
}

/** Read-only preview. This function performs no inserts, updates, or deletes. */
export async function calculateAttendanceReversalEligibility(
  attendanceId: number,
  options: { now?: Date } = {},
): Promise<AttendanceReversalEligibility> {
  return db.transaction((tx) => calculateAttendanceReversalEligibilityInTransaction(tx, attendanceId, options));
}

type AttendanceReversal = typeof attendanceReversalsTable.$inferSelect;

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new AttendanceReversalServiceError("REVERSAL_VALIDATION_ERROR", `${field} is required.`);
  return trimmed;
}

function requireEligible(eligibility: AttendanceReversalEligibility): void {
  if (!eligibility.eligible) {
    throw new AttendanceReversalServiceError(
      "ATTENDANCE_REVERSAL_NOT_ELIGIBLE",
      `Attendance reversal is not eligible: ${eligibility.nonEligibilityReason ?? "unknown"}`,
    );
  }
}

async function lockReversal(tx: Tx, reversalId: number): Promise<AttendanceReversal> {
  const [reversal] = await tx.select().from(attendanceReversalsTable)
    .where(eq(attendanceReversalsTable.id, reversalId)).for("update").limit(1);
  if (!reversal) throw new AttendanceReversalServiceError("ATTENDANCE_REVERSAL_NOT_FOUND", "Attendance reversal not found.");
  return reversal;
}

export async function requestAttendanceReversal(params: {
  attendanceId: number;
  requestIdempotencyKey: string;
  reasonCode: string;
  reason: string;
  requestedBy: string;
  notes?: string | null;
  now?: Date;
}): Promise<{ reversal: AttendanceReversal; eligibility: AttendanceReversalEligibility; replayed: boolean }> {
  const requestIdempotencyKey = requireText(params.requestIdempotencyKey, "requestIdempotencyKey");
  const reasonCode = requireText(params.reasonCode, "reasonCode");
  const reason = requireText(params.reason, "reason");
  const requestedBy = requireText(params.requestedBy, "requestedBy");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attendance_reversal_request:${requestIdempotencyKey}`}, 0))`);
    const [existing] = await tx.select().from(attendanceReversalsTable)
      .where(eq(attendanceReversalsTable.requestIdempotencyKey, requestIdempotencyKey)).limit(1);
    if (existing) {
      if (
        existing.attendanceId !== params.attendanceId
        || existing.reasonCode !== reasonCode
        || existing.reason !== reason
        || existing.requestedBy !== requestedBy
      ) throw new AttendanceReversalServiceError("IDEMPOTENCY_KEY_REUSED", "Attendance reversal idempotency key was reused.");
      const eligibility = await calculateAttendanceReversalEligibilityInTransaction(tx, params.attendanceId, {
        now: params.now,
        excludeReversalId: existing.id,
      });
      return { reversal: existing, eligibility, replayed: true };
    }

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attendance_reversal_attendance:${params.attendanceId}`}, 0))`);
    const eligibility = await calculateAttendanceReversalEligibilityInTransaction(tx, params.attendanceId, { now: params.now });
    requireEligible(eligibility);
    const now = (params.now ?? new Date()).toISOString();
    const [reversal] = await tx.insert(attendanceReversalsTable).values({
      attendanceId: params.attendanceId,
      originalConsumptionAllocationId: eligibility.originalConsumptionAllocationId!,
      packageOrderId: eligibility.packageOrderId!,
      bookingId: eligibility.bookingId,
      status: "requested",
      requestIdempotencyKey,
      reasonCode,
      reason,
      requestedBy,
      requestedAt: now,
      notes: params.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return { reversal, eligibility, replayed: false };
  });
}

export async function approveAttendanceReversal(params: {
  reversalId: number;
  approvedBy: string;
  notes?: string | null;
  now?: Date;
}): Promise<{ reversal: AttendanceReversal; requiredPermissions: AttendanceReversalEligibility["requiredPermissions"]; replayed: boolean }> {
  const approvedBy = requireText(params.approvedBy, "approvedBy");
  return db.transaction(async (tx) => {
    const reversal = await lockReversal(tx, params.reversalId);
    if (reversal.status === "approved") {
      const eligibility = await calculateAttendanceReversalEligibilityInTransaction(tx, reversal.attendanceId, {
        now: params.now,
        excludeReversalId: reversal.id,
      });
      return { reversal, requiredPermissions: eligibility.requiredPermissions, replayed: true };
    }
    if (reversal.status !== "requested") {
      throw new AttendanceReversalServiceError("REVERSAL_STATUS_CONFLICT", "Only a requested Attendance reversal can be approved.");
    }
    const eligibility = await calculateAttendanceReversalEligibilityInTransaction(tx, reversal.attendanceId, {
      now: params.now,
      excludeReversalId: reversal.id,
    });
    requireEligible(eligibility);
    if (eligibility.requiredPermissions.includes("finance.refundsManage") && reversal.requestedBy === approvedBy) {
      throw new AttendanceReversalServiceError(
        "REVERSAL_SEPARATION_OF_DUTIES_REQUIRED",
        "A financial Attendance reversal must be approved by a different actor.",
      );
    }
    const approvedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(attendanceReversalsTable).set({
      status: "approved",
      approvedBy,
      approvedAt,
      notes: params.notes ?? reversal.notes,
      updatedAt: approvedAt,
    }).where(eq(attendanceReversalsTable.id, reversal.id)).returning();
    return { reversal: updated, requiredPermissions: eligibility.requiredPermissions, replayed: false };
  });
}

export async function rejectAttendanceReversal(params: {
  reversalId: number;
  rejectedBy: string;
  notes?: string | null;
  now?: Date;
}): Promise<{ reversal: AttendanceReversal; replayed: boolean }> {
  const rejectedBy = requireText(params.rejectedBy, "rejectedBy");
  return db.transaction(async (tx) => {
    const reversal = await lockReversal(tx, params.reversalId);
    if (reversal.status === "rejected") return { reversal, replayed: true };
    if (reversal.status !== "requested" && reversal.status !== "approved") {
      throw new AttendanceReversalServiceError("REVERSAL_STATUS_CONFLICT", "Only a requested or approved Attendance reversal can be rejected.");
    }
    const rejectedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(attendanceReversalsTable).set({
      status: "rejected", rejectedBy, rejectedAt,
      notes: params.notes ?? reversal.notes, updatedAt: rejectedAt,
    }).where(eq(attendanceReversalsTable.id, reversal.id)).returning();
    return { reversal: updated, replayed: false };
  });
}

export async function failAttendanceReversal(params: {
  reversalId: number;
  failedBy: string;
  notes?: string | null;
  now?: Date;
}): Promise<{ reversal: AttendanceReversal; replayed: boolean }> {
  const failedBy = requireText(params.failedBy, "failedBy");
  return db.transaction(async (tx) => {
    const reversal = await lockReversal(tx, params.reversalId);
    if (reversal.status === "failed") return { reversal, replayed: true };
    if (reversal.status !== "requested" && reversal.status !== "approved") {
      throw new AttendanceReversalServiceError("REVERSAL_STATUS_CONFLICT", "Only a requested or approved Attendance reversal can fail.");
    }
    const failedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(attendanceReversalsTable).set({
      status: "failed", failedBy, failedAt,
      notes: params.notes ?? reversal.notes, updatedAt: failedAt,
    }).where(eq(attendanceReversalsTable.id, reversal.id)).returning();
    return { reversal: updated, replayed: false };
  });
}

export type CompleteAttendanceReversalResult = {
  reversal: AttendanceReversal;
  restoredCreditTransactionId: number;
  reversalAllocationId: number;
  restoredLotId: number;
  expirationCreditTransactionId: number | null;
  expirationAllocationId: number | null;
  restoredCreditUsable: boolean;
  replayed: boolean;
};

export async function completeAttendanceReversal(params: {
  reversalId: number;
  completedBy: string;
  now?: Date;
}): Promise<CompleteAttendanceReversalResult> {
  const completedBy = requireText(params.completedBy, "completedBy");
  return db.transaction(async (tx) => {
    const reversal = await lockReversal(tx, params.reversalId);
    if (reversal.status === "completed") {
      const [expiration] = await tx.select({
        creditTransactionId: packageCreditAllocationsTable.creditTransactionId,
        allocationId: packageCreditAllocationsTable.id,
      }).from(packageCreditAllocationsTable).where(and(
        eq(packageCreditAllocationsTable.lotId, reversal.resultingRestoredLotId!),
        eq(packageCreditAllocationsTable.eventType, "expiration"),
      )).limit(1);
      return {
        reversal,
        restoredCreditTransactionId: reversal.resultingCreditTransactionId!,
        reversalAllocationId: reversal.resultingReversalAllocationId!,
        restoredLotId: reversal.resultingRestoredLotId!,
        expirationCreditTransactionId: expiration?.creditTransactionId ?? null,
        expirationAllocationId: expiration?.allocationId ?? null,
        restoredCreditUsable: !expiration,
        replayed: true,
      };
    }
    if (reversal.status !== "approved") {
      throw new AttendanceReversalServiceError("REVERSAL_STATUS_CONFLICT", "Only an approved Attendance reversal can be completed.");
    }

    const [order] = await tx.select().from(packageOrdersTable)
      .where(eq(packageOrdersTable.id, reversal.packageOrderId)).for("update").limit(1);
    if (!order) throw new AttendanceReversalServiceError("ATTENDANCE_REVERSAL_NOT_ELIGIBLE", "The Package Order is missing.");
    const lockedLots = await tx.select().from(packageCreditLotsTable)
      .where(eq(packageCreditLotsTable.packageOrderId, order.id)).orderBy(asc(packageCreditLotsTable.id)).for("update");
    const eligibility = await calculateAttendanceReversalEligibilityInTransaction(tx, reversal.attendanceId, {
      now: params.now,
      excludeReversalId: reversal.id,
    });
    requireEligible(eligibility);
    if (
      eligibility.originalConsumptionAllocationId !== reversal.originalConsumptionAllocationId
      || eligibility.packageOrderId !== reversal.packageOrderId
      || eligibility.bookingId !== reversal.bookingId
    ) throw new AttendanceReversalServiceError("REVERSAL_INTEGRITY_CONFLICT", "Attendance reversal linkage changed after request.");
    if (eligibility.requiredPermissions.includes("finance.refundsManage") && reversal.approvedBy === reversal.requestedBy) {
      throw new AttendanceReversalServiceError("REVERSAL_SEPARATION_OF_DUTIES_REQUIRED", "Financial reversal approval is not independent.");
    }
    const lotCredits = lockedLots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
    if (lotCredits !== order.remainingCredits) {
      throw new AttendanceReversalServiceError("PACKAGE_CREDIT_BALANCE_MISMATCH", "Package Order and lot balances do not match.");
    }
    const originalLot = lockedLots.find((lot) => lot.id === eligibility.originalLotId);
    if (!originalLot) throw new AttendanceReversalServiceError("REVERSAL_INTEGRITY_CONFLICT", "Original credit lot is missing.");
    if (order.status === "expired" && !eligibility.requiresImmediateExpiration) {
      throw new AttendanceReversalServiceError("UNSUPPORTED_PACKAGE_STATE", "An unexpired credit cannot reactivate an expired Package Order.");
    }

    const now = params.now ?? new Date();
    const nowIso = now.toISOString();
    const restoredBalance = order.remainingCredits + 1;
    const [restorationTransaction] = await tx.insert(creditTransactionsTable).values({
      packageOrderId: order.id,
      studentId: order.studentId,
      participantType: order.participantType,
      participantChildId: order.participantChildId,
      type: "attendance_reversal",
      delta: 1,
      balanceBefore: order.remainingCredits,
      balanceAfter: restoredBalance,
      referenceId: reversal.id,
      referenceType: "attendance_reversal",
      bookingId: reversal.bookingId,
      attendanceId: reversal.attendanceId,
      notes: `${reversal.reasonCode}: ${reversal.reason}`,
      createdBy: completedBy,
      createdAt: nowIso,
    }).returning();
    const [reversalAllocation] = await tx.insert(packageCreditAllocationsTable).values({
      lotId: originalLot.id,
      eventType: "reversal",
      creditTransactionId: restorationTransaction.id,
      packageOrderId: order.id,
      attendanceId: reversal.attendanceId,
      bookingId: reversal.bookingId,
      scheduleId: eligibility.scheduleId,
      branchId: eligibility.branchId,
      roomId: eligibility.roomId,
      credits: 1,
      unitValueMinor: eligibility.originalAllocatedValueMinor,
      totalValueMinor: eligibility.originalAllocatedValueMinor ?? 0,
      valueBasis: eligibility.originalValueBasis ?? "unknown",
      policyVersion: ATTENDANCE_REVERSAL_POLICY_VERSION,
      reversesAllocationId: reversal.originalConsumptionAllocationId,
      createdBy: completedBy,
      notes: `${reversal.reasonCode}: ${reversal.reason}`,
      createdAt: nowIso,
    }).returning();
    const [restoredLot] = await tx.insert(packageCreditLotsTable).values({
      packageOrderId: order.id,
      sourceType: "restored",
      creditsIssued: 1,
      creditsRemaining: 1,
      totalValueMinor: eligibility.originalAllocatedValueMinor,
      valueBasis: eligibility.originalValueBasis ?? "unknown",
      expiresAt: eligibility.originalExpiresAt,
      issuingCreditTransactionId: restorationTransaction.id,
      restoredFromAllocationId: reversal.originalConsumptionAllocationId,
      createdBy: completedBy,
      createdAt: nowIso,
      notes: `Restored by Attendance reversal ${reversal.id}`,
    }).returning();

    const restoredStatus = order.status === "fullyUsed" ? "active" : order.status;
    await tx.update(packageOrdersTable).set({ remainingCredits: restoredBalance, status: restoredStatus })
      .where(eq(packageOrdersTable.id, order.id));

    let expirationCreditTransactionId: number | null = null;
    let expirationAllocationId: number | null = null;
    if (eligibility.requiresImmediateExpiration) {
      const [expirationTransaction] = await tx.insert(creditTransactionsTable).values({
        packageOrderId: order.id,
        studentId: order.studentId,
        participantType: order.participantType,
        participantChildId: order.participantChildId,
        type: "credit_expired",
        delta: -1,
        balanceBefore: restoredBalance,
        balanceAfter: order.remainingCredits,
        referenceId: restoredLot.id,
        referenceType: "package_credit_lot",
        notes: `Immediately expired Attendance reversal credit ${reversal.id}`,
        createdBy: completedBy,
        createdAt: nowIso,
      }).returning();
      const [expirationAllocation] = await tx.insert(packageCreditAllocationsTable).values({
        lotId: restoredLot.id,
        eventType: "expiration",
        creditTransactionId: expirationTransaction.id,
        packageOrderId: order.id,
        attendanceId: null,
        bookingId: null,
        scheduleId: null,
        branchId: null,
        roomId: null,
        credits: 1,
        unitValueMinor: eligibility.originalAllocatedValueMinor,
        totalValueMinor: eligibility.originalAllocatedValueMinor ?? 0,
        valueBasis: eligibility.originalValueBasis ?? "unknown",
        policyVersion: PACKAGE_CREDIT_EXPIRATION_POLICY_VERSION,
        createdBy: completedBy,
        notes: `Inherited expiry preserved by Attendance reversal ${reversal.id}`,
        createdAt: nowIso,
      }).returning();
      await tx.update(packageCreditLotsTable).set({ creditsRemaining: 0 }).where(eq(packageCreditLotsTable.id, restoredLot.id));
      const finalStatus = order.remainingCredits === 0 ? "expired" : order.status === "fullyUsed" ? "active" : order.status;
      await tx.update(packageOrdersTable).set({ remainingCredits: order.remainingCredits, status: finalStatus })
        .where(eq(packageOrdersTable.id, order.id));
      expirationCreditTransactionId = expirationTransaction.id;
      expirationAllocationId = expirationAllocation.id;
    }

    const [updatedAttendance] = await tx.update(attendanceTable).set({ status: "reversed" })
      .where(and(eq(attendanceTable.id, reversal.attendanceId), inArray(attendanceTable.status, ["checked_in", "late"])))
      .returning({ id: attendanceTable.id });
    if (!updatedAttendance) throw new AttendanceReversalServiceError("ATTENDANCE_STATE_CONFLICT", "Attendance is not in a reversible state.");
    if (reversal.bookingId != null) {
      const [updatedBooking] = await tx.update(bookingsTable)
        .set({ status: "attendance_reversed", bookingStatus: "attendance_reversed" })
        .where(and(eq(bookingsTable.id, reversal.bookingId), inArray(bookingsTable.bookingStatus, ["attended", "completed"])))
        .returning({ id: bookingsTable.id });
      if (!updatedBooking) throw new AttendanceReversalServiceError("BOOKING_STATE_CONFLICT", "Booking is not in an attended state.");
    }

    const [completed] = await tx.update(attendanceReversalsTable).set({
      status: "completed",
      completedBy,
      completedAt: nowIso,
      resultingCreditTransactionId: restorationTransaction.id,
      resultingReversalAllocationId: reversalAllocation.id,
      resultingRestoredLotId: restoredLot.id,
      updatedAt: nowIso,
    }).where(eq(attendanceReversalsTable.id, reversal.id)).returning();
    return {
      reversal: completed,
      restoredCreditTransactionId: restorationTransaction.id,
      reversalAllocationId: reversalAllocation.id,
      restoredLotId: restoredLot.id,
      expirationCreditTransactionId,
      expirationAllocationId,
      restoredCreditUsable: !eligibility.requiresImmediateExpiration,
      replayed: false,
    };
  });
}
