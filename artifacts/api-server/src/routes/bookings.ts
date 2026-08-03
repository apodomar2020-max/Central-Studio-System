import { blockStudentJwt } from "../middlewares/auth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  attendanceTable,
  studentsTable,
  childrenTable,
  paymentRecordsTable,
  paymentEventsTable,
  packageOrdersTable,
  creditTransactionsTable,
  type PaymentRecordRequestedChannel,
  PAYMENT_RECORD_CONFIRMED_METHODS,
  type PaymentRecordConfirmedMethod,
} from "@workspace/db";
import { egpToMinor, minorToEgp } from "../lib/money";
import { canViewFinanceAmounts } from "../lib/financialVisibility";
import { logger } from "../lib/logger";
import { resolveSingleClassPriceEgp } from "../lib/singleClassPricing";
import { createStudentNotification } from "../lib/notifications";
import { sendPushNotification } from "../lib/pushNotifications";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { confirmCanonicalPaymentRecord } from "../lib/financeConfirmation";
import {
  ListBookingsQueryParams,
  CreateBookingBody,
  GetBookingParams,
  GetBookingResponse,
  UpdateBookingParams,
  UpdateBookingBody,
  UpdateBookingResponse,
  DeleteBookingParams,
  ListBookingsResponse,
} from "@workspace/api-zod";
import { currentOccurrenceDate, checkInWindowState } from "../lib/occurrence";
import { DUPLICATE_BLOCKING_STATUSES, RESERVED_SEAT_STATUSES, isSeatReservedBooking } from "../lib/bookingStatus";
import { isClassCapacityEnabled } from "../lib/classCapacitySettings";
import { resolveBookingParticipant } from "../lib/participants/resolveBookingParticipant";
import { resolveParticipantPackageCredit } from "../lib/bookings/resolveParticipantPackageCredit";
import { calculateAgeOnDate, parseIsoDate } from "../lib/eligibility/dateOnly";
import { evaluateAgeRange } from "../lib/eligibility/ageRange";
import { evaluateParticipantOnOccurrence } from "../lib/eligibility/participantOccurrenceEligibility";
import type { ParticipantSelection } from "@workspace/api-zod";

const router: IRouter = Router();

const ParticipantCandidatesQuery = z.object({
  scheduleId: z.coerce.number().int().positive(),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// dayOfWeek matches schedulesTable.dayOfWeek / JavaScript Date.getDay():
//   0 = Sunday, 1 = Monday, ..., 6 = Saturday
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const BOOKING_STATUSES = ["pending", "confirmed", "rejected", "cancelled", "attended", "completed"] as const;
const PAYMENT_STATUSES = ["not_required", "pending_payment", "paid", "refunded", "failed"] as const;
const PAYMENT_MODES = ["package_credit", "pay_at_studio", "online_payment", "free"] as const;

type BookingStatus = (typeof BOOKING_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
type PaymentMode = (typeof PAYMENT_MODES)[number];
type BookingWrite = Partial<typeof bookingsTable.$inferInsert>;
type NotificationPayload = {
  title: string;
  body: string;
  type: string;
  relatedEntityType: string;
  relatedEntityId: number;
  metadata: Record<string, unknown>;
};
type BookingNotificationClient = Pick<typeof db, "select">;
type BookingOwnerClient = Pick<typeof db, "select">;

router.get(
  "/bookings/participant-candidates",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const parsed = ParticipantCandidatesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "OCCURRENCE_INVALID", message: "A valid schedule and occurrence date are required." });
      return;
    }
    const { scheduleId, occurrenceDate } = parsed.data;
    const [[account], [schedule], children] = await Promise.all([
      db.select({
        id: studentsTable.id,
        name: studentsTable.name,
        accountType: studentsTable.accountType,
        dateOfBirth: studentsTable.dateOfBirth,
      }).from(studentsTable).where(eq(studentsTable.id, req.studentId!)).limit(1),
      db.select({
        id: schedulesTable.id,
        classId: schedulesTable.classId,
        status: schedulesTable.status,
        type: schedulesTable.type,
        date: schedulesTable.date,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
        allowAllAges: classesTable.allowAllAges,
        minAge: classesTable.minAge,
        maxAge: classesTable.maxAge,
      }).from(schedulesTable)
        .innerJoin(classesTable, eq(classesTable.id, schedulesTable.classId))
        .where(eq(schedulesTable.id, scheduleId))
        .limit(1),
      db.select({
        id: childrenTable.id,
        fullName: childrenTable.fullName,
        dateOfBirth: childrenTable.dateOfBirth,
      }).from(childrenTable).where(eq(childrenTable.parentId, req.studentId!)),
    ]);
    if (!account || !schedule || schedule.status !== "active") {
      res.status(404).json({ error: "OCCURRENCE_UNAVAILABLE", message: "This occurrence is unavailable." });
      return;
    }
    if (currentOccurrenceDate(schedule) !== occurrenceDate) {
      res.status(409).json({
        error: "OCCURRENCE_UNAVAILABLE",
        message: "This occurrence is stale or does not belong to the selected schedule.",
      });
      return;
    }

    const existing = await db.select({
      participantType: bookingsTable.participantType,
      participantChildId: bookingsTable.participantChildId,
      bookingStatus: bookingsTable.bookingStatus,
    }).from(bookingsTable).where(and(
      eq(bookingsTable.accountOwnerStudentId, account.id),
      eq(bookingsTable.scheduleId, scheduleId),
      eq(bookingsTable.occurrenceDate, occurrenceDate),
      inArray(bookingsTable.bookingStatus, ["pending", "confirmed", "attended"]),
    ));
    const existingAttendance = await db.select({
      participantType: attendanceTable.participantType,
      participantChildId: attendanceTable.participantChildId,
    }).from(attendanceTable).where(and(
      eq(attendanceTable.studentId, account.id),
      eq(attendanceTable.scheduleId, scheduleId),
      sql`(${attendanceTable.checkedInAt} AT TIME ZONE 'Africa/Cairo')::date = ${occurrenceDate}::date`,
    ));

    const range = {
      allowAllAges: schedule.allowAllAges === true,
      minAge: schedule.minAge,
      maxAge: schedule.maxAge,
    };
    const people = [
      { participantType: "self" as const, participantChildId: null, participantName: account.name, dateOfBirth: account.dateOfBirth },
      ...(account.accountType === "parent"
        ? children.map((child) => ({
            participantType: "child" as const,
            participantChildId: child.id,
            participantName: child.fullName,
            dateOfBirth: child.dateOfBirth,
          }))
        : []),
    ];
    const candidates = people.map((person) => {
      const age = schedule.allowAllAges == null && schedule.minAge == null && schedule.maxAge == null
        ? { eligible: true, reasonCode: "ELIGIBLE" as const, ageOnOccurrenceDate: null }
        : evaluateParticipantOnOccurrence(person.dateOfBirth, occurrenceDate, range);
      const booking = existing.find((row) =>
        row.participantType === person.participantType
        && row.participantChildId === person.participantChildId);
      const attendance = existingAttendance.find((row) =>
        row.participantType === person.participantType
        && row.participantChildId === person.participantChildId);
      const reasonCode = attendance
        ? "EXISTING_ATTENDANCE"
        : booking
          ? "EXISTING_BOOKING"
          : age.reasonCode;
      return {
        participantType: person.participantType,
        participantChildId: person.participantChildId,
        participantName: person.participantName,
        ageOnOccurrenceDate: age.ageOnOccurrenceDate,
        eligible: age.eligible && !booking && !attendance,
        reasonCode,
        existingBookingState: booking?.bookingStatus ?? null,
        existingAttendanceState: attendance ? "checked_in" : null,
      };
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ scheduleId, occurrenceDate, candidates });
  },
);

async function refreshScheduleLifecycle(scheduleId: number): Promise<void> {
  await db
    .update(schedulesTable)
    .set({ status: "expired" })
    .where(sql`
      ${schedulesTable.id} = ${scheduleId}
      and ${schedulesTable.type} = 'one_time'
      and ${schedulesTable.date} is not null
      and (${schedulesTable.date}::text || ' ' || ${schedulesTable.endTime})::timestamp
        < (now() at time zone 'Africa/Cairo')
      and ${schedulesTable.status} <> 'expired'
    `);

}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function countDailyBookingAttempts(args: {
  accountOwnerStudentId: number;
  studentEmail: string;
  scheduleId?: number | null;
  classId?: number | null;
  occurrenceDate?: string | null;
}): Promise<number> {
  const targetMatch = args.scheduleId != null
    ? eq(bookingsTable.scheduleId, args.scheduleId)
    : args.classId != null
      ? eq(bookingsTable.classId, args.classId)
      : null;

  if (!targetMatch) return 0;

  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(bookingsTable)
    .where(and(
      sql`(${bookingsTable.accountOwnerStudentId} = ${args.accountOwnerStudentId} OR lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(args.studentEmail)})`,
      targetMatch,
      args.occurrenceDate != null
        ? eq(bookingsTable.occurrenceDate, args.occurrenceDate)
        : sql`${bookingsTable.occurrenceDate} is null`,
      sql`(${bookingsTable.createdAt} AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date`,
    ));

  return row?.count ?? 0;
}

