// ---------------------------------------------------------------------------
// checkInService — the SINGLE implementation of the "attended" transition.
//
// QR Check-in (POST /check-in/qr) and Manual booking-based Check-in
// (POST /attendance with a bookingId) are only two entry points; both call
// performBookingCheckIn() so the attendance record, credit deduction, ledger
// row, booking→attended transition and notifications are produced by exactly
// one code path. Walk-ins (no booking) are a separate, attendance-only path
// and never run this function.
//
// The caller is responsible for:
//   • opening the DB transaction,
//   • loading + locking the booking row (SELECT … FOR UPDATE),
//   • resolving the account-owner student,
//   • (QR only) verifying the booking belongs to the scanned student.
// Everything after that — every eligibility rule and every write — lives here.
// ---------------------------------------------------------------------------
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  attendanceTable,
  packageOrdersTable,
  creditTransactionsTable,
} from "@workspace/db";
import { createStudentNotification, type PendingPushJob } from "./notifications";
import { checkInWindowState } from "./occurrence";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof bookingsTable.$inferSelect;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ── Shared check-in error type (used by every entry point) ──────────────────
export type CheckInErrorCode =
  | "invalid_qr"
  | "booking_not_found"
  | "booking_mismatch"
  | "already_attended"
  | "duplicate_attendance"
  | "booking_not_actionable"
  | "booking_not_confirmed"
  | "not_todays_occurrence"
  | "check_in_too_early"
  | "check_in_closed"
  | "package_required"
  | "package_not_found"
  | "invalid_package"
  | "package_not_eligible"
  | "no_credits"
  | "candidate_key_mismatch"
  | "booking_exists_use_normal_checkin";

export interface CheckInError {
  isCheckInError: true;
  status: number;
  code: CheckInErrorCode;
  message: string;
}

export function makeCheckInError(
  status: number,
  code: CheckInErrorCode,
  message: string,
): CheckInError {
  return { isCheckInError: true, status, code, message };
}

