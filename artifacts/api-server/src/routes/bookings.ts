import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
  attendanceTable,
} from "@workspace/db";
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
      attendanceId: attendanceTable.id,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
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
    enrichedById.set(r.booking.id, {
      ...(existing ?? {}),
      ...r.booking,
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
      hasAttendance: Boolean(existing?.hasAttendance || r.attendanceId),
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

  const [row] = await db
    .insert(bookingsTable)
    .values({
      ...normalized,
      // CreateBookingBody (zod) guarantees studentName/studentEmail at runtime;
      // normalizeBookingWrite widens them to optional, so assert the insert shape.
      studentEmail: normalizeEmail(parsed.data.studentEmail),
    } as typeof bookingsTable.$inferInsert)
    .returning();
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

router.patch("/bookings/:id", async (req, res): Promise<void> => {
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
  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  const data = parsed.data.studentEmail
    ? { ...parsed.data, studentEmail: normalizeEmail(parsed.data.studentEmail) }
    : parsed.data;
  const normalized = normalizeBookingWrite(data, existing);
  const [row] = await db.update(bookingsTable).set(normalized).where(eq(bookingsTable.id, params.data.id)).returning();
  res.json(UpdateBookingResponse.parse(row));
});

router.delete("/bookings/:id", async (req, res): Promise<void> => {
  const params = DeleteBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(bookingsTable).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
