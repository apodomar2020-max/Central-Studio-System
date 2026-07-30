// ---------------------------------------------------------------------------
// checkInService — the SINGLE implementation of the "attended" transition.
//
// QR Check-in (POST /check-in/qr) and Manual booking-based Check-in
// (POST /attendance with a bookingId) are only two entry points; both call
// performBookingCheckIn() so participant verification, attendance,
// booking→attended transition and notification are produced by exactly one
// code path. Booking credit was already consumed during Phase D booking and
// is only verified here. Walk-ins use their separate atomic settlement paths.
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
  paymentRecordsTable,
  paymentEventsTable,
  studentsTable,
  type PaymentRecordRequestedChannel,
} from "@workspace/db";
import { createStudentNotification } from "./notifications";
import { checkInWindowState, currentOccurrenceDate } from "./occurrence";
import { resolveSingleClassPriceEgp } from "./singleClassPricing";
import { egpToMinor } from "./money";
import { sendPushNotification } from "./pushNotifications";
import { logger } from "./logger";
import { resolveBookingParticipant } from "./participants/resolveBookingParticipant";
import { resolveParticipantPackageCredit } from "./bookings/resolveParticipantPackageCredit";
import type { ParticipantType } from "@workspace/api-zod";
import { calculateAgeOnDate, parseIsoDate } from "./eligibility/dateOnly";
import { getCairoBusinessDate } from "./eligibility/dateOnly";
import type { IsoDate } from "./eligibility/types";
import { evaluateParticipantOnOccurrence } from "./eligibility/participantOccurrenceEligibility";

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
  | "booking_participant_missing"
  | "booking_participant_mismatch"
  | "booking_credit_integrity_mismatch"
  | "participant_not_found"
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
  | "invalid_price_configuration"
  | "walkin_not_paid"
  | "walkin_price_changed"
  | "WALKIN_BLOCKED_BY_EXISTING_BOOKING"
  | "WALKIN_PARTICIPANT_INELIGIBLE"
  | "PARTICIPANT_DOB_REQUIRED"
  | "PAYMENT_METHOD_REQUIRED"
  | "payment_integrity_error"
  | "BOOKING_PENDING_APPROVAL"
  | "AMBIGUOUS_ACTIVE_BOOKINGS"
  | "SOURCE_CLASS_OR_SCHEDULE_UNAVAILABLE"
  | "PACKAGE_PARTICIPANT_MISMATCH"
  | "PACKAGE_EXPIRED"
  | "PACKAGE_NO_CREDITS"
  | "PACKAGE_DANCE_TYPE_MISMATCH"
  | "PACKAGE_CREDIT_INTEGRITY_MISMATCH";

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

async function assertGenuineEligibleWalkIn(
  tx: Tx,
  params: {
    accountId: number;
    participantChildId: number | null;
    participantDateOfBirth: string | null;
    scheduleId: number;
    classId: number | null;
    occurrenceDate: string;
  },
): Promise<void> {
  const [blockingBooking] = await tx
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(and(
      eq(bookingsTable.accountOwnerStudentId, params.accountId),
      eq(bookingsTable.scheduleId, params.scheduleId),
      eq(bookingsTable.occurrenceDate, params.occurrenceDate),
      sql`${bookingsTable.participantChildId} is not distinct from ${params.participantChildId}`,
      sql`${bookingsTable.bookingStatus} in ('pending','confirmed','attended')`,
    ))
    .limit(1);
  if (blockingBooking) {
    throw makeCheckInError(409, "WALKIN_BLOCKED_BY_EXISTING_BOOKING", "An existing booking already covers this participant and occurrence.");
  }
  if (params.classId == null) return;
  const [klass] = await tx
    .select({
      allowAllAges: classesTable.allowAllAges,
      minAge: classesTable.minAge,
      maxAge: classesTable.maxAge,
    })
    .from(classesTable)
    .where(eq(classesTable.id, params.classId))
    .limit(1);
  if (!klass || (klass.allowAllAges == null && klass.minAge == null && klass.maxAge == null)) return;
  const eligibility = evaluateParticipantOnOccurrence(params.participantDateOfBirth, params.occurrenceDate, {
    allowAllAges: klass.allowAllAges === true,
    minAge: klass.minAge,
    maxAge: klass.maxAge,
  });
  if (!eligibility.eligible) {
    throw makeCheckInError(
      409,
      eligibility.reasonCode === "PARTICIPANT_DOB_REQUIRED" ? "PARTICIPANT_DOB_REQUIRED" : "WALKIN_PARTICIPANT_INELIGIBLE",
      eligibility.reasonCode === "PARTICIPANT_DOB_REQUIRED"
        ? "A canonical date of birth is required for this participant."
        : "This participant is not eligible for the selected class occurrence.",
    );
  }
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
  /** Optional caller assertion (manual/gateway flows). The booking remains authoritative. */
  expectedParticipantType?: ParticipantType | null;
  expectedParticipantChildId?: number | null;
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
  participantType: ParticipantType;
  participantChildId: number | null;
  participantName: string;
  attendanceSource: "booking";
  paymentSource: "booking_package_credit" | "booking_pay_at_studio";
  packageOrderId: number | null;
}