export function isCheckInError(e: unknown): e is CheckInError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as CheckInError).isCheckInError === true
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizeLegacyEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bookingParticipantKey(booking: Booking): string {
  if (booking.participantChildId != null) return `child:${booking.participantChildId}`;
  if (booking.bookingScope === "child") return `child:unknown:${booking.id}`;
  return `self:${booking.accountOwnerStudentId ?? normalizeLegacyEmail(booking.studentEmail)}`;
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!match) return t;
  const h = Number(match[1]);
  const m = match[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

async function getBookingNotificationContext(tx: Tx, booking: Booking) {
  const [details] = await tx
    .select({
      className: classesTable.title,
      instructorName: instructorsTable.name,
      branch: schedulesTable.location,
      scheduleType: schedulesTable.type,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleDate: schedulesTable.date,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .where(eq(bookingsTable.id, booking.id))
    .limit(1);

  const start = formatTime(details?.scheduleStartTime ?? null);
  const end = formatTime(details?.scheduleEndTime ?? null);
  const dayName = details?.scheduleDayOfWeek != null ? DAY_NAMES[details.scheduleDayOfWeek] ?? null : null;
  const dateLabel = details?.scheduleDate
    ? new Date(`${details.scheduleDate}T00:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;
  const schedulePrefix = details?.scheduleType === "one_time" ? dateLabel : dayName;
  const scheduleLabel = schedulePrefix && start
    ? `${schedulePrefix} • ${end ? `${start} - ${end}` : start}`
    : null;
  const className = details?.className ?? null;

  return {
    className,
    instructorName: details?.instructorName ?? null,
    branch: details?.branch ?? null,
    scheduleLabel,
    participantName: booking.studentName,
    bookingScope: booking.bookingScope ?? (booking.participantChildId != null ? "child" : "self"),
    label: className ?? "your class",
  };
}

// ── The single attended-transition implementation ──────────────────────────
export interface PerformBookingCheckInParams {
  booking: Booking;
  /** Account-owner student (the QR identity / package owner). */
  student: { id: number; name: string; email: string };
  paymentMode: "package_credit" | "pay_at_studio";
  packageOrderId?: number | null;
  /** Audit trail — admin email or "system". */
  performedBy: string;
  /** Override the authoritative clock used for the check-in window check.
   *  Defaults to the real wall clock — only tests pass this. */
  now?: Date;
}

export interface BookingCheckInResult {
  attendanceId: number;
  studentName: string;
  studentEmail: string;
  classTitle: string | null;
  creditDeducted: boolean;
  remainingCredits: number | null;
  checkedInAt: string;
  /**
   * Push sends produced by this check-in, not yet dispatched. The caller
   * owns the enclosing db.transaction() and MUST flushPushQueue() this only
   * after that transaction resolves successfully — never before, and never
   * if it rolled back. Strip this field before sending the result to a
   * client; it is an internal handoff, not part of any public response
   * contract.
   */
  pendingPushJobs: PendingPushJob[];
}

export async function performBookingCheckIn(
  tx: Tx,
  { booking, student, paymentMode, packageOrderId, performedBy, now }: PerformBookingCheckInParams,
): Promise<BookingCheckInResult> {
  if (paymentMode === "package_credit" && packageOrderId == null) {
    throw makeCheckInError(400, "package_required", "Package credit check-in requires a packageOrderId.");
  }

  const pendingPushJobs: PendingPushJob[] = [];
  const notificationContext = await getBookingNotificationContext(tx, booking);

  // ── Step 1 — Booking must be CONFIRMED (not pending/terminal/already attended)
  const currentBookingStatus = booking.bookingStatus ?? booking.status;
  if (currentBookingStatus === "attended" || currentBookingStatus === "completed") {
    throw makeCheckInError(409, "already_attended", "This booking has already been marked as attended.");
  }
  if (currentBookingStatus === "cancelled" || currentBookingStatus === "rejected") {
    throw makeCheckInError(400, "booking_not_actionable", "Cancelled or rejected bookings cannot be checked in.");
  }
  if (currentBookingStatus !== "confirmed") {
    throw makeCheckInError(400, "booking_not_confirmed", "Only confirmed bookings can be checked in. Confirm the booking first.");
  }

  // ── Step 2 — Canonical booking occurrence + strict window (opens 2h
  // before start, including on the prior Cairo date, and closes strictly at
  // scheduled end — see lib/occurrence.ts).
  let scheduleStartTime: string | null = null;
  let scheduleEndTime: string | null = null;
  if (booking.scheduleId != null) {
    const [sched] = await tx
      .select({ startTime: schedulesTable.startTime, endTime: schedulesTable.endTime })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, booking.scheduleId))
      .limit(1);
    scheduleStartTime = sched?.startTime ?? null;
    scheduleEndTime = sched?.endTime ?? null;
  }
  const windowState = checkInWindowState(
    { startTime: scheduleStartTime, endTime: scheduleEndTime },
    booking.occurrenceDate,
    now ?? new Date(),
  );
  if (windowState === "too_early") {
    throw makeCheckInError(400, "check_in_too_early", "Check-in for this class opens 2 hours before it starts.");
  }
  if (windowState === "ended") {
    throw makeCheckInError(400, "check_in_closed", "Check-in for this class closed when it ended.");
  }
  if (windowState === "not_today") {
    throw makeCheckInError(400, "not_todays_occurrence", "This booking has no valid occurrence available for check-in.");
  }

  // ── Step 3 — One attendance per booking
  const [existingForBooking] = await tx
    .select({ id: attendanceTable.id })
    .from(attendanceTable)
    .where(eq(attendanceTable.bookingId, booking.id))
    .limit(1);
  if (existingForBooking) {
    throw makeCheckInError(409, "already_attended", "This booking already has an attendance record.");
  }

  // ── Step 4 — No duplicate attendance for the same participant + class today
  if (booking.classId != null || booking.scheduleId != null) {
    const dupConditions = [
      eq(attendanceTable.studentEmail, student.email),
      sql`(${attendanceTable.checkedInAt} AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date`,
    ];
    if (booking.scheduleId != null) {
      dupConditions.push(eq(attendanceTable.scheduleId, booking.scheduleId));
    } else {
      dupConditions.push(eq(attendanceTable.classId, booking.classId!));
    }

    const existingRows = await tx
      .select({ attendanceId: attendanceTable.id, existingBooking: bookingsTable })
      .from(attendanceTable)
      .leftJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
      .where(and(...dupConditions))
      .limit(50);

    const participantKey = bookingParticipantKey(booking);
    const existing = existingRows.find((row) => {
      if (row.existingBooking) return bookingParticipantKey(row.existingBooking) === participantKey;
      return booking.participantChildId == null && booking.bookingScope !== "child";
    });
    if (existing) {
      throw makeCheckInError(409, "duplicate_attendance", "Student is already checked in for this class today.");
    }
  }

  // ── Step 5 — Validate the selected package credit (if any)
  let selectedOrder: { id: number; studentEmail: string; remainingCredits: number; status: string } | null = null;
  if (paymentMode === "package_credit") {
    if (booking.scheduleId != null) {
      const [schedule] = await tx
        .select({ packageEligible: schedulesTable.packageEligible })
        .from(schedulesTable)
        .where(eq(schedulesTable.id, booking.scheduleId))
        .limit(1);
      if (schedule?.packageEligible === false) {
        throw makeCheckInError(400, "package_not_eligible", "This schedule is not eligible for package credits.");
      }
    }

    const [order] = await tx
      .select({
        id: packageOrdersTable.id,
        studentEmail: packageOrdersTable.studentEmail,
        remainingCredits: packageOrdersTable.remainingCredits,
        status: packageOrdersTable.status,
      })
      .from(packageOrdersTable)
      .where(eq(packageOrdersTable.id, packageOrderId!))
      .for("update");

    if (!order) {
      throw makeCheckInError(404, "package_not_found", "The selected package order could not be found.");
    }
    if (order.studentEmail !== student.email || order.status !== "active") {
      throw makeCheckInError(403, "invalid_package", "The selected package is not active for this student.");
    }
    if (order.remainingCredits <= 0) {
      throw makeCheckInError(400, "no_credits", "This package has no remaining credits.");
    }
    selectedOrder = order;
  }

  // ── Step 6 — Create attendance record (real participant identity)
  const [attendance] = await tx
    .insert(attendanceTable)
    .values({
      studentName: booking.studentName,
      studentEmail: student.email,
      studentId: student.id,
      classId: booking.classId ?? null,
      scheduleId: booking.scheduleId ?? null,
      bookingId: booking.id,
      packageOrderId: selectedOrder?.id ?? null,
      creditDeducted: paymentMode === "package_credit",
      checkedInBy: performedBy,
      status: "checked_in",
      classTitle: null,
      notes: paymentMode === "pay_at_studio" ? "Payment mode: pay at studio" : null,
      checkedInAt: new Date().toISOString(),
    })
    .returning();

  // ── Step 7 — Deduct one credit + immutable ledger row (package mode only)
  let remainingCredits: number | null = null;
  if (selectedOrder) {
    const newRemaining = selectedOrder.remainingCredits - 1;
    await tx
      .update(packageOrdersTable)
      .set({ remainingCredits: newRemaining, status: newRemaining <= 0 ? "fullyUsed" : selectedOrder.status })
      .where(eq(packageOrdersTable.id, selectedOrder.id));

    await tx.insert(creditTransactionsTable).values({
      packageOrderId: selectedOrder.id,
      studentId: student.id,
      type: "attendance_deduction",
      delta: -1,
      balanceBefore: selectedOrder.remainingCredits,
      balanceAfter: newRemaining,
      referenceId: attendance.id,
      referenceType: "attendance",
      notes: `Check-in for ${notificationContext.label}`,
      createdBy: performedBy,
    });
    remainingCredits = newRemaining;
  }

  // ── Step 8 — Mark booking attended
  await tx
    .update(bookingsTable)
    .set({ status: "attended", bookingStatus: "attended" })
    .where(eq(bookingsTable.id, booking.id));

  // ── Step 9 — Notifications. dispatch (the actual push send) is queued via
  // pushQueue, not fired here — the caller flushes it strictly after this
  // transaction commits (see pendingPushJobs on the return value below).
  await createStudentNotification(tx, {
    studentId: student.id,
    title: "Checked in",
    body: `You have been checked in for ${notificationContext.label}.`,
    type: "attendance_checked_in",
    relatedEntityType: "booking",
    relatedEntityId: booking.id,
    metadata: {
      bookingId: booking.id,
      classId: booking.classId,
      scheduleId: booking.scheduleId,
      className: notificationContext.className,
      instructorName: notificationContext.instructorName,
      branch: notificationContext.branch,
      scheduleLabel: notificationContext.scheduleLabel,
      participantName: notificationContext.participantName,
      bookingScope: notificationContext.bookingScope,
    },
    pushQueue: pendingPushJobs,
  });

  if (selectedOrder) {
    await createStudentNotification(tx, {
      studentId: student.id,
      title: "Credit used",
      body: `1 credit was used for ${notificationContext.label}.`,
      type: "credits_exhausted",
      relatedEntityType: "booking",
      relatedEntityId: booking.id,
      metadata: {
        bookingId: booking.id,
        className: notificationContext.className,
        instructorName: notificationContext.instructorName,
        branch: notificationContext.branch,
        scheduleLabel: notificationContext.scheduleLabel,
        participantName: notificationContext.participantName,
        bookingScope: notificationContext.bookingScope,
        remainingCredits,
      },
      pushQueue: pendingPushJobs,
    });

    if (remainingCredits === 0) {
      await createStudentNotification(tx, {
        studentId: student.id,
        title: "Package credits used",
        body: "Your package credits have been used.",
        type: "credits_exhausted",
        relatedEntityType: "package_order",
        relatedEntityId: selectedOrder.id,
        metadata: {
          bookingId: booking.id,
          className: notificationContext.className,
          instructorName: notificationContext.instructorName,
          branch: notificationContext.branch,
          scheduleLabel: notificationContext.scheduleLabel,
          participantName: notificationContext.participantName,
          bookingScope: notificationContext.bookingScope,
          remainingCredits,
        },
        pushQueue: pendingPushJobs,
      });
    }
  }

  return {
    attendanceId: attendance.id,
    studentName: booking.studentName,
    studentEmail: student.email,
    classTitle: null,
    creditDeducted: paymentMode === "package_credit",
    remainingCredits,
    checkedInAt: attendance.checkedInAt,
    pendingPushJobs,
  };
}