function requireBookingUpdatePermission(req: Request, res: Response, next: NextFunction): void {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const isCancellation = body["bookingStatus"] === "cancelled" || body["status"] === "cancelled";

  if (!isCancellation) {
    requireAdminPermission("bookings", "edit")(req, res, next);
    return;
  }

  const cancellationOnly = Object.keys(body).every((key) => key === "bookingStatus" || key === "status");
  requireAdminPermission("bookings", "cancel")(req, res, () => {
    if (cancellationOnly) {
      next();
      return;
    }
    requireAdminPermission("bookings", "edit")(req, res, next);
  });
}

// Finance Roles & Permissions integration: this PATCH is general-purpose
// (schedule, notes, status, etc.), but a write that targets
// paymentStatus:"paid" is a genuine payment-confirmation action — it must
// require finance.paymentsConfirm in addition to the existing
// bookings.edit/cancel permission already enforced by
// requireBookingUpdatePermission, even though it is launched from the
// Bookings page rather than Finance.
function requireBookingPaymentConfirmPermission(req: Request, res: Response, next: NextFunction): void {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  if (body["paymentStatus"] !== "paid") {
    next();
    return;
  }
  requireAdminPermission("finance", "paymentsConfirm")(req, res, next);
}

function requireBookingReadAccess(req: Request, res: Response, next: NextFunction): void {
  if (req.studentJwtVerified) {
    requireVerifiedStudent(req, res, next);
    return;
  }
  requireAdminAuth(req, res, () => {
    requireAdminPermission("bookings", "view")(req, res, next);
  });
}

