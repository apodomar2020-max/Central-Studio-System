/**
 * Admin Calendar Occurrence Roster (Phase 4A.1) —
 * /api/admin/calendar/occurrence-roster
 *
 * Read-only. Composes the schedule summary plus the exact bookings (and
 * their attendance, if any) for a single calendar occurrence — the backend
 * data layer for the future Calendar operational Sheet (Phase 4A.2, not
 * built yet; this endpoint has no UI consumer in this phase). A new,
 * purpose-built endpoint rather than retrofitting a scheduleId+occurrenceDate
 * filter onto GET /bookings or GET /attendance — neither of those changes.
 *
 * Permission: gated on bookings.view AND attendance.view (both required),
 * NOT on schedules.view. The roster surfaces student names and payment/
 * attendance status — more sensitive than schedule metadata — so this must
 * never grant broader visibility than the dedicated Bookings/Attendance
 * pages already require for the exact same data.
 *
 * Data rules:
 *   - Regular ("class") schedules: roster is filtered by
 *     (scheduleId, occurrenceDate) — a real per-occurrence roster.
 *   - Ballet schedules: occurrenceDate is NOT applied as a booking filter —
 *     Ballet has no per-occurrence booking model (enrollment is group/level
 *     based), matching GET /admin/calendar's own bookingCount semantics
 *     exactly (see routes/adminCalendar.ts's doc comment). occurrenceDate is
 *     still a required query param for shape consistency with the regular
 *     case, it's simply unused in the Ballet branch's WHERE clause.
 *   - bookingCount mirrors GET /admin/calendar: only RESERVED_SEAT_STATUSES
 *     count. The `roster` array itself is NOT filtered by status — a
 *     cancelled/rejected booking still appears, since the roster is a
 *     record of everyone associated with the occurrence, not just reserved
 *     seats.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  bookingsTable,
  attendanceTable,
  studentsTable,
  childrenTable,
  schedulesTable,
  classesTable,
  instructorsTable,
  balletSchedulesTable,
  balletClassesTable,
  balletInstructorsTable,
  studioBranchesTable,
  studioRoomsTable,
} from "@workspace/db";
import { GetAdminCalendarOccurrenceRosterQueryParams, GetAdminCalendarOccurrenceRosterResponse } from "@workspace/api-zod";
import { RESERVED_SEAT_STATUSES } from "../lib/bookingStatus";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();

type ScheduleSummary = {
  classTitle: string;
  instructorName: string | null;
  branchName: string | null;
  roomName: string | null;
  startTime: string;
  endTime: string;
  capacity: number | null;
};

async function fetchScheduleSummary(source: "class" | "ballet", scheduleId: number): Promise<ScheduleSummary | null> {
  if (source === "class") {
    const [row] = await db
      .select({
        startTime: schedulesTable.startTime,
        endTime: schedulesTable.endTime,
        classTitle: classesTable.title,
        capacity: classesTable.capacity,
        instructorName: instructorsTable.name,
        branchName: studioBranchesTable.name,
        roomName: studioRoomsTable.name,
      })
      .from(schedulesTable)
      .innerJoin(classesTable, eq(schedulesTable.classId, classesTable.id))
      .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
      .leftJoin(studioBranchesTable, eq(schedulesTable.branchId, studioBranchesTable.id))
      .leftJoin(studioRoomsTable, eq(schedulesTable.roomId, studioRoomsTable.id))
      .where(eq(schedulesTable.id, scheduleId))
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select({
      startTime: balletSchedulesTable.startTime,
      endTime: balletSchedulesTable.endTime,
      classTitle: balletClassesTable.title,
      capacity: balletSchedulesTable.capacity,
      instructorName: balletInstructorsTable.name,
      branchName: studioBranchesTable.name,
      roomName: studioRoomsTable.name,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
    .leftJoin(balletInstructorsTable, eq(balletClassesTable.instructorId, balletInstructorsTable.id))
    .leftJoin(studioBranchesTable, eq(balletSchedulesTable.branchId, studioBranchesTable.id))
    .leftJoin(studioRoomsTable, eq(balletSchedulesTable.roomId, studioRoomsTable.id))
    .where(eq(balletSchedulesTable.id, scheduleId))
    .limit(1);
  return row ?? null;
}

router.get(
  "/admin/calendar/occurrence-roster",
  blockStudentJwt,
  requireAdminAuth,
  requireAdminPermission("bookings", "view"),
  requireAdminPermission("attendance", "view"),
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = GetAdminCalendarOccurrenceRosterQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { source, scheduleId, occurrenceDate } = parsed.data;

    const summary = await fetchScheduleSummary(source, scheduleId);
    if (!summary) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const bookingConditions = source === "class"
      ? [eq(bookingsTable.scheduleId, scheduleId), eq(bookingsTable.occurrenceDate, occurrenceDate)]
      : [eq(bookingsTable.balletScheduleId, scheduleId)];

    const bookingRows = await db
      .select({
        bookingId: bookingsTable.id,
        studentName: bookingsTable.studentName,
        accountOwnerName: studentsTable.name,
        participantChildName: childrenTable.fullName,
        bookingStatus: bookingsTable.bookingStatus,
        paymentStatus: bookingsTable.paymentStatus,
      })
      .from(bookingsTable)
      .leftJoin(studentsTable, eq(bookingsTable.accountOwnerStudentId, studentsTable.id))
      .leftJoin(childrenTable, eq(bookingsTable.participantChildId, childrenTable.id))
      .where(and(...bookingConditions));

    const bookingIds = bookingRows.map((row) => row.bookingId);
    const attendanceRows = bookingIds.length
      ? await db
          .select({
            bookingId: attendanceTable.bookingId,
            status: attendanceTable.status,
            checkedInAt: attendanceTable.checkedInAt,
          })
          .from(attendanceTable)
          .where(inArray(attendanceTable.bookingId, bookingIds))
      : [];
    const attendanceByBookingId = new Map(
      attendanceRows.filter((row) => row.bookingId != null).map((row) => [row.bookingId as number, row]),
    );

    const reservedSeatStatuses: readonly string[] = RESERVED_SEAT_STATUSES;
    const bookingCount = bookingRows.filter((row) => reservedSeatStatuses.includes(row.bookingStatus)).length;

    const roster = bookingRows.map((row) => {
      const attendance = attendanceByBookingId.get(row.bookingId);
      return {
        bookingId: row.bookingId,
        studentName: row.accountOwnerName ?? row.studentName,
        participantName: row.participantChildName ?? row.studentName,
        bookingStatus: row.bookingStatus,
        paymentStatus: row.paymentStatus,
        attendanceStatus: attendance?.status ?? null,
        checkedInAt: attendance?.checkedInAt ?? null,
      };
    });

    res.json(GetAdminCalendarOccurrenceRosterResponse.parse({
      scheduleId,
      source,
      classTitle: summary.classTitle,
      instructorName: summary.instructorName,
      branchName: summary.branchName,
      roomName: summary.roomName,
      startTime: summary.startTime,
      endTime: summary.endTime,
      capacity: summary.capacity,
      bookingCount,
      roster,
    }));
  },
);

export default router;
