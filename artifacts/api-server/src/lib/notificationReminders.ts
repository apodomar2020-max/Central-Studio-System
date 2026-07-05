import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  attendanceTable,
  bookingsTable,
  classesTable,
  creditTransactionsTable,
  db,
  feedbackTable,
  instructorsTable,
  notificationDeliveryLogsTable,
  notificationsTable,
  packageOrdersTable,
  schedulesTable,
} from "@workspace/db";
import { createStudentNotification } from "./notifications";
import { getPushStatus, sendPushNotification } from "./pushNotifications";

export type AutomationSummary = {
  created: number;
  pushed: number;
  skipped: number;
  failed: number;
  pushDisabled: boolean;
};

export type AutomationRunSummary = {
  classReminders: AutomationSummary;
  postClassReminders: AutomationSummary;
  packageReminders: AutomationSummary;
  total: AutomationSummary;
};

type BookingReminderRow = {
  booking: typeof bookingsTable.$inferSelect;
  classTitle: string | null;
  instructorName: string | null;
  scheduleDate: string | null;
  scheduleDayOfWeek: number | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  scheduleLocation: string | null;
};

type BookingReminderRule = {
  key: string;
  targetHours: number;
  windowMinutes: number;
  bookingStatuses: string[];
  title: string;
  direction: "before" | "after";
  body: (row: BookingReminderRow, label: string) => string;
};

type PackageReminderRule = {
  key: string;
  title: string;
  body: (row: typeof packageOrdersTable.$inferSelect) => string;
  where: ReturnType<typeof and>;
  dedupeKey: (row: typeof packageOrdersTable.$inferSelect) => Promise<string | null>;
};

function emptySummary(): AutomationSummary {
  return {
    created: 0,
    pushed: 0,
    skipped: 0,
    failed: 0,
    pushDisabled: !getPushStatus().enabled,
  };
}

function combine(a: AutomationSummary, b: AutomationSummary): AutomationSummary {
  return {
    created: a.created + b.created,
    pushed: a.pushed + b.pushed,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    pushDisabled: a.pushDisabled && b.pushDisabled,
  };
}

function scheduleLabel(row: Pick<BookingReminderRow, "scheduleDate" | "scheduleDayOfWeek" | "scheduleStartTime" | "scheduleEndTime">): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = row.scheduleDate ?? (row.scheduleDayOfWeek != null ? days[row.scheduleDayOfWeek] : "your scheduled time");
  const start = row.scheduleStartTime?.slice(0, 5) ?? "";
  const end = row.scheduleEndTime?.slice(0, 5) ?? "";
  return `${day}${start ? ` • ${start}${end ? ` - ${end}` : ""}` : ""}`;
}

function bookingStartSql() {
  return sql`
    (
      case
        when ${schedulesTable.type} = 'one_time' and ${schedulesTable.date} is not null
          then (${schedulesTable.date}::text || ' ' || ${schedulesTable.startTime})::timestamp
        when ${bookingsTable.occurrenceDate} is not null
          then (${bookingsTable.occurrenceDate}::text || ' ' || ${schedulesTable.startTime})::timestamp
        else null
      end
    )
  `;
}

function bookingWindowSql(rule: BookingReminderRule) {
  const start = bookingStartSql();
  if (rule.direction === "before") {
    return sql`
      ${start} between ((now() at time zone 'Africa/Cairo') + (${rule.targetHours} * interval '1 hour'))
        and ((now() at time zone 'Africa/Cairo') + (${rule.targetHours} * interval '1 hour') + (${rule.windowMinutes} * interval '1 minute'))
    `;
  }
  return sql`
    ${start} between ((now() at time zone 'Africa/Cairo') - (${rule.targetHours} * interval '1 hour') - (${rule.windowMinutes} * interval '1 minute'))
      and ((now() at time zone 'Africa/Cairo') - (${rule.targetHours} * interval '1 hour'))
  `;
}

async function hasExistingReminder(type: string, entityType: string, entityId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.type, type),
      eq(notificationsTable.relatedEntityType, entityType),
      eq(notificationsTable.relatedEntityId, entityId),
    ))
    .limit(1);
  return Boolean(row);
}

async function hasExistingReminderForDedupeKey(type: string, entityType: string, entityId: number, dedupeKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.type, type),
      eq(notificationsTable.relatedEntityType, entityType),
      eq(notificationsTable.relatedEntityId, entityId),
      sql`${notificationsTable.metadata}->>'dedupeKey' = ${dedupeKey}`,
    ))
    .limit(1);
  return Boolean(row);
}

