import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
      ?? (paymentMode === "pay_at_studio" ? "pending" : "confirmed");

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

router.get("/bookings", async (req, res): Promise<void> => {
  const query = ListBookingsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  // Build WHERE conditions from optional filters
  const conditions = [];
  if (query.data.status) conditions.push(eq(bookingsTable.status, query.data.status));
  if (query.data.bookingStatus) conditions.push(eq(bookingsTable.bookingStatus, query.data.bookingStatus));
  if (query.data.paymentStatus) conditions.push(eq(bookingsTable.paymentStatus, query.data.paymentStatus));
  if (query.data.studentEmail) {
    conditions.push(sql`lower(trim(${bookingsTable.studentEmail})) = ${normalizeEmail(query.data.studentEmail)}`);
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

  const rows = conditions.length > 0
    ? await base.where(and(...conditions)).orderBy(desc(bookingsTable.createdAt))
    : await base.orderBy(desc(bookingsTable.createdAt));

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
    const checkInBlockedReason =
      alreadyCheckedIn
        ? "Already checked in"
        : bookingStatus === "attended" || bookingStatus === "completed"
          ? "Already checked in"
          : bookingStatus === "cancelled" || bookingStatus === "rejected"
            ? "Booking is not eligible for check-in"
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

  res.json(ListBookingsResponse.parse(enriched));
});

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalized = normalizeBookingWrite(parsed.data);

  if (normalized.paymentMode === "package_credit" && normalized.packageOrderId == null) {
    res.status(400).json({
      error: "package_required",
      message: "Package credit booking requires a packageOrderId.",
    });
    return;
  }

  if (normalized.packageOrderId != null && normalized.scheduleId != null) {
    const [schedule] = await db
      .select({ packageEligible: schedulesTable.packageEligible })
      .from(schedulesTable)
      .where(eq(schedulesTable.id, normalized.scheduleId))
      .limit(1);

    if (schedule?.packageEligible === false) {
      res.status(400).json({
        error: "package_not_eligible",
        message: "This schedule is not eligible for package credits.",
      });
      return;
    }
  }

  const requestedParticipantChildId =
    parsed.data.participantChildId ?? parsed.data.childId ?? normalized.participantChildId ?? null;
  const accountOwnerStudentId = await resolveAccountOwnerStudentId(
    db,
    req,
    parsed.data.studentEmail,
    parsed.data.accountOwnerStudentId ?? normalized.accountOwnerStudentId ?? null,
  );
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

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(bookingsTable)
      .values({
        ...normalized,
        // CreateBookingBody (zod) guarantees studentName/studentEmail at runtime;
        // normalizeBookingWrite widens them to optional, so assert the insert shape.
        studentName: participantName,
        studentEmail: normalizeEmail(parsed.data.studentEmail),
        accountOwnerStudentId,
        participantChildId,
        bookingScope,
      } as typeof bookingsTable.$inferInsert)
      .returning();

    const notification = await bookingCreatedNotification(tx, inserted);
    await createStudentNotification(tx, {
      studentEmail: inserted.studentEmail,
      ...notification,
    });

    return inserted;
  });

  res.status(201).json(GetBookingResponse.parse(row));
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
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
  res.json(GetBookingResponse.parse(row));
});

router.patch(
  "/bookings/:id",
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
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
    if (!existing) return null;

    const data = parsed.data.studentEmail
      ? { ...parsed.data, studentEmail: normalizeEmail(parsed.data.studentEmail) }
      : parsed.data;
    const normalized = normalizeBookingWrite(data, existing);
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

    return updated;
  });

  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  res.json(UpdateBookingResponse.parse(row));
  },
);

router.delete(
  "/bookings/:id",
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
