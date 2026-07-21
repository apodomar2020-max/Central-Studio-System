import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  attendanceTable,
  bookingsTable,
  classesTable,
  creditTransactionsTable,
  db,
  feedbackTable,
  instructorsTable,
  notificationsTable,
  packageOrdersTable,
  schedulesTable,
} from "@workspace/db";
import { createStudentNotification, resolveStudentTarget } from "./notifications";
import { sendPushNotification } from "./pushNotifications";
import { getOrCreateClassReminderSettings, isCategoryEnabled } from "./classReminderSettings";
import { logger } from "./logger";

// ─── Result / observability model (Phase 7) ────────────────────────────────
// One row per reminder candidate maps to exactly one of these outcomes, and
// every run rolls candidate outcomes up into these aggregate counters. No
// extra user-facing notification is ever created for an operational state —
// these are purely for Admin observability (see reminderWorkerHeartbeat.ts
// and routes/classReminderSettings.ts).
export type AutomationSummary = {
  /** Rows returned by the base status+window query, before eligibility checks. */
  selected: number;
  /** Rows that passed schedule-active + occurrence-date checks. */
  eligible: number;
  created: number;
  duplicateSkipped: number;
  /** Whole rule skipped because the category (or automation) is disabled. */
  disabledSkipped: number;
  inactiveScheduleSkipped: number;
  missingOccurrence: number;
  /** Eligible row had no resolvable student identity (booking_ineligible). */
  unresolvedTarget: number;
  pushed: number;
  pushFailed: number;
  noActiveDevice: number;
  pushDisabled: number;
};

export type AutomationRunSummary = {
  classReminders: AutomationSummary;
  postClassReminders: AutomationSummary;
  packageReminders: AutomationSummary;
  total: AutomationSummary;
};

export type RunOptions = {
  /**
   * Bypass reminder-category settings. Callers MUST already have verified a
   * high-level permission (super admin) before setting this — see the
   * `force` handling in routes/notifications.ts. Never set by the scheduled
   * Worker path, which always respects settings.
   */
  force?: boolean;
};

type BookingReminderRow = {
  booking: typeof bookingsTable.$inferSelect;
  classTitle: string | null;
  instructorName: string | null;
  scheduleStatus: string | null;
  scheduleDate: string | null;
  scheduleDayOfWeek: number | null;
  scheduleStartTime: string | null;
  scheduleEndTime: string | null;
  scheduleLocation: string | null;
  /** Canonical occurrence date for this booking — schedule.date for
   * one_time schedules, otherwise the booking's own stored occurrenceDate.
   * Never re-derived from "now"; this must match what the booking system
   * already resolved at booking time (see occurrence.ts). */
  occurrenceDate: string | null;
};

type BookingReminderRule = {
  key: string;
  title: string;
  direction: "before" | "after";
  /**
   * Minutes offset from class start, relative to now. For "before", the
   * window is [now+minMinutes, now+maxMinutes] (class starts that soon from
   * now — a reminder ahead of class start). For "after", the window is
   * [now-maxMinutes, now-minMinutes] (class started that long ago). Both
   * forms structurally guarantee the reminder is never sent after class
   * start for "before" rules (minMinutes > 0).
   */
  minMinutes: number;
  maxMinutes: number;
  bookingStatuses: string[];
  /**
   * Require the joined schedule's canonical status to be 'active' (not
   * merely "not cancelled"). Pre-class rules require this; the post-class
   * rating rule does not — see the reasoning note on
   * runPostClassRatingReminders below.
   */
  requireActiveSchedule: boolean;
  settingsKey: "classReminder24hEnabled" | "classReminder1hEnabled" | "postClassRating3hEnabled";
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
    selected: 0,
    eligible: 0,
    created: 0,
    duplicateSkipped: 0,
    disabledSkipped: 0,
    inactiveScheduleSkipped: 0,
    missingOccurrence: 0,
    unresolvedTarget: 0,
    pushed: 0,
    pushFailed: 0,
    noActiveDevice: 0,
    pushDisabled: 0,
  };
}

function combine(a: AutomationSummary, b: AutomationSummary): AutomationSummary {
  const keys = Object.keys(emptySummary()) as (keyof AutomationSummary)[];
  const out = emptySummary();
  for (const key of keys) out[key] = a[key] + b[key];
  return out;
}

