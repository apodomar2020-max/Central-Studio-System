import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bookingsTable,
  classCapacitySettingsTable,
  classesTable,
  db,
  schedulesTable,
} from "@workspace/db";
import { RESERVED_SEAT_STATUSES } from "./bookingStatus";
import { cairoNow, currentOccurrenceDate } from "./occurrence";

export type ClassCapacitySettingsClient = {
  id: number;
  classCapacityEnabled: boolean;
  enforcementEnabled: boolean;
  displayEnabled: boolean;
  overCapacityOccurrences: Array<{
    scheduleId: number;
    classId: number;
    classTitle: string;
    occurrenceDate: string | null;
    bookedCount: number;
    capacity: number;
  }>;
  updatedAt: string;
};

export async function getOrCreateClassCapacitySettings() {
  const [existing] = await db
    .select()
    .from(classCapacitySettingsTable)
    .where(eq(classCapacitySettingsTable.id, 1));

  if (existing) return existing;

  const [created] = await db
    .insert(classCapacitySettingsTable)
    .values({ id: 1, classCapacityEnabled: true })
    .onConflictDoNothing({ target: classCapacitySettingsTable.id })
    .returning();

  if (created) return created;

  const [afterRace] = await db
    .select()
    .from(classCapacitySettingsTable)
    .where(eq(classCapacitySettingsTable.id, 1));

  if (!afterRace) throw new Error("Class capacity settings could not be initialized");
  return afterRace;
}

export async function isClassCapacityEnabled(): Promise<boolean> {
  const settings = await getOrCreateClassCapacitySettings();
  return settings.classCapacityEnabled;
}

export async function getOverCapacityOccurrences() {
  const rows = await db
    .select({
      scheduleId: bookingsTable.scheduleId,
      classId: schedulesTable.classId,
      classTitle: classesTable.title,
      scheduleType: schedulesTable.type,
      scheduleDate: schedulesTable.date,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleStartTime: schedulesTable.startTime,
      occurrenceDate: bookingsTable.occurrenceDate,
      bookedCount: sql<number>`count(*)::int`,
      capacity: classesTable.capacity,
    })
    .from(bookingsTable)
    .innerJoin(schedulesTable, eq(schedulesTable.id, bookingsTable.scheduleId))
    .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
    .where(and(
      inArray(bookingsTable.bookingStatus, [...RESERVED_SEAT_STATUSES]),
      sql`${bookingsTable.scheduleId} is not null`,
      eq(schedulesTable.status, "active"),
      sql`${bookingsTable.occurrenceDate} is not null`,
    ))
    .groupBy(
      bookingsTable.scheduleId,
      schedulesTable.classId,
      classesTable.title,
      schedulesTable.type,
      schedulesTable.date,
      schedulesTable.dayOfWeek,
      schedulesTable.startTime,
      bookingsTable.occurrenceDate,
      classesTable.capacity,
    )
    .having(sql`count(*)::int > ${classesTable.capacity}`);

  const now = cairoNow();

  return rows
    .filter((row) => {
      if (row.scheduleId == null || row.occurrenceDate == null) return false;
      if (row.occurrenceDate < now.date) return false;
      const canonicalOccurrence = currentOccurrenceDate({
        type: row.scheduleType,
        date: row.scheduleDate,
        dayOfWeek: row.scheduleDayOfWeek,
        startTime: row.scheduleStartTime,
      }, now);
      return canonicalOccurrence != null && row.occurrenceDate >= canonicalOccurrence;
    })
    .map((row) => ({
      scheduleId: Number(row.scheduleId),
      classId: Number(row.classId),
      classTitle: row.classTitle,
      occurrenceDate: row.occurrenceDate,
      bookedCount: Number(row.bookedCount),
      capacity: Number(row.capacity),
    }));
}

export function shapeClassCapacitySettingsClient(
  settings: Awaited<ReturnType<typeof getOrCreateClassCapacitySettings>>,
  overCapacityOccurrences: Awaited<ReturnType<typeof getOverCapacityOccurrences>> = [],
): ClassCapacitySettingsClient {
  return {
    id: settings.id,
    classCapacityEnabled: settings.classCapacityEnabled,
    enforcementEnabled: settings.classCapacityEnabled,
    displayEnabled: settings.classCapacityEnabled,
    overCapacityOccurrences,
    updatedAt: settings.updatedAt,
  };
}
