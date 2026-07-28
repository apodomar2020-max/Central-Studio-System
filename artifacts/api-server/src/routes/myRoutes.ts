/**
 * Student-scoped /my/* routes
 *
 * All routes require a valid student JWT (enforced by requireStudentAuth).
 * Every query is hard-scoped to req.studentEmail — no student can read
 * another student's data.
 *
 * Replaces the insecure pattern where the mobile app called
 * /api/package-orders (all orders) and filtered client-side.
 */
import { Router, type IRouter } from "express";
import { desc, eq, inArray, sql } from "drizzle-orm";
import * as zod from "zod";
import {
  db,
  packageOrdersTable,
  creditTransactionsTable,
  attendanceTable,
  bookingsTable,
  classesTable,
  instructorsTable,
  schedulesTable,
  childrenTable,
  pricePackagesTable,
} from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";

const router: IRouter = Router();

// Apply student authentication + mandatory email verification to every /my/* route
router.use("/my", requireStudentAuth, requireVerifiedStudent);

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "18:00" / "18:00:00" → "6:00 PM"; returns null for empty input. */
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

// ---------------------------------------------------------------------------
// GET /my/packages
//
// Returns all package orders belonging to the authenticated student, ordered
// by creation date descending (newest first).
// ---------------------------------------------------------------------------
router.get("/my/packages", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: packageOrdersTable.id,
      studentName: packageOrdersTable.studentName,
      studentEmail: packageOrdersTable.studentEmail,
      studentPhone: packageOrdersTable.studentPhone,
      packageId: packageOrdersTable.packageId,
      packageName: packageOrdersTable.packageName,
      totalCredits: packageOrdersTable.totalCredits,
      remainingCredits: packageOrdersTable.remainingCredits,
      status: packageOrdersTable.status,
      notes: packageOrdersTable.notes,
      activatedAt: packageOrdersTable.activatedAt,
      expiresAt: packageOrdersTable.expiresAt,
      createdAt: packageOrdersTable.createdAt,
      updatedAt: packageOrdersTable.updatedAt,
      priceEgp: pricePackagesTable.priceEgp,
      participantType: packageOrdersTable.participantType,
      participantChildId: packageOrdersTable.participantChildId,
      participantName: packageOrdersTable.participantNameSnapshot,
      participantAgeAtPurchase: packageOrdersTable.participantAgeAtPurchase,
      purchaseEligibilityConfigurationState: packageOrdersTable.purchaseEligibilityConfigurationState,
    })
    .from(packageOrdersTable)
    .leftJoin(pricePackagesTable, eq(packageOrdersTable.packageId, pricePackagesTable.id))
    .where(eq(packageOrdersTable.studentEmail, req.studentEmail!))
    .orderBy(desc(packageOrdersTable.createdAt));

  res.json(rows.map((row) => ({
    ...row,
    ownershipState: row.participantType == null ? "legacy_unassigned" : "assigned",
  })));
});

// ---------------------------------------------------------------------------
// GET /my/credits
//
// Returns the authenticated student's credit transaction history (immutable
// ledger rows from credit_transactions).  Only transactions belonging to this
// student's package orders are returned — determined by first fetching the
// student's package order IDs, then filtering by those IDs.
//
// Supports optional pagination (page / limit) and filtering by a specific
// packageOrderId (validated to belong to this student).
// ---------------------------------------------------------------------------
const MyCreditsQueryParams = zod.object({
  page: zod.coerce.number().int().min(1).optional(),
  limit: zod.coerce.number().int().min(1).max(100).optional(),
  packageOrderId: zod.coerce.number().int().positive().optional(),
});

