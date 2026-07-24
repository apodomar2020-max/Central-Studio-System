/**
 * balletAutoAbsence — automatic 'absent' Attendance rows for Ballet
 * occurrences nobody checked into before their scheduled end time.
 *
 * Two-stage BullMQ pattern (mirrors the existing Ballet cancellation
 * finalization queue):
 *
 *   planDueBalletAbsenceOccurrences() — recurring planner (every 15 min, see
 *   BALLET_AUTO_ABSENCE_SCHEDULES). On every run it does TWO things in one
 *   bounded sweep: (1) near-term future planning — enqueues a delayed
 *   "process_occurrence" job for today's schedules timed to fire shortly
 *   after each one's end time; (2) bounded past reconciliation — walks back
 *   up to RECOVERY_HORIZON_DAYS and re-enqueues any of those occurrences too,
 *   so a Worker outage (planner down for 30 minutes, 6 hours, or overnight)
 *   is recovered on the next run instead of the occurrence being silently
 *   missed forever. This is intentionally a bounded, idempotent sweep, never
 *   an unbounded full-history scan — occurrences older than the horizon are
 *   outside its reach by design and need a manual admin backfill.
 *
 *   processBalletAutoAbsenceOccurrence() — the actual work. Re-fetches and
 *   re-validates everything at EXECUTION time (never trusts what the planner
 *   saw): the Schedule/Class/Instructor must still be active, the classDate
 *   must still fall on the Schedule's current day of week (a Schedule edit
 *   between planning and firing invalidates a stale occurrence), and the
 *   authoritative Cairo clock must be at/after the occurrence's real end
 *   instant — if it isn't, no absence is written; the occurrence is
 *   rescheduled instead of discarded. Each assignment is then processed in
 *   its OWN transaction via performBalletAttendanceWrite(source:"autoAbsence")
 *   composed with a durable notification intent — the Attendance row and its
 *   notification are committed atomically or not at all, and one student's
 *   failure never aborts the rest of the occurrence.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  balletSchedulesTable,
  balletClassesTable,
  balletLevelAssignmentsTable,
  notificationsTable,
  notificationDeliveryLogsTable,
} from "@workspace/db";
import { scheduleShapeCondition, isOperationalBalletClass } from "./balletClassEntitlement";
import {
  performBalletAttendanceWrite,
  isBalletAttendanceError,
  type BalletAttendanceErrorCode,
} from "./balletAttendanceWrite";
import { addDaysToIsoDate, cairoNow, cairoDateTimeToUtcMs, isValidIsoDate, isoDateDayOfWeek } from "./occurrence";
import { getQueue, QUEUE_NAMES, type BalletAutoAbsenceJob } from "./queue";
import { logActivityWithActorStrict, systemActivityActor } from "./activityLog";
import { insertReminderNotification, pushCreatedNotification, type PushOutcome } from "./notificationReminders";
import { logger } from "./logger";
import {
  balletAbsenceOccurrenceJobId,
  balletAbsencePushJobId,
} from "./balletAutoAbsenceJobIds";
import {
  enqueueAbsencePushDelivery,
  enqueueProcessOccurrence,
  type AutoAbsenceQueue,
} from "./balletAutoAbsenceQueue";

export {
  assertValidBullMqCustomJobId,
  balletAbsenceOccurrenceJobId,
  balletAbsencePushJobId,
} from "./balletAutoAbsenceJobIds";
export {
  enqueueAbsencePushDelivery,
  enqueueProcessOccurrence,
} from "./balletAutoAbsenceQueue";

/** Delay after a schedule's end time before the absence job fires — gives an
 *  in-flight check-in transaction time to land before the cutoff is judged. */
const POST_END_GRACE_MS = 45_000;
/** Must exceed the planner's own recurring cadence (15 min) so no occurrence
 *  is ever missed in the gap between two consecutive planner runs. */
const LOOKAHEAD_MS = 20 * 60_000;

