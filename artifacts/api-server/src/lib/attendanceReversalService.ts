import { and, eq, inArray, or } from "drizzle-orm";
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

async function resolveProvenance(lot: typeof packageCreditLotsTable.$inferSelect): Promise<{
  classification: FutureRefundEligibilityClassification;
  provenance: NonNullable<AttendanceReversalEligibility["paymentBackedProvenance"]>;
}> {
  let current = lot;
  let restored = current.sourceType === "restored";
  const visited = new Set<number>();
  while (current.sourceType === "restored" && current.restoredFromAllocationId != null && !visited.has(current.id)) {
    visited.add(current.id);
    const [source] = await db.select({ lot: packageCreditLotsTable })
      .from(packageCreditAllocationsTable)
      .innerJoin(packageCreditLotsTable, eq(packageCreditLotsTable.id, packageCreditAllocationsTable.lotId))
      .where(eq(packageCreditAllocationsTable.id, current.restoredFromAllocationId)).limit(1);
    if (!source) break;
    current = source.lot;
    restored = true;
  }
  const provenance = {
    cashBacked: current.sourceType === "purchased" && current.valueBasis === "recorded_purchase_price",
    rootLotId: current.id,
    rootSourceType: current.sourceType,
    rootValueBasis: current.valueBasis,
  };
  if (current.sourceType === "manual_paid") return { classification: "manual_paid_unsupported", provenance };
  if (current.sourceType === "purchased") return {
    classification: restored ? "restored_from_purchased"
      : current.valueBasis === "recorded_purchase_price" ? "purchased_recorded" : "purchased_estimated",
    provenance,
  };
  if (current.sourceType === "bonus") return { classification: restored ? "restored_from_promotional" : "bonus_zero_value", provenance };
  if (current.sourceType === "manual_complimentary") return { classification: restored ? "restored_from_promotional" : "complimentary_zero_value", provenance };
  return { classification: "legacy_unknown", provenance };
}

/** Read-only preview. This function performs no inserts, updates, or deletes. */
export async function calculateAttendanceReversalEligibility(
  attendanceId: number,
  options: { now?: Date } = {},
): Promise<AttendanceReversalEligibility> {
  const [attendance] = await db.select().from(attendanceTable).where(eq(attendanceTable.id, attendanceId)).limit(1);
  if (!attendance) return empty(attendanceId, "attendance_not_found");
  const attendanceSummary = {
    studentId: attendance.studentId, studentName: attendance.studentName, studentEmail: attendance.studentEmail,
    participantType: attendance.participantType, participantChildId: attendance.participantChildId,
    attendanceSource: attendance.attendanceSource, paymentSource: attendance.paymentSource, status: attendance.status,
  };
  if (attendance.paymentSource === "booking_pay_at_studio" || attendance.paymentSource === "walk_in_pay_at_studio") {
    return { ...empty(attendanceId, "paid_direct_walkin"), attendance: attendanceSummary, bookingId: attendance.bookingId, cashRefundImplied: false };
  }

  const consumptions = await db.select().from(packageCreditAllocationsTable).where(and(
    eq(packageCreditAllocationsTable.attendanceId, attendanceId),
    eq(packageCreditAllocationsTable.eventType, "consumption"),
  ));
  if (consumptions.length === 0) {
    const legacyConditions = [
      attendance.bookingId == null ? undefined : and(eq(creditTransactionsTable.bookingId, attendance.bookingId), eq(creditTransactionsTable.type, "booking_deduction")),
      and(eq(creditTransactionsTable.attendanceId, attendanceId), eq(creditTransactionsTable.type, "booking_deduction")),
    ].filter((value) => value !== undefined);
    const [legacy] = legacyConditions.length === 0 ? [] : await db.select({ id: creditTransactionsTable.id })
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
  const [creditTransaction] = await db.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.id, consumption.creditTransactionId)).limit(1);
  if (!creditTransaction || creditTransaction.type !== "attendance_deduction") return {
    ...empty(attendanceId, "integrity_conflict"), attendance: attendanceSummary,
    integrityWarnings: ["consumption_credit_transaction_invalid"], bookingId: attendance.bookingId,
  };
  const [order] = await db.select().from(packageOrdersTable).where(eq(packageOrdersTable.id, consumption.packageOrderId)).limit(1);
  if (!order) return { ...empty(attendanceId, "missing_package_order"), attendance: attendanceSummary, bookingId: attendance.bookingId };
  const [lot] = await db.select().from(packageCreditLotsTable).where(eq(packageCreditLotsTable.id, consumption.lotId)).limit(1);
  if (!lot) return { ...empty(attendanceId, "missing_lot"), attendance: attendanceSummary, bookingId: attendance.bookingId, packageOrderId: order.id };

  const warnings: string[] = [];
  if (consumption.packageOrderId !== lot.packageOrderId || creditTransaction.packageOrderId !== order.id) warnings.push("package_order_link_mismatch");
  if (consumption.attendanceId !== attendance.id) warnings.push("attendance_link_mismatch");
  if ((consumption.bookingId ?? null) !== (attendance.bookingId ?? null)) warnings.push("booking_link_mismatch");
  if ((consumption.scheduleId ?? null) !== (attendance.scheduleId ?? null)) warnings.push("schedule_link_mismatch");
  if (attendance.packageOrderId != null && attendance.packageOrderId !== order.id) warnings.push("attendance_package_order_mismatch");

  const [prior] = await db.select().from(attendanceReversalsTable).where(and(
    eq(attendanceReversalsTable.originalConsumptionAllocationId, consumption.id),
    inArray(attendanceReversalsTable.status, ["requested", "approved", "completed"]),
  )).limit(1);
  const [existingReversalAllocation] = await db.select({ id: packageCreditAllocationsTable.id })
    .from(packageCreditAllocationsTable).where(and(
      eq(packageCreditAllocationsTable.eventType, "reversal"),
      eq(packageCreditAllocationsTable.reversesAllocationId, consumption.id),
    )).limit(1);
  const [refundRetirement] = await db.select({ id: packageCreditAllocationsTable.id })
    .from(packageCreditAllocationsTable).where(and(
      eq(packageCreditAllocationsTable.packageOrderId, order.id),
      eq(packageCreditAllocationsTable.eventType, "refund_retirement"),
    )).limit(1);
  const [booking] = attendance.bookingId == null ? [] : await db.select().from(bookingsTable)
    .where(eq(bookingsTable.id, attendance.bookingId)).limit(1);
  const bookingEffectPreview: BookingEffectPreview = attendance.bookingId == null ? "no_booking"
    : booking && (booking.bookingStatus === "attended" || booking.status === "attended")
      ? "booking_attendance_reversal_required" : "legacy_booking_manual_review";
  const { classification, provenance } = await resolveProvenance(lot);
  const expiryPassed = lot.expiresAt != null
    && getCairoBusinessDate(new Date(lot.expiresAt)) < getCairoBusinessDate(options.now ?? new Date());
  const requiredPermissions: AttendanceReversalEligibility["requiredPermissions"] = ["attendance.reverse"];
  if (consumption.totalValueMinor > 0 || provenance.cashBacked) requiredPermissions.push("finance.refundsManage");

  let reason: AttendanceReversalNonEligibilityReason | null = null;
  if (warnings.length > 0) reason = "integrity_conflict";
  else if (prior || existingReversalAllocation) reason = "already_reversed";
  else if (order.status === "cancelled" || refundRetirement) reason = "package_refund_cancelled";
  else if (classification === "manual_paid_unsupported") reason = "manual_paid_unsupported";

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