router.get("/my/credits", async (req, res): Promise<void> => {
  const query = MyCreditsQueryParams.safeParse(req.query);
  const page = (query.success && query.data.page) ? query.data.page : 1;
  const limit = (query.success && query.data.limit) ? query.data.limit : 20;
  const filterPackageOrderId = query.success ? query.data.packageOrderId : undefined;

  // Step 1 — collect all package order IDs for this student
  const orders = await db
    .select({
      id: packageOrdersTable.id,
      participantType: packageOrdersTable.participantType,
      participantChildId: packageOrdersTable.participantChildId,
      participantName: packageOrdersTable.participantNameSnapshot,
      remainingCredits: packageOrdersTable.remainingCredits,
    })
    .from(packageOrdersTable)
    .where(eq(packageOrdersTable.studentEmail, req.studentEmail!));

  const participantBalanceMap = new Map<string, {
    participantType: "self" | "child" | null;
    participantChildId: number | null;
    participantName: string | null;
    remainingCredits: number;
    ownershipState: "assigned" | "legacy_unassigned";
  }>();
  for (const order of orders) {
    const key = `${order.participantType ?? "legacy"}:${order.participantChildId ?? ""}`;
    const existing = participantBalanceMap.get(key);
    if (existing) {
      existing.remainingCredits += order.remainingCredits;
    } else {
      participantBalanceMap.set(key, {
        participantType: order.participantType === "self" || order.participantType === "child"
          ? order.participantType
          : null,
        participantChildId: order.participantChildId,
        participantName: order.participantName,
        remainingCredits: order.remainingCredits,
        ownershipState: order.participantType == null ? "legacy_unassigned" : "assigned",
      });
    }
  }
  const participantBalances = [...participantBalanceMap.values()];

  if (orders.length === 0) {
    res.json({ data: [], total: 0, page, limit, participantBalances });
    return;
  }

  const orderIds = orders.map((o) => o.id);

  // Step 2 — if caller wants a specific package, ensure it belongs to them
  let scopedIds: number[];
  if (filterPackageOrderId != null) {
    scopedIds = orderIds.includes(filterPackageOrderId) ? [filterPackageOrderId] : [];
  } else {
    scopedIds = orderIds;
  }

  if (scopedIds.length === 0) {
    res.json({ data: [], total: 0, page, limit, participantBalances });
    return;
  }

  const offset = (page - 1) * limit;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(creditTransactionsTable)
    .where(inArray(creditTransactionsTable.packageOrderId, scopedIds));

  const total = Number(countRow?.total ?? 0);

  // Step 3 — fetch only the current page. Enrichment below intentionally works
  // on this page only so historical ledger size does not affect response cost.
  const data = await db
    .select()
    .from(creditTransactionsTable)
    .where(inArray(creditTransactionsTable.packageOrderId, scopedIds))
    .orderBy(desc(creditTransactionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Resolve a human-friendly class name for each row so the app shows the class
  // instead of a raw note like "QR check-in for booking #29" (legacy). We resolve
  // from several sources (in priority order), since older rows stored the booking
  // id only in the note text rather than a structured reference:
  //   1. referenceType "attendance" → attendance.classId/classTitle
  //   2. referenceType "booking"    → booking → class.title
  //   3. a booking id parsed from the note ("… booking #29") → booking → class.title
  const bookingIdFromNote = (note?: string | null): number | null => {
    if (!note) return null;
    const m = note.match(/booking\s+#?(\d+)/i) ?? note.match(/#(\d+)/);
    return m ? Number(m[1]) : null;
  };

  const attendanceIds = [...new Set(
    data.filter((t) => t.referenceType === "attendance" && t.referenceId != null).map((t) => t.referenceId!),
  )];
  const bookingIds = [...new Set(
    data.flatMap((t) => {
      const ids: number[] = [];
      if (t.referenceType === "booking" && t.referenceId != null) ids.push(t.referenceId);
      const fromNote = bookingIdFromNote(t.notes);
      if (fromNote != null) ids.push(fromNote);
      return ids;
    }),
  )];

  const classByAttendance = new Map<number, string>();
  if (attendanceIds.length > 0) {
    const rows = await db
      .select({ id: attendanceTable.id, classTitle: attendanceTable.classTitle, fromClass: classesTable.title })
      .from(attendanceTable)
      .leftJoin(classesTable, eq(attendanceTable.classId, classesTable.id))
      .where(inArray(attendanceTable.id, attendanceIds));
    for (const r of rows) {
      const name = r.fromClass ?? r.classTitle;
      if (name) classByAttendance.set(r.id, name);
    }
  }

  const classByBooking = new Map<number, string>();
  if (bookingIds.length > 0) {
    const rows = await db
      .select({ id: bookingsTable.id, title: classesTable.title })
      .from(bookingsTable)
      .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
      .where(inArray(bookingsTable.id, bookingIds));
    for (const r of rows) if (r.title) classByBooking.set(r.id, r.title);
  }

  const enriched = data.map((t) => {
    let className: string | null = null;
    if (t.referenceType === "attendance" && t.referenceId != null) {
      className = classByAttendance.get(t.referenceId) ?? null;
    }
    if (!className && t.referenceType === "booking" && t.referenceId != null) {
      className = classByBooking.get(t.referenceId) ?? null;
    }
    if (!className) {
      const fromNote = bookingIdFromNote(t.notes);
      if (fromNote != null) className = classByBooking.get(fromNote) ?? null;
    }
    return {
      ...t,
      className,
      ownershipState: t.participantType == null ? "legacy_unassigned" : "assigned",
    };
  });

  res.json({ data: enriched, total, page, limit, participantBalances });
});

// ---------------------------------------------------------------------------
// GET /my/attendance
//
// Returns the authenticated student's attendance history with instructor name
// resolved via a LEFT JOIN:
//   attendance → classes (on classId) → instructors (on instructorId)
//
// Supports optional pagination (page / limit).
// ---------------------------------------------------------------------------
const MyAttendanceQueryParams = zod.object({
  page: zod.coerce.number().int().min(1).optional(),
  limit: zod.coerce.number().int().min(1).max(100).optional(),
});

router.get("/my/attendance", async (req, res): Promise<void> => {
  const query = MyAttendanceQueryParams.safeParse(req.query);
  const page = (query.success && query.data.page) ? query.data.page : 1;
  const limit = (query.success && query.data.limit) ? query.data.limit : 20;
  const offset = (page - 1) * limit;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(attendanceTable)
    .where(eq(attendanceTable.studentEmail, req.studentEmail!));

  const total = Number(countRow?.total ?? 0);

  const data = await db
    .select({
      id: attendanceTable.id,
      studentEmail: attendanceTable.studentEmail,
      studentName: attendanceTable.studentName,
      classTitle: sql<string | null>`coalesce(${attendanceTable.classTitle}, ${classesTable.title})`,
      status: attendanceTable.status,
      creditDeducted: attendanceTable.creditDeducted,
      checkedInAt: attendanceTable.checkedInAt,
      packageOrderId: attendanceTable.packageOrderId,
      classId: attendanceTable.classId,
      scheduleId: attendanceTable.scheduleId,
      notes: attendanceTable.notes,
      // Resolved via JOIN; null when classId was not provided at check-in time
      instructorName: instructorsTable.name,
    })
    .from(attendanceTable)
    .leftJoin(classesTable, eq(attendanceTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(eq(attendanceTable.studentEmail, req.studentEmail!))
    .orderBy(desc(attendanceTable.checkedInAt))
    .limit(limit)
    .offset(offset);

  res.json({ data, total, page, limit });
});

// ---------------------------------------------------------------------------
// GET /my/bookings  (Phase C — single backend source of truth for the app's
// Schedule / My Bookings flow)
//
// Returns all bookings owned by the authenticated student (self OR any of
// their children), scoped by account-owner id OR email. Each row is enriched
// with display-ready class / schedule / instructor / participant fields so the
// mobile app can render directly from the server instead of relying on local
// optimistic state. The backend booking_status is authoritative and always
// wins over the app's cached copy.
// ---------------------------------------------------------------------------
router.get("/my/bookings", async (req, res): Promise<void> => {
  const email = (req.studentEmail ?? "").trim().toLowerCase();

  const rows = await db
    .select({
      booking: bookingsTable,
      classTitle: classesTable.title,
      classCategory: classesTable.category,
      classDurationMins: classesTable.durationMins,
      instructorName: instructorsTable.name,
      instructorPhotoUrl: instructorsTable.photoUrl,
      scheduleType: schedulesTable.type,
      scheduleDayOfWeek: schedulesTable.dayOfWeek,
      scheduleDate: schedulesTable.date,
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
      schedulePriceEgp: schedulesTable.priceEgp,
      participantChildName: childrenTable.fullName,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
    .where(sql`(${bookingsTable.accountOwnerStudentId} = ${req.studentId!} OR lower(trim(${bookingsTable.studentEmail})) = ${email})`)
    .orderBy(desc(bookingsTable.createdAt));

  const data = rows.map((r) => {
    const b = r.booking;
    const start = formatTime(r.scheduleStartTime);
    const end = formatTime(r.scheduleEndTime);
    const dayName = r.scheduleDayOfWeek != null ? DAY_NAMES[r.scheduleDayOfWeek] ?? null : null;
    const dateLabel = r.scheduleDate
      ? new Date(`${r.scheduleDate}T00:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : null;
    const schedulePrefix = r.scheduleType === "one_time" ? dateLabel : dayName;
    const scheduleLabel =
      schedulePrefix && start ? `${schedulePrefix} • ${end ? `${start} - ${end}` : start}` : null;
    const time = start ? (end ? `${start} - ${end}` : start) : "";

    const bookingStatus = b.bookingStatus ?? b.status;
    const paymentMode = b.paymentMode ?? (b.packageOrderId != null ? "package_credit" : null);
    const participantType = b.bookingScope ?? (b.participantChildId != null ? "child" : "self");
    const isPackage = paymentMode === "package_credit" || b.packageOrderId != null;
    const paymentMethod =
      paymentMode === "package_credit"
        ? "packageCredit"
        : paymentMode === "online_payment"
          ? "online"
          : "cash";
    const attendanceStatus =
      bookingStatus === "attended" || bookingStatus === "completed"
        ? "attended"
        : bookingStatus === "cancelled" || bookingStatus === "rejected"
          ? "cancelled"
          : "booked";

    return {
      id: b.id,
      classId: b.classId,
      scheduleId: b.scheduleId,
      // Raw occurrence key (YYYY-MM-DD) — used by the app to scope Cancel CTAs
      // and to decide whether a confirmed booking is past.
      occurrenceDate: b.occurrenceDate ?? null,
      className: r.classTitle ?? "Class",
      danceType: r.classCategory ?? "",
      instructorName: r.instructorName ?? "Instructor",
      // Raw stored URL — the app normalizes it to an absolute media URL.
      instructorImage: r.instructorPhotoUrl ?? null,
      date: b.occurrenceDate ?? r.scheduleDate ?? "",
      time,
      scheduleLabel,
      duration: r.classDurationMins != null ? `${r.classDurationMins} min` : "",
      location: r.scheduleLocation ?? "Central Studio",
      price: r.schedulePriceEgp ?? 0,
      participantType,
      participantName: r.participantChildName ?? b.studentName,
      // Stable child identity (children.id) for this booking, when present —
      // the mobile app's duplicate-booking check must key on this, not on
      // participantName, since child names are editable and not unique
      // across siblings. Null only for legacy rows without one.
      participantChildId: b.participantChildId ?? null,
      paymentMethod,
      paymentStatus: b.paymentStatus ?? "not_required",
      bookingStatus,
      bookingType: isPackage ? "package" : "single",
      bookingNumber: "CS" + String(b.id).padStart(6, "0"),
      attendanceStatus,
      createdAt: b.createdAt,
    };
  });

  res.json({ data });
});

export default router;
