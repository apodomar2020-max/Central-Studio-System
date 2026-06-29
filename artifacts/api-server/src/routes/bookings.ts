import { blockStudentJwt } from "../middlewares/auth";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  attendanceTable,
  studentsTable,
  childrenTable,
} from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
import { requireAdminAuth, requireAdminPermission } from "./adminAuth";
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
import { DUPLICATE_BLOCKING_STATUSES } from "../lib/bookingStatus";

const router: IRouter = Router();

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

  await db
    .update(schedulesTable)
    .set({ status: "completed" })
    .where(sql`
      ${schedulesTable.id} = ${scheduleId}
      and ${schedulesTable.status} = 'active'
      and exists (
        select 1
        from ${classesTable}
        where ${classesTable.id} = ${schedulesTable.classId}
          and ${classesTable.capacity} <= (
            select count(*)::int
            from ${bookingsTable}
            where ${bookingsTable.scheduleId} = ${schedulesTable.id}
              -- RESERVED seats only; pending requests do not reserve a seat.
              and ${bookingsTable.bookingStatus} in ('confirmed', 'attended')
          )
      )
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

router.get("/bookings", requireBookingReadAccess, async (req, res): Promise<void> => {
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
    if (query.data.studentEmail) {
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
    const bookingScope = r.booking.bookingScope ?? (r.booking.participantChildId != null ? "child" : "self");
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
      { startTime: r.scheduleStartTime },
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
      schedulePriceEgp: r.schedulePriceEgp ?? null,
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
            ? "This class schedule is full."
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

  const requestedParticipantChildId =
    parsed.data.participantChildId ?? parsed.data.childId ?? normalized.participantChildId ?? null;

  let participantChildId = requestedParticipantChildId;
  let bookingScope = normalized.bookingScope ?? (participantChildId != null ? "child" : "self");
  let participantName = parsed.data.studentName;

  if (participantChildId != null) {
    if (accountOwnerStudentId == null) {
      res.status(401).json({
        error: "Student authentication required to book for a child.",
      });
      return;
    }

    const [child] = await db
      .select({ id: childrenTable.id, fullName: childrenTable.fullName })
      .from(childrenTable)
      .where(and(
        eq(childrenTable.id, participantChildId),
        eq(childrenTable.parentId, accountOwnerStudentId),
      ))
      .limit(1);

    if (!child) {
      res.status(403).json({
        error: "Child profile not found for this account.",
      });
      return;
    }

    participantChildId = child.id;
    participantName = child.fullName;
    bookingScope = "child";
  } else {
    participantChildId = null;
    bookingScope = "self";
  }

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

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bookingsTable)
      .values({
        ...normalized,
        // CreateBookingBody (zod) guarantees studentName/studentEmail at runtime;
        // normalizeBookingWrite widens them to optional, so assert the insert shape.
        studentName: participantName,
        studentEmail: normalizeEmail(studentEmail),
        accountOwnerStudentId,
        participantChildId,
        bookingScope,
        occurrenceDate,
      } as typeof bookingsTable.$inferInsert)
      .returning();

    const notification = await bookingCreatedNotification(tx, inserted);
    await createStudentNotification(tx, {
      studentEmail: inserted.studentEmail,
      ...notification,
    });

    if (inserted.scheduleId != null) {
      await tx
        .update(schedulesTable)
        .set({ status: "completed" })
        .where(sql`
          ${schedulesTable.id} = ${inserted.scheduleId}
          and ${schedulesTable.status} = 'active'
          and exists (
            select 1
            from ${classesTable}
            where ${classesTable.id} = ${schedulesTable.classId}
              and ${classesTable.capacity} <= (
                select count(*)::int
                from ${bookingsTable}
                where ${bookingsTable.scheduleId} = ${schedulesTable.id}
                  -- RESERVED seats only (see lib/bookingStatus RESERVED_SEAT_STATUSES);
                  -- pending requests do NOT reserve a seat.
                  and ${bookingsTable.bookingStatus} in ('confirmed', 'attended')
              )
          )
        `);
    }

    return inserted;
  });

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

// ── Student-safe cancellation ────────────────────────────────────────────────
// Students may cancel ONLY their own ACTIVE booking. Sets bookingStatus =
// 'cancelled' (keeps the record for history — never deletes), which releases the
// seat (booked count excludes cancelled). If the schedule had been auto-marked
// "completed" (full), free it back to "active" so the seat is reusable.
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
      const [updated] = await tx
        .update(bookingsTable)
        .set({ bookingStatus: "cancelled", status: "cancelled" })
        .where(eq(bookingsTable.id, existing.id))
        .returning();
      // Release the seat: revert a "completed" (full) schedule back to active when
      // it is now below capacity.
      if (updated.scheduleId != null) {
        await tx.update(schedulesTable).set({ status: "active" }).where(sql`
          ${schedulesTable.id} = ${updated.scheduleId}
          and ${schedulesTable.status} = 'completed'
          and not (
            ${schedulesTable.type} = 'one_time'
            and ${schedulesTable.date} is not null
            and (${schedulesTable.date}::text || ' ' || ${schedulesTable.endTime})::timestamp
              < (now() at time zone 'Africa/Cairo')
          )
          and exists (
            select 1 from ${classesTable}
            where ${classesTable.id} = ${schedulesTable.classId}
              and ${classesTable.capacity} > (
                select count(*)::int from ${bookingsTable}
                where ${bookingsTable.scheduleId} = ${schedulesTable.id}
                  -- RESERVED seats only; pending requests do not reserve a seat.
                  and ${bookingsTable.bookingStatus} in ('confirmed', 'attended')
              )
          )
        `);
      }
      const notification = await bookingStatusNotification(tx, updated, "cancelled");
      if (notification) {
        await createStudentNotification(tx, { studentEmail: updated.studentEmail, ...notification });
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

router.patch(
  "/bookings/:id",
  blockStudentJwt,
  requireAdminAuth,
  requireBookingUpdatePermission,
  async (req, res): Promise<void> => {
  const params = UpdateBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
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

    const [updated] = await tx.update(bookingsTable).set(normalized).where(eq(bookingsTable.id, params.data.id)).returning();

    if (updated.bookingStatus !== existing.bookingStatus) {
      const notification = await bookingStatusNotification(tx, updated, updated.bookingStatus);
      if (notification) {
        await createStudentNotification(tx, {
          studentEmail: updated.studentEmail,
          ...notification,
        });
      }
    }

    if (updated.paymentStatus !== existing.paymentStatus) {
      const notification = await paymentStatusNotification(tx, updated, updated.paymentStatus);
      if (notification) {
        await createStudentNotification(tx, {
          studentEmail: updated.studentEmail,
          ...notification,
        });
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
    const [existing] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
    if (!existing) return null;

    const notification = await bookingStatusNotification(tx, existing, "cancelled");
    if (notification) {
      await createStudentNotification(tx, {
        studentEmail: existing.studentEmail,
        ...notification,
      });
    }

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