export async function performBookingCheckIn(
  tx: Tx,
  {
    booking,
    student,
    paymentMode,
    packageOrderId,
    expectedParticipantType,
    expectedParticipantChildId,
    performedBy,
    now,
  }: PerformBookingCheckInParams,
): Promise<BookingCheckInResult> {
  if (
    booking.accountOwnerStudentId !== student.id
    || normalizeLegacyEmail(booking.studentEmail) !== normalizeLegacyEmail(student.email)
  ) {
    throw makeCheckInError(403, "booking_mismatch", "This booking does not belong to the resolved account.");
  }
  if (booking.participantType !== "self" && booking.participantType !== "child") {
    throw makeCheckInError(
      409,
      "booking_participant_missing",
      "This booking has no canonical participant identity and cannot be checked in automatically.",
    );
  }
  if (
    expectedParticipantType != null
    && (
      expectedParticipantType !== booking.participantType
      || (expectedParticipantChildId ?? null) !== booking.participantChildId
    )
  ) {
    throw makeCheckInError(
      409,
      "booking_participant_mismatch",
      "The submitted attendance participant does not match the booking.",
    );
  }

  const participantResolution = await resolveBookingParticipant(tx, student.id, {
    participantType: booking.participantType,
    participantChildId: booking.participantChildId,
  });
  if (!participantResolution.ok) {
    throw makeCheckInError(
      participantResolution.status,
      "booking_participant_mismatch",
      "The booking participant is no longer valid for this account.",
    );
  }
  const participant = participantResolution.participant;
  if (
    participant.participantType !== booking.participantType
    || participant.participantChildId !== booking.participantChildId
  ) {
    throw makeCheckInError(409, "booking_participant_mismatch", "The attendance participant does not match the booking.");
  }
  if (packageOrderId != null && packageOrderId !== booking.packageOrderId) {
    throw makeCheckInError(409, "booking_participant_mismatch", "The submitted package does not match the booking credit source.");
  }

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

  // ── Step 5 — Verify the booking-time deduction. Phase D already consumed
  // the credit, so attendance must never lock/decrement the package again.
  const bookingUsesPackage = booking.paymentMode === "package_credit" || booking.packageOrderId != null;
  if (bookingUsesPackage) {
    if (booking.packageOrderId == null) {
      throw makeCheckInError(409, "booking_credit_integrity_mismatch", "The booking credit source is incomplete.");
    }
    const [bookingDeduction] = await tx
      .select({
        id: creditTransactionsTable.id,
        studentId: creditTransactionsTable.studentId,
        participantType: creditTransactionsTable.participantType,
        participantChildId: creditTransactionsTable.participantChildId,
        packageOrderId: creditTransactionsTable.packageOrderId,
      })
      .from(creditTransactionsTable)
      .where(and(
        eq(creditTransactionsTable.bookingId, booking.id),
        eq(creditTransactionsTable.packageOrderId, booking.packageOrderId),
        eq(creditTransactionsTable.type, "booking_deduction"),
      ))
      .limit(1);
    if (
      !bookingDeduction
      || bookingDeduction.studentId !== student.id
      || bookingDeduction.participantType !== participant.participantType
      || bookingDeduction.participantChildId !== participant.participantChildId
    ) {
      throw makeCheckInError(
        409,
        "booking_credit_integrity_mismatch",
        "The booking credit deduction could not be verified. No attendance was recorded.",
      );
    }
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
      packageOrderId: booking.packageOrderId ?? null,
      participantType: participant.participantType,
      participantChildId: participant.participantChildId,
      participantDateOfBirthSnapshot: booking.participantDateOfBirthSnapshot,
      participantAgeOnOccurrence: booking.participantAgeOnOccurrence,
      eligibilityEvaluatedOn: booking.eligibilityEvaluatedOn,
      attendanceSource: "booking",
      paymentSource: bookingUsesPackage ? "booking_package_credit" : "booking_pay_at_studio",
      creditDeducted: false,
      checkedInBy: performedBy,
      status: "checked_in",
      classTitle: null,
      notes: bookingUsesPackage ? "Credit deducted at booking" : "Payment mode: pay at studio",
      checkedInAt: new Date().toISOString(),
    })
    .returning();

  // ── Step 7 — Mark booking attended
  await tx
    .update(bookingsTable)
    .set({ status: "attended", bookingStatus: "attended" })
    .where(eq(bookingsTable.id, booking.id));

  // ── Step 8 — Notification
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
  });

  return {
    attendanceId: attendance.id,
    studentName: booking.studentName,
    studentEmail: student.email,
    classTitle: null,
    creditDeducted: false,
    remainingCredits: null,
    checkedInAt: attendance.checkedInAt,
    participantType: participant.participantType,
    participantChildId: participant.participantChildId,
    participantName: participant.displayName,
    attendanceSource: "booking",
    paymentSource: bookingUsesPackage ? "booking_package_credit" : "booking_pay_at_studio",
    packageOrderId: booking.packageOrderId ?? null,
  };
}

