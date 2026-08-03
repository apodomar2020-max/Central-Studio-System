/**
 * Admin Calendar (Phase 1 — read-only foundation) — /api/admin/calendar
 *
 * Projects existing `schedules` and `ballet_schedules` rows into concrete
 * calendar occurrences over a date range. This route creates NO new data —
 * it reads the same tables the Schedules/Ballet Schedules admin pages
 * already write to (see routes/schedules.ts, routes/adminBalletSchedules.ts)
 * and reuses the existing day-of-week/effective-date projection rule from
 * lib/calendarOccurrence.ts (itself a generalization of routes/dashboard.ts's
 * `occursOn`) rather than introducing a new recurrence system.
 *
 * Scoping decisions specific to this endpoint (documented here since they're
 * not obvious from the schema alone):
 *   - Only `status: "active"` schedules are projected — cancelled/expired/
 *     completed schedules (and deactivated/cancelled ballet schedules) are
 *     omitted. Admins can still see their full lifecycle on the existing
 *     Schedules/Ballet Schedules pages.
 *   - `bookingCount` for a regular-schedule occurrence is scoped to that
 *     exact occurrence date, matching the existing `/schedules` list
 *     endpoint's `actualBookedCount`. Ballet has no per-occurrence booking
 *     model (enrollment is group/level-based — see balletGroupSchedules),
 *     so its `bookingCount` is a simple total of reserved bookings for the
 *     weekly slot.
 *   - Permission: reuses the existing "schedules" / "ballet.schedules"
 *     view|create|edit permission gate (requireScheduleLocationLookup, also
 *     used by the schedule-location lookup endpoints) rather than adding a
 *     new permission module — the calendar only visualizes data those
 *     permissions already grant read access to.
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  bookingsTable,
  schedulesTable,
  classesTable,
  instructorsTable,
  studioBranchesTable,
  studioRoomsTable,
  balletSchedulesTable,
  balletClassesTable,
  balletInstructorsTable,
} from "@workspace/db";
import { ListAdminCalendarQueryParams, ListAdminCalendarResponse } from "@workspace/api-zod";
import { RESERVED_SEAT_STATUSES } from "../lib/bookingStatus";
import { InvalidCalendarRangeError, isoDateRange, scheduleOccursOnDate } from "../lib/calendarOccurrence";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";
import { requireScheduleLocationLookup } from "./studioBranches";

const router: IRouter = Router();

type CalendarOccurrence = {
  scheduleId: number;
  source: "class" | "ballet";
  scheduleType: "weekly" | "one_time";
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  classTitle: string;
  instructorName: string | null;
  branchName: string | null;
  roomName: string | null;
  bookingCount: number;
};

router.get(
  "/admin/calendar",
  blockStudentJwt,
  requireAdminAuth,
  requireScheduleLocationLookup,
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = ListAdminCalendarQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { from, to, branchId, roomId } = parsed.data;

    let dateRange: string[];
    try {
      dateRange = isoDateRange(from, to);
    } catch (error) {
      if (error instanceof InvalidCalendarRangeError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }

    const regularConditions = [eq(schedulesTable.status, "active")];
    if (branchId != null) regularConditions.push(eq(schedulesTable.branchId, branchId));
    if (roomId != null) regularConditions.push(eq(schedulesTable.roomId, roomId));

    const balletConditions = [eq(balletSchedulesTable.status, "active")];
    if (branchId != null) balletConditions.push(eq(balletSchedulesTable.branchId, branchId));
    if (roomId != null) balletConditions.push(eq(balletSchedulesTable.roomId, roomId));

    const [regularRows, balletRows] = await Promise.all([
      db
        .select({
          id: schedulesTable.id,
          branchId: schedulesTable.branchId,
          roomId: schedulesTable.roomId,
          type: schedulesTable.type,
          dayOfWeek: schedulesTable.dayOfWeek,
          date: schedulesTable.date,
          startTime: schedulesTable.startTime,
          endTime: schedulesTable.endTime,
          effectiveFrom: schedulesTable.effectiveFrom,
          effectiveUntil: schedulesTable.effectiveUntil,
          classTitle: classesTable.title,
          instructorName: instructorsTable.name,
        })
        .from(schedulesTable)
        .innerJoin(classesTable, eq(schedulesTable.classId, classesTable.id))
        .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
        .where(and(...regularConditions)),
      db
        .select({
          id: balletSchedulesTable.id,
          branchId: balletSchedulesTable.branchId,
          roomId: balletSchedulesTable.roomId,
          dayOfWeek: balletSchedulesTable.dayOfWeek,
          startTime: balletSchedulesTable.startTime,
          endTime: balletSchedulesTable.endTime,
          classTitle: balletClassesTable.title,
          instructorName: balletInstructorsTable.name,
        })
        .from(balletSchedulesTable)
        .innerJoin(balletClassesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
        .leftJoin(balletInstructorsTable, eq(balletClassesTable.instructorId, balletInstructorsTable.id))
        .where(and(...balletConditions)),
    ]);

    const branchIds = new Set<number>();
    const roomIds = new Set<number>();
    for (const row of [...regularRows, ...balletRows]) {
      if (row.branchId != null) branchIds.add(row.branchId);
      if (row.roomId != null) roomIds.add(row.roomId);
    }
    const [branches, rooms] = await Promise.all([
      branchIds.size ? db.select().from(studioBranchesTable).where(inArray(studioBranchesTable.id, [...branchIds])) : [],
      roomIds.size ? db.select().from(studioRoomsTable).where(inArray(studioRoomsTable.id, [...roomIds])) : [],
    ]);
    const branchById = new Map(branches.map((row) => [row.id, row]));
    const roomById = new Map(rooms.map((row) => [row.id, row]));

    const regularScheduleIds = regularRows.map((row) => row.id);
    const balletScheduleIds = balletRows.map((row) => row.id);
    const [regularCountRows, balletCountRows] = await Promise.all([
      regularScheduleIds.length
        ? db
            .select({
              scheduleId: bookingsTable.scheduleId,
              occurrenceDate: bookingsTable.occurrenceDate,
              n: sql<number>`count(*)::int`,
            })
            .from(bookingsTable)
            .where(and(
              inArray(bookingsTable.scheduleId, regularScheduleIds),
              inArray(bookingsTable.bookingStatus, [...RESERVED_SEAT_STATUSES]),
            ))
            .groupBy(bookingsTable.scheduleId, bookingsTable.occurrenceDate)
        : [],
      balletScheduleIds.length
        ? db
            .select({
              balletScheduleId: bookingsTable.balletScheduleId,
              n: sql<number>`count(*)::int`,
            })
            .from(bookingsTable)
            .where(and(
              inArray(bookingsTable.balletScheduleId, balletScheduleIds),
              inArray(bookingsTable.bookingStatus, [...RESERVED_SEAT_STATUSES]),
            ))
            .groupBy(bookingsTable.balletScheduleId)
        : [],
    ]);
    const regularCountByKey = new Map<string, number>();
    for (const row of regularCountRows) {
      regularCountByKey.set(`${row.scheduleId}|${row.occurrenceDate ?? ""}`, Number(row.n));
    }
    const balletCountById = new Map<number, number>();
    for (const row of balletCountRows) {
      if (row.balletScheduleId != null) balletCountById.set(row.balletScheduleId, Number(row.n));
    }

    const occurrences: CalendarOccurrence[] = [];

    for (const row of regularRows) {
      const schedule = {
        type: row.type as "weekly" | "one_time",
        date: row.date,
        dayOfWeek: row.dayOfWeek,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
      };
      for (const occurrenceDate of dateRange) {
        if (!scheduleOccursOnDate(schedule, occurrenceDate)) continue;
        occurrences.push({
          scheduleId: row.id,
          source: "class",
          scheduleType: schedule.type,
          occurrenceDate,
          startTime: row.startTime,
          endTime: row.endTime,
          classTitle: row.classTitle,
          instructorName: row.instructorName,
          branchName: row.branchId != null ? branchById.get(row.branchId)?.name ?? null : null,
          roomName: row.roomId != null ? roomById.get(row.roomId)?.name ?? null : null,
          bookingCount: regularCountByKey.get(`${row.id}|${occurrenceDate}`) ?? 0,
        });
      }
    }

    for (const row of balletRows) {
      const schedule = { type: "weekly" as const, dayOfWeek: row.dayOfWeek };
      for (const occurrenceDate of dateRange) {
        if (!scheduleOccursOnDate(schedule, occurrenceDate)) continue;
        occurrences.push({
          scheduleId: row.id,
          source: "ballet",
          scheduleType: "weekly",
          occurrenceDate,
          startTime: row.startTime,
          endTime: row.endTime,
          classTitle: row.classTitle,
          instructorName: row.instructorName,
          branchName: row.branchId != null ? branchById.get(row.branchId)?.name ?? null : null,
          roomName: row.roomId != null ? roomById.get(row.roomId)?.name ?? null : null,
          bookingCount: balletCountById.get(row.id) ?? 0,
        });
      }
    }

    occurrences.sort((a, b) =>
      a.occurrenceDate === b.occurrenceDate
        ? a.startTime.localeCompare(b.startTime)
        : a.occurrenceDate.localeCompare(b.occurrenceDate),
    );

    res.json(ListAdminCalendarResponse.parse(occurrences));
  },
);

export default router;
