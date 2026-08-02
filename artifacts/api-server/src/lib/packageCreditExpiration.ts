import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  creditTransactionsTable,
  db,
  packageCreditAllocationsTable,
  packageCreditLotsTable,
  packageOrdersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { getCairoBusinessDate } from "./eligibility/dateOnly";

const EXPIRATION_WORKER_IDENTITY = "worker:package-credit-expiration";
export const PACKAGE_CREDIT_EXPIRATION_POLICY_VERSION = "expiration_v1_cairo_date_exact_minor";

export function remainingLotValueMinor(params: {
  totalValueMinor: number | null;
  creditsIssued: number;
  creditsRemaining: number;
}): number | null {
  if (params.totalValueMinor == null) return null;
  const value = BigInt(params.totalValueMinor);
  const issued = BigInt(params.creditsIssued);
  const consumed = BigInt(params.creditsIssued - params.creditsRemaining);
  return Number(value - (value * consumed) / issued);
}

export type PackageCreditExpirationResult = {
  packageOrderId: number;
  expiredCredits: number;
  expirationTransactions: number;
  expirationAllocations: number;
  alreadyProcessed: boolean;
};

export async function expirePackageOrderCredits(
  packageOrderId: number,
  options: { now?: Date } = {},
): Promise<PackageCreditExpirationResult> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(packageOrdersTable)
      .where(eq(packageOrdersTable.id, packageOrderId))
      .for("update")
      .limit(1);
    if (!order) {
      return { packageOrderId, expiredCredits: 0, expirationTransactions: 0, expirationAllocations: 0, alreadyProcessed: true };
    }
    const due = order.status === "active"
      && order.expiresAt != null
      && getCairoBusinessDate(new Date(order.expiresAt)) < getCairoBusinessDate(now);
    if (!due) {
      return { packageOrderId, expiredCredits: 0, expirationTransactions: 0, expirationAllocations: 0, alreadyProcessed: true };
    }

    const lots = await tx
      .select()
      .from(packageCreditLotsTable)
      .where(and(
        eq(packageCreditLotsTable.packageOrderId, order.id),
        gt(packageCreditLotsTable.creditsRemaining, 0),
      ))
      .orderBy(asc(packageCreditLotsTable.id))
      .for("update");
    const lotCredits = lots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
    if (lotCredits !== order.remainingCredits) {
      throw new Error(
        `Package credit expiration integrity mismatch for order ${order.id}: order=${order.remainingCredits}, lots=${lotCredits}`,
      );
    }

    let balance = order.remainingCredits;
    for (const lot of lots) {
      const expiredCredits = lot.creditsRemaining;
      const balanceAfter = balance - expiredCredits;
      const [creditTransaction] = await tx
        .insert(creditTransactionsTable)
        .values({
          packageOrderId: order.id,
          studentId: order.studentId,
          participantType: order.participantType,
          participantChildId: order.participantChildId,
          type: "credit_expired",
          delta: -expiredCredits,
          balanceBefore: balance,
          balanceAfter,
          referenceId: lot.id,
          referenceType: "package_credit_lot",
          notes: `Expired ${expiredCredits} package credit${expiredCredits === 1 ? "" : "s"}`,
          createdBy: EXPIRATION_WORKER_IDENTITY,
        })
        .returning({ id: creditTransactionsTable.id });

      const expiredValueMinor = remainingLotValueMinor(lot);
      await tx.insert(packageCreditAllocationsTable).values({
        lotId: lot.id,
        eventType: "expiration",
        creditTransactionId: creditTransaction.id,
        packageOrderId: order.id,
        attendanceId: null,
        bookingId: null,
        scheduleId: null,
        branchId: null,
        roomId: null,
        credits: expiredCredits,
        unitValueMinor: expiredCredits === 1 ? expiredValueMinor : null,
        totalValueMinor: expiredValueMinor ?? 0,
        valueBasis: expiredValueMinor == null ? "unknown" : lot.valueBasis,
        policyVersion: PACKAGE_CREDIT_EXPIRATION_POLICY_VERSION,
        createdBy: EXPIRATION_WORKER_IDENTITY,
        notes: `Lot expired on package business date ${order.expiresAt}`,
      });
      await tx
        .update(packageCreditLotsTable)
        .set({ creditsRemaining: 0 })
        .where(and(
          eq(packageCreditLotsTable.id, lot.id),
          eq(packageCreditLotsTable.creditsRemaining, expiredCredits),
        ));
      balance = balanceAfter;
    }

    await tx
      .update(packageOrdersTable)
      .set({ remainingCredits: 0, status: "expired" })
      .where(eq(packageOrdersTable.id, order.id));

    return {
      packageOrderId: order.id,
      expiredCredits: lotCredits,
      expirationTransactions: lots.length,
      expirationAllocations: lots.length,
      alreadyProcessed: false,
    };
  });
}

export async function runPackageCreditExpirationBatch(options: {
  batchSize?: number;
  now?: Date;
} = {}): Promise<{ selected: number; processed: number; expiredCredits: number; failed: number }> {
  const batchSize = Math.min(500, Math.max(1, options.batchSize ?? 100));
  const now = options.now ?? new Date();
  const candidates = await db
    .select({ id: packageOrdersTable.id })
    .from(packageOrdersTable)
    .where(and(
      eq(packageOrdersTable.status, "active"),
      gt(packageOrdersTable.remainingCredits, 0),
      sql`${packageOrdersTable.expiresAt} is not null`,
      sql`(${packageOrdersTable.expiresAt} at time zone 'Africa/Cairo')::date < (${now.toISOString()}::timestamptz at time zone 'Africa/Cairo')::date`,
    ))
    .orderBy(asc(packageOrdersTable.expiresAt), asc(packageOrdersTable.id))
    .limit(batchSize);

  let processed = 0;
  let expiredCredits = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await expirePackageOrderCredits(candidate.id, { now });
      if (!result.alreadyProcessed) {
        processed += 1;
        expiredCredits += result.expiredCredits;
      }
    } catch (error) {
      failed += 1;
      logger.error({ err: error, packageOrderId: candidate.id }, "Package credit expiration failed for package order");
    }
  }
  const result = { selected: candidates.length, processed, expiredCredits, failed };
  logger.info(result, "Package credit expiration batch completed");
  return result;
}