function scheduleLabel(row: Pick<BookingReminderRow, "scheduleDate" | "scheduleDayOfWeek" | "scheduleStartTime" | "scheduleEndTime">): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const day = row.scheduleDate ?? (row.scheduleDayOfWeek != null ? days[row.scheduleDayOfWeek] : "your scheduled time");
  const start = row.scheduleStartTime?.slice(0, 5) ?? "";
  const end = row.scheduleEndTime?.slice(0, 5) ?? "";
  return `${day}${start ? ` • ${start}${end ? ` - ${end}` : ""}` : ""}`;
}

// The booking's canonical occurrence date: schedule.date for one_time
// schedules, otherwise the booking's own stored occurrenceDate. Never
// re-derived from "now" — this mirrors exactly what the booking system
// already resolved (see occurrence.ts / bookings.ts).
function occurrenceDateSql() {
  return sql<string | null>`
    (
      case
        when ${schedulesTable.type} = 'one_time' and ${schedulesTable.date} is not null
          then ${schedulesTable.date}::text
        when ${bookingsTable.occurrenceDate} is not null
          then ${bookingsTable.occurrenceDate}::text
        else null
      end
    )
  `;
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

// All comparisons happen in Africa/Cairo — the business timezone — never
// server-local time. `minMinutes`/`maxMinutes` bounds are evaluated against
// that Cairo "now", matching the fixed windows in Phase 4:
//   24h: [now+21h, now+24h]     1h: [now+15m, now+60m]
//   post-class (3h): [now-5h, now-3h] (class started 3-5h ago)
function bookingWindowSql(rule: BookingReminderRule) {
  const start = bookingStartSql();
  const nowCairo = sql`(now() at time zone 'Africa/Cairo')`;
  if (rule.direction === "before") {
    return sql`
      ${start} between (${nowCairo} + (${rule.minMinutes} * interval '1 minute'))
        and (${nowCairo} + (${rule.maxMinutes} * interval '1 minute'))
    `;
  }
  return sql`
    ${start} between (${nowCairo} - (${rule.maxMinutes} * interval '1 minute'))
      and (${nowCairo} - (${rule.minMinutes} * interval '1 minute'))
  `;
}

/** Cheap pre-check optimization only — NOT authoritative. The partial unique
 * index on notifications.reminder_idempotency_key is what actually enforces
 * dedupe (see insertReminderNotification's 23505 handling below). Avoids
 * repeatedly hitting the DB unique-violation path every 15-minute tick for
 * the same booking while its window remains open. */
async function hasExistingReminder(idempotencyKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(eq(notificationsTable.reminderIdempotencyKey, idempotencyKey))
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

type PushOutcome = "push_sent" | "push_failed" | "push_disabled" | "no_active_device";

async function pushCreatedNotification(row: typeof notificationsTable.$inferSelect): Promise<PushOutcome> {
  const match = /^student:(\d+)$/.exec(row.target);
  if (!match) return "push_failed";
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const result = await sendPushNotification({
    studentId: Number(match[1]),
    title: row.title,
    body: row.body,
    data: {
      type: row.type ?? "notification",
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      bookingId: metadata["bookingId"] ?? row.relatedEntityId,
      occurrenceDate: metadata["occurrenceDate"] ?? null,
    },
    notificationId: row.id,
  });
  if (result.reason === "push_disabled") return "push_disabled";
  if (result.reason === "no_active_device") return "no_active_device";
  return result.sent > 0 ? "push_sent" : "push_failed";
}

const REMINDER_IDEMPOTENCY_CONSTRAINT = "notifications_reminder_idempotency_key_unique";

type ReminderInsertOutcome =
  | { outcome: "created"; notification: typeof notificationsTable.$inferSelect }
  | { outcome: "duplicate_skipped" }
  | { outcome: "no_target" };

/**
 * Atomically insert a reminder notification with its idempotency key. This
 * is the DB-authoritative dedupe path (Phase 2): a concurrent insert for the
 * same key is rejected by Postgres with SQLSTATE 23505 on the partial unique
 * index, which we treat as a safe, non-fatal duplicate skip — never a
 * fatal Worker error, and never a second push.
 */
async function insertReminderNotification(input: {
  studentId?: number | null;
  studentEmail: string;
  title: string;
  body: string;
  type: string;
  relatedEntityType: string;
  relatedEntityId: number;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<ReminderInsertOutcome> {
  const target = await resolveStudentTarget(db, input.studentId, input.studentEmail);
  if (!target) return { outcome: "no_target" };

  try {
    const [row] = await db
      .insert(notificationsTable)
      .values({
        title: input.title,
        body: input.body,
        target,
        type: input.type,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        metadata: input.metadata,
        reminderIdempotencyKey: input.idempotencyKey,
        isDraft: false,
        sentAt: new Date().toISOString(),
      })
      .returning();
    return { outcome: "created", notification: row };
  } catch (error) {
    const pgErr = error as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === REMINDER_IDEMPOTENCY_CONSTRAINT) {
      logger.info({
        idempotencyKey: input.idempotencyKey,
        type: input.type,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
      }, "duplicate_skipped: reminder idempotency key conflict at insert time");
      return { outcome: "duplicate_skipped" };
    }
    throw error;
  }
}

async function runBookingRule(rule: BookingReminderRule, options: RunOptions = {}): Promise<AutomationSummary> {
  const summary = emptySummary();
  const settings = await getOrCreateClassReminderSettings();
  const enabled = isCategoryEnabled(settings, rule.settingsKey);

  if (!enabled && !options.force) {
    summary.disabledSkipped = 1;
    logger.info({
      rule: rule.key,
      automaticRemindersEnabled: settings.automaticRemindersEnabled,
      categoryEnabled: settings[rule.settingsKey],
    }, settings.automaticRemindersEnabled ? "category_disabled: reminder rule skipped" : "automation_disabled: reminder rule skipped");
    return summary;
  }

  const rows = await db
    .select({
      booking: bookingsTable,
      classTitle: classesTable.title,
      instructorName: instructorsTable.name,
      scheduleStatus: schedulesTable.status,
      scheduleDate: schedulesTable.date,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
      occurrenceDate: occurrenceDateSql(),
    })
    .from(bookingsTable)
    .innerJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(and(
      inArray(bookingsTable.bookingStatus, rule.bookingStatuses),
      bookingWindowSql(rule),
    ))
    .orderBy(desc(bookingsTable.bookedAt))
    .limit(250);

  summary.selected += rows.length;

  for (const row of rows) {
    // Eligibility (Phase 3): canonical active schedule status — not merely
    // "not cancelled" — required for pre-class rules only.
    if (rule.requireActiveSchedule && row.scheduleStatus !== "active") {
      summary.inactiveScheduleSkipped += 1;
      continue;
    }
    if (row.occurrenceDate == null) {
      summary.missingOccurrence += 1;
      continue;
    }

    summary.eligible += 1;

    if (rule.key === "post_class_rating_3h" && await hasFeedbackForBooking(row)) {
      summary.duplicateSkipped += 1;
      continue;
    }

    // Reminder identity includes the booking occurrence, not booking ID
    // alone (Phase 2/Phase 7). Deterministic, stable across retries, no PII,
    // no execution-time timestamp.
    const idempotencyKey = `booking:${row.booking.id}:${rule.key}:${row.occurrenceDate}`;

    if (await hasExistingReminder(idempotencyKey)) {
      summary.duplicateSkipped += 1;
      continue;
    }

    const label = scheduleLabel(row);
    const insertResult = await insertReminderNotification({
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
        occurrenceDate: row.occurrenceDate,
      },
      idempotencyKey,
    });

    if (insertResult.outcome === "duplicate_skipped") {
      summary.duplicateSkipped += 1;
      continue;
    }
    if (insertResult.outcome === "no_target") {
      summary.unresolvedTarget += 1;
      continue;
    }

    summary.created += 1;
    const pushOutcome = await pushCreatedNotification(insertResult.notification);
    if (pushOutcome === "push_sent") summary.pushed += 1;
    else if (pushOutcome === "push_failed") summary.pushFailed += 1;
    else if (pushOutcome === "push_disabled") summary.pushDisabled += 1;
    else if (pushOutcome === "no_active_device") summary.noActiveDevice += 1;
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

  summary.selected += rows.length;

  for (const row of rows) {
    const dedupeKey = await rule.dedupeKey(row);
    if (!dedupeKey || await hasExistingReminderForDedupeKey(rule.key, "package_order", row.id, dedupeKey)) {
      summary.duplicateSkipped += 1;
      continue;
    }
    summary.eligible += 1;

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
      summary.unresolvedTarget += 1;
      continue;
    }

    summary.created += 1;
    const pushOutcome = await pushCreatedNotification(notification);
    if (pushOutcome === "push_sent") summary.pushed += 1;
    else if (pushOutcome === "push_failed") summary.pushFailed += 1;
    else if (pushOutcome === "push_disabled") summary.pushDisabled += 1;
    else if (pushOutcome === "no_active_device") summary.noActiveDevice += 1;
  }

  return summary;
}

// ─── Pre-class reminders (Phase 3/4) ────────────────────────────────────────
// Eligibility: booking_status = confirmed (payment method never filters
// eligibility — pay-at-studio, package-credit, and online-paid confirmed
// bookings are all equally eligible), joined schedule.status = 'active'
// (canonical active status — NOT merely "not cancelled"), a valid occurrence
// date, and no existing reminder idempotency key.
//
// Catch-up windows (never after class start):
//   24h: class start between now+21h and now+24h
//   1h:  class start between now+15m and now+60m

export async function runClassReminder24h(options: RunOptions = {}): Promise<AutomationSummary> {
  return runBookingRule({
    key: "class_reminder_24h",
    title: "Class reminder",
    direction: "before",
    minMinutes: 21 * 60,
    maxMinutes: 24 * 60,
    bookingStatuses: ["confirmed"],
    requireActiveSchedule: true,
    settingsKey: "classReminder24hEnabled",
    body: (row, label) => `Your ${row.classTitle ?? "class"} booking is tomorrow at ${label}.`,
  }, options);
}

export async function runClassReminder1h(options: RunOptions = {}): Promise<AutomationSummary> {
  return runBookingRule({
    key: "class_reminder_1h",
    title: "Class starts soon",
    direction: "before",
    minMinutes: 15,
    maxMinutes: 60,
    bookingStatuses: ["confirmed"],
    requireActiveSchedule: true,
    settingsKey: "classReminder1hEnabled",
    body: (row, label) => `Your ${row.classTitle ?? "class"} booking starts soon at ${label}.`,
  }, options);
}

// ─── Post-class rating reminder (Phase 3/4) ─────────────────────────────────
// Deliberately does NOT require schedule.status = 'active': the class has
// already happened by the time this rule can match (bookingStatuses are
// "attended"/"completed" only), and a schedule can legitimately transition
// to completed/expired/cancelled afterward through normal lifecycle
// management. Requiring an active schedule here would incorrectly withhold
// a rating reminder for a class the student genuinely attended. Booking
// eligibility (attended/completed) is itself the safety boundary. Window is
// unchanged from the prior implementation: class started 3-5 hours ago
// (target 3h + a 2h catch-up allowance), which the 15-minute scheduler
// cadence comfortably covers.
export async function runPostClassRatingReminders(options: RunOptions = {}): Promise<AutomationSummary> {
  return runBookingRule({
    key: "post_class_rating_3h",
    title: "How was class?",
    direction: "after",
    minMinutes: 180,
    maxMinutes: 300,
    bookingStatuses: ["attended", "completed"],
    requireActiveSchedule: false,
    settingsKey: "postClassRating3hEnabled",
    body: (row) => `Tell us how ${row.classTitle ?? "your class"} went today.`,
  }, options);
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

export async function runClassReminderAutomation(options: RunOptions = {}): Promise<AutomationSummary> {
  return combine(await runClassReminder24h(options), await runClassReminder1h(options));
}

export async function runPostClassReminderAutomation(options: RunOptions = {}): Promise<AutomationSummary> {
  return runPostClassRatingReminders(options);
}

export async function runPackageReminderAutomation(): Promise<AutomationSummary> {
  return combine(await runPackageExpiryReminders(), await runLowCreditReminders());
}

export async function runNotificationAutomation(options: RunOptions = {}): Promise<AutomationRunSummary> {
  const classReminders = await runClassReminderAutomation(options);
  const postClassReminders = await runPostClassReminderAutomation(options);
  const packageReminders = await runPackageReminderAutomation();
  return {
    classReminders,
    postClassReminders,
    packageReminders,
    total: combine(combine(classReminders, postClassReminders), packageReminders),
  };
}
