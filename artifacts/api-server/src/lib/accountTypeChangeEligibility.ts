import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  balletApplicationsTable,
  bookingsTable,
  childrenTable,
  db,
} from "@workspace/db";

import {
  evaluateAccountTypeChangePolicy,
  type AccountTypeChangePolicy,
} from "./accountTypeChangePolicy";

const CHILD_CLASS_HISTORY_STATUSES = [
  "pending",
  "confirmed",
  "attended",
  "completed",
  "attendance_reversed",
] as const;

export async function getAccountTypeChangePolicy(studentId: number): Promise<AccountTypeChangePolicy> {
  const [[childClassBooking], [balletApplication]] = await Promise.all([
    db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .innerJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
      .where(and(
        eq(childrenTable.parentId, studentId),
        isNotNull(bookingsTable.classId),
        inArray(bookingsTable.bookingStatus, [...CHILD_CLASS_HISTORY_STATUSES]),
      ))
      .limit(1),
    db
      .select({ id: balletApplicationsTable.id })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.parentStudentId, studentId))
      .limit(1),
  ]);

  return evaluateAccountTypeChangePolicy({
    hasChildClassBooking: Boolean(childClassBooking),
    hasBalletApplication: Boolean(balletApplication),
  });
}