async function hasFeedbackForBooking(row: BookingReminderRow): Promise<boolean> {
  const [feedback] = await db
    .select({ id: feedbackTable.id })
    .from(feedbackTable)
    .leftJoin(attendanceTable, eq(feedbackTable.attendanceId, attendanceTable.id))
    .where(or(
      eq(feedbackTable.bookingId, row.booking.id),
      eq(attendanceTable.bookingId, row.booking.id),
      and(
        row.booking.accountOwnerStudentId != null
          ? eq(feedbackTable.studentId, row.booking.accountOwnerStudentId)
          : sql`lower(trim(${feedbackTable.studentEmailSnapshot})) = ${row.booking.studentEmail.trim().toLowerCase()}`,
        row.booking.classId != null ? eq(feedbackTable.classId, row.booking.classId) : sql`true`,
        row.booking.scheduleId != null ? eq(feedbackTable.scheduleId, row.booking.scheduleId) : sql`true`,
      ),
    ))
    .limit(1);
  return Boolean(feedback);
}

async function packageExpiryDedupeKey(row: typeof packageOrdersTable.$inferSelect): Promise<string | null> {
  return row.expiresAt ? `expiresAt:${row.expiresAt}` : null;
}

async function lowCreditCycleDedupeKey(row: typeof packageOrdersTable.$inferSelect): Promise<string | null> {
  const [latestReplenishment] = await db
    .select({ id: creditTransactionsTable.id, balanceAfter: creditTransactionsTable.balanceAfter })
    .from(creditTransactionsTable)
    .where(and(
      eq(creditTransactionsTable.packageOrderId, row.id),
      sql`${creditTransactionsTable.balanceAfter} > 1`,
    ))
    .orderBy(desc(creditTransactionsTable.createdAt), desc(creditTransactionsTable.id))
    .limit(1);

  return latestReplenishment
    ? `latestAboveOneTransaction:${latestReplenishment.id}`
    : "legacy-no-credit-ledger";
}

async function pushCreatedNotification(row: typeof notificationsTable.$inferSelect): Promise<{ pushed: number; failed: number }> {
  const match = /^student:(\d+)$/.exec(row.target);
  if (!match) return { pushed: 0, failed: 0 };
  const result = await sendPushNotification({
    studentId: Number(match[1]),
    title: row.title,
    body: row.body,
    data: {
      type: row.type ?? "notification",
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
    },
    notificationId: row.id,
  });
  return { pushed: result.sent, failed: result.failed };
}

async function runBookingRule(rule: BookingReminderRule): Promise<AutomationSummary> {
  const summary = emptySummary();
  const rows = await db
    .select({
      booking: bookingsTable,
      classTitle: classesTable.title,
      instructorName: instructorsTable.name,
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
      sql`${schedulesTable.status} <> 'cancelled'`,
      bookingWindowSql(rule),
    ))
    .orderBy(desc(bookingsTable.bookedAt))
    .limit(250);

  for (const row of rows) {
    if (await hasExistingReminder(rule.key, "booking", row.booking.id)) {
      summary.skipped += 1;
      continue;
    }
    if (rule.key === "post_class_rating_3h" && await hasFeedbackForBooking(row)) {
      summary.skipped += 1;
      continue;
    }

    const label = scheduleLabel(row);
    const notification = await createStudentNotification(db, {
      studentId: row.booking.accountOwnerStudentId,
      studentEmail: row.booking.studentEmail,
      title: rule.title,
      body: rule.body(row, label),
      type: rule.key,
      relatedEntityType: "booking",
      relatedEntityId: row.booking.id,
      metadata: {
        bookingId: row.booking.id,
        scheduleId: row.booking.scheduleId,
        classId: row.booking.classId,
        className: row.classTitle,
        instructorName: row.instructorName,
        branch: row.scheduleLocation,
        scheduleLabel: label,
        bookingScope: row.booking.bookingScope,
      },
      dedupe: false,
      dispatchPush: false,
    });
    if (!notification) {
      summary.skipped += 1;
      continue;
    }

    summary.created += 1;
    const push = await pushCreatedNotification(notification);
    summary.pushed += push.pushed;
    summary.failed += push.failed;
  }

  return summary;
}

