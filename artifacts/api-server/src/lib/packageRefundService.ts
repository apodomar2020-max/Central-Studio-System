import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  creditTransactionsTable,
  db,
  packageCreditAllocationsTable,
  packageCreditLotsTable,
  packageOrdersTable,
  paymentEventsTable,
  paymentRefundsTable,
  paymentRecordsTable,
  type PaymentRefundMethod,
} from "@workspace/db";
import { getCairoBusinessDate } from "./eligibility/dateOnly";

export type PackageRefundExcludedLotReason =
  | "no_remaining_credits"
  | "bonus"
  | "non_purchased_source"
  | "expired"
  | "unknown_value"
  | "unsupported_value_basis";

export type PackageRefundIntegrityWarning =
  | "package_order_not_found"
  | "package_order_not_active"
  | "payment_record_missing"
  | "payment_record_multiple"
  | "payment_record_not_refundable"
  | "payment_amount_unavailable"
  | "lot_balance_mismatch"
  | "no_refundable_value"
  | "refundable_value_exceeds_payment_capacity";

export type RefundablePackageCreditLot = {
  lotId: number;
  creditsIssued: number;
  creditsRemaining: number;
  consumedCredits: number;
  totalValueMinor: number;
  remainingValueMinor: number;
  expiresAt: string | null;
};

export type ExcludedPackageCreditLot = {
  lotId: number;
  sourceType: string;
  creditsIssued: number;
  creditsRemaining: number;
  totalValueMinor: number | null;
  valueBasis: string;
  expiresAt: string | null;
  reason: PackageRefundExcludedLotReason;
};

export type PackageRefundEligibility = {
  packageOrderId: number;
  paymentRecordId: number | null;
  eligible: boolean;
  refundableAmountMinor: number;
  refundableCredits: number;
  consumedValueMinor: number;
  expiredValueMinor: number;
  paymentCapacityMinor: number;
  refundableLots: RefundablePackageCreditLot[];
  excludedLots: ExcludedPackageCreditLot[];
  integrityWarnings: PackageRefundIntegrityWarning[];
};

/** Exact unconsumed tail value: V - floor(V * consumed / issued). */
export function calculateRemainingPurchasedLotValueMinor(params: {
  totalValueMinor: number;
  creditsIssued: number;
  creditsRemaining: number;
}): number {
  const value = BigInt(params.totalValueMinor);
  const issued = BigInt(params.creditsIssued);
  const consumed = BigInt(params.creditsIssued - params.creditsRemaining);
  return Number(value - (value * consumed) / issued);
}

function emptyResult(packageOrderId: number, warning: PackageRefundIntegrityWarning): PackageRefundEligibility {
  return {
    packageOrderId,
    paymentRecordId: null,
    eligible: false,
    refundableAmountMinor: 0,
    refundableCredits: 0,
    consumedValueMinor: 0,
    expiredValueMinor: 0,
    paymentCapacityMinor: 0,
    refundableLots: [],
    excludedLots: [],
    integrityWarnings: [warning],
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PackageOrder = typeof packageOrdersTable.$inferSelect;
type PaymentRecord = typeof paymentRecordsTable.$inferSelect;
type CreditLot = typeof packageCreditLotsTable.$inferSelect;
type CreditAllocation = typeof packageCreditAllocationsTable.$inferSelect;
type PaymentRefund = typeof paymentRefundsTable.$inferSelect;

type LockedPackageContext = {
  order: PackageOrder | null;
  payments: PaymentRecord[];
  lots: CreditLot[];
  allocations: CreditAllocation[];
};

export class PackageRefundServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PackageRefundServiceError";
  }
}

async function lockPackageContext(tx: Tx, packageOrderId: number): Promise<LockedPackageContext> {
  const [order] = await tx
    .select()
    .from(packageOrdersTable)
    .where(eq(packageOrdersTable.id, packageOrderId))
    .for("update")
    .limit(1);
  if (!order) return { order: null, payments: [], lots: [], allocations: [] };

  const payments = await tx
    .select()
    .from(paymentRecordsTable)
    .where(eq(paymentRecordsTable.packageOrderId, packageOrderId))
    .for("update");
  const lots = await tx
    .select()
    .from(packageCreditLotsTable)
    .where(eq(packageCreditLotsTable.packageOrderId, packageOrderId))
    .orderBy(asc(packageCreditLotsTable.id))
    .for("update");
  const allocations = await tx.select().from(packageCreditAllocationsTable)
    .where(eq(packageCreditAllocationsTable.packageOrderId, packageOrderId));
  return { order, payments, lots, allocations };
}

