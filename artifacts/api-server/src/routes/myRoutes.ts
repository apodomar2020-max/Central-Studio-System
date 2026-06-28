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
import { desc, eq, inArray } from "drizzle-orm";
import * as zod from "zod";
import {
  db,
  packageOrdersTable,
  creditTransactionsTable,
  attendanceTable,
  bookingsTable,
  classesTable,
  instructorsTable,
  pricePackagesTable,
} from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";

const router: IRouter = Router();

// Apply student authentication + mandatory email verification to every /my/* route
router.use("/my", requireStudentAuth, requireVerifiedStudent);

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
    })
    .from(packageOrdersTable)
    .leftJoin(pricePackagesTable, eq(packageOrdersTable.packageId, pricePackagesTable.id))
    .where(eq(packageOrdersTable.studentEmail, req.studentEmail!))
    .orderBy(desc(packageOrdersTable.createdAt));

  res.json(rows);
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
    .select({ id: packageOrdersTable.id })
    .from(packageOrdersTable)
    .where(eq(packageOrdersTable.studentEmail, req.studentEmail!));

  if (orders.length === 0) {
    res.json({ data: [], total: 0, page, limit });
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
    res.json({ data: [], total: 0, page, limit });
    return;
  }

  // Step 3 — fetch transactions (all rows first; paginate in JS to keep
  // the query simple — ledger rows per student are bounded in practice)
  const allRows = await db
    .select()
    .from(creditTransactionsTable)
    .where(inArray(creditTransactionsTable.packageOrderId, scopedIds))
    .orderBy(desc(creditTransactionsTable.createdAt));

  const total = allRows.length;
  const data = allRows.slice((page - 1) * limit, page * limit);

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
    return { ...t, className };
  });

  res.json({ data: enriched, total, page, limit });
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

  const allRows = await db
    .select({
      id: attendanceTable.id,
      studentEmail: attendanceTable.studentEmail,
      studentName: attendanceTable.studentName,
      classTitle: attendanceTable.classTitle,
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
    .orderBy(desc(attendanceTable.checkedInAt));

  const total = allRows.length;
  const data = allRows.slice((page - 1) * limit, page * limit);

  res.json({ data, total, page, limit });
});

export default router;