async function runPackageRule(rule: PackageReminderRule): Promise<AutomationSummary> {
  const summary = emptySummary();
  const rows = await db
    .select()
    .from(packageOrdersTable)
    .where(rule.where)
    .orderBy(desc(packageOrdersTable.updatedAt))
    .limit(250);

  for (const row of rows) {
    const dedupeKey = await rule.dedupeKey(row);
    if (!dedupeKey || await hasExistingReminderForDedupeKey(rule.key, "package_order", row.id, dedupeKey)) {
      summary.skipped += 1;
      continue;
    }

    const notification = await createStudentNotification(db, {
      studentId: row.studentId,
      studentEmail: row.studentEmail,
      title: rule.title,
      body: rule.body(row),
      type: rule.key,
      relatedEntityType: "package_order",
      relatedEntityId: row.id,
      metadata: {
        packageOrderId: row.id,
        packageName: row.packageName,
        remainingCredits: row.remainingCredits,
        expiresAt: row.expiresAt,
        dedupeKey,
      },
      dedupe: false,
      dispatchPush: false,
    });
    if (!notification) {
      summary.skipped += 1;
      continue;
    }

    summary.created += 1;
    const push = await pushCreatedNotification(notification);
    summary.pushed += push.pushed;
    summary.failed += push.failed;
  }

  return summary;
}

export async function runClassReminder24h(): Promise<AutomationSummary> {
  return runBookingRule({
    key: "class_reminder_24h",
    targetHours: 24,
    windowMinutes: 60,
    bookingStatuses: ["confirmed"],
    title: "Class reminder",
    direction: "before",
    body: (row, label) => `Your ${row.classTitle ?? "class"} booking is tomorrow at ${label}.`,
  });
}

export async function runClassReminder1h(): Promise<AutomationSummary> {
  return runBookingRule({
    key: "class_reminder_1h",
    targetHours: 1,
    windowMinutes: 60,
    bookingStatuses: ["confirmed"],
    title: "Class starts soon",
    direction: "before",
    body: (row, label) => `Your ${row.classTitle ?? "class"} booking starts soon at ${label}.`,
  });
}

export async function runPostClassRatingReminders(): Promise<AutomationSummary> {
  return runBookingRule({
    key: "post_class_rating_3h",
    targetHours: 3,
    windowMinutes: 120,
    bookingStatuses: ["attended", "completed"],
    title: "How was class?",
    direction: "after",
    body: (row) => `Tell us how ${row.classTitle ?? "your class"} went today.`,
  });
}

export async function runPackageExpiryReminders(): Promise<AutomationSummary> {
  return runPackageRule({
    key: "package_expiry_7d",
    title: "Package expiring soon",
    body: (row) => `Your ${row.packageName} package expires soon and has ${row.remainingCredits} credit${row.remainingCredits === 1 ? "" : "s"} remaining.`,
    where: and(
      eq(packageOrdersTable.status, "active"),
      sql`${packageOrdersTable.remainingCredits} > 0`,
      sql`${packageOrdersTable.expiresAt} is not null`,
      sql`${packageOrdersTable.expiresAt} between (now() + interval '7 days') and (now() + interval '8 days')`,
    ),
    dedupeKey: packageExpiryDedupeKey,
  });
}

export async function runLowCreditReminders(): Promise<AutomationSummary> {
  return runPackageRule({
    key: "package_low_credits_1",
    title: "One package credit left",
    body: (row) => `Your ${row.packageName} package has 1 credit remaining.`,
    where: and(
      eq(packageOrdersTable.status, "active"),
      eq(packageOrdersTable.remainingCredits, 1),
      sql`(${packageOrdersTable.expiresAt} is null or ${packageOrdersTable.expiresAt} > now())`,
    ),
    dedupeKey: lowCreditCycleDedupeKey,
  });
}

export async function runClassReminderAutomation(): Promise<AutomationSummary> {
  return combine(await runClassReminder24h(), await runClassReminder1h());
}

export async function runPostClassReminderAutomation(): Promise<AutomationSummary> {
  return runPostClassRatingReminders();
}

export async function runPackageReminderAutomation(): Promise<AutomationSummary> {
  return combine(await runPackageExpiryReminders(), await runLowCreditReminders());
}

export async function runNotificationAutomation(): Promise<AutomationRunSummary> {
  const classReminders = await runClassReminderAutomation();
  const postClassReminders = await runPostClassReminderAutomation();
  const packageReminders = await runPackageReminderAutomation();
  return {
    classReminders,
    postClassReminders,
    packageReminders,
    total: combine(combine(classReminders, postClassReminders), packageReminders),
  };
}

export async function notificationPushCounts(notificationId: number): Promise<{ pushed: number; failed: number }> {
  const [row] = await db
    .select({
      pushed: sql<number>`count(*) filter (where ${notificationDeliveryLogsTable.status} = 'sent')::int`,
      failed: sql<number>`count(*) filter (where ${notificationDeliveryLogsTable.status} = 'failed')::int`,
    })
    .from(notificationDeliveryLogsTable)
    .where(eq(notificationDeliveryLogsTable.notificationId, notificationId));
  return { pushed: row?.pushed ?? 0, failed: row?.failed ?? 0 };
}