function buildEligibility(
  packageOrderId: number,
  context: LockedPackageContext,
  now: Date,
): PackageRefundEligibility {
  const { order, payments, lots, allocations } = context;
  if (!order) return emptyResult(packageOrderId, "package_order_not_found");
  const warnings: PackageRefundIntegrityWarning[] = [];
  if (order.status !== "active" && order.status !== "fullyUsed") warnings.push("package_order_not_active");
  if (payments.length === 0) return {
    ...emptyResult(packageOrderId, "payment_record_missing"),
    integrityWarnings: [...warnings, "payment_record_missing"],
  };
  if (payments.length !== 1) return {
    ...emptyResult(packageOrderId, "payment_record_multiple"),
    integrityWarnings: [...warnings, "payment_record_multiple"],
  };

  const payment = payments[0];
  const paymentCapacityMinor = Math.max(0, payment.paidAmountMinor - payment.refundedAmountMinor);
  if (payment.flowType !== "package_purchase" || (payment.status !== "paid" && payment.status !== "partially_refunded")) {
    warnings.push("payment_record_not_refundable");
  }
  if (
    payment.amountAvailability !== "exact"
    || payment.amountSource !== "creation_snapshot"
    || payment.finalPayableAmountMinor == null
    || payment.paidAmountMinor <= 0
  ) warnings.push("payment_amount_unavailable");
  const remainingLotCredits = lots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
  if (remainingLotCredits !== order.remainingCredits) warnings.push("lot_balance_mismatch");

  const refundableLots: RefundablePackageCreditLot[] = [];
  const excludedLots: ExcludedPackageCreditLot[] = [];
  const today = getCairoBusinessDate(now);
  for (const lot of lots) {
    let reason: PackageRefundExcludedLotReason | null = null;
    if (lot.creditsRemaining <= 0) reason = "no_remaining_credits";
    else if (lot.sourceType === "bonus") reason = "bonus";
    else if (lot.sourceType !== "purchased") reason = "non_purchased_source";
    else if (lot.expiresAt != null && getCairoBusinessDate(new Date(lot.expiresAt)) < today) reason = "expired";
    else if (lot.totalValueMinor == null || lot.valueBasis === "unknown") reason = "unknown_value";
    else if (lot.valueBasis !== "recorded_purchase_price") reason = "unsupported_value_basis";
    if (reason) {
      excludedLots.push({
        lotId: lot.id,
        sourceType: lot.sourceType,
        creditsIssued: lot.creditsIssued,
        creditsRemaining: lot.creditsRemaining,
        totalValueMinor: lot.totalValueMinor,
        valueBasis: lot.valueBasis,
        expiresAt: lot.expiresAt,
        reason,
      });
      continue;
    }
    const remainingValueMinor = calculateRemainingPurchasedLotValueMinor({
      totalValueMinor: lot.totalValueMinor!,
      creditsIssued: lot.creditsIssued,
      creditsRemaining: lot.creditsRemaining,
    });
    refundableLots.push({
      lotId: lot.id,
      creditsIssued: lot.creditsIssued,
      creditsRemaining: lot.creditsRemaining,
      consumedCredits: lot.creditsIssued - lot.creditsRemaining,
      totalValueMinor: lot.totalValueMinor!,
      remainingValueMinor,
      expiresAt: lot.expiresAt,
    });
  }
  const refundableAmountMinor = refundableLots.reduce((sum, lot) => sum + lot.remainingValueMinor, 0);
  const refundableCredits = refundableLots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
  const consumedValueMinor = allocations.filter((allocation) => allocation.eventType === "consumption")
    .reduce((sum, allocation) => sum + allocation.totalValueMinor, 0);
  const recordedExpiredValueMinor = allocations.filter((allocation) => allocation.eventType === "expiration")
    .reduce((sum, allocation) => sum + allocation.totalValueMinor, 0);
  const pendingExpiredValueMinor = excludedLots.filter((lot) => lot.reason === "expired" && lot.totalValueMinor != null)
    .reduce((sum, lot) => sum + calculateRemainingPurchasedLotValueMinor({
      totalValueMinor: lot.totalValueMinor!, creditsIssued: lot.creditsIssued, creditsRemaining: lot.creditsRemaining,
    }), 0);
  if (refundableAmountMinor <= 0) warnings.push("no_refundable_value");
  if (refundableAmountMinor > paymentCapacityMinor) warnings.push("refundable_value_exceeds_payment_capacity");
  return {
    packageOrderId,
    paymentRecordId: payment.id,
    eligible: warnings.length === 0,
    refundableAmountMinor,
    refundableCredits,
    consumedValueMinor,
    expiredValueMinor: recordedExpiredValueMinor + pendingExpiredValueMinor,
    paymentCapacityMinor,
    refundableLots,
    excludedLots,
    integrityWarnings: warnings,
  };
}