// ---------------------------------------------------------------------------
// performStudioWalkIn — Finance Phase 2B-4: Studio Walk-in Atomic Monetary
// Capture.
//
// A genuinely SEPARATE write path from performBookingCheckIn() above: it
// creates its own synthetic booking (there is no pre-existing booking to
// check in against — that's what makes it a walk-in), then performs the
// SAME attended-transition shape (attendance row) plus the new Finance
// capture, all inside one transaction. Called ONLY when the Admin has
// EXPLICITLY selected settlementMode:"pay_at_studio" for this walk-in.
// Package availability is never consulted here and never overrides this
// choice — even a participant with valid package credits leaves those
// credits byte-for-byte unchanged on this path. See
// STUDIO_WALKIN_EXPLICIT_SETTLEMENT_POLICY.md.
//
// The caller (attendance.ts) is responsible for the Not Paid short-circuit
// (settlementMode:"not_paid" → abort before ever calling this) and for opening the
// transaction / dispatching the returned pendingPush after it commits —
// mirroring the exact pattern already established in Phase 2B-1/2B-2
// (packageOrders.ts / bookings.ts): the notification ROW is inserted here
// (dispatchPush:false, atomic with everything else); the actual push send
// is deferred to the caller, post-commit.
// ---------------------------------------------------------------------------
export interface PerformStudioWalkInParams {
  studentName: string;
  studentEmail: string;
  /** Validated account id, when the walk-in is linked to a real account (optional — many walk-ins are unlinked). */
  studentId?: number | null;
  /** Validated child id (childrenTable.parentId === studentId already checked by the caller) — set only for a child walk-in. */
  childId?: number | null;
  classId?: number | null;
  scheduleId?: number | null;
  /** Authenticated admin confirming payment — system_users.id. */
  adminId: number;
  confirmedPaymentMethod: "cash" | "card";
  /** Audit trail — admin email, matches the existing checkedInBy convention. */
  performedBy: string;
  /**
   * The exact price the caller displayed to the Admin before this
   * confirmation (e.g. the Attendance Gateway's resolve() response). When
   * provided, it must equal the price re-resolved here right now, or the
   * whole operation aborts with invalid_price_configuration-style
   * protection (see walkin_price_changed below) rather than silently
   * capturing a different amount than what was shown.
   */
  expectedPriceEgp?: number | null;
  now?: Date;
}