async function resolveAccountOwnerStudentId(
  client: BookingOwnerClient,
  req: { studentId?: number },
  studentEmail: string,
  requestedOwnerId?: number | null,
): Promise<number | null> {
  if (typeof req.studentId === "number") return req.studentId;
  if (requestedOwnerId != null) return requestedOwnerId;

  const [student] = await client
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(sql`lower(trim(${studentsTable.email})) = ${normalizeEmail(studentEmail)}`)
    .limit(1);

  return student?.id ?? null;
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function legacyToBookingStatus(status?: string | null): BookingStatus | null {
  switch (status) {
    case "pendingPayment":
      return "pending";
    case "pending":
    case "confirmed":
    case "rejected":
    case "cancelled":
    case "attended":
    case "completed":
      return status;
    default:
      return null;
  }
}

function legacyToPaymentStatus(status?: string | null, packageOrderId?: number | null): PaymentStatus | null {
  switch (status) {
    case "pendingPayment":
      return "pending_payment";
    case "refunded":
      return "refunded";
    case "attended":
    case "completed":
      return packageOrderId != null ? "not_required" : "paid";
    default:
      return null;
  }
}

/**
 * Independent-review Blocker 2: migration 0085's
 * bookings_active_occurrence_participant_unique DB constraint correctly
 * blocks a true concurrent duplicate booking (the application-level
 * check-then-insert above has no row lock around it), but the LOSING
 * concurrent request's raw Postgres 23505 error was previously uncaught —
 * it propagated to Express's default error handler as a 500, not the same
 * 409/duplicate_booking response the app-level check already returns for
 * the exact same business condition.
 *
 * drizzle-orm (node-postgres driver) wraps the raw pg error in a
 * DrizzleQueryError, exposing the pg fields on `.cause`, not on the
 * wrapper itself — confirmed by direct inspection against a disposable
 * database: `err.code` is undefined, `err.cause.code === "23505"`,
 * `err.cause.constraint === "bookings_active_occurrence_participant_unique"`.
 * Checking both `error.code`/`error.constraint` AND
 * `error.cause?.code`/`error.cause?.constraint` keeps this correct
 * regardless of whether a future change unwraps the error or not.
 *
 * Deliberately narrow: only THIS exact constraint name maps to
 * duplicate_booking. Any other 23505 (a different unique constraint
 * entirely) must surface as whatever it already surfaces as today — this
 * function must never widen "any uniqueness violation" into this one
 * business-facing error.
 */
function isOccurrenceDuplicateViolation(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const value = error as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  const code = value.code ?? value.cause?.code;
  const constraint = value.constraint ?? value.cause?.constraint;
  return code === "23505" && constraint === "bookings_active_occurrence_participant_unique";
}

function legacyStatusFromSplit(bookingStatus: BookingStatus, paymentStatus: PaymentStatus): string {
  if (bookingStatus === "pending" && paymentStatus === "pending_payment") return "pendingPayment";
  return bookingStatus;
}

function normalizeBookingWrite(data: BookingWrite, existing?: typeof bookingsTable.$inferSelect): BookingWrite {
  const paymentMode = isOneOf(PAYMENT_MODES, data.paymentMode)
    ? data.paymentMode
    : isOneOf(PAYMENT_MODES, existing?.paymentMode)
      ? existing.paymentMode
      : data.packageOrderId != null || existing?.packageOrderId != null
        ? "package_credit"
        : data.paymentStatus === "pending_payment" || existing?.paymentStatus === "pending_payment"
          ? "pay_at_studio"
        : data.status === "pendingPayment" || existing?.status === "pendingPayment"
          ? "pay_at_studio"
          : null;

  const bookingStatus = isOneOf(BOOKING_STATUSES, data.bookingStatus)
    ? data.bookingStatus
    : legacyToBookingStatus(data.status)
      ?? (isOneOf(BOOKING_STATUSES, existing?.bookingStatus) ? existing.bookingStatus : null)
      // Policy: new student bookings default to PENDING (Admin confirms) — for both
      // pay-on-arrival AND package credit. Only non-reserving payment modes left.
      ?? (paymentMode === "pay_at_studio" || paymentMode === "package_credit" ? "pending" : "confirmed");

  const paymentStatus = isOneOf(PAYMENT_STATUSES, data.paymentStatus)
    ? data.paymentStatus
    : legacyToPaymentStatus(data.status, data.packageOrderId ?? existing?.packageOrderId ?? null)
      ?? (isOneOf(PAYMENT_STATUSES, existing?.paymentStatus) ? existing.paymentStatus : null)
      ?? (paymentMode === "pay_at_studio" || paymentMode === "online_payment" ? "pending_payment" : "not_required");

  return {
    ...data,
    bookingStatus,
    paymentStatus,
    paymentMode,
    status: legacyStatusFromSplit(bookingStatus, paymentStatus),
  };
}

function bookingParticipantKey(booking: typeof bookingsTable.$inferSelect): string {
  if (booking.participantChildId != null) return `child:${booking.participantChildId}`;
  if (booking.bookingScope === "child") return `child:unknown:${booking.id}`;
  return `self:${booking.accountOwnerStudentId ?? normalizeEmail(booking.studentEmail)}`;
}

async function findParticipantDuplicateAttendance(
  client: Pick<typeof db, "select">,
  booking: typeof bookingsTable.$inferSelect,
): Promise<boolean> {
  if (booking.classId == null && booking.scheduleId == null) return false;

  const dupConditions = [
    sql`lower(trim(${attendanceTable.studentEmail})) = ${normalizeEmail(booking.studentEmail)}`,
    sql`(${attendanceTable.checkedInAt} AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date`,
  ];

  if (booking.scheduleId != null) {
    dupConditions.push(eq(attendanceTable.scheduleId, booking.scheduleId));
  } else {
    dupConditions.push(eq(attendanceTable.classId, booking.classId!));
  }

  const existingRows = await client
    .select({
      attendanceId: attendanceTable.id,
      existingBooking: bookingsTable,
    })
    .from(attendanceTable)
    .leftJoin(bookingsTable, eq(attendanceTable.bookingId, bookingsTable.id))
    .where(and(...dupConditions))
    .limit(50);

  const participantKey = bookingParticipantKey(booking);
  return existingRows.some((row) => {
    if (row.existingBooking?.id === booking.id) return true;
    if (row.existingBooking) return bookingParticipantKey(row.existingBooking) === participantKey;
    return booking.participantChildId == null && booking.bookingScope !== "child";
  });
}

async function bookingMetadata(
  client: BookingNotificationClient,
  row: typeof bookingsTable.$inferSelect,
): Promise<Record<string, unknown>> {
  const [details] = await client
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
    .where(eq(bookingsTable.id, row.id))
    .limit(1);

  const start = formatTime(details?.scheduleStartTime ?? null);
  const dayName = details?.scheduleDayOfWeek != null ? DAY_NAMES[details.scheduleDayOfWeek] ?? null : null;
  const dateLabel = details?.scheduleDate
    ? new Date(`${details.scheduleDate}T00:00:00Z`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;
  const schedulePrefix = details?.scheduleType === "one_time" ? dateLabel : dayName;
  const scheduleLabel = schedulePrefix && start ? `${schedulePrefix} • ${start}` : null;

  return {
    bookingId: row.id,
    classId: row.classId,
    scheduleId: row.scheduleId,
    paymentMode: row.paymentMode,
    className: details?.className ?? null,
    instructorName: details?.instructorName ?? null,
    branch: details?.branch ?? null,
    scheduleLabel,
  };
}

function displayClassName(metadata: Record<string, unknown>): string | null {
  return typeof metadata.className === "string" && metadata.className.trim()
    ? metadata.className.trim()
    : null;
}

async function bookingCreatedNotification(
  client: BookingNotificationClient,
  row: typeof bookingsTable.$inferSelect,
): Promise<NotificationPayload> {
  const metadata = await bookingMetadata(client, row);
  const className = displayClassName(metadata);
  if (row.bookingStatus === "pending") {
    return {
      title: className ? `${className} Booking Request Submitted` : "Booking request submitted",
      body: "Your booking request has been submitted.",
      type: "booking_created",
      relatedEntityType: "booking",
      relatedEntityId: row.id,
      metadata,
    };
  }

  return {
    title: className ? `${className} Booking Confirmed` : "Booking confirmed",
    body: row.paymentMode === "package_credit"
      ? "Your booking has been confirmed. Credit will be deducted at check-in."
      : "Your booking has been confirmed.",
    type: "booking_confirmed",
    relatedEntityType: "booking",
    relatedEntityId: row.id,
    metadata,
  };
}

async function bookingStatusNotification(
  client: BookingNotificationClient,
  row: typeof bookingsTable.$inferSelect,
  status: string,
): Promise<NotificationPayload | null> {
  const metadata = await bookingMetadata(client, row);
  const className = displayClassName(metadata);
  const bookingLabel = className ? `${className} Booking` : "Booking";
  const base = {
    relatedEntityType: "booking",
    relatedEntityId: row.id,
    metadata,
  };
  switch (status) {
    case "confirmed":
      return { ...base, type: "booking_confirmed", title: `${bookingLabel} Confirmed`, body: "Your booking has been confirmed." };
    case "rejected":
      return { ...base, type: "booking_rejected", title: `${bookingLabel} Rejected`, body: "Your booking request was rejected." };
    case "cancelled":
      return { ...base, type: "booking_cancelled", title: `${bookingLabel} Cancelled`, body: "Your booking was cancelled." };
    case "attended":
    case "completed":
      return { ...base, type: "attendance_checked_in", title: className ? `${className} Attendance Confirmed` : "Attendance confirmed", body: "Your attendance has been confirmed." };
    default:
      return null;
  }
}

async function paymentStatusNotification(
  client: BookingNotificationClient,
  row: typeof bookingsTable.$inferSelect,
  status: string,
): Promise<NotificationPayload | null> {
  const metadata = await bookingMetadata(client, row);
  const className = displayClassName(metadata);
  const paymentLabel = className ? `${className} Payment` : "Payment";
  const base = {
    relatedEntityType: "booking",
    relatedEntityId: row.id,
    metadata,
  };
  switch (status) {
    case "paid":
      return { ...base, type: "payment_paid", title: `${paymentLabel} Confirmed`, body: "Your payment has been confirmed." };
    case "refunded":
      return { ...base, type: "payment_refunded", title: `${paymentLabel} Refunded`, body: "Your payment has been refunded." };
    case "failed":
      return { ...base, type: "payment_failed", title: `${paymentLabel} Failed`, body: "Your payment failed." };
    default:
      return null;
  }
}

// Format a "HH:MM" 24h time string into a friendly "6:00 PM". Falls back to
// the raw value if it isn't parseable so we never throw on bad data.
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

router.get("/bookings", requireBookingReadAccess, async (req: AdminRequest, res): Promise<void> => {
  if (req.studentJwtVerified) {
    if (req.studentEmailVerified === false) {
      res.status(403).json({
        error: "Email verification required.",
        requiresOtp: true,
        email: req.studentEmail,
      });
      return;
    }
  }

  const query = ListBookingsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const page = query.data.page ?? 1;
  const pageSize = query.data.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  // Build WHERE conditions from optional filters
  const conditions = [];
  if (query.data.status) conditions.push(eq(bookingsTable.status, query.data.status));
  if (query.data.bookingStatus) conditions.push(eq(bookingsTable.bookingStatus, query.data.bookingStatus));
  if (query.data.paymentStatus) conditions.push(eq(bookingsTable.paymentStatus, query.data.paymentStatus));
  if (query.data.scheduleId != null) conditions.push(eq(bookingsTable.scheduleId, query.data.scheduleId));
  if (query.data.date) conditions.push(eq(bookingsTable.occurrenceDate, query.data.date));
  if (query.data.scope === "child") {
    conditions.push(sql`(${bookingsTable.bookingScope} = 'child' OR ${bookingsTable.participantChildId} IS NOT NULL)`);
  } else if (query.data.scope === "self") {
    conditions.push(sql`(coalesce(${bookingsTable.bookingScope}, 'self') = 'self' AND ${bookingsTable.participantChildId} IS NULL)`);
  }

  const search = query.data.search?.trim().toLowerCase();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(sql`(
      lower(coalesce(${childrenTable.fullName}, '')) like ${pattern}
      OR lower(coalesce(${studentsTable.name}, '')) like ${pattern}
      OR lower(coalesce(${studentsTable.email}, '')) like ${pattern}
      OR lower(coalesce(${bookingsTable.studentName}, '')) like ${pattern}
      OR lower(coalesce(${bookingsTable.studentEmail}, '')) like ${pattern}
      OR lower(coalesce(${classesTable.title}, '')) like ${pattern}
    )`);
  }

  if (req.studentJwtVerified) {
    conditions.push(
      sql`(${bookingsTable.accountOwnerStudentId} = ${req.studentId!} OR lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(req.studentEmail!)})`
    );
  } else {
    // Membership Engine (Phase 3): accept studentId alongside the existing
    // studentEmail filter, matched on the indexed account_owner_student_id
    // column (read directly off req.query — not part of the generated
    // ListBookingsQueryParams schema).
    const rawStudentId = req.query.studentId;
    const studentId = typeof rawStudentId === "string" && /^\d+$/.test(rawStudentId) ? Number(rawStudentId) : undefined;
    if (studentId != null && query.data.studentEmail) {
      conditions.push(sql`(${bookingsTable.accountOwnerStudentId} = ${studentId} OR lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(query.data.studentEmail)})`);
    } else if (studentId != null) {
      conditions.push(eq(bookingsTable.accountOwnerStudentId, studentId));
    } else if (query.data.studentEmail) {
      conditions.push(sql`lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(query.data.studentEmail)}`);
    }
  }

  // Left-join class/schedule/instructor so the response carries display-ready
  // fields. Left joins keep every booking even when its class, schedule, or
  // instructor is missing — those columns simply come back as null.
  const base = db
    .select({
      booking: bookingsTable,
      classTitle: classesTable.title,
      classDescription: classesTable.description,
      classCategory: classesTable.category,
      classDurationMins: classesTable.durationMins,
      instructorName: instructorsTable.name,
      instructorPhotoUrl: instructorsTable.photoUrl,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleType: schedulesTable.type,
      scheduleDate: schedulesTable.date,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
      schedulePriceEgp: schedulesTable.priceEgp,
      schedulePackageEligible: schedulesTable.packageEligible,
      accountOwnerName: studentsTable.name,
      accountOwnerEmail: studentsTable.email,
      participantChildName: childrenTable.fullName,
      attendanceId: attendanceTable.id,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .leftJoin(studentsTable, eq(bookingsTable.accountOwnerStudentId, studentsTable.id))
    .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
    .leftJoin(attendanceTable, eq(attendanceTable.bookingId, bookingsTable.id));

  const countBase = db
    .select({ total: sql<number>`count(distinct ${bookingsTable.id})` })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(studentsTable, eq(bookingsTable.accountOwnerStudentId, studentsTable.id))
    .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id));

  const [countRow] = conditions.length > 0
    ? await countBase.where(and(...conditions))
    : await countBase;
  const total = Number(countRow?.total ?? 0);

  const rows = conditions.length > 0
    ? await base.where(and(...conditions)).orderBy(desc(bookingsTable.createdAt)).limit(pageSize).offset(offset)
    : await base.orderBy(desc(bookingsTable.createdAt)).limit(pageSize).offset(offset);

  const enrichedById = new Map<number, Record<string, unknown>>();

  for (const r of rows) {
    const dayName =
      r.scheduleDayOfWeek != null ? DAY_NAMES[r.scheduleDayOfWeek] ?? null : null;
    const start = formatTime(r.scheduleStartTime);
    const end = formatTime(r.scheduleEndTime);
    const scheduleDate = r.scheduleDate ?? null;
    const dateLabel = scheduleDate
      ? new Date(`${scheduleDate}T00:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : null;
    // scheduleLabel: "Sunday • 6:00 PM - 7:00 PM" — null when no schedule joined.
    const scheduleLabel =
      (r.scheduleType === "one_time" ? dateLabel : dayName) && start && end
        ? `${r.scheduleType === "one_time" ? dateLabel : dayName} • ${start} - ${end}`
        : null;
    const existing = enrichedById.get(r.booking.id);
    const bookingScope = r.booking.participantType ?? r.booking.bookingScope ?? (r.booking.participantChildId != null ? "child" : "self");
    const bookingStatus = r.booking.bookingStatus ?? legacyToBookingStatus(r.booking.status) ?? r.booking.status;
    const hasAttendance = Boolean(existing?.hasAttendance || r.attendanceId);
    const participantDuplicateAttendance = !hasAttendance && query.data.studentEmail
      ? await findParticipantDuplicateAttendance(db, r.booking)
      : false;
    const alreadyCheckedIn = hasAttendance || participantDuplicateAttendance;
    // Phase A — QR check-in eligibility. A booking is eligible ONLY when it is
    // confirmed, for today's occurrence, inside the grace window (opens 2h
    // before start, closes at end of the Cairo day), and not already attended.
    // Pending / future / past / cancelled / rejected / attended are all blocked,
    // and the backend enforces the same rules at the /check-in/qr write path so
    // the UI flag can never be bypassed.
    const windowState = checkInWindowState(
      { startTime: r.scheduleStartTime, endTime: r.scheduleEndTime },
      r.booking.occurrenceDate,
    );
    const checkInBlockedReason =
      alreadyCheckedIn
        ? "Already checked in"
        : bookingStatus === "attended" || bookingStatus === "completed"
          ? "Already checked in"
          : bookingStatus === "cancelled" || bookingStatus === "rejected"
            ? "Booking is not eligible for check-in"
            : bookingStatus !== "confirmed"
              ? "Awaiting admin confirmation"
              : windowState === "too_early"
                ? "Check-in opens 2 hours before class"
                : windowState === "ended"
                  ? "Check-in closed when the class ended"
                  : windowState === "not_today"
                    ? "Not scheduled for today"
                    : null;
    enrichedById.set(r.booking.id, {
      ...(existing ?? {}),
      ...r.booking,
      accountOwnerStudentId: r.booking.accountOwnerStudentId ?? null,
      accountOwnerName: r.accountOwnerName ?? null,
      accountOwnerEmail: r.accountOwnerEmail ?? null,
      bookingScope,
      participantType: bookingScope,
      participantChildId: r.booking.participantChildId ?? null,
      participantName: r.participantChildName ?? r.booking.studentName,
      usedCredit: r.booking.paymentMode === "package_credit" && r.booking.packageOrderId != null,
      creditSource: {
        packageOrderId: r.booking.packageOrderId ?? null,
        usedCredit: r.booking.paymentMode === "package_credit" && r.booking.packageOrderId != null,
        paymentMethod: r.booking.paymentMode ?? null,
      },
      classTitle: r.classTitle ?? null,
      classDescription: r.classDescription ?? null,
      classCategory: r.classCategory ?? null,
      classDurationMins: r.classDurationMins ?? null,
      instructorName: r.instructorName ?? null,
      instructorPhotoUrl: r.instructorPhotoUrl ?? null,
      scheduleDayOfWeek: r.scheduleDayOfWeek ?? null,
      scheduleType: r.scheduleType ?? null,
      scheduleDate,
      scheduleStartTime: r.scheduleStartTime ?? null,
      scheduleEndTime: r.scheduleEndTime ?? null,
      scheduleLocation: r.scheduleLocation ?? null,
      schedulePriceEgp:
        req.studentJwtVerified || canViewFinanceAmounts(req.adminUser)
          ? r.schedulePriceEgp ?? null
          : null,
      schedulePackageEligible: r.schedulePackageEligible ?? true,
      scheduleLabel,
      displayTitle: r.classTitle ?? `Booking #${r.booking.id}`,
      hasAttendance,
      alreadyCheckedIn,
      checkInEligible: checkInBlockedReason == null,
      checkInBlockedReason,
    });
  }

  const enriched = Array.from(enrichedById.values());

  res.json(ListBookingsResponse.parse({
    bookings: enriched,
    total,
    page,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    pageSize,
  }));
});

