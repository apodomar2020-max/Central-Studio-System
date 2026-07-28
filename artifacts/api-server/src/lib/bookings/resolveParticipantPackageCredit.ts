import { and, asc, eq } from "drizzle-orm";
import {
  creditTransactionsTable,
  packageOrdersTable,
  pricePackageDanceTypesTable,
} from "@workspace/db";
import type { ParticipantType } from "@workspace/api-zod";
import { getCairoBusinessDate } from "../eligibility/dateOnly";

type Transaction = Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];

export type PackageCreditFailureCode =
  | "PACKAGE_PARTICIPANT_MISMATCH"
  | "PACKAGE_EXPIRED"
  | "PACKAGE_NO_CREDITS"
  | "PACKAGE_DANCE_TYPE_MISMATCH"
  | "PACKAGE_CREDIT_INTEGRITY_MISMATCH";

export type ParticipantCreditResolution =
  | { ok: true; order: typeof packageOrdersTable.$inferSelect }
  | { ok: false; code: PackageCreditFailureCode; message: string };

export async function resolveParticipantPackageCredit(
  tx: Transaction,
  input: {
    packageOrderId: number;
    accountOwnerStudentId: number;
    participantType: ParticipantType;
    participantChildId: number | null;
    occurrenceDate: string;
    danceTypeId: number | null;
  },
): Promise<ParticipantCreditResolution> {
  const [order] = await tx
    .select()
    .from(packageOrdersTable)
    .where(and(
      eq(packageOrdersTable.id, input.packageOrderId),
      eq(packageOrdersTable.studentId, input.accountOwnerStudentId),
    ))
    .orderBy(asc(packageOrdersTable.expiresAt), asc(packageOrdersTable.activatedAt), asc(packageOrdersTable.id))
    .for("update")
    .limit(1);

  if (
    !order
    || order.participantType !== input.participantType
    || order.participantChildId !== input.participantChildId
  ) {
    return {
      ok: false,
      code: "PACKAGE_PARTICIPANT_MISMATCH",
      message: "The selected package does not belong to this participant.",
    };
  }
  if (order.status !== "active" || order.remainingCredits <= 0) {
    return { ok: false, code: "PACKAGE_NO_CREDITS", message: "This participant has no usable credits in the selected package." };
  }
  if (order.expiresAt != null && getCairoBusinessDate(new Date(order.expiresAt)) < input.occurrenceDate) {
    return { ok: false, code: "PACKAGE_EXPIRED", message: "The selected package expires before this class occurrence." };
  }
  if (order.packageId == null) {
    return {
      ok: false,
      code: "PACKAGE_CREDIT_INTEGRITY_MISMATCH",
      message: "The selected package credit is temporarily unavailable.",
    };
  }

  const danceRows = await tx
    .select({ danceTypeId: pricePackageDanceTypesTable.danceTypeId })
    .from(pricePackageDanceTypesTable)
    .where(eq(pricePackageDanceTypesTable.packageId, order.packageId));
  if (
    danceRows.length > 0
    && (input.danceTypeId == null || !danceRows.some((row) => row.danceTypeId === input.danceTypeId))
  ) {
    return {
      ok: false,
      code: "PACKAGE_DANCE_TYPE_MISMATCH",
      message: "The selected package cannot be used for this dance type.",
    };
  }

  const [activation] = await tx
    .select({
      participantType: creditTransactionsTable.participantType,
      participantChildId: creditTransactionsTable.participantChildId,
      studentId: creditTransactionsTable.studentId,
    })
    .from(creditTransactionsTable)
    .where(and(
      eq(creditTransactionsTable.packageOrderId, order.id),
      eq(creditTransactionsTable.type, "package_activated"),
    ))
    .limit(1);
  if (
    !activation
    || activation.studentId !== input.accountOwnerStudentId
    || activation.participantType !== input.participantType
    || activation.participantChildId !== input.participantChildId
  ) {
    return {
      ok: false,
      code: "PACKAGE_CREDIT_INTEGRITY_MISMATCH",
      message: "The selected package credit is temporarily unavailable.",
    };
  }
  return { ok: true, order };
}