export interface StudioWalkInPendingPush {
  studentId: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  notificationId: number;
}

export interface StudioWalkInResult {
  bookingId: number;
  attendanceId: number;
  paymentRecordId: number;
  studentName: string;
  studentEmail: string;
  grossAmountMinor: number;
  finalPayableAmountMinor: number;
  checkedInAt: string;
  participantType: ParticipantType;
  participantChildId: number | null;
  participantName: string;
  attendanceSource: "walk_in";
  paymentSource: "walk_in_pay_at_studio";
  pendingPush: StudioWalkInPendingPush | null;
}

export async function performStudioWalkIn(
  tx: Tx,
  params: PerformStudioWalkInParams,
): Promise<StudioWalkInResult> {
  const now = params.now ?? new Date();
  let accountOwnerStudentId = params.studentId ?? null;
  if (accountOwnerStudentId == null) {
    const [account] = await tx
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(sql`lower(trim(${studentsTable.email})) = ${normalizeLegacyEmail(params.studentEmail)}`)
      .limit(1);
    accountOwnerStudentId = account?.id ?? null;
  }
  if (accountOwnerStudentId == null) {
    throw makeCheckInError(404, "participant_not_found", "A linked account is required for Studio walk-in attendance.");
  }
  const participantResolution = await resolveBookingParticipant(tx, accountOwnerStudentId, {
    participantType: params.childId != null ? "child" : "self",
    participantChildId: params.childId ?? null,
  });
  if (!participantResolution.ok) {
    throw makeCheckInError(
      participantResolution.status,
      "booking_participant_mismatch",
      "The selected walk-in participant is unavailable for this account.",
    );
  }
  const participant = participantResolution.participant;
  const canonicalStudentName = participant.displayName;
  const canonicalStudentEmail = participantResolution.account.email;

  // ── Step: resolve the exact positive server price — never a client value,
  // never a silent zero fallback. Same resolver Single-Class Booking
  // Creation Capture and the Finance Phase 1 read model both use, so the
  // price this function captures can never disagree with what any other
  // surface displays for the same schedule/class.
  const priceEgp = await resolveSingleClassPriceEgp(tx, params.scheduleId ?? null);
  if (!(priceEgp > 0)) {
    throw makeCheckInError(
      409,
      "invalid_price_configuration",
      "No valid Single-Class price is configured for this class/schedule. Configure a price before recording a paid walk-in.",
    );
  }
  // ── Price-binding guard: if the caller tells us what price it displayed
  // to the Admin (Attendance Gateway's resolve() response), it must match
  // what we just re-resolved right now exactly — otherwise the configured
  // price changed between preview and confirmation, and we must never
  // silently capture a different amount than the one the Admin actually
  // saw and confirmed against.
  const grossAmountMinor = egpToMinor(priceEgp);
  if (
    params.expectedPriceEgp != null &&
    egpToMinor(params.expectedPriceEgp) !== grossAmountMinor
  ) {
    throw makeCheckInError(
      409,
      "walkin_price_changed",
      "The class price changed since it was displayed — please review the updated price and confirm again.",
    );
  }

  const discountAmountMinor = 0;
  const finalPayableAmountMinor = grossAmountMinor - discountAmountMinor;

  // ── Occurrence date, resolved the exact same way the ordinary booking
  // route does (currentOccurrenceDate), for a schedule-linked walk-in.
  let occurrenceDate: string | null = null;
  if (params.scheduleId != null) {
    const [schedule] = await tx
      .select({
        type: schedulesTable.type,
        date: schedulesTable.date,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
      })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, params.scheduleId))
      .limit(1);
    if (schedule) occurrenceDate = currentOccurrenceDate(schedule);
  }

  const checkedInAtIso = now.toISOString();
  const evaluationDate = (occurrenceDate ?? getCairoBusinessDate(now)) as IsoDate;
  if (params.scheduleId != null && occurrenceDate != null) {
    await assertGenuineEligibleWalkIn(tx, {
      accountId: accountOwnerStudentId,
      participantChildId: participant.participantChildId,
      participantDateOfBirth: participant.dateOfBirth,
      scheduleId: params.scheduleId,
      classId: params.classId ?? null,
      occurrenceDate,
    });
  }
  const parsedDob = participant.dateOfBirth
    ? parseIsoDate(participant.dateOfBirth, { today: evaluationDate })
    : null;
  const participantAge = parsedDob?.eligible
    ? calculateAgeOnDate(parsedDob.value!, evaluationDate)
    : null;

  // ── Insert the synthetic booking. bookingStatus/paymentStatus/status are
  // set directly to their terminal "already attended, already paid" shape
  // — this confirmation IS the attendance event, happening atomically with
  // it, not a separate pending state that something else confirms later.
  const [booking] = await tx
    .insert(bookingsTable)
    .values({
      studentName: canonicalStudentName,
      studentEmail: normalizeLegacyEmail(canonicalStudentEmail),
      accountOwnerStudentId,
      participantType: participant.participantType,
      participantChildId: params.childId ?? null,
      bookingScope: params.childId != null ? "child" : "self",
      scheduleId: params.scheduleId ?? null,
      classId: params.classId ?? null,
      occurrenceDate,
      participantDateOfBirthSnapshot: parsedDob?.eligible ? parsedDob.value : null,
      participantAgeOnOccurrence: participantAge,
      eligibilityEvaluatedOn: occurrenceDate,
      paymentMode: "pay_at_studio",
      bookingStatus: "attended",
      paymentStatus: "paid",
      status: "attended",
      notes: "Studio walk-in",
    })
    .returning();

  // ── Finance capture: payment_records + payment_events, same transaction.
  const [paymentRecord] = await tx
    .insert(paymentRecordsTable)
    .values({
      flowType: "studio_walkin",
      packageOrderId: null,
      bookingId: booking.id,
      captureOrigin: "live_capture",
      occurredAt: checkedInAtIso,
      evidenceClass: "confirmed",
      amountAvailability: "exact",
      amountSource: "creation_snapshot",
      grossAmountMinor,
      discountAmountMinor,
      finalPayableAmountMinor,
      paidAmountMinor: finalPayableAmountMinor,
      refundedAmountMinor: 0,
      currency: "EGP",
      requestedPaymentChannel: "pay_at_studio" as PaymentRecordRequestedChannel,
      rawRequestedChannel: "pay_at_studio",
      confirmedPaymentMethod: params.confirmedPaymentMethod,
      rawConfirmedMethod: null,
      status: "paid",
      paidAt: checkedInAtIso,
      confirmingAdminId: params.adminId,
      providerReference: null,
      internalReceiptRef: null,
      studentId: accountOwnerStudentId,
      participantType: participant.participantType,
      childId: params.childId ?? null,
      creationIdempotencyKey: null,
    })
    .returning();

  await tx.insert(paymentEventsTable).values({
    paymentRecordId: paymentRecord.id,
    paymentRefundId: null,
    eventType: "created_and_confirmed",
    amountMinor: finalPayableAmountMinor,
    previousStatus: null,
    newStatus: "paid",
    creditTransactionId: null,
    actorAdminId: params.adminId,
    actorType: "admin",
    reason: "studio_walkin_paid_at_studio",
    providerReference: null,
    ipAddress: null,
    userAgent: null,
    idempotencyKey: null,
  });

  // ── Attendance row — same shape as the existing walk-in/credit paths.
  const [attendance] = await tx
    .insert(attendanceTable)
    .values({
      studentName: canonicalStudentName,
      studentEmail: normalizeLegacyEmail(canonicalStudentEmail),
      studentId: accountOwnerStudentId,
      participantType: participant.participantType,
      participantChildId: participant.participantChildId,
      participantDateOfBirthSnapshot: parsedDob?.eligible ? parsedDob.value : null,
      participantAgeOnOccurrence: participantAge,
      eligibilityEvaluatedOn: occurrenceDate,
      attendanceSource: "walk_in",
      paymentSource: "walk_in_pay_at_studio",
      classId: params.classId ?? null,
      scheduleId: params.scheduleId ?? null,
      bookingId: booking.id,
      packageOrderId: null,
      creditDeducted: false,
      checkedInBy: params.performedBy,
      status: "checked_in",
      classTitle: null,
      notes: "Payment mode: pay at studio",
      checkedInAt: checkedInAtIso,
    })
    .returning();

  // ── Notification row, atomic with everything above, push dispatch
  // deferred to the caller post-commit (dispatchPush:false — see module
  // header comment).
  let pendingPush: StudioWalkInPendingPush | null = null;
  if (accountOwnerStudentId != null) {
    const title = "Checked in";
    const body = `You have been checked in for your class.`;
    const metadata = { bookingId: booking.id, classId: params.classId ?? null, scheduleId: params.scheduleId ?? null };
    const notificationRow = await createStudentNotification(tx, {
      studentId: accountOwnerStudentId,
      studentEmail: canonicalStudentEmail,
      title,
      body,
      type: "attendance_checked_in",
      relatedEntityType: "booking",
      relatedEntityId: booking.id,
      metadata,
      dispatchPush: false,
    });
    if (notificationRow) {
      pendingPush = {
        studentId: accountOwnerStudentId,
        title,
        body,
        data: { type: "attendance_checked_in", ...metadata },
        notificationId: notificationRow.id,
      };
    }
  }

  return {
    bookingId: booking.id,
    attendanceId: attendance.id,
    paymentRecordId: paymentRecord.id,
    studentName: canonicalStudentName,
    studentEmail: normalizeLegacyEmail(canonicalStudentEmail),
    grossAmountMinor,
    finalPayableAmountMinor,
    checkedInAt: attendance.checkedInAt,
    participantType: participant.participantType,
    participantChildId: participant.participantChildId,
    participantName: participant.displayName,
    attendanceSource: "walk_in",
    paymentSource: "walk_in_pay_at_studio",
    pendingPush,
  };
}