router.post(
  "/bookings",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Force booking owner identity from verified JWT claims
  const studentEmail = req.studentEmail!;
  const accountOwnerStudentId = req.studentId!;

  const normalized = normalizeBookingWrite({
    ...parsed.data,
    studentEmail,
    accountOwnerStudentId,
  });

  if (normalized.paymentMode === "free") {
    res.status(400).json({ error: "Free class booking is currently disabled." });
    return;
  }

  if (normalized.paymentMode === "package_credit" && normalized.packageOrderId == null) {
    res.status(400).json({
      error: "package_required",
      message: "Package credit booking requires a packageOrderId.",
    });
    return;
  }

  // Occurrence date for this booking (computed server-side from the schedule's
  // current upcoming occurrence). Booking identity = student + schedule +
  // occurrence, so weekly classes can be re-booked next week once today's passes.
  // TODO: When a full recurring occurrence model is introduced, derive this from
  // the explicit occurrence row instead of recomputing from the schedule.
  let occurrenceDate: string | null = null;

  if (normalized.scheduleId != null) {
    await refreshScheduleLifecycle(normalized.scheduleId);
    const [schedule] = await db
      .select({
        id: schedulesTable.id,
        status: schedulesTable.status,
        packageEligible: schedulesTable.packageEligible,
        type: schedulesTable.type,
        date: schedulesTable.date,
        dayOfWeek: schedulesTable.dayOfWeek,
        startTime: schedulesTable.startTime,
      })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, normalized.scheduleId))
      .limit(1);

    if (schedule) {
      occurrenceDate = currentOccurrenceDate(schedule);
    }

    if (!schedule) {
      res.status(400).json({
        error: "schedule_not_found",
        message: "The selected schedule is no longer available.",
      });
      return;
    }

    if (schedule.status !== "active") {
      res.status(409).json({
        error: "schedule_unavailable",
        message: schedule.status === "cancelled"
          ? "This class schedule has been cancelled."
          : schedule.status === "completed"
            ? "This class schedule has been completed."
            : "This class schedule has expired.",
      });
      return;
    }

    if (normalized.packageOrderId != null && schedule.packageEligible === false) {
      res.status(400).json({
        error: "package_not_eligible",
        message: "This schedule is not eligible for package credits.",
      });
      return;
    }
  }
  if (occurrenceDate == null) {
    res.status(400).json({
      error: "OCCURRENCE_INVALID",
      code: "OCCURRENCE_INVALID",
      message: "A valid class schedule occurrence is required for booking.",
    });
    return;
  }

  const participantTypeInput = parsed.data.participantType
    ?? parsed.data.bookingScope
    ?? ((parsed.data.participantChildId ?? parsed.data.childId) != null ? "child" : "self");
  const participantSelection = {
    participantType: participantTypeInput,
    participantChildId: parsed.data.participantChildId ?? parsed.data.childId ?? null,
  } as ParticipantSelection;
  const participantResolution = await resolveBookingParticipant(db, accountOwnerStudentId, participantSelection);
  if (!participantResolution.ok) {
    res.status(participantResolution.status).json({
      error: participantResolution.reason.code,
      code: participantResolution.reason.code,
      message: participantResolution.reason.message,
    });
    return;
  }
  if (
    participantResolution.account.accountType === "parent"
    && parsed.data.participantType == null
    && parsed.data.bookingScope == null
    && parsed.data.participantChildId == null
    && parsed.data.childId == null
  ) {
    res.status(400).json({
      error: "PARTICIPANT_REQUIRED",
      code: "PARTICIPANT_REQUIRED",
      message: "Select who will attend this class.",
    });
    return;
  }
  const participantChildId = participantResolution.participant.participantChildId;
  const bookingScope = participantResolution.participant.participantType;
  const participantName = participantResolution.participant.displayName;

  // ── Duplicate-booking guard (backend-enforced, OCCURRENCE-aware) ────────────
  // Block a second ACTIVE booking by the same account/participant for the same
  // class OCCURRENCE. Active = a booking that still reserves a seat (pending or
  // confirmed). Cancelled/rejected (and past attended/completed) do NOT block, so
  // a user can re-book after cancelling or — for a weekly class — once the current
  // occurrence has passed and the schedule rolls to next week.
  {
    const targetMatch = normalized.scheduleId != null
      ? eq(bookingsTable.scheduleId, normalized.scheduleId)
      : normalized.classId != null
        ? eq(bookingsTable.classId, normalized.classId)
        : null;
    if (targetMatch) {
      const [existingActive] = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(and(
          sql`(${bookingsTable.accountOwnerStudentId} = ${accountOwnerStudentId} OR lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(studentEmail)})`,
          targetMatch,
          // Same participant (self vs a specific child); null = self.
          sql`${bookingsTable.participantChildId} is not distinct from ${participantChildId}`,
          // Same occurrence. When we have a computed occurrence date, only an
          // active booking for the SAME occurrence blocks; a different/next-week
          // occurrence (or legacy null rows) does not.
          occurrenceDate != null
            ? eq(bookingsTable.occurrenceDate, occurrenceDate)
            : sql`${bookingsTable.occurrenceDate} is null`,
          // pending OR confirmed blocks a duplicate request (pending does not
          // reserve a seat, but still blocks a second request for the occurrence).
          inArray(bookingsTable.bookingStatus, [...DUPLICATE_BLOCKING_STATUSES]),
        ))
        .limit(1);
      if (existingActive) {
        res.status(409).json({
          error: "You already have an active booking for this class.",
          code: "duplicate_booking",
        });
        return;
      }
    }
  }

  const attemptsToday = await countDailyBookingAttempts({
    accountOwnerStudentId,
    studentEmail,
    scheduleId: normalized.scheduleId,
    classId: normalized.classId,
    occurrenceDate,
  });

  if (attemptsToday >= 3) {
    res.status(429).json({
      error: "You have reached the daily booking limit for this class.",
      code: "booking_attempt_limit_reached",
    });
    return;
  }

  // Finance Phase 2B-2: capture creation-time monetary state only for an
  // ordinary, customer-created, direct-monetary-payment booking. paymentMode
  // is the real, already-enforced discriminator (PAYMENT_MODES above) —
  // package_credit (credit ledger owns its own economics) and free (blocked
  // above, and would otherwise fall into the "not_required" payment lane)
  // are excluded. Studio walk-ins and Unified Attendance Gateway walk-ins
  // never reach this insert at all (confirmed: bookingsTable has exactly one
  // INSERT call site in this repository — this one — walk-in/check-in flows
  // write to attendanceTable directly), so no further discriminator is
  // needed to exclude them.
  const isDirectPaymentBooking = normalized.paymentMode === "pay_at_studio" || normalized.paymentMode === "online_payment";

  // Same deterministic post-commit push boundary as Phase 2B-1
  // (packageOrders.ts): createStudentNotification's push dispatch runs on a
  // separate connection from `tx` and must not be scheduled until this
  // transaction has actually committed.
  const pushState: { pending: { studentId: number; title: string; body: string; data: Record<string, unknown>; notificationId: number } | null } = { pending: null };

  let createResult;
  try {
    createResult = await db.transaction(async (tx) => {
    const classCapacityEnabled = await isClassCapacityEnabled();
    let creditOrder: typeof packageOrdersTable.$inferSelect | null = null;
    let eligibilitySnapshot: Pick<typeof bookingsTable.$inferInsert,
      "participantDateOfBirthSnapshot" | "participantAgeOnOccurrence" | "eligibilityEvaluatedOn"
      | "classAllowAllAgesSnapshot" | "classMinAgeSnapshot" | "classMaxAgeSnapshot"
      | "eligibilityDecisionCode"> = {};
    if (normalized.scheduleId != null) {
      const [lockedSchedule] = await tx
        .select({
          id: schedulesTable.id,
          classId: schedulesTable.classId,
          status: schedulesTable.status,
          packageEligible: schedulesTable.packageEligible,
          type: schedulesTable.type,
          date: schedulesTable.date,
          dayOfWeek: schedulesTable.dayOfWeek,
          startTime: schedulesTable.startTime,
        })
        .from(schedulesTable)
        .where(eq(schedulesTable.id, normalized.scheduleId))
        .for("update");

      if (!lockedSchedule) {
        return { kind: "schedule_not_found" as const };
      }

      if (lockedSchedule.status !== "active") {
        return { kind: "schedule_unavailable" as const, status: lockedSchedule.status };
      }
      const [lockedClass] = await tx
        .select({
          capacity: classesTable.capacity,
          isActive: classesTable.isActive,
          danceTypeId: classesTable.danceTypeId,
          allowAllAges: classesTable.allowAllAges,
          minAge: classesTable.minAge,
          maxAge: classesTable.maxAge,
        })
        .from(classesTable)
        .where(eq(classesTable.id, lockedSchedule.classId))
        .limit(1);
      if (!lockedClass?.isActive) {
        return { kind: "class_inactive" as const };
      }

      const parsedDob = parseIsoDate(participantResolution.participant.dateOfBirth, {
        today: occurrenceDate as never,
      });
      if (!parsedDob.eligible) {
        return { kind: "eligibility_error" as const, reason: parsedDob.reasons[0] };
      }
      const participantAge = calculateAgeOnDate(parsedDob.value!, occurrenceDate as never);
      const legacyUnconfigured =
        lockedClass.allowAllAges == null
        && lockedClass.minAge == null
        && lockedClass.maxAge == null;
      if (!legacyUnconfigured) {
        const ageResult = evaluateAgeRange(participantAge, {
          allowAllAges: lockedClass.allowAllAges!,
          minAge: lockedClass.minAge,
          maxAge: lockedClass.maxAge,
        });
        if (!ageResult.eligible) {
          return { kind: "eligibility_error" as const, reason: ageResult.reasons[0] };
        }
      }
      eligibilitySnapshot = {
        participantDateOfBirthSnapshot: parsedDob.value,
        participantAgeOnOccurrence: participantAge,
        eligibilityEvaluatedOn: occurrenceDate,
        classAllowAllAgesSnapshot: lockedClass.allowAllAges,
        classMinAgeSnapshot: lockedClass.minAge,
        classMaxAgeSnapshot: lockedClass.maxAge,
        eligibilityDecisionCode: legacyUnconfigured ? "legacy_unconfigured" : "eligible",
      };

      if (normalized.packageOrderId != null && lockedSchedule.packageEligible === false) {
        return { kind: "package_not_eligible" as const };
      }

      const targetMatch = normalized.scheduleId != null
        ? eq(bookingsTable.scheduleId, normalized.scheduleId)
        : normalized.classId != null
          ? eq(bookingsTable.classId, normalized.classId)
          : null;
      if (targetMatch) {
        const [existingActive] = await tx
          .select({ id: bookingsTable.id })
          .from(bookingsTable)
          .where(and(
            sql`(${bookingsTable.accountOwnerStudentId} = ${accountOwnerStudentId} OR lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(studentEmail)})`,
            targetMatch,
            sql`${bookingsTable.participantChildId} is not distinct from ${participantChildId}`,
            occurrenceDate != null
              ? eq(bookingsTable.occurrenceDate, occurrenceDate)
              : sql`${bookingsTable.occurrenceDate} is null`,
            inArray(bookingsTable.bookingStatus, [...DUPLICATE_BLOCKING_STATUSES]),
          ))
          .limit(1);
        if (existingActive) return { kind: "duplicate_booking" as const };
      }

      if (
        classCapacityEnabled &&
        occurrenceDate != null &&
        isSeatReservedBooking({ bookingStatus: String(normalized.bookingStatus) })
      ) {
        const [reservedSeats] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingsTable)
          .where(and(
            eq(bookingsTable.scheduleId, lockedSchedule.id),
            eq(bookingsTable.occurrenceDate, occurrenceDate),
            inArray(bookingsTable.bookingStatus, [...RESERVED_SEAT_STATUSES]),
          ));

        if ((reservedSeats?.count ?? 0) >= lockedClass.capacity) {
          return { kind: "capacity_full" as const };
        }
      }

      if (normalized.paymentMode === "package_credit" && normalized.packageOrderId != null) {
        const credit = await resolveParticipantPackageCredit(tx, {
          packageOrderId: normalized.packageOrderId,
          accountOwnerStudentId,
          participantType: participantResolution.participant.participantType,
          participantChildId,
          occurrenceDate: occurrenceDate!,
          danceTypeId: lockedClass.danceTypeId,
        });
        if (!credit.ok) {
          return { kind: "package_credit_error" as const, code: credit.code, message: credit.message };
        }
        creditOrder = credit.order;
      }
    }
    const [inserted] = await tx
      .insert(bookingsTable)
      .values({
        ...normalized,
        studentName: participantName,
        studentEmail: normalizeEmail(studentEmail),
        accountOwnerStudentId,
        participantType: participantResolution.participant.participantType,
        participantChildId,
        bookingScope,
        occurrenceDate,
        ...eligibilitySnapshot,
      } as typeof bookingsTable.$inferInsert)
      .returning();

    // Finance Phase 2B-2: capture the creation-time monetary snapshot as a
    // live payment_records row, plus its opening payment_events "created"
    // row, in the same transaction as the bookings write above — only for
    // an ordinary direct-payment booking (see isDirectPaymentBooking above).
    // The amount is always the server-resolved schedule/Studio-default
    // price — never a client-provided figure.
    if (isDirectPaymentBooking) {
      const priceEgp = await resolveSingleClassPriceEgp(tx, normalized.scheduleId ?? null);
      const grossAmountMinor = egpToMinor(priceEgp);
      // No real, server-validated discount mechanism exists on this booking
      // flow today (no promotion service is wired into POST /bookings) —
      // per the locked spec, discount is 0 rather than inventing support.
      const discountAmountMinor = 0;
      const finalPayableAmountMinor = grossAmountMinor - discountAmountMinor;

      const requestedPaymentChannel: PaymentRecordRequestedChannel =
        normalized.paymentMode === "pay_at_studio"
          ? "pay_at_studio"
          : "online";

      // Every direct-payment booking is created with paymentStatus
      // "pending_payment" (normalizeBookingWrite above) and the only exit
      // is an admin PATCH /bookings/:id {paymentStatus:"paid"} — gated by
      // the payment-confirmation guard further down this file, which only
      // accepts a transition FROM "pending_payment" (or "failed"). There is
      // no self-service confirmation and no payment-gateway callback. A
      // newly created direct-payment booking is therefore already sitting
      // in that admin confirmation queue — pending_confirmation, not unpaid.
      const initialStatus = "pending_confirmation" as const;

      const [paymentRecord] = await tx
        .insert(paymentRecordsTable)
        .values({
          flowType: "single_class_booking",
          packageOrderId: null,
          bookingId: inserted.id,
          captureOrigin: "live_capture",
          occurredAt: inserted.createdAt,
          evidenceClass: "confirmed",
          amountAvailability: "exact",
          amountSource: "creation_snapshot",
          grossAmountMinor,
          discountAmountMinor,
          finalPayableAmountMinor,
          paidAmountMinor: 0,
          refundedAmountMinor: 0,
          currency: "EGP",
          requestedPaymentChannel,
          rawRequestedChannel: normalized.paymentMode ?? null,
          status: initialStatus,
          // accountOwnerStudentId/participantChildId are the same
          // route-validated identity already used to write the booking row
          // itself (JWT-forced owner; child ownership checked against
          // childrenTable.parentId above) — never re-derived from the
          // request body here.
          studentId: accountOwnerStudentId,
          childId: participantChildId,
          participantType: participantResolution.participant.participantType,
          creationIdempotencyKey: null,
        })
        .returning();

      await tx.insert(paymentEventsTable).values({
        paymentRecordId: paymentRecord.id,
        paymentRefundId: null,
        eventType: "created",
        amountMinor: null,
        previousStatus: null,
        newStatus: initialStatus,
        creditTransactionId: null,
        actorAdminId: null,
        // POST /bookings requires requireStudentAuth + requireVerifiedStudent
        // — this insert is only ever reached by an authenticated student.
        actorType: "student",
        reason: null,
        providerReference: null,
        ipAddress: null,
        userAgent: null,
        idempotencyKey: null,
      });
    }

    // The notification ROW is inserted here, on the transaction client, so
    // it stays atomic with the booking/payment rows above. dispatchPush:
    // false suppresses createStudentNotification's own setTimeout(0) push
    // scheduling — the actual push is dispatched post-commit below instead.
    const notification = await bookingCreatedNotification(tx, inserted);
    const notificationRow = await createStudentNotification(tx, {
      studentId: inserted.accountOwnerStudentId,
      studentEmail: inserted.studentEmail,
      ...notification,
      dispatchPush: false,
    });
    if (notificationRow && inserted.accountOwnerStudentId != null) {
      pushState.pending = {
        studentId: inserted.accountOwnerStudentId,
        title: notification.title,
        body: notification.body,
        data: { type: notification.type, ...notification.metadata },
        notificationId: notificationRow.id,
      };
    }

    return { kind: "created" as const, inserted };
    });
  } catch (error: unknown) {
    // Independent-review Blocker 2: the losing side of a true concurrent
    // duplicate-booking race hits migration 0085's DB constraint directly
    // (the application-level check above has no row lock around it) and
    // must map to the SAME 409/duplicate_booking response the app-level
    // check already returns for this business condition — never a bare 500.
    if (isOccurrenceDuplicateViolation(error)) {
      res.status(409).json({
        error: "You already have an active booking for this class.",
        code: "duplicate_booking",
      });
      return;
    }
    // Any other error (a different constraint, a connection failure, etc.)
    // is not this function's concern — rethrow unchanged so it is handled
    // exactly as it already was before this fix.
    throw error;
  }
  // Deterministic post-commit boundary: the push is dispatched only after
  // `db.transaction` above has resolved, i.e. only after the booking, any
  // Finance rows, and the notification row have all actually committed.
  // Not awaited — matches the pre-existing fire-and-forget contract; a push
  // failure here has never rolled back a booking and still does not.
  if (pushState.pending) {
    const push = pushState.pending;
    void sendPushNotification(push).catch((error) => {
      logger.error({ err: error, notificationId: push.notificationId }, "Failed to dispatch booking creation push");
    });
  }

  if (createResult.kind !== "created") {
    if (createResult.kind === "schedule_not_found") {
      res.status(400).json({
        error: "schedule_not_found",
        message: "The selected schedule is no longer available.",
      });
      return;
    }

    if (createResult.kind === "schedule_unavailable") {
      res.status(409).json({
        error: "schedule_unavailable",
        message: createResult.status === "cancelled"
          ? "This class schedule has been cancelled."
          : createResult.status === "completed"
            ? "This class schedule has been completed."
            : "This class schedule has expired.",
      });
      return;
    }

    if (createResult.kind === "capacity_full") {
      res.status(409).json({
        error: "schedule_capacity_full",
        message: "This class occurrence is full.",
      });
      return;
    }

    if (createResult.kind === "duplicate_booking") {
      res.status(409).json({
        error: "You already have an active booking for this class.",
        code: "duplicate_booking",
      });
      return;
    }

    if (createResult.kind === "package_not_eligible") {
      res.status(400).json({
        error: "package_not_eligible",
        message: "This schedule is not eligible for package credits.",
      });
      return;
    }
    if (createResult.kind === "class_inactive") {
      res.status(409).json({ error: "CLASS_INACTIVE", code: "CLASS_INACTIVE", message: "This class is inactive." });
      return;
    }
    if (createResult.kind === "eligibility_error") {
      res.status(400).json({ error: createResult.reason.code, code: createResult.reason.code, message: createResult.reason.message });
      return;
    }
    if (createResult.kind === "package_credit_error") {
      res.status(409).json({ error: createResult.code, code: createResult.code, message: createResult.message });
      return;
    }
  }

  const row = createResult.inserted;

  res.status(201).json(GetBookingResponse.parse(row));
});