/**
 * How many days of ended occurrences the planner reconciles on every run,
 * bounding each 15-minute tick's work instead of an unbounded full-history
 * scan (Section 7). A schedule recurs weekly, so 7 days covers every
 * schedule's most recent occurrence at least once — enough to recover from
 * a Worker outage measured in hours, up to about a week. Configurable via
 * env var; an occurrence older than this needs a manual admin backfill, not
 * automatic recovery.
 */
export const BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS = Number.parseInt(
  process.env["BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS"] ?? "7",
  10,
);

export interface PlanResult {
  /** Total schedule×date candidates examined across the whole sweep (today + reconciled days). */
  scanned: number;
  enqueued: number;
  scheduleIds: number[];
  /** Precise schedule+date pairs discovered as due this run (superset of scheduleIds, disambiguated by date). */
  occurrences: { balletScheduleId: number; classDate: string }[];
  /** Number of distinct calendar days covered by this run's reconciliation sweep (today + horizon). */
  daysSwept: number;
  upcomingScheduled: number;
  recoveredWithinHorizon: number;
  outsideRecoveryHorizon: number;
  invalidOccurrence: number;
  duplicateJob: number;
}

async function scheduleIdsForDayOfWeek(dayOfWeek: number): Promise<{ id: number; endTime: string }[]> {
  return db
    .select({ id: balletSchedulesTable.id, endTime: balletSchedulesTable.endTime })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .where(and(
      eq(balletSchedulesTable.dayOfWeek, dayOfWeek),
      scheduleShapeCondition(),
      isOperationalBalletClass(),
  ));
}

export async function planDueBalletAbsenceOccurrences(now: Date = new Date()): Promise<PlanResult> {
  const nowCairo = cairoNow(now);
  const queue = getQueue(QUEUE_NAMES.balletAutoAbsence);
  if (!queue) {
    logger.warn("Ballet auto-absence queue unavailable; discovery will still run, but nothing can be enqueued this pass");
  }

  let scanned = 0;
  let enqueued = 0;
  let upcomingScheduled = 0;
  let recoveredWithinHorizon = 0;
  let invalidOccurrence = 0;
  let duplicateJob = 0;
  const scheduleIds: number[] = [];
  const occurrences: { balletScheduleId: number; classDate: string }[] = [];

  // daysBack=0 is today — an occurrence may still be in the future (handled
  // by a positive delay) or may already be due. daysBack=1..HORIZON is
  // bounded past reconciliation: every one of those occurrences has already
  // ended, so it is always due immediately (delay=0). Re-adding a job whose
  // deterministic jobId is still active/waiting is a safe BullMQ no-op;
  // re-adding one whose earlier run already completed and was purged is a
  // safe, idempotent re-run (the DB unique index and per-student duplicate
  // handling make repeated processing of an already-resolved occurrence
  // cheap no-ops) — this bounded redundancy is the intentional trade that
  // keeps recovery simple without a separate "occurrence done" tracking
  // table. Discovery itself is independent of queue availability (a Redis
  // outage must never blind the planner to what's due — see the enqueue
  // step below), so `scanned`/`scheduleIds` are populated either way and
  // only `enqueued` reflects whether a job was actually handed to BullMQ.
  for (let daysBack = 0; daysBack <= BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS; daysBack++) {
    const date = addDaysToIsoDate(nowCairo.date, -daysBack);
    const dow = isoDateDayOfWeek(date);
    const schedules = await scheduleIdsForDayOfWeek(dow);
    scanned += schedules.length;

    for (const schedule of schedules) {
      let endInstantMs: number;
      try {
        endInstantMs = cairoDateTimeToUtcMs(date, schedule.endTime);
      } catch (err) {
        invalidOccurrence += 1;
        logger.warn({ err, balletScheduleId: schedule.id, classDate: date }, "ballet auto-absence: invalid occurrence during planning");
        continue;
      }
      const fireAtMs = endInstantMs + POST_END_GRACE_MS;
      const msUntilFire = fireAtMs - now.getTime();
      if (daysBack === 0 && msUntilFire > LOOKAHEAD_MS) continue; // next run will pick this up in time
      scheduleIds.push(schedule.id);
      occurrences.push({ balletScheduleId: schedule.id, classDate: date });
      if (daysBack === 0) upcomingScheduled += 1;
      else recoveredWithinHorizon += 1;
      if (!queue) continue; // discovered and due, but nothing to enqueue to right now
      const enqueueOutcome = await enqueueProcessOccurrence(queue, schedule.id, date, msUntilFire);
      if (enqueueOutcome === "enqueued") enqueued += 1;
      else duplicateJob += 1;
    }
  }

  // One additional bounded day makes the configured cutoff visible without
  // turning reconciliation into an unbounded historical scan.
  const firstOutsideDate = addDaysToIsoDate(nowCairo.date, -(BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS + 1));
  const outsideRecoveryHorizon = (await scheduleIdsForDayOfWeek(isoDateDayOfWeek(firstOutsideDate))).length;
  if (outsideRecoveryHorizon > 0) {
    logger.info(
      { firstOutsideDate, outsideRecoveryHorizon, recoveryHorizonDays: BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS },
      "ballet auto-absence: occurrences exist immediately outside the bounded recovery horizon",
    );
  }

  return {
    scanned,
    enqueued,
    scheduleIds,
    occurrences,
    daysSwept: BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS + 1,
    upcomingScheduled,
    recoveredWithinHorizon,
    outsideRecoveryHorizon,
    invalidOccurrence,
    duplicateJob,
  };
}