/**
 * Produces a locked, internally consistent refund eligibility snapshot.
 * This foundation performs no writes. Future lifecycle writers must call the
 * same calculation under their transaction before approving or completing a
 * refund rather than trusting an earlier preview.
 */
export async function calculatePackageRefundEligibility(
  packageOrderId: number,
  options: { now?: Date } = {},
): Promise<PackageRefundEligibility> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => buildEligibility(packageOrderId, await lockPackageContext(tx, packageOrderId), now));
}

export async function getPackageRefundOverview(
  packageOrderId: number,
  options: { now?: Date } = {},
): Promise<{ eligibility: PackageRefundEligibility; refund: PaymentRefund | null }> {
  return db.transaction(async (tx) => {
    const context = await lockPackageContext(tx, packageOrderId);
    const eligibility = buildEligibility(packageOrderId, context, options.now ?? new Date());
    if (context.payments.length !== 1) return { eligibility, refund: null };
    const [refund] = await tx.select().from(paymentRefundsTable)
      .where(eq(paymentRefundsTable.paymentRecordId, context.payments[0].id))
      .orderBy(desc(paymentRefundsTable.id)).limit(1);
    return { eligibility, refund: refund ?? null };
  });
}

export async function getPackageRefund(refundId: number): Promise<{
  refund: PaymentRefund;
  packageOrderId: number;
}> {
  return db.transaction(async (tx) => {
    const packageOrderId = await resolveRefundPackageOrderId(tx, refundId);
    const { refund } = await lockRefundContext(tx, refundId);
    return { refund, packageOrderId };
  });
}

function requireEligible(result: PackageRefundEligibility): void {
  if (!result.eligible) throw new PackageRefundServiceError(
    "PACKAGE_REFUND_NOT_ELIGIBLE",
    `Package refund is not eligible: ${result.integrityWarnings.join(", ")}`,
  );
}

async function resolveRefundPackageOrderId(tx: Tx, refundId: number): Promise<number> {
  const [row] = await tx
    .select({ packageOrderId: paymentRecordsTable.packageOrderId })
    .from(paymentRefundsTable)
    .innerJoin(paymentRecordsTable, eq(paymentRecordsTable.id, paymentRefundsTable.paymentRecordId))
    .where(eq(paymentRefundsTable.id, refundId))
    .limit(1);
  if (!row?.packageOrderId) throw new PackageRefundServiceError("PACKAGE_REFUND_NOT_FOUND", "Package refund not found.");
  return row.packageOrderId;
}

async function lockRefundContext(tx: Tx, refundId: number): Promise<{
  context: LockedPackageContext;
  refund: PaymentRefund;
}> {
  const packageOrderId = await resolveRefundPackageOrderId(tx, refundId);
  const context = await lockPackageContext(tx, packageOrderId);
  const [refund] = await tx.select().from(paymentRefundsTable).where(eq(paymentRefundsTable.id, refundId)).for("update").limit(1);
  if (!refund || context.payments.length !== 1 || refund.paymentRecordId !== context.payments[0].id) {
    throw new PackageRefundServiceError("PACKAGE_REFUND_INTEGRITY_ERROR", "Refund payment linkage is inconsistent.");
  }
  return { context, refund };
}