router.get("/bookings/:id", requireBookingReadAccess, async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (
    req.studentJwtVerified &&
    row.accountOwnerStudentId !== req.studentId &&
    normalizeEmail(row.studentEmail) !== normalizeEmail(req.studentEmail ?? "")
  ) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(GetBookingResponse.parse(row));
});

router.get(
  "/bookings/:id/payment-confirmation-amount",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("bookings", "view"),
  requireAdminPermission("finance", "paymentsConfirm"),
  async (req: AdminRequest, res): Promise<void> => {
    const params = GetBookingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [record] = await db
      .select({
        finalPayableAmountMinor: paymentRecordsTable.finalPayableAmountMinor,
        status: paymentRecordsTable.status,
        bookingPaymentStatus: bookingsTable.paymentStatus,
        bookingPaymentMode: bookingsTable.paymentMode,
      })
      .from(paymentRecordsTable)
      .innerJoin(bookingsTable, eq(bookingsTable.id, paymentRecordsTable.bookingId))
      .where(and(
        eq(paymentRecordsTable.bookingId, params.data.id),
        eq(paymentRecordsTable.flowType, "single_class_booking"),
      ))
      .limit(1);
    if (!record) {
      res.status(404).json({ error: "Payment record not found" });
      return;
    }
    if (
      record.status !== "pending_confirmation" ||
      record.bookingPaymentStatus !== "pending_payment" ||
      record.bookingPaymentMode !== "pay_at_studio"
    ) {
      res.status(409).json({ error: "Payment is not eligible for confirmation" });
      return;
    }
    res.json({
      bookingId: params.data.id,
      amountEgp: record.finalPayableAmountMinor == null ? null : minorToEgp(record.finalPayableAmountMinor),
      paymentStatus: record.status,
    });
  },
);

