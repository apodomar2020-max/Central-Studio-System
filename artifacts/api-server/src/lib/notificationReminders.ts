import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  bookingsTable,
  classesTable,
  db,
  instructorsTable,
  notificationsTable,
  schedulesTable,
} from "@workspace/db";
import { createStudentNotification } from "./notifications";

type BookingReminderRow = {
  booking: typeof bookingsTable.$inferSelect;
  classTitle: string | null;
  instructorName: string | null;
  scheduleType: string | null;
  scheduleDate: string | null;
  scheduleDayOfWeek: number | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  scheduleLocation: string | null;
};

type BookingReminderRule = {
  key: string;
  lookAheadHours: number;
  bookingStatuses: string[];
  title: string;
  buildBody: (row: BookingReminderRow, label: string) => string;
};

const classReminder24hRule: BookingReminderRule = {
  key: "class_reminder_24h",
  lookAheadHours: 24,
  bookingStatuses: ["confirmed"],
  title: "Class reminder",
  buildBody: (row, label) => `Your ${row.classTitle ?? "class"} booking is coming up ${label}.`,
};

function scheduleLabel(row: {
  scheduleDate: string | null;
  scheduleDayOfWeek: number | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
}): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = row.scheduleDate ?? (row.scheduleDayOfWeek != null ? days[row.scheduleDayOfWeek] : "your scheduled time");
  const start = row.scheduleStartTime?.slice(0, 5) ?? "";
  const end = row.scheduleEndTime?.slice(0, 5) ?? "";
  return `${day}${start ? ` • ${start}${end ? ` - ${end}` : ""}` : ""}`;
}

async function runBookingReminderRule(rule: BookingReminderRule): Promise<{ created: number; skipped: number }> {
  const rows = await db
    .select({
      booking: bookingsTable,
      classTitle: classesTable.title,
      instructorName: instructorsTable.name,
      scheduleType: schedulesTable.type,
      scheduleDate: schedulesTable.date,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
    })
    .from(bookingsTable)
    .innerJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(and(
      inArray(bookingsTable.bookingStatus, rule.bookingStatuses),
      sql`
        (
          case
            when ${schedulesTable.type} = 'one_time' and ${schedulesTable.date} is not null
              then (${schedulesTable.date}::text || ' ' || ${schedulesTable.startTime})::timestamp
            when ${bookingsTable.occurrenceDate} is not null
              then (${bookingsTable.occurrenceDate}::text || ' ' || ${schedulesTable.startTime})::timestamp
            else null
          end
        ) between (now() at time zone 'Africa/Cairo')
          and ((now() at time zone 'Africa/Cairo') + (${rule.lookAheadHours} * interval '1 hour'))
      `,
    ))
    .orderBy(desc(bookingsTable.bookedAt))
    .limit(250);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.type, rule.key),
        sql`${notificationsTable.metadata}->>'bookingId' = ${String(row.booking.id)}`,
      ))
      .limit(1);
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    const label = scheduleLabel(row);
    const notification = await createStudentNotification(db, {
      studentId: row.booking.accountOwnerStudentId,
      studentEmail: row.booking.studentEmail,
      title: rule.title,
      body: rule.buildBody(row, label),
      type: rule.key,
      relatedEntityType: "booking",
      relatedEntityId: row.booking.id,
      metadata: {
        bookingId: row.booking.id,
        className: row.classTitle,
        instructorName: row.instructorName,
        branch: row.scheduleLocation,
        scheduleLabel: label,
        participantName: row.booking.studentName,
        bookingScope: row.booking.bookingScope,
      },
      dedupe: false,
    });
    if (notification) created += 1;
  }

  return { created, skipped };
}

export async function runClassReminder24h(): Promise<{ created: number; skipped: number }> {
  return runBookingReminderRule(classReminder24hRule);
}
