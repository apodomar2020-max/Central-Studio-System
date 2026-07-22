import { count } from "drizzle-orm";
import { db, balletClassesTable, balletSchedulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOperationalBalletSchedule } from "./balletClassEntitlement";

/** Builds the authoritative public count of valid active weekly Schedule rows. */
export function buildActiveBalletWeeklyScheduleCountQuery() {
  return db
    .select({ total: count(balletSchedulesTable.id) })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .where(isOperationalBalletSchedule());
}