// ── Student-safe cancellation ────────────────────────────────────────────────
// Students may cancel ONLY their own ACTIVE booking. Sets bookingStatus =
// 'cancelled' (keeps the record for history — never deletes), which releases the
// seat because booked count excludes cancelled bookings.
router.patch(
  "/bookings/:id/cancel",
  requireStudentAuth,
  requireVerifiedStudent,
  async (req, res): Promise<void> => {
    const params = GetBookingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
      if (!existing) return { kind: "not_found" as const };
      const ownsIt =
        (existing.accountOwnerStudentId != null && existing.accountOwnerStudentId === req.studentId) ||
        normalizeEmail(existing.studentEmail) === normalizeEmail(req.studentEmail ?? "");
      if (!ownsIt) return { kind: "not_found" as const }; // 404 — never leak others' bookings
      if (existing.bookingStatus === "cancelled") return { kind: "ok" as const, booking: existing };
      if (existing.bookingStatus !== "pending" && existing.bookingStatus !== "confirmed") {
        return { kind: "not_cancellable" as const };
      }
      if (existing.packageOrderId != null) {
        const [historicalDeduction] = await tx
          .select()
          .from(creditTransactionsTable)
          .where(and(
            eq(creditTransactionsTable.bookingId, existing.id),
            eq(creditTransactionsTable.type, "booking_deduction"),
          ))
          .limit(1);

        if (historicalDeduction) {
          const [alreadyRestored] = await tx
            .select()
            .from(creditTransactionsTable)
            .where(and(
              eq(creditTransactionsTable.bookingId, existing.id),
              eq(creditTransactionsTable.type, "booking_restoration"),
            ))
            .limit(1);

          if (!alreadyRestored) {
            const [order] = await tx
              .select()
              .from(packageOrdersTable)
              .where(eq(packageOrdersTable.id, existing.packageOrderId))
              .for("update")
              .limit(1);

            if (order) {
              const balanceBefore = order.remainingCredits;
              const balanceAfter = balanceBefore + 1;
              await tx
                .update(packageOrdersTable)
                .set({
                  remainingCredits: balanceAfter,
                  status: order.status === "fullyUsed" ? "active" : order.status,
                })
                .where(eq(packageOrdersTable.id, order.id));

              await tx.insert(creditTransactionsTable).values({
                packageOrderId: order.id,
                studentId: existing.accountOwnerStudentId,
                participantType: existing.participantType,
                participantChildId: existing.participantChildId,
                type: "booking_restoration",
                delta: 1,
                balanceBefore,
                balanceAfter,
                referenceId: existing.id,
                referenceType: "booking",
                bookingId: existing.id,
                notes: "Restoration of pre-H5 historical booking deduction on cancellation",
                createdBy: "system:cancellation",
              });
            }
          }
        }
      }
      const [updated] = await tx
        .update(bookingsTable)
        .set({ bookingStatus: "cancelled", status: "cancelled" })
        .where(eq(bookingsTable.id, existing.id))
        .returning();
      const notification = await bookingStatusNotification(tx, updated, "cancelled");
      if (notification) {
        await createStudentNotification(tx, {
          studentId: updated.accountOwnerStudentId,
          studentEmail: updated.studentEmail,
          ...notification,
        });
      }
      return { kind: "ok" as const, booking: updated };
    });
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    if (result.kind === "not_cancellable") {
      res.status(409).json({ error: "This booking can no longer be cancelled.", code: "not_cancellable" });
      return;
    }
    res.json(GetBookingResponse.parse(result.booking));
  },
);

