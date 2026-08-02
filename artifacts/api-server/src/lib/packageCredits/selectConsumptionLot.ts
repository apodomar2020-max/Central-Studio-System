import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  attendanceTable,
  creditTransactionsTable,
  db,
  packageCreditAllocationsTable,
  packageCreditLotsTable,
  schedulesTable,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ConsumptionAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsumptionAllocationError";
  }
}

export const CONSUMPTION_ALLOCATION_POLICY_VERSION = "consumption_v1_expiry_fifo_exact_minor";

/**
 * Exact value of the next consumed credit in a lot.
 *
 * value(k) = floor(V*k/C) - floor(V*(k-1)/C)
 *
 * BigInt keeps the intermediate products exact even at PostgreSQL integer
 * limits; the resulting single-credit value is always safe to convert back.
 */
export function nextCreditValueMinor(params: {
  totalValueMinor: number | null;
  creditsIssued: number;
  creditsRemaining: number;
}): number | null {
  if (params.totalValueMinor == null) return null;
  const value = BigInt(params.totalValueMinor);
  const issued = BigInt(params.creditsIssued);
  const ordinal = BigInt(params.creditsIssued - params.creditsRemaining + 1);
  return Number((value * ordinal) / issued - (value * (ordinal - 1n)) / issued);
}

/**
 * Allocates one attendance_deduction to one locked origin lot.
 * The caller must pass the same transaction that created the attendance and
 * credit transaction; this helper never opens or schedules separate work.
 */
export async function allocateAttendanceConsumption(
  tx: Tx,
  params: {
    creditTransactionId: number;
    packageOrderId: number;
    attendanceId: number;
    bookingId: number | null;
    createdBy: string;
  },
): Promise<typeof packageCreditAllocationsTable.$inferSelect> {
  // Missing-row checks cannot themselves lock. Serialize by immutable credit
  // transaction identity, then re-check so concurrent retries become reads.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`package_credit_consumption:${params.creditTransactionId}`}, 0))`);

  const [existing] = await tx
    .select()
    .from(packageCreditAllocationsTable)
    .where(eq(packageCreditAllocationsTable.creditTransactionId, params.creditTransactionId))
    .limit(1);
  if (existing) return existing;

  const [creditTransaction] = await tx
    .select({ type: creditTransactionsTable.type, packageOrderId: creditTransactionsTable.packageOrderId })
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.id, params.creditTransactionId))
    .limit(1);
  if (
    !creditTransaction
    || creditTransaction.type !== "attendance_deduction"
    || creditTransaction.packageOrderId !== params.packageOrderId
  ) {
    throw new ConsumptionAllocationError("Only a matching attendance deduction can create a consumption allocation.");
  }

  const [attendance] = await tx
    .select({ scheduleId: attendanceTable.scheduleId })
    .from(attendanceTable)
    .where(eq(attendanceTable.id, params.attendanceId))
    .limit(1);
  if (!attendance) throw new ConsumptionAllocationError("Attendance record is unavailable for credit allocation.");

  const [schedule] = attendance.scheduleId == null
    ? []
    : await tx
        .select({ branchId: schedulesTable.branchId, roomId: schedulesTable.roomId })
        .from(schedulesTable)
        .where(eq(schedulesTable.id, attendance.scheduleId))
        .limit(1);

  const [lot] = await tx
    .select()
    .from(packageCreditLotsTable)
    .where(and(
      eq(packageCreditLotsTable.packageOrderId, params.packageOrderId),
      gt(packageCreditLotsTable.creditsRemaining, 0),
      sql`(${packageCreditLotsTable.expiresAt} is null or ${packageCreditLotsTable.expiresAt} > now())`,
    ))
    .orderBy(
      sql`${packageCreditLotsTable.expiresAt} asc nulls last`,
      asc(packageCreditLotsTable.createdAt),
      asc(packageCreditLotsTable.id),
    )
    .limit(1)
    .for("update");
  if (!lot) throw new ConsumptionAllocationError("No active package credit lot is available for this deduction.");

  const unitValueMinor = nextCreditValueMinor(lot);
  const [updatedLot] = await tx
    .update(packageCreditLotsTable)
    .set({ creditsRemaining: lot.creditsRemaining - 1 })
    .where(and(
      eq(packageCreditLotsTable.id, lot.id),
      eq(packageCreditLotsTable.creditsRemaining, lot.creditsRemaining),
      gt(packageCreditLotsTable.creditsRemaining, 0),
    ))
    .returning({ id: packageCreditLotsTable.id });
  if (!updatedLot) throw new ConsumptionAllocationError("The selected credit lot changed before allocation.");

  const [allocation] = await tx
    .insert(packageCreditAllocationsTable)
    .values({
      lotId: lot.id,
      eventType: "consumption",
      creditTransactionId: params.creditTransactionId,
      packageOrderId: params.packageOrderId,
      attendanceId: params.attendanceId,
      bookingId: params.bookingId,
      scheduleId: attendance.scheduleId,
      branchId: schedule?.branchId ?? null,
      roomId: schedule?.roomId ?? null,
      credits: 1,
      unitValueMinor,
      totalValueMinor: unitValueMinor ?? 0,
      valueBasis: unitValueMinor == null ? "unknown" : lot.valueBasis,
      policyVersion: CONSUMPTION_ALLOCATION_POLICY_VERSION,
      createdBy: params.createdBy,
    })
    .returning();
  return allocation;
}