export async function requestPackageRefund(params: {
  packageOrderId: number;
  refundMethod: PaymentRefundMethod;
  requestedReason: string;
  requestedByAdminId: number;
  requestIdempotencyKey: string;
  now?: Date;
}): Promise<{ refund: PaymentRefund; eligibility: PackageRefundEligibility; replayed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`package_refund_request:${params.requestIdempotencyKey}`}, 0))`);
    const [existing] = await tx
      .select({ refund: paymentRefundsTable, packageOrderId: paymentRecordsTable.packageOrderId })
      .from(paymentRefundsTable)
      .innerJoin(paymentRecordsTable, eq(paymentRecordsTable.id, paymentRefundsTable.paymentRecordId))
      .where(eq(paymentRefundsTable.requestIdempotencyKey, params.requestIdempotencyKey))
      .limit(1);
    if (existing) {
      if (
        existing.packageOrderId !== params.packageOrderId
        || existing.refund.refundMethod !== params.refundMethod
        || existing.refund.requestedReason !== params.requestedReason
      ) throw new PackageRefundServiceError("IDEMPOTENCY_KEY_REUSED", "Refund request idempotency key was reused.");
      const eligibility = buildEligibility(params.packageOrderId, await lockPackageContext(tx, params.packageOrderId), params.now ?? new Date());
      return { refund: existing.refund, eligibility, replayed: true };
    }
    const context = await lockPackageContext(tx, params.packageOrderId);
    const eligibility = buildEligibility(params.packageOrderId, context, params.now ?? new Date());
    requireEligible(eligibility);
    const [refund] = await tx.insert(paymentRefundsTable).values({
      paymentRecordId: eligibility.paymentRecordId!,
      status: "underReview",
      requestedAmountMinor: eligibility.refundableAmountMinor,
      refundMethod: params.refundMethod,
      requestedReason: params.requestedReason,
      requestedByAdminId: params.requestedByAdminId,
      requestIdempotencyKey: params.requestIdempotencyKey,
    }).returning();
    return { refund, eligibility, replayed: false };
  });
}

export async function approvePackageRefund(params: {
  refundId: number;
  reviewedByAdminId: number;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { context, refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "approved") return { refund, replayed: true };
    if (refund.status !== "underReview") throw new PackageRefundServiceError("REFUND_STATUS_CONFLICT", "Only an under-review refund can be approved.");
    const eligibility = buildEligibility(context.order!.id, context, params.now ?? new Date());
    requireEligible(eligibility);
    if (eligibility.refundableAmountMinor !== refund.requestedAmountMinor) {
      throw new PackageRefundServiceError("REFUND_ELIGIBILITY_CHANGED", "Refund eligibility changed after request.");
    }
    const reviewedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "approved",
      approvedAmountMinor: eligibility.refundableAmountMinor,
      reviewedByAdminId: params.reviewedByAdminId,
      reviewedAt,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: reviewedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

export async function rejectPackageRefund(params: {
  refundId: number;
  reviewedByAdminId: number;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "rejected") return { refund, replayed: true };
    if (refund.status !== "underReview") throw new PackageRefundServiceError("REFUND_STATUS_CONFLICT", "Only an under-review refund can be rejected.");
    const reviewedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "rejected",
      reviewedByAdminId: params.reviewedByAdminId,
      reviewedAt,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: reviewedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

export async function failPackageRefund(params: {
  refundId: number;
  processedByAdminId: number;
  failedReason: string;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "failed") return { refund, replayed: true };
    if (refund.status !== "approved" && refund.status !== "processing") {
      throw new PackageRefundServiceError("REFUND_STATUS_CONFLICT", "Only an approved or processing refund can fail.");
    }
    const processedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "failed",
      processedByAdminId: params.processedByAdminId,
      processedAt,
      failedReason: params.failedReason,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: processedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

export async function completePackageRefund(params: {
  refundId: number;
  processedByAdminId: number;
  completionIdempotencyKey: string;
  transactionReference: string;
  now?: Date;
}): Promise<{ refund: PaymentRefund; retiredCredits: number; allocations: number; replayed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`package_refund_completion:${params.completionIdempotencyKey}`}, 0))`);
    const { context, refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "refunded") {
      if (refund.completionIdempotencyKey !== params.completionIdempotencyKey || refund.transactionReference !== params.transactionReference) {
        throw new PackageRefundServiceError("REFUND_ALREADY_COMPLETED", "Refund was completed with different payout evidence.");
      }
      return { refund, retiredCredits: 0, allocations: 0, replayed: true };
    }
    if (refund.status !== "approved" && refund.status !== "processing") {
      throw new PackageRefundServiceError("REFUND_STATUS_CONFLICT", "Only an approved or processing refund can complete.");
    }
    const now = params.now ?? new Date();
    const eligibility = buildEligibility(context.order!.id, context, now);
    requireEligible(eligibility);
    if (refund.approvedAmountMinor !== eligibility.refundableAmountMinor) {
      throw new PackageRefundServiceError("REFUND_ELIGIBILITY_CHANGED", "Refund eligibility changed before payout completion.");
    }
    if (context.lots.some((lot) => lot.creditsRemaining > 0 && lot.sourceType === "manual_paid")) {
      throw new PackageRefundServiceError("MANUAL_PAID_REFUND_POLICY_REQUIRED", "Manual-paid credits require a separate refund policy.");
    }
    const today = getCairoBusinessDate(now);
    if (context.lots.some((lot) => lot.creditsRemaining > 0 && lot.expiresAt != null && getCairoBusinessDate(new Date(lot.expiresAt)) < today)) {
      throw new PackageRefundServiceError("EXPIRED_LOTS_PENDING_EXPIRATION", "Expired credits must be handled by the expiration lifecycle.");
    }
    const refundableByLot = new Map(eligibility.refundableLots.map((lot) => [lot.lotId, lot.remainingValueMinor]));
    let balance = context.order!.remainingCredits;
    let allocations = 0;
    for (const lot of context.lots) {
      if (lot.creditsRemaining <= 0) continue;
      const credits = lot.creditsRemaining;
      const balanceAfter = balance - credits;
      const [creditTransaction] = await tx.insert(creditTransactionsTable).values({
        packageOrderId: context.order!.id,
        studentId: context.order!.studentId,
        participantType: context.order!.participantType,
        participantChildId: context.order!.participantChildId,
        type: "package_refund_retirement",
        delta: -credits,
        balanceBefore: balance,
        balanceAfter,
        referenceId: refund.id,
        referenceType: "payment_refund",
        notes: `Retired ${credits} credits for package refund ${refund.id}`,
        createdBy: `admin:${params.processedByAdminId}`,
      }).returning({ id: creditTransactionsTable.id });
      const monetaryValue = refundableByLot.get(lot.id) ?? 0;
      await tx.insert(packageCreditAllocationsTable).values({
        lotId: lot.id,
        eventType: "refund_retirement",
        creditTransactionId: creditTransaction.id,
        packageOrderId: context.order!.id,
        paymentRefundId: refund.id,
        credits,
        unitValueMinor: credits === 1 ? monetaryValue : null,
        totalValueMinor: monetaryValue,
        valueBasis: monetaryValue > 0 ? "recorded_purchase_price" : "unknown",
        policyVersion: "refund_retirement_v1_all_entitlement_paid_purchased_value",
        createdBy: `admin:${params.processedByAdminId}`,
        notes: monetaryValue > 0 ? "Refunded purchased credit value" : "Non-cash entitlement retirement",
      });
      const [updatedLot] = await tx.update(packageCreditLotsTable).set({ creditsRemaining: 0 }).where(and(
        eq(packageCreditLotsTable.id, lot.id),
        eq(packageCreditLotsTable.creditsRemaining, credits),
      )).returning({ id: packageCreditLotsTable.id });
      if (!updatedLot) throw new PackageRefundServiceError("LOT_CONCURRENCY_CONFLICT", "Credit lot changed during refund completion.");
      balance = balanceAfter;
      allocations += 1;
    }
    if (balance !== 0) throw new PackageRefundServiceError("LOT_BALANCE_MISMATCH", "Refund retirement did not reach zero balance.");

    const payment = context.payments[0];
    const refundedAmountMinor = payment.refundedAmountMinor + eligibility.refundableAmountMinor;
    if (refundedAmountMinor > payment.paidAmountMinor) {
      throw new PackageRefundServiceError("PAYMENT_REFUND_EXCEEDS_PAID", "Refund would exceed the paid amount.");
    }
    const paymentStatus = refundedAmountMinor === payment.paidAmountMinor ? "refunded" : "partially_refunded";
    await tx.update(packageOrdersTable).set({ remainingCredits: 0, status: "cancelled" }).where(eq(packageOrdersTable.id, context.order!.id));
    await tx.update(paymentRecordsTable).set({
      refundedAmountMinor,
      status: paymentStatus,
      updatedAt: now.toISOString(),
    }).where(eq(paymentRecordsTable.id, payment.id));
    const [updatedRefund] = await tx.update(paymentRefundsTable).set({
      status: "refunded",
      refundedAmountMinor: eligibility.refundableAmountMinor,
      processedByAdminId: params.processedByAdminId,
      processedAt: now.toISOString(),
      transactionReference: params.transactionReference,
      completionIdempotencyKey: params.completionIdempotencyKey,
      failedReason: null,
      updatedAt: now.toISOString(),
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    await tx.insert(paymentEventsTable).values({
      paymentRecordId: payment.id,
      paymentRefundId: refund.id,
      eventType: "refund_payout_completed",
      amountMinor: eligibility.refundableAmountMinor,
      previousStatus: payment.status,
      newStatus: paymentStatus,
      creditTransactionId: null,
      actorAdminId: params.processedByAdminId,
      actorType: "admin",
      reason: refund.requestedReason,
      providerReference: params.transactionReference,
      idempotencyKey: params.completionIdempotencyKey,
    });
    return {
      refund: updatedRefund,
      retiredCredits: context.order!.remainingCredits,
      allocations,
      replayed: false,
    };
  });
}