// Finance Phase 2C: UpdateBookingBody is a generated (orval) zod schema
// that does not know about this field and, by default zod.object
// behavior, silently strips unknown keys — so confirmedPaymentMethod is
// parsed separately against this small local schema rather than by
// extending the generated contract. Required only when this PATCH
// transitions paymentStatus to "paid", validated against the exact
// DB-enum values from the schema.
const BookingConfirmedPaymentMethod = z.object({
  confirmedPaymentMethod: z.enum(PAYMENT_RECORD_CONFIRMED_METHODS).optional(),
});

router.patch(
  "/bookings/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireBookingUpdatePermission,
  requireBookingPaymentConfirmPermission,
  async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (
    req.body != null
    && typeof req.body === "object"
    && ["participantType", "participantChildId", "bookingScope", "childId"].some((key) => key in req.body)
  ) {
    res.status(409).json({
      error: "BOOKING_PARTICIPANT_IMMUTABLE",
      code: "BOOKING_PARTICIPANT_IMMUTABLE",
      message: "A booking participant cannot be reassigned after creation.",
    });
    return;
  }
  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const confirmedPushState: { pending: { studentId: number; studentEmail: string; title: string; body: string; data: Record<string, unknown>; notificationId: number } | null } = { pending: null };
  let financeCompatibility: "legacy_payment_record_missing" | null = null;
  // Finance Batch 1 (Part E): true only when THIS transaction auto-forced
  // bookingStatus pending -> confirmed as a side effect of confirming
  // payment (see the guard block below) — used to suppress the generic
  // booking-status-changed notification for that specific transition, so a
  // single payment confirmation sends one push ("payment confirmed"), not
  // two ("payment confirmed" + "booking confirmed") for the same action.
  let bookingStatusAutoConfirmedByPayment = false;
  const methodParsed = BookingConfirmedPaymentMethod.safeParse(req.body);
  const requestedConfirmedPaymentMethod: PaymentRecordConfirmedMethod | undefined = methodParsed.success
    ? methodParsed.data.confirmedPaymentMethod
    : undefined;
  const confirmingAdminId = req.adminUser?.id;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, params.data.id))
      .for("update");
    if (!existing) return { kind: "not_found" as const };

    const data = parsed.data.studentEmail
      ? { ...parsed.data, studentEmail: normalizeEmail(parsed.data.studentEmail) }
      : parsed.data;
    const normalized = normalizeBookingWrite(data, existing);

    // ── Occurrence integrity ─────────────────────────────────────────────────
    // If this update moves the booking to a different schedule, the stored
    // occurrenceDate is stale — it was resolved against the OLD schedule's
    // date/weekday. Recompute it from the new schedule's canonical current
    // occurrence (same resolution the create-booking route already uses)
    // so reminder automation and anything else keyed on occurrenceDate never
    // reads stale metadata. Clearing scheduleId clears occurrenceDate too.
    const scheduleIdProvided = Object.prototype.hasOwnProperty.call(req.body ?? {}, "scheduleId");
    if (scheduleIdProvided && normalized.scheduleId !== existing.scheduleId) {
      if (normalized.scheduleId == null) {
        normalized.occurrenceDate = null;
      } else {
        const [newSchedule] = await tx
          .select({
            type: schedulesTable.type,
            date: schedulesTable.date,
            dayOfWeek: schedulesTable.dayOfWeek,
            startTime: schedulesTable.startTime,
          })
          .from(schedulesTable)
          .where(eq(schedulesTable.id, normalized.scheduleId))
          .limit(1);
        if (!newSchedule) {
          return { kind: "forbidden" as const, message: "Target schedule not found." };
        }
        normalized.occurrenceDate = currentOccurrenceDate(newSchedule);
      }
    }

    // ── State-machine guard (Phase D) ───────────────────────────────────────
    // "attended" is a CHECK-IN outcome, not an admin-editable label. It must be
    // produced only by the attendance flow (/check-in/qr or POST /attendance),
    // which atomically creates the attendance record (+ credit + notification)
    // alongside the status change. So the booking PATCH may NOT:
    //   • move a booking INTO attended/completed (no attendance row would exist), or
    //   • move a booking OUT of attended/completed (a booking can never return
    //     from Attended to Confirmed).
    const wasAttended = existing.bookingStatus === "attended" || existing.bookingStatus === "completed";
    const willBeAttended = normalized.bookingStatus === "attended" || normalized.bookingStatus === "completed";
    if (normalized.bookingStatus !== existing.bookingStatus) {
      if (willBeAttended) {
        return {
          kind: "forbidden" as const,
          message: "Attendance can only be recorded through check-in, not by editing the booking status.",
        };
      }
      if (wasAttended) {
        return {
          kind: "forbidden" as const,
          message: "An attended booking cannot be changed back to another status.",
        };
      }
    }

    // ── Payment confirmation guard (Pre-Phase-2 Payment Integrity Hotfix) ────
    // This PATCH is general-purpose (schedule, notes, status, etc.), so the
    // guard below fires only when the write actually targets paymentStatus
    // "paid" — the one transition with a real, irreversible-in-spirit
    // consequence (a booking treated as paid cash). The row lock above
    // (.for("update")) already serializes concurrent PATCHes on this booking;
    // this guard adds the state-machine check that decides whether THIS
    // particular transition is allowed to proceed, so a duplicate/concurrent
    // confirmation attempt is rejected instead of silently re-applied.
    if (normalized.paymentStatus === "paid") {
      // A package-credit or free booking must never become a paid-cash
      // booking through this endpoint — its economics live entirely in the
      // credit ledger (package_credit) or nowhere (free), and "paid" would
      // fabricate a cash receipt that was never collected.
      if (normalized.paymentMode === "package_credit" || normalized.paymentMode === "free") {
        return {
          kind: "payment_not_confirmable" as const,
          message: `A ${normalized.paymentMode === "package_credit" ? "package-credit" : "free"} booking cannot be confirmed as a paid cash booking.`,
        };
      }
      // Reject repeated or invalid confirmations. "not_required" bookings
      // (package-credit/free, checked above, but also any other current or
      // future not_required booking) and "refunded"/already-"paid" bookings
      // have no legitimate reason to accept a new "paid" write — the only
      // confirmable source states are "pending_payment" (the normal case)
      // and "failed" (a retried payment attempt that then succeeded).
      if (existing.paymentStatus !== "pending_payment" && existing.paymentStatus !== "failed") {
        return {
          kind: "payment_not_confirmable" as const,
          message: `Booking ${existing.id} cannot be confirmed as paid from payment status "${existing.paymentStatus}".`,
        };
      }
      // A cancelled or rejected booking is operationally terminal — payment
      // confirmation on it would resurrect a booking nobody is attending.
      if (existing.bookingStatus === "cancelled" || existing.bookingStatus === "rejected") {
        return {
          kind: "payment_not_confirmable" as const,
          message: `Booking ${existing.id} cannot be confirmed as paid — its booking status ("${existing.bookingStatus}") is terminal.`,
        };
      }

      // Finance Phase 2C: this transition to paymentStatus:"paid" is the
      // approved authoritative Finance payment-confirmation action (policy
      // decision #2). confirmedPaymentMethod is required for it — the
      // booking row lock above already serializes concurrent PATCHes, so
      // this check only ever runs once per genuine confirmation.
      if (!requestedConfirmedPaymentMethod) {
        return {
          kind: "confirmed_payment_method_required" as const,
        };
      }
      if (confirmingAdminId == null) {
        return { kind: "admin_identity_required" as const };
      }

      // Finance Batch 1 (Part E): payment confirmation must atomically
      // confirm the booking too — previously paymentStatus could become
      // "paid" while bookingStatus stayed "pending" (its default-inherited
      // value, since the Admin "Confirm Payment" action only sends
      // {paymentStatus, confirmedPaymentMethod}), leaving Confirm/Reject
      // visible in the Admin UI even though payment was already collected.
      // Every guard above (source paymentStatus pending_payment/failed,
      // bookingStatus not cancelled/rejected/attended, package_credit/free
      // excluded) has already run by this point, so "pending" is the only
      // bookingStatus value this transition can still be sitting on —
      // forcing it to "confirmed" here needs no further guard. If the
      // caller's own request already explicitly targets a bookingStatus
      // other than "pending" (e.g. some future combined admin action), that
      // explicit choice is respected instead of being overwritten.
      if (normalized.bookingStatus === "pending") {
        // Narrow via a local const rather than relying on property narrowing
        // surviving the assignment below: `normalized` is typed as the broad
        // Drizzle insert partial (BookingWrite), so TypeScript does not
        // retain a literal-narrowed type for `normalized.bookingStatus`
        // across the write on the next line. The runtime value is always a
        // valid BookingStatus here (this block only runs when the check
        // above already matched "pending"); this local just gives the
        // compiler the same guarantee explicitly.
        const confirmedBookingStatus: BookingStatus = "confirmed";
        normalized.bookingStatus = confirmedBookingStatus;
        normalized.status = legacyStatusFromSplit(confirmedBookingStatus, normalized.paymentStatus);
        bookingStatusAutoConfirmedByPayment = true;
      }
    }

    const [updated] = await tx.update(bookingsTable).set(normalized).where(eq(bookingsTable.id, params.data.id)).returning();

    // Finance Phase 2C: transition the existing canonical payment_records
    // row atomically with the booking update above, only for the actual
    // pending->paid transition (not every operational-status edit sharing
    // this PATCH). Studio-walk-in and package-credit/free bookings never
    // reach here — the guards above already excluded them.
    if (normalized.paymentStatus === "paid" && existing.paymentStatus !== "paid") {
      const confirmation = await confirmCanonicalPaymentRecord(tx, {
        flowType: "single_class_booking",
        bookingId: updated.id,
        confirmedPaymentMethod: requestedConfirmedPaymentMethod!,
        confirmingAdminId: confirmingAdminId!,
      });
      if (confirmation.kind === "integrity_error" || confirmation.kind === "terminal") {
        return { kind: "finance_integrity_error" as const, confirmation };
      }
      if (confirmation.kind === "legacy_missing") {
        logger.warn({
          event: "finance_legacy_payment_record_missing",
          flowType: "single_class_booking",
          bookingId: updated.id,
        }, "Confirming payment for a booking with no canonical payment_records row — legacy/pre-Phase-2B source, Phase 2D backfill scope.");
        financeCompatibility = "legacy_payment_record_missing";
      }
    }

    if (updated.bookingStatus !== existing.bookingStatus && !bookingStatusAutoConfirmedByPayment) {
      const notification = await bookingStatusNotification(tx, updated, updated.bookingStatus);
      if (notification) {
        await createStudentNotification(tx, {
          studentId: updated.accountOwnerStudentId,
          studentEmail: updated.studentEmail,
          ...notification,
        });
      }
    }

    if (updated.paymentStatus !== existing.paymentStatus) {
      const notification = await paymentStatusNotification(tx, updated, updated.paymentStatus);
      if (notification) {
        // Finance Phase 2C: for the specific paid-confirmation transition,
        // defer push to after commit (approved policy #2 step 10) — the
        // notification row itself still inserts atomically inside `tx`.
        // Every other payment-status notification (refunded/failed) keeps
        // its pre-existing dispatch behavior unchanged.
        const isConfirmationNotification = updated.paymentStatus === "paid";
        const notificationRow = await createStudentNotification(tx, {
          studentId: updated.accountOwnerStudentId,
          studentEmail: updated.studentEmail,
          ...notification,
          dispatchPush: isConfirmationNotification ? false : undefined,
        });
        if (isConfirmationNotification && notificationRow && updated.accountOwnerStudentId != null) {
          confirmedPushState.pending = {
            studentId: updated.accountOwnerStudentId,
            studentEmail: updated.studentEmail,
            title: notification.title,
            body: notification.body,
            data: { type: notification.type, ...notification.metadata },
            notificationId: notificationRow.id,
          };
        }
      }
    }

    return { kind: "ok" as const, booking: updated };
  });

  if (result.kind === "not_found") {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (result.kind === "forbidden") {
    res.status(409).json({ error: result.message, code: "invalid_status_transition" });
    return;
  }

  if (result.kind === "payment_not_confirmable") {
    res.status(409).json({ error: result.message, code: "PAYMENT_STATUS_NOT_CONFIRMABLE" });
    return;
  }

  if (result.kind === "confirmed_payment_method_required") {
    res.status(400).json({
      error: "confirmedPaymentMethod is required to confirm this booking's payment.",
      code: "CONFIRMED_PAYMENT_METHOD_REQUIRED",
    });
    return;
  }

  if (result.kind === "admin_identity_required") {
    res.status(401).json({ error: "Authenticated Admin identity is required to confirm payment." });
    return;
  }

  if (result.kind === "finance_integrity_error") {
    logger.error({
      event: "finance_confirmation_integrity_error",
      flowType: "single_class_booking",
      bookingId: params.data.id,
      confirmation: result.confirmation,
    }, "Blocked booking payment confirmation due to a Finance payment_records integrity problem.");
    res.status(409).json({
      error: "This booking's payment record is in an inconsistent state and cannot be confirmed automatically. Please contact engineering support.",
      code: "FINANCE_CONFIRMATION_INTEGRITY_ERROR",
    });
    return;
  }

  // Deterministic post-commit boundary — dispatched only once the
  // confirmation transaction above has actually resolved successfully.
  if (confirmedPushState.pending) {
    const push = confirmedPushState.pending;
    void sendPushNotification(push).catch((error) => {
      logger.error({ err: error, notificationId: push.notificationId }, "Failed to dispatch booking-payment-confirmation push");
    });
  }
  if (financeCompatibility) {
    res.setHeader("X-Finance-Compatibility", financeCompatibility);
  }
  res.json(UpdateBookingResponse.parse(result.booking));
  },
);

