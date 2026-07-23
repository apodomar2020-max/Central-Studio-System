/**
 * balletAttendanceWrite — the SINGLE implementation of the Ballet "record
 * attendance" transition.
 *
 * Three trusted, server-controlled entry sources call this function — never
 * an arbitrary client-supplied string:
 *
 *   "gateway"          — the unified QR/phone/name Attendance gateway. A
 *                         live operational check-in: status is forced to
 *                         "checked_in" and classDate must equal the
 *                         authoritative occurrence currently open in Cairo
 *                         (including a next-day occurrence whose window
 *                         opens before midnight).
 *   "applicationDetail" — the existing manual Application Detail control.
 *                         Historical/staff-correction path: past-date
 *                         checked_in/late is allowed, today's obeys the live
 *                         window, future dates are always rejected, absent
 *                         requires the occurrence to have already ended.
 *   "autoAbsence"       — the automatic-absence Worker. Status is forced to
 *                         "absent"; the Worker itself is the timing
 *                         authority (it only calls this after independently
 *                         proving the occurrence has ended — see
 *                         balletAutoAbsence.ts), so this function does not
 *                         re-run the live-clock check for that source.
 *
 * durationMinutes is NEVER accepted from any caller — always derived from
 * the canonical Schedule's own start/end times at write time, so a stale or
 * hostile client value can never be persisted as history.
 *
 * Never trust eligibility computed by an earlier resolver call — this
 * function re-derives everything itself from the database on every call.
 *
 * Accepts an optional `client` (a drizzle transaction or the default `db`)
 * so a caller — specifically the auto-absence Worker — can compose this
 * write inside a larger transaction that also durably records a
 * notification intent for the same student, atomically.
 *
 * PATCH /admin/ballet/attendance/:id (status/note correction of an
 * ALREADY-RECORDED row) intentionally does not run through this function —
 * it is a lightweight historical correction, not a fresh occurrence
 * recording, and re-running "is now inside this occurrence's live window"
 * against a record from last week would make corrections impossible.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  balletApplicationsTable,
  balletLevelAssignmentsTable,
  balletSchedulesTable,
  balletClassesTable,
  balletPaymentsTable,
  attendanceTable,
} from "@workspace/db";
import {
  BALLET_ATTENDED_ATTENDANCE_STATUSES,
  BALLET_ABSENT_ATTENDANCE_STATUS,
  BALLET_CHECKED_IN_ATTENDANCE_STATUS,
  type BalletAttendanceStatus,
} from "@workspace/api-zod";

import { isAssignmentReadyClass, scheduleShapeCondition } from "./balletClassEntitlement";
import { checkInWindowState, cairoNow, isoDateDayOfWeek, attendanceOccurrenceDateForWeeklySchedule } from "./occurrence";

export type BalletAttendanceSource = "gateway" | "applicationDetail" | "autoAbsence";

export type BalletAttendanceErrorCode =
  | "assignment_not_found"
  | "owner_mismatch"
  | "child_mismatch"
  | "application_not_active"
  | "assignment_not_active"
  | "no_group_assigned"
  | "invalid_schedule"
  | "wrong_day_of_week"
  | "too_early"
  | "check_in_closed"
  | "not_yet_ended"
  | "not_todays_occurrence"
  | "class_date_in_future"
  | "no_active_subscription"
  | "invalid_status_for_source"
  | "invalid_duration"
  | "duplicate_attendance";

export interface BalletAttendanceError {
  isBalletAttendanceError: true;
  status: number;
  code: BalletAttendanceErrorCode;
  message: string;
  existingAttendanceId?: number | null;
}

function makeBalletAttendanceError(
  status: number,
  code: BalletAttendanceErrorCode,
  message: string,
  existingAttendanceId: number | null = null,
): BalletAttendanceError {
  return { isBalletAttendanceError: true, status, code, message, existingAttendanceId };
}

export function isBalletAttendanceError(e: unknown): e is BalletAttendanceError {
  return typeof e === "object" && e !== null && (e as BalletAttendanceError).isBalletAttendanceError === true;
}

/** True when a paid cycle's date-only range covers `date` — NOT "was ever paid". */
export function subscriptionCoversDate(startDate: string | null, expiresAt: string | null, date: string): boolean {
  if (!startDate || !expiresAt) return false;
  return startDate <= date && expiresAt >= date;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Anything with the same query surface as `db` — either `db` itself or a transaction handle. */
export type BalletAttendanceDbClient = typeof db | Tx;

export interface PerformBalletAttendanceWriteParams {
  levelAssignmentId: number;
  balletScheduleId: number;
  /**
   * Required for every source. For "gateway" and "autoAbsence" this is
   * revalidated against the server-derived occurrence date and REJECTED if
   * it doesn't match — it is never blindly trusted, even though those two
   * sources are expected to always pass the correct value themselves.
   */
  classDate: string;
  /**
   * For "gateway", must be "checked_in" — anything else is rejected.
   * For "autoAbsence", must be "absent" — anything else is rejected.
   * For "applicationDetail", any canonical status is accepted (subject to
   * the existing per-status time-window rules below).
   */
  status: BalletAttendanceStatus;
  note?: string | null;
  /** Admin email, or "system" for the automatic-absence Worker. */
  performedBy: string;
  source: BalletAttendanceSource;
  /**
   * The resolved account's studentId. Required (non-null) for "gateway" —
   * candidate IDs from an earlier resolver response are untrusted and must
   * be re-validated to actually belong to this account. Not applicable to
   * "applicationDetail" (already scoped by the page it's rendered on) or
   * "autoAbsence" (no account is doing the resolving).
   */
  ownerStudentId?: number | null;
  now?: Date;
  /** Participate in a caller-supplied transaction instead of the default `db` — used by the auto-absence Worker to make the Attendance write atomic with a notification insert. */
  client?: BalletAttendanceDbClient;
}

export interface BalletAttendanceWriteResult {
  attendance: typeof attendanceTable.$inferSelect;
  applicationId: number;
  childName: string;
  parentStudentId: number | null;
  parentEmail: string;
}

export async function performBalletAttendanceWrite(
  params: PerformBalletAttendanceWriteParams,
): Promise<BalletAttendanceWriteResult> {
  const {
    levelAssignmentId,
    balletScheduleId,
    classDate,
    status,
    note,
    performedBy,
    source,
    ownerStudentId,
    now = new Date(),
    client = db,
  } = params;

  // ── Source-mode status enforcement — never trust a client-supplied status
  // for the two automated sources. ────────────────────────────────────────
  if (source === "gateway" && status !== BALLET_CHECKED_IN_ATTENDANCE_STATUS) {
    throw makeBalletAttendanceError(422, "invalid_status_for_source", "The unified Attendance gateway may only record a live check-in.");
  }
  if (source === "autoAbsence" && status !== BALLET_ABSENT_ATTENDANCE_STATUS) {
    throw makeBalletAttendanceError(422, "invalid_status_for_source", "The automatic-absence Worker may only record an absence.");
  }
  if (source === "gateway" && ownerStudentId == null) {
    throw makeBalletAttendanceError(403, "owner_mismatch", "The unified Attendance gateway requires a resolved account.");
  }

  // ── Ownership + lifecycle ────────────────────────────────────────────────
  const [assignment] = await client
    .select({
      id: balletLevelAssignmentsTable.id,
      status: balletLevelAssignmentsTable.status,
      levelId: balletLevelAssignmentsTable.levelId,
      groupId: balletLevelAssignmentsTable.groupId,
      childId: balletLevelAssignmentsTable.childId,
      applicationId: balletLevelAssignmentsTable.applicationId,
      applicationStatus: balletApplicationsTable.status,
      applicationChildId: balletApplicationsTable.childId,
      parentStudentId: balletApplicationsTable.parentStudentId,
      childName: balletApplicationsTable.childName,
      parentEmail: balletApplicationsTable.parentEmail,
    })
    .from(balletLevelAssignmentsTable)
    .innerJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletLevelAssignmentsTable.applicationId))
    .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
    .limit(1);

  if (!assignment) {
    throw makeBalletAttendanceError(404, "assignment_not_found", "Level assignment not found.");
  }
  if (ownerStudentId != null && assignment.parentStudentId !== ownerStudentId) {
    throw makeBalletAttendanceError(403, "owner_mismatch", "This enrollment does not belong to the resolved account.");
  }
  // Mirrors balletMyClasses.ts's validAssignment(): only enforced when the
  // application has a linked child — a null assignment.childId against a
  // linked application is a mismatch, not a pass.
  if (assignment.applicationChildId != null && assignment.childId !== assignment.applicationChildId) {
    throw makeBalletAttendanceError(422, "child_mismatch", "Level assignment's child does not match the application's linked child.");
  }
  if (assignment.applicationStatus !== "active") {
    throw makeBalletAttendanceError(422, "application_not_active", "Ballet application is not active — cannot record attendance.");
  }
  if (assignment.status !== "active") {
    throw makeBalletAttendanceError(422, "assignment_not_active", "Level assignment is not active — cannot record attendance.");
  }
  if (assignment.groupId == null) {
    throw makeBalletAttendanceError(422, "no_group_assigned", "This student has no assigned group — cannot record attendance.");
  }

  // ── Structural chain: Schedule belongs to assigned Group+Level, is itself
  // well-formed, and its owning Class is canonical/active/instructor-active
  // (never trust a client-supplied classId — always derive it from the
  // schedule). ──────────────────────────────────────────────────────────────
  const [scheduleLink] = await client
    .select({
      scheduleId: balletSchedulesTable.id,
      classId: balletSchedulesTable.classId,
      durationMins: balletSchedulesTable.durationMins,
      dayOfWeek: balletSchedulesTable.dayOfWeek,
      startTime: balletSchedulesTable.startTime,
      endTime: balletSchedulesTable.endTime,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .where(and(
      eq(balletClassesTable.groupId, assignment.groupId),
      eq(balletClassesTable.levelId, assignment.levelId),
      eq(balletSchedulesTable.id, balletScheduleId),
      scheduleShapeCondition(),
      isAssignmentReadyClass(),
    ))
    .limit(1);

  if (!scheduleLink) {
    throw makeBalletAttendanceError(422, "invalid_schedule", "The selected schedule does not belong to this student's group, or is cancelled/inactive.");
  }
  if (isoDateDayOfWeek(classDate) !== scheduleLink.dayOfWeek) {
    throw makeBalletAttendanceError(422, "wrong_day_of_week", "The class date does not match the schedule's day of week.");
  }

  // ── Strict Cairo time policy per source — see lib/occurrence.ts. ──────────
  const attendedOrLate = (BALLET_ATTENDED_ATTENDANCE_STATUSES as readonly string[]).includes(status);
  const isAbsent = status === BALLET_ABSENT_ATTENDANCE_STATUS;
  const nowCairo = cairoNow(now);

  if (source === "gateway") {
    // A live operational check-in: classDate must be the occurrence that is
    // addressable at the authoritative Cairo instant. This is usually today,
    // but an early-morning occurrence can open on the previous calendar day.
    const authoritativeOccurrenceDate = attendanceOccurrenceDateForWeeklySchedule(scheduleLink, now);
    if (classDate !== authoritativeOccurrenceDate) {
      throw makeBalletAttendanceError(400, "not_todays_occurrence", "This occurrence is not currently addressable.");
    }
    const windowState = checkInWindowState({ startTime: scheduleLink.startTime, endTime: scheduleLink.endTime }, classDate, now);
    if (windowState === "too_early") {
      throw makeBalletAttendanceError(400, "too_early", "Check-in for this class opens 2 hours before it starts.");
    }
    if (windowState === "ended") {
      throw makeBalletAttendanceError(400, "check_in_closed", "Check-in for this class closed when it ended.");
    }
  } else if (source === "applicationDetail") {
    if (attendedOrLate) {
      // A future occurrence can never be checked in. A PAST occurrence is a
      // legitimate historical/backfill correction (this control's
      // documented "historical review, staff correction" use) and is exempt
      // from the live-clock window. Only TODAY's occurrence goes through
      // the live window.
      if (classDate > nowCairo.date) {
        throw makeBalletAttendanceError(422, "class_date_in_future", "Cannot check in for a future class date.");
      }
      if (classDate === nowCairo.date) {
        const windowState = checkInWindowState({ startTime: scheduleLink.startTime, endTime: scheduleLink.endTime }, classDate, now);
        if (windowState === "too_early") {
          throw makeBalletAttendanceError(400, "too_early", "Check-in for this class opens 2 hours before it starts.");
        }
        if (windowState === "ended") {
          throw makeBalletAttendanceError(400, "check_in_closed", "Check-in for this class closed when it ended.");
        }
      }
      // classDate < today: historical entry, always allowed.
    } else if (isAbsent) {
      if (classDate > nowCairo.date) {
        throw makeBalletAttendanceError(422, "class_date_in_future", "Cannot record an absence for a future class date.");
      }
      if (classDate === nowCairo.date) {
        const windowState = checkInWindowState({ startTime: scheduleLink.startTime, endTime: scheduleLink.endTime }, classDate, now);
        if (windowState !== "ended") {
          throw makeBalletAttendanceError(422, "not_yet_ended", "An absence can only be recorded once the class has ended.");
        }
      }
      // classDate < today: the occurrence has already ended by definition.
    }
    // "cancelled" carries no time restriction — an administrative correction.
  }
  // source === "autoAbsence": no live-clock check here at all — the Worker
  // is the timing authority and only calls this function after
  // independently proving (at execution time, against the real Cairo clock)
  // that the occurrence has genuinely ended. See balletAutoAbsence.ts.

  // ── Paid subscription must cover THIS occurrence date — never "was ever
  // paid" — cancelled writes are exempt (they consume nothing either way).
  if (attendedOrLate || isAbsent) {
    const cycles = await client
      .select({
        status: balletPaymentsTable.status,
        subscriptionStartDate: balletPaymentsTable.subscriptionStartDate,
        subscriptionExpiresAt: balletPaymentsTable.subscriptionExpiresAt,
      })
      .from(balletPaymentsTable)
      .where(eq(balletPaymentsTable.applicationId, assignment.applicationId));
    const covers = cycles.some((cycle) =>
      cycle.status === "paid"
      && subscriptionCoversDate(cycle.subscriptionStartDate, cycle.subscriptionExpiresAt, classDate),
    );
    if (!covers) {
      throw makeBalletAttendanceError(422, "no_active_subscription", "No paid Ballet subscription covers this occurrence date.");
    }
  }

  // Duration is ALWAYS derived from the canonical Schedule at write time —
  // no caller (gateway DTO, Application Detail form, Worker queue payload)
  // may supply or influence it. scheduleShapeCondition() already proved
  // durationMins is a positive integer consistent with start/end above, so
  // this is just a defensive re-check, never a silent 0/null coercion.
  const durationMinutes = scheduleLink.durationMins;
  if (durationMinutes == null || durationMinutes <= 0) {
    throw makeBalletAttendanceError(422, "invalid_duration", "The schedule has no valid duration to snapshot.");
  }

  try {
    // Wrapped in its own transaction (a SAVEPOINT when `client` is already a
    // caller-supplied tx, e.g. the auto-absence Worker composing this with a
    // notification insert) so a unique-violation below can be recovered from
    // without leaving the outer transaction poisoned. Postgres aborts an
    // entire transaction on error until ROLLBACK; without this, the
    // existing-row lookup in the catch block would itself fail with
    // "current transaction is aborted" whenever `client` is a nested tx.
    const [attendance] = await client.transaction(async (writeTx) =>
      writeTx
        .insert(attendanceTable)
        .values({
          balletLevelAssignmentId: levelAssignmentId,
          balletScheduleId,
          balletClassId: scheduleLink.classId,
          classDate,
          status,
          durationMinutes,
          notes: note ?? null,
          studentName: assignment.childName,
          studentEmail: assignment.parentEmail,
          checkedInBy: performedBy,
        })
        .returning(),
    );
    return {
      attendance,
      applicationId: assignment.applicationId,
      childName: assignment.childName,
      parentStudentId: assignment.parentStudentId,
      parentEmail: assignment.parentEmail,
    };
  } catch (err: unknown) {
    const cause = (err as { cause?: unknown }).cause;
    const pgErr = (cause ?? err) as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === "attendance_ballet_unique_per_slot_date") {
      // Never silently overwrite — surface the existing row's id.
      const [existing] = await client
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(and(
          eq(attendanceTable.balletLevelAssignmentId, levelAssignmentId),
          eq(attendanceTable.balletScheduleId, balletScheduleId),
          eq(attendanceTable.classDate, classDate),
        ))
        .limit(1);
      throw makeBalletAttendanceError(
        409,
        "duplicate_attendance",
        "Attendance for this schedule and date is already recorded.",
        existing?.id ?? null,
      );
    }
    throw err;
  }
}