/**
 * Fire-and-forget push dispatch for a completed studio walk-in — call only
 * AFTER the enclosing db.transaction() has resolved successfully. Mirrors
 * packageOrders.ts / bookings.ts's identical post-commit boundary: the push
 * is never scheduled until this transaction has actually committed, and a
 * rejection here is caught, logged, and never rolls back the walk-in.
 */
export function dispatchStudioWalkInPush(pendingPush: StudioWalkInPendingPush | null): void {
  if (!pendingPush) return;
  void sendPushNotification(pendingPush).catch((error) => {
    logger.error({ err: error, notificationId: pendingPush.notificationId }, "Failed to dispatch studio walk-in push");
  });
}

export interface StudioPackageWalkInResult {
  attendanceId: number;
  bookingId: null;
  studentName: string;
  studentEmail: string;
  participantType: ParticipantType;
  participantChildId: number | null;
  participantName: string;
  packageOrderId: number;
  creditDeducted: true;
  remainingCredits: number;
  attendanceSource: "walk_in";
  paymentSource: "walk_in_package_credit";
  checkedInAt: string;
}

/**
 * General Studio package walk-in. There is deliberately no booking row:
 * attendance owns this one deduction and records the participant directly.
 */
export async function performStudioPackageWalkIn(
  tx: Tx,
  params: {
    accountOwnerStudentId: number;
    participantType: ParticipantType;
    participantChildId: number | null;
    packageOrderId: number;
    classId: number | null;
    scheduleId: number;
    occurrenceDate: string;
    performedBy: string;
    now?: Date;
  },
): Promise<StudioPackageWalkInResult> {
  const participantResolution = await resolveBookingParticipant(tx, params.accountOwnerStudentId, {
    participantType: params.participantType,
    participantChildId: params.participantChildId,
  });
  if (!participantResolution.ok) {
    throw makeCheckInError(
      participantResolution.status,
      "booking_participant_mismatch",
      "The selected walk-in participant is unavailable for this account.",
    );
  }
  const { account, participant } = participantResolution;
  const [schedule] = await tx
    .select({ classId: schedulesTable.classId, packageEligible: schedulesTable.packageEligible })
    .from(schedulesTable)
    .where(eq(schedulesTable.id, params.scheduleId))
    .limit(1);
  if (!schedule || schedule.packageEligible === false) {
    throw makeCheckInError(400, "package_not_eligible", "This schedule is not eligible for package credits.");
  }
  if (params.classId != null && schedule.classId !== params.classId) {
    throw makeCheckInError(409, "booking_mismatch", "The selected class does not match the schedule.");
  }
  const classId = schedule.classId ?? params.classId;
  const [klass] = classId != null
    ? await tx
        .select({ danceTypeId: classesTable.danceTypeId })
        .from(classesTable)
        .where(eq(classesTable.id, classId))
        .limit(1)
    : [];

  await assertGenuineEligibleWalkIn(tx, {
    accountId: account.id,
    participantChildId: participant.participantChildId,
    participantDateOfBirth: participant.dateOfBirth,
    scheduleId: params.scheduleId,
    classId,
    occurrenceDate: params.occurrenceDate,
  });

  const credit = await resolveParticipantPackageCredit(tx, {
    packageOrderId: params.packageOrderId,
    accountOwnerStudentId: account.id,
    participantType: participant.participantType,
    participantChildId: participant.participantChildId,
    occurrenceDate: params.occurrenceDate,
    danceTypeId: klass?.danceTypeId ?? null,
  });
  if (!credit.ok) {
    throw makeCheckInError(409, credit.code, credit.message);
  }

  const parsedDob = parseIsoDate(participant.dateOfBirth, { today: params.occurrenceDate as never });
  const participantAge = parsedDob.eligible
    ? calculateAgeOnDate(parsedDob.value!, params.occurrenceDate as never)
    : null;
  const checkedInAt = (params.now ?? new Date()).toISOString();
  const [attendance] = await tx
    .insert(attendanceTable)
    .values({
      studentName: participant.displayName,
      studentEmail: normalizeLegacyEmail(account.email),
      studentId: account.id,
      participantType: participant.participantType,
      participantChildId: participant.participantChildId,
      participantDateOfBirthSnapshot: parsedDob.eligible ? parsedDob.value : null,
      participantAgeOnOccurrence: participantAge,
      eligibilityEvaluatedOn: params.occurrenceDate,
      attendanceSource: "walk_in",
      paymentSource: "walk_in_package_credit",
      classId,
      scheduleId: params.scheduleId,
      bookingId: null,
      packageOrderId: credit.order.id,
      creditDeducted: true,
      checkedInBy: params.performedBy,
      status: "checked_in",
      notes: "Studio walk-in (package credit)",
      checkedInAt,
    })
    .returning();

  const balanceBefore = credit.order.remainingCredits;
  const balanceAfter = balanceBefore - 1;
  await tx
    .update(packageOrdersTable)
    .set({
      remainingCredits: balanceAfter,
      status: balanceAfter === 0 ? "fullyUsed" : credit.order.status,
    })
    .where(eq(packageOrdersTable.id, credit.order.id));
  await tx.insert(creditTransactionsTable).values({
    packageOrderId: credit.order.id,
    studentId: account.id,
    participantType: participant.participantType,
    participantChildId: participant.participantChildId,
    type: "attendance_deduction",
    delta: -1,
    balanceBefore,
    balanceAfter,
    referenceId: attendance.id,
    referenceType: "attendance",
    attendanceId: attendance.id,
    notes: "General Studio package walk-in credit deduction",
    createdBy: params.performedBy,
  });

  await createStudentNotification(tx, {
    studentId: account.id,
    title: "Checked in",
    body: "You have been checked in for your class.",
    type: "attendance_checked_in",
    relatedEntityType: "attendance",
    relatedEntityId: attendance.id,
    metadata: {
      attendanceId: attendance.id,
      classId,
      scheduleId: params.scheduleId,
      participantName: participant.displayName,
      participantType: participant.participantType,
    },
  });

  return {
    attendanceId: attendance.id,
    bookingId: null,
    studentName: participant.displayName,
    studentEmail: normalizeLegacyEmail(account.email),
    participantType: participant.participantType,
    participantChildId: participant.participantChildId,
    participantName: participant.displayName,
    packageOrderId: credit.order.id,
    creditDeducted: true,
    remainingCredits: balanceAfter,
    attendanceSource: "walk_in",
    paymentSource: "walk_in_package_credit",
    checkedInAt: attendance.checkedInAt,
  };
}