router.delete(
  "/bookings/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("bookings", "delete"),
  async (req, res): Promise<void> => {
  const params = DeleteBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    // Locks the booking row before any tombstone/delete decision, matching
    // the same FOR UPDATE convention as packageOrders.ts's activation guard
    // — prevents a concurrent delete from racing this one.
    const [existing] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id)).for("update");
    if (!existing) return null;

    const notification = await bookingStatusNotification(tx, existing, "cancelled");
    if (notification) {
      await createStudentNotification(tx, {
        studentId: existing.accountOwnerStudentId,
        studentEmail: existing.studentEmail,
        ...notification,
      });
    }

    // Finance Phase 2A: payment_records.booking_id/package_order_id use
    // ON DELETE RESTRICT, not SET NULL — a plain cascade can't be told apart
    // from an unauthorized direct write after the fact. This transaction is
    // the one authorized way to clear a payment_records row's booking_id: it
    // sets a transaction-local marker the guard trigger on payment_records
    // checks for (see 0078_payment_records_foundation.sql), tombstones any
    // linked row, then deletes the booking — all in the same transaction, so
    // either both happen or neither does. No payment_records row is created
    // by any route today, so this is a no-op for every booking that has one
    // (there are none yet); it exists so the delete route already satisfies
    // the FK once a future write path starts creating payment_records rows.
    await tx.execute(sql`set local app.allow_payment_source_tombstone = 'on'`);
    await tx.update(paymentRecordsTable)
      .set({ bookingId: null, sourceDeletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(paymentRecordsTable.bookingId, existing.id));

    const [deleted] = await tx.delete(bookingsTable).where(eq(bookingsTable.id, params.data.id)).returning();
    return deleted ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.sendStatus(204);
  },
);

export default router;
