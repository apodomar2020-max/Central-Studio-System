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
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
import {
  ListAdminCalendarQueryParams,
  ListAdminCalendarResponse,
  GetAdminCalendarResourceViewQueryParams,
  GetAdminCalendarResourceViewResponse,
} from "@workspace/api-zod";
import { RESERVED_SEAT_STATUSES } from "../lib/bookingStatus";
import { InvalidCalendarRangeError, isoDateRange, scheduleOccursOnDate } from "../lib/calendarOccurrence";
import { findScheduleConflict, type ScheduleOccupancy } from "../lib/scheduleConflict";
import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";
import { requireScheduleLocationLookup } from "./studioBranches";

const router: IRouter = Router();

type CalendarOccurrenceConflict = {
  scheduleId: number;
  source: "class" | "ballet";
  classTitle: string;
  startTime: string;
  endTime: string;
  branchName: string | null;
  roomName: string | null;
};

type CalendarOccurrence = {
  scheduleId: number;
  source: "class" | "ballet";
  scheduleType: "weekly" | "one_time";
  occurrenceDate: string;
  startTime: string;
  endTime: string;
  classId: number;
  classTitle: string;
  instructorId: number | null;
  instructorName: string | null;
  branchName: string | null;
  roomName: string | null;
  // Regular: classes.capacity (per-class). Ballet: ballet_schedules.capacity
  // (per-schedule) — resolved per-source below rather than left for callers
  // to reconcile the two systems' differing capacity models themselves.
  capacity: number | null;
  bookingCount: number;
  conflict: CalendarOccurrenceConflict | null;
};

/**
 * Phase 2D — annotates each already-projected occurrence with the occurrence
 * (if any) it conflicts with, reusing the Phase 2A engine's
 * findScheduleConflict rather than re-deriving overlap logic here. Two
 * occurrences can only conflict if they land on the same calendar date, so
 * this groups by occurrenceDate first, then treats each occurrence in that
 * group as a one-off ("one_time") ScheduleOccupancy pinned to that date —
 * exactly what the underlying recurring schedule resolves to on that
 * specific day, so this is a faithful, non-duplicated reuse of the same
 * conflict predicate the create/update routes already enforce (Phase 2B/2C),
 * not a re-implementation of it. Read-only: this never blocks anything, it
 * only labels the response.
 */
function annotateConflicts(
  occurrences: ReadonlyArray<Omit<CalendarOccurrence, "conflict"> & { branchId: number | null; roomId: number | null }>,
): Map<string, CalendarOccurrenceConflict> {
  const occurrenceKey = (o: { source: string; scheduleId: number; occurrenceDate: string }) =>
    `${o.source}|${o.scheduleId}|${o.occurrenceDate}`;

  const byDate = new Map<string, typeof occurrences[number][]>();
  for (const occurrence of occurrences) {
    const list = byDate.get(occurrence.occurrenceDate) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.occurrenceDate, list);
  }

  const toOccupancy = (o: typeof occurrences[number]): ScheduleOccupancy => ({
    id: o.scheduleId,
    source: o.source,
    branchId: o.branchId,
    roomId: o.roomId,
    // Every occurrence here was already projected only from a
    // status: "active" schedule row (see the query conditions below), so
    // this is always the occupying status — no separate lookup needed.
    status: "active",
    startTime: o.startTime,
    endTime: o.endTime,
    recurrence: { type: "one_time", date: o.occurrenceDate },
  });

  const conflicts = new Map<string, CalendarOccurrenceConflict>();
  for (const dayOccurrences of byDate.values()) {
    if (dayOccurrences.length < 2) continue;
    const dayOccupancies = dayOccurrences.map(toOccupancy);
    dayOccurrences.forEach((occurrence, index) => {
      const found = findScheduleConflict(dayOccupancies[index], dayOccupancies);
      if (!found) return;
      const matchingOccurrence = dayOccurrences.find((candidate) => candidate.scheduleId === found.id && candidate.source === found.source);
      if (!matchingOccurrence) return;
      conflicts.set(occurrenceKey(occurrence), {
        scheduleId: matchingOccurrence.scheduleId,
        source: matchingOccurrence.source,
        classTitle: matchingOccurrence.classTitle,
        startTime: matchingOccurrence.startTime,
        endTime: matchingOccurrence.endTime,
        branchName: matchingOccurrence.branchName,
        roomName: matchingOccurrence.roomName,
      });
    });
  }
  return conflicts;
}

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
          classId: classesTable.id,
          classTitle: classesTable.title,
          classCapacity: classesTable.capacity,
          instructorId: instructorsTable.id,
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
          capacity: balletSchedulesTable.capacity,
          classId: balletClassesTable.id,
          classTitle: balletClassesTable.title,
          instructorId: balletInstructorsTable.id,
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

    const occurrences: Array<Omit<CalendarOccurrence, "conflict"> & { branchId: number | null; roomId: number | null }> = [];

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
          classId: row.classId,
          classTitle: row.classTitle,
          instructorId: row.instructorId,
          instructorName: row.instructorName,
          capacity: row.classCapacity,
          branchId: row.branchId,
          roomId: row.roomId,
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
          classId: row.classId,
          classTitle: row.classTitle,
          instructorId: row.instructorId,
          instructorName: row.instructorName,
          capacity: row.capacity,
          branchId: row.branchId,
          roomId: row.roomId,
          branchName: row.branchId != null ? branchById.get(row.branchId)?.name ?? null : null,
          roomName: row.roomId != null ? roomById.get(row.roomId)?.name ?? null : null,
          bookingCount: balletCountById.get(row.id) ?? 0,
        });
      }
    }

    const conflictByKey = annotateConflicts(occurrences);
    const withConflicts: CalendarOccurrence[] = occurrences.map((occurrence) => ({
      ...occurrence,
      conflict: conflictByKey.get(`${occurrence.source}|${occurrence.scheduleId}|${occurrence.occurrenceDate}`) ?? null,
    }));

    withConflicts.sort((a, b) =>
      a.occurrenceDate === b.occurrenceDate
        ? a.startTime.localeCompare(b.startTime)
        : a.occurrenceDate.localeCompare(b.occurrenceDate),
    );

    res.json(ListAdminCalendarResponse.parse(withConflicts));
  },
);