export interface ProcessOccurrenceResult {
  assignmentsChecked: number;
  inserted: number;
  insertedWithNotification: number;
  insertedWithoutLinkedAccount: number;
  skippedExisting: number;
  skippedIneligible: number;
  notificationsEnqueued: number;
  /** Per-student business failures — logged and skipped, never aborts the rest of the occurrence (Section 10). */
  failed: number;
  /** True when execution happened before the occurrence's authoritative end time — rescheduled, nothing written. */
  rescheduled: boolean;
  /** Safe, non-PII diagnostic code when the occurrence itself (not a specific student) could not be processed. */
  diagnostic?: string;
}

export interface AutoAbsenceExecutionContext {
  jobId?: string | null;
  /** Real BullMQ workers move the active job to delayed and throw DelayedError. */
  rescheduleAt?: (timestamp: number) => Promise<never>;
}

function emptyProcessResult(diagnostic?: string): ProcessOccurrenceResult {
  return {
    assignmentsChecked: 0,
    inserted: 0,
    insertedWithNotification: 0,
    insertedWithoutLinkedAccount: 0,
    skippedExisting: 0,
    skippedIneligible: 0,
    notificationsEnqueued: 0,
    failed: 0,
    rescheduled: false,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

/** Error codes from performBalletAttendanceWrite that represent a student no
 *  longer being a valid candidate for this occurrence (not a system fault) —
 *  bucketed as skippedIneligible rather than a failure requiring attention. */
const INELIGIBLE_CODES: ReadonlySet<BalletAttendanceErrorCode> = new Set([
  "no_active_subscription",
  "application_not_active",
  "assignment_not_active",
  "child_mismatch",
  "no_group_assigned",
  "assignment_not_found",
  "invalid_schedule",
  "wrong_day_of_week",
]);

export async function processBalletAutoAbsenceOccurrence(
  job: { balletScheduleId: number; classDate: string },
  now: Date = new Date(),
  execution: AutoAbsenceExecutionContext = {},
): Promise<ProcessOccurrenceResult> {
  const { balletScheduleId, classDate } = job;

  if (!isValidIsoDate(classDate)) {
    logger.warn({ balletScheduleId, classDate }, "ballet auto-absence: malformed classDate, skipping");
    return emptyProcessResult("invalid_class_date");
  }

  const expectedJobId = balletAbsenceOccurrenceJobId(balletScheduleId, classDate);
  if (execution.jobId != null && execution.jobId !== expectedJobId) {
    logger.warn({ balletScheduleId, classDate, jobId: execution.jobId }, "ballet auto-absence: deterministic job identity mismatch");
    return emptyProcessResult("job_identity_mismatch");
  }

  const todayCairo = cairoNow(now).date;
  const oldestRecoverableDate = addDaysToIsoDate(todayCairo, -BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS);
  if (classDate > todayCairo) {
    logger.warn({ balletScheduleId, classDate, todayCairo }, "ballet auto-absence: future occurrence rejected");
    return emptyProcessResult("future_occurrence");
  }
  if (classDate < oldestRecoverableDate) {
    logger.warn(
      { balletScheduleId, classDate, oldestRecoverableDate },
      "ballet auto-absence: occurrence outside configured recovery horizon",
    );
    return emptyProcessResult("outside_recovery_horizon");
  }

  // Re-validate at EXECUTION time, not planning time — never trust the
  // planner's payload beyond the Schedule id + date (Section 6).
  const [schedule] = await db
    .select({
      id: balletSchedulesTable.id,
      dayOfWeek: balletSchedulesTable.dayOfWeek,
      startTime: balletSchedulesTable.startTime,
      endTime: balletSchedulesTable.endTime,
      groupId: balletClassesTable.groupId,
      levelId: balletClassesTable.levelId,
      className: balletClassesTable.title,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .where(and(
      eq(balletSchedulesTable.id, balletScheduleId),
      scheduleShapeCondition(),
      isOperationalBalletClass(),
    ))
    .limit(1);

  if (!schedule || schedule.groupId == null || schedule.levelId == null) {
    // Schedule/Class/Instructor no longer active or structurally incomplete
    // — safe diagnostic result, no absence written, no notification.
    logger.info({ balletScheduleId, classDate }, "ballet auto-absence: schedule inactive or incomplete at execution time, skipping");
    return emptyProcessResult("schedule_inactive");
  }

  // The occurrence must still fall on the Schedule's CURRENT day of week —
  // an edit to the Schedule between planning and firing can otherwise cause
  // a phantom absence for a class that never actually met on this date.
  if (isoDateDayOfWeek(classDate) !== schedule.dayOfWeek) {
    logger.warn(
      { balletScheduleId, classDate, scheduleDayOfWeek: schedule.dayOfWeek },
      "ballet auto-absence: classDate no longer matches the Schedule's current day of week (Schedule was edited) — skipping, no absence written",
    );
    return emptyProcessResult("weekday_mismatch");
  }

  // Authoritative Cairo server time must be at/after the occurrence's real
  // end instant — never trust that the job fired at the "right" time (a
  // reconciliation catch-up, a delayed retry, or a manual trigger could all
  // execute early). If it hasn't ended yet, reschedule instead of marking
  // absent or silently discarding.
  const endInstantMs = cairoDateTimeToUtcMs(classDate, schedule.endTime);
  if (now.getTime() < endInstantMs) {
    const rescheduleTimestamp = endInstantMs + POST_END_GRACE_MS;
    if (execution.rescheduleAt) {
      await execution.rescheduleAt(rescheduleTimestamp);
      throw new Error("BullMQ reschedule callback returned without delaying the active job");
    }
    logger.info(
      { balletScheduleId, classDate, endInstantMs, executedAtMs: now.getTime() },
      "ballet auto-absence: executed before the occurrence's end time — rescheduled, no absence written",
    );
    return { ...emptyProcessResult("executed_before_end"), rescheduled: true };
  }

  // Candidate assignments — ownership, lifecycle, structural-chain, and
  // subscription eligibility are all re-derived per student inside
  // performBalletAttendanceWrite itself (the single source of truth), so
  // this query only needs to discover WHO to attempt.
  const assignments = await db
    .select({ id: balletLevelAssignmentsTable.id })
    .from(balletLevelAssignmentsTable)
    .where(and(
      eq(balletLevelAssignmentsTable.groupId, schedule.groupId),
      eq(balletLevelAssignmentsTable.levelId, schedule.levelId),
      eq(balletLevelAssignmentsTable.status, "active"),
    ));

  let inserted = 0;
  let insertedWithNotification = 0;
  let insertedWithoutLinkedAccount = 0;
  let skippedExisting = 0;
  let skippedIneligible = 0;
  let notificationsEnqueued = 0;
  let failed = 0;

  for (const assignment of assignments) {
    try {
      // Section 8 — Attendance insert + durable notification intent + audit
      // record, ONE transaction. If the notification insert fails, the
      // whole transaction rolls back: an absent row must never exist
      // without a durable, recoverable notification intent alongside it.
      const outcome = await db.transaction(async (tx) => {
        const attendanceResult = await performBalletAttendanceWrite({
          levelAssignmentId: assignment.id,
          balletScheduleId,
          classDate,
          status: "absent",
          performedBy: "system",
          source: "autoAbsence",
          now,
          client: tx,
        });

        let notification: typeof notificationsTable.$inferSelect | null = null;
        let notificationOutcome: "created" | "unavailable_no_linked_account";
        if (attendanceResult.parentStudentId != null) {
          const timeLabel = schedule.startTime && schedule.endTime ? `${schedule.startTime}–${schedule.endTime}` : schedule.startTime ?? "";
          const insertResult = await insertReminderNotification(
            {
              studentId: attendanceResult.parentStudentId,
              studentEmail: attendanceResult.parentEmail,
              title: "Absence recorded",
              body: `${attendanceResult.childName} was marked absent from ${schedule.className ?? "Ballet class"} on ${classDate}${timeLabel ? ` (${timeLabel})` : ""} because no check-in was recorded before the class ended.`,
              type: "ballet_absence_recorded",
              relatedEntityType: "attendance",
              relatedEntityId: attendanceResult.attendance.id,
              metadata: {
                attendanceId: attendanceResult.attendance.id,
                applicationId: attendanceResult.applicationId,
                childName: attendanceResult.childName,
                className: schedule.className,
                classDate,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
              },
              // Deterministic and tied to the fresh attendance row this same
              // transaction just inserted — DB-enforced via the partial
              // unique index on notifications.reminderIdempotencyKey.
              idempotencyKey: `ballet_absence:${attendanceResult.attendance.id}`,
            },
            tx,
          );
          if (insertResult.outcome !== "created") {
            throw new Error(`Unable to create durable Ballet absence notification intent (${insertResult.outcome})`);
          }
          notification = insertResult.notification;
          notificationOutcome = "created";
        } else {
          notificationOutcome = "unavailable_no_linked_account";
        }

        await logActivityWithActorStrict(tx, systemActivityActor("Ballet Auto-Absence Worker"), {
          action: "checkIn",
          module: "attendance",
          entityType: "ballet_attendance",
          entityId: attendanceResult.attendance.id,
          entityLabel: attendanceResult.childName,
          after: {
            levelAssignmentId: assignment.id,
            balletScheduleId,
            classDate,
            status: "absent",
            durationMinutes: attendanceResult.attendance.durationMinutes,
            source: "worker",
            program: "ballet",
            notificationOutcome,
          },
          summary: `Automatically recorded absence for ${attendanceResult.childName} on ${classDate}`,
        });

        return { notification, notificationOutcome };
      });

      inserted += 1;
      if (outcome.notificationOutcome === "created") insertedWithNotification += 1;
      else insertedWithoutLinkedAccount += 1;
      if (outcome.notification) {
        // Push delivery is a separate, at-least-once guarantee. Only the
        // deterministic delivery job calls the provider, under a per-
        // Notification advisory lock; reconciliation recovers this durable
        // intent if Redis is unavailable in this narrow post-commit step.
        try {
          const enqueueOutcome = await enqueueAbsencePushDelivery(outcome.notification.id);
          if (enqueueOutcome === "enqueued") notificationsEnqueued += 1;
        } catch (err) {
          logger.warn(
            { errorName: err instanceof Error ? err.name : "unknown", notificationId: outcome.notification.id },
            "ballet auto-absence: immediate Push-job enqueue failed; durable notification will be recovered by reconciliation",
          );
        }
      }
    } catch (err: unknown) {
      if (isBalletAttendanceError(err)) {
        if (err.code === "duplicate_attendance") {
          skippedExisting += 1;
          continue;
        }
        if (INELIGIBLE_CODES.has(err.code)) {
          skippedIneligible += 1;
          continue;
        }
        // A structural/business error that should never occur for this
        // source (e.g. invalid_duration, or a gateway/applicationDetail-only
        // code) — log and continue. Not an infrastructure failure, so the
        // rest of the occurrence still proceeds (Section 10).
        failed += 1;
        logger.error(
          { code: err.code, balletScheduleId, classDate, levelAssignmentId: assignment.id },
          "ballet auto-absence: unexpected business error for one student, continuing with the rest of the occurrence",
        );
        continue;
      }
      const sqlState = ((err as { cause?: { code?: string }; code?: string }).cause?.code
        ?? (err as { code?: string }).code
        ?? "");
      const infrastructureFailure = /^(08|53|57P|58)/.test(sqlState);
      if (!infrastructureFailure) {
        failed += 1;
        logger.error(
          {
            errorName: err instanceof Error ? err.name : "unknown",
            sqlState: sqlState || null,
            balletScheduleId,
            classDate,
            levelAssignmentId: assignment.id,
          },
          "ballet auto-absence: one student's atomic Attendance/Notification/Audit transaction failed; continuing",
        );
        continue;
      }
      // Infrastructure-wide failure — retry the whole occurrence. Earlier
      // committed students become duplicate no-ops; this student's transaction
      // rolled back in full and will be attempted again.
      logger.error(
        {
          errorName: err instanceof Error ? err.name : "unknown",
          sqlState: sqlState || null,
          balletScheduleId,
          classDate,
          levelAssignmentId: assignment.id,
        },
        "ballet auto-absence: infrastructure-level failure — failing the job so BullMQ retries the whole occurrence",
      );
      throw err;
    }
  }

  return {
    assignmentsChecked: assignments.length,
    inserted,
    insertedWithNotification,
    insertedWithoutLinkedAccount,
    skippedExisting,
    skippedIneligible,
    notificationsEnqueued,
    failed,
    rescheduled: false,
  };
}

const PUSH_RECONCILIATION_LIMIT = 200;

export interface PushReconciliationResult {
  scanned: number;
  enqueued: number;
  duplicateJobs: number;
}

type CanonicalDeliveryState = "sent" | "skipped" | "failed" | "missing" | "pending";
type DeliveryStateClient = Pick<typeof db, "select">;

async function canonicalDeliveryState(
  client: DeliveryStateClient,
  notificationId: number,
): Promise<CanonicalDeliveryState> {
  const [latest] = await client
    .select({ status: notificationDeliveryLogsTable.status })
    .from(notificationDeliveryLogsTable)
    .where(eq(notificationDeliveryLogsTable.notificationId, notificationId))
    .orderBy(desc(notificationDeliveryLogsTable.createdAt), desc(notificationDeliveryLogsTable.id))
    .limit(1);
  if (!latest) return "missing";
  if (latest.status === "sent") return "sent";
  if (latest.status === "skipped") return "skipped";
  if (latest.status === "failed") return "failed";
  return "pending";
}

/**
 * Section 9 — push delivery is a separate, at-least-once-retryable
 * guarantee from the durable in-app notification intent committed inside
 * processBalletAutoAbsenceOccurrence's transaction. A transient BullMQ/FCM
 * failure — or the narrow gap in sendPushNotification where the device
 * lookup itself throws before any delivery log row is written — must not
 * permanently lose push delivery. notificationDeliveryLogsTable already
 * records every attempt's outcome (confirmed by direct schema inspection —
 * no migration required for this). The latest authoritative state controls:
 * sent/skipped are terminal; failed/missing are retryable. Reconciliation
 * only enqueues deterministic jobs and never calls the Push provider itself.
 */
export async function reconcileBalletAbsencePushDelivery(
  now: Date = new Date(),
  queueOverride?: AutoAbsenceQueue | null,
): Promise<PushReconciliationResult> {
  const horizonStartIso = new Date(now.getTime() - BALLET_AUTO_ABSENCE_RECOVERY_HORIZON_DAYS * 24 * 60 * 60_000).toISOString();

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.type, "ballet_absence_recorded"),
      sql`${notificationsTable.createdAt} >= ${horizonStartIso}`,
    ))
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
    .limit(PUSH_RECONCILIATION_LIMIT);

  const queue = queueOverride === undefined
    ? getQueue(QUEUE_NAMES.balletAutoAbsence)
    : queueOverride;
  let scanned = 0;
  let enqueued = 0;
  let duplicateJobs = 0;
  for (const row of notifications) {
    const state = await canonicalDeliveryState(db, row.id);
    if (state !== "failed" && state !== "missing") continue;
    scanned += 1;
    if (!queue) continue;

    const enqueueOutcome = await enqueueAbsencePushDelivery(row.id, queue);
    if (enqueueOutcome === "enqueued") enqueued += 1;
    else if (enqueueOutcome === "duplicate") duplicateJobs += 1;
  }
  return { scanned, enqueued, duplicateJobs };
}

export interface AbsencePushDeliveryResult {
  notificationId: number;
  outcome: "sent" | "skipped" | "retryable_failed" | "missing_notification";
}

export type AbsencePushSender = (notification: typeof notificationsTable.$inferSelect) => Promise<PushOutcome>;

/** Serialize provider calls per Notification across Worker replicas. */
export async function processBalletAbsencePushDelivery(
  notificationId: number,
  sender: AbsencePushSender = pushCreatedNotification,
): Promise<AbsencePushDeliveryResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1847206, ${notificationId})`);

    const [notification] = await tx
      .select()
      .from(notificationsTable)
      .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.type, "ballet_absence_recorded")))
      .limit(1);
    if (!notification) return { notificationId, outcome: "missing_notification" };

    const state = await canonicalDeliveryState(tx, notificationId);
    if (state === "sent" || state === "skipped" || state === "pending") {
      return { notificationId, outcome: state === "sent" ? "sent" : "skipped" };
    }

    const pushOutcome = await sender(notification);
    if (pushOutcome === "push_sent") return { notificationId, outcome: "sent" };
    if (pushOutcome === "push_disabled" || pushOutcome === "no_active_device") {
      return { notificationId, outcome: "skipped" };
    }
    return { notificationId, outcome: "retryable_failed" };
  });
}

export async function processBalletAutoAbsenceJob(
  jobData: BalletAutoAbsenceJob,
  execution: AutoAbsenceExecutionContext = {},
): Promise<PlanResult | ProcessOccurrenceResult | AbsencePushDeliveryResult> {
  if (jobData.type === "plan_due_occurrences") {
    const [planResult] = await Promise.all([
      planDueBalletAbsenceOccurrences(),
      reconcileBalletAbsencePushDelivery(),
    ]);
    return planResult;
  }
  if (jobData.type === "deliver_absence_push") {
    const expectedJobId = balletAbsencePushJobId(jobData.notificationId);
    if (execution.jobId != null && execution.jobId !== expectedJobId) {
      throw new Error(`Ballet absence push job identity mismatch for notification ${jobData.notificationId}`);
    }
    const result = await processBalletAbsencePushDelivery(jobData.notificationId);
    if (result.outcome === "retryable_failed") {
      throw new Error(`Retryable Ballet absence push failure for notification ${jobData.notificationId}`);
    }
    return result;
  }
  return processBalletAutoAbsenceOccurrence(
    { balletScheduleId: jobData.balletScheduleId, classDate: jobData.classDate },
    new Date(),
    execution,
  );
}