router.get(
  "/admin/calendar/resource-view",
  blockStudentJwt,
  requireAdminAuth,
  requireScheduleLocationLookup,
  async (req: AdminRequest, res): Promise<void> => {
    const parsed = GetAdminCalendarResourceViewQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { date, branchId, roomId } = parsed.data;

    const regularConditions = [
      eq(schedulesTable.status, "active"),
      isNotNull(schedulesTable.branchId),
      isNotNull(schedulesTable.roomId),
    ];
    if (branchId != null) regularConditions.push(eq(schedulesTable.branchId, branchId));
    if (roomId != null) regularConditions.push(eq(schedulesTable.roomId, roomId));

    const balletConditions = [
      eq(balletSchedulesTable.status, "active"),
      isNotNull(balletSchedulesTable.branchId),
      isNotNull(balletSchedulesTable.roomId),
    ];
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
          classId: classesTable.id,
          classTitle: classesTable.title,
          classCapacity: classesTable.capacity,
          instructorId: instructorsTable.id,
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
          capacity: balletSchedulesTable.capacity,
          classId: balletClassesTable.id,
          classTitle: balletClassesTable.title,
          instructorId: balletInstructorsTable.id,
          instructorName: balletInstructorsTable.name,
        })
        .from(balletSchedulesTable)
        .innerJoin(balletClassesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
        .leftJoin(balletInstructorsTable, eq(balletClassesTable.instructorId, balletInstructorsTable.id))
        .where(and(...balletConditions)),
    ]);

    const roomConditions = [eq(studioRoomsTable.isActive, true)];
    if (branchId != null) roomConditions.push(eq(studioRoomsTable.branchId, branchId));
    if (roomId != null) roomConditions.push(eq(studioRoomsTable.id, roomId));

    const activeRooms = await db
      .select({
        id: studioRoomsTable.id,
        name: studioRoomsTable.name,
        branchId: studioRoomsTable.branchId,
      })
      .from(studioRoomsTable)
      .where(and(...roomConditions));

    const roomById = new Map(activeRooms.map((r) => [r.id, r]));

    const branchIds = new Set<number>();
    for (const r of activeRooms) branchIds.add(r.branchId);
    for (const row of [...regularRows, ...balletRows]) {
      if (row.branchId != null) branchIds.add(row.branchId);
    }
    const branches = branchIds.size
      ? await db.select().from(studioBranchesTable).where(inArray(studioBranchesTable.id, [...branchIds]))
      : [];
    const branchById = new Map(branches.map((b) => [b.id, b]));

    const regularScheduleIds = regularRows.map((r) => r.id);
    const balletScheduleIds = balletRows.map((r) => r.id);

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

    const occurrences: Array<Omit<CalendarOccurrence, "conflict"> & { branchId: number | null; roomId: number | null }> = [];

    for (const row of regularRows) {
      const schedule = {
        type: row.type as "weekly" | "one_time",
        date: row.date,
        dayOfWeek: row.dayOfWeek,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
      };
      if (scheduleOccursOnDate(schedule, date)) {
        occurrences.push({
          scheduleId: row.id,
          source: "class",
          scheduleType: schedule.type,
          occurrenceDate: date,
          startTime: row.startTime,
          endTime: row.endTime,
          classId: row.classId,
          classTitle: row.classTitle,
          instructorId: row.instructorId,
          instructorName: row.instructorName,
          capacity: row.classCapacity,
          branchId: row.branchId,
          roomId: row.roomId,
          branchName: row.branchId != null ? branchById.get(row.branchId)?.name ?? null : null,
          roomName: row.roomId != null ? roomById.get(row.roomId)?.name ?? null : null,
          bookingCount: regularCountByKey.get(`${row.id}|${date}`) ?? 0,
        });
      }
    }

    for (const row of balletRows) {
      const schedule = { type: "weekly" as const, dayOfWeek: row.dayOfWeek };
      if (scheduleOccursOnDate(schedule, date)) {
        occurrences.push({
          scheduleId: row.id,
          source: "ballet",
          scheduleType: "weekly",
          occurrenceDate: date,
          startTime: row.startTime,
          endTime: row.endTime,
          classId: row.classId,
          classTitle: row.classTitle,
          instructorId: row.instructorId,
          instructorName: row.instructorName,
          capacity: row.capacity,
          branchId: row.branchId,
          roomId: row.roomId,
          branchName: row.branchId != null ? branchById.get(row.branchId)?.name ?? null : null,
          roomName: row.roomId != null ? roomById.get(row.roomId)?.name ?? null : null,
          bookingCount: balletCountById.get(row.id) ?? 0,
        });
      }
    }

    const conflictByKey = annotateConflicts(occurrences);

    const occurrencesByRoom = new Map<number, any[]>();
    for (const occurrence of occurrences) {
      if (occurrence.roomId == null) continue;
      const roomOccs = occurrencesByRoom.get(occurrence.roomId) ?? [];
      const conflict = conflictByKey.get(`${occurrence.source}|${occurrence.scheduleId}|${occurrence.occurrenceDate}`) ?? null;
      roomOccs.push({
        id: occurrence.scheduleId,
        scheduleId: occurrence.scheduleId,
        source: occurrence.source,
        scheduleType: occurrence.scheduleType,
        occurrenceDate: occurrence.occurrenceDate,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        classId: occurrence.classId,
        classTitle: occurrence.classTitle,
        title: occurrence.classTitle,
        instructorId: occurrence.instructorId,
        instructorName: occurrence.instructorName,
        branchId: occurrence.branchId!,
        roomId: occurrence.roomId!,
        roomName: occurrence.roomName ?? `Room ${occurrence.roomId}`,
        capacity: occurrence.capacity,
        bookingCount: occurrence.bookingCount,
        conflict,
      });
      occurrencesByRoom.set(occurrence.roomId, roomOccs);
    }

    const roomGroups = activeRooms.map((room) => {
      const roomOccs = occurrencesByRoom.get(room.id) ?? [];
      roomOccs.sort((a, b) => a.startTime.localeCompare(b.startTime));
      return {
        roomId: room.id,
        roomName: room.name,
        occurrences: roomOccs,
      };
    });

    for (const [rId, rOccs] of occurrencesByRoom.entries()) {
      if (!activeRooms.some((r) => r.id === rId)) {
        rOccs.sort((a, b) => a.startTime.localeCompare(b.startTime));
        roomGroups.push({
          roomId: rId,
          roomName: rOccs[0]?.roomName ?? `Room ${rId}`,
          occurrences: rOccs,
        });
      }
    }

    roomGroups.sort((a, b) => a.roomName.localeCompare(b.roomName));

    res.json(
      GetAdminCalendarResourceViewResponse.parse({
        date,
        branchId: branchId ?? null,
        rooms: roomGroups,
      }),
    );
  },
);

export default router;
