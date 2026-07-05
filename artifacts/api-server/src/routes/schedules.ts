import { blockStudentJwt } from "../middlewares/auth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { Router, type IRouter } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, bookingsTable, schedulesTable, classesTable, instructorsTable } from "@workspace/db";
import { currentOccurrenceDate } from "../lib/occurrence";
import { RESERVED_SEAT_STATUSES } from "../lib/bookingStatus";
import { createStudentNotification } from "../lib/notifications";
import { DbClient } from "../lib/dbTypes";
import { diffFields, logActivity } from "../lib/activityLog";
import {
  ListSchedulesQueryParams,
  CreateScheduleBody,
  GetScheduleParams,
  GetScheduleResponse,
  UpdateScheduleParams,
  UpdateScheduleBody,
  UpdateScheduleResponse,
  DeleteScheduleParams,
  ListSchedulesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const SCHEDULE_ACTIVITY_FIELDS = ["classId", "type", "status", "dayOfWeek", "date", "startTime", "endTime", "priceEgp", "packageEligible", "location", "isRecurring", "effectiveFrom", "effectiveUntil"] as const;

const SCHEDULE_TYPES = ["weekly", "one_time"] as const;
const SCHEDULE_STATUSES = ["active", "completed", "expired", "cancelled"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];
type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

type ScheduleInput = {
  classId?: number;
  type?: ScheduleType;
  status?: ScheduleStatus;
  dayOfWeek?: number | null;
  date?: string | null;
  startTime?: string;
  endTime?: string;
  priceEgp?: number | null;
  packageEligible?: boolean;
  location?: string | null;
  isRecurring?: boolean;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
};

function dayOfWeekFromDate(date: string): number | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCDay();
}

function cairoToday(): { date: string; dayOfWeek: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, dayOfWeek: dayOfWeekFromDate(date) ?? new Date().getDay() };
}

function cairoNow(): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function isPastOneTimeSchedule(schedule: Pick<ScheduleInput, "type" | "date" | "endTime">): boolean {
  if (schedule.type !== "one_time" || !schedule.date || !schedule.endTime) return false;
  const now = cairoNow();
  return schedule.date < now.date || (schedule.date === now.date && schedule.endTime <= now.time);
}

async function validateActiveScheduleAllowed(
  schedule: ScheduleInput,
  scheduleId?: number,
): Promise<string | null> {
  if (schedule.status !== "active") return null;

  if (isPastOneTimeSchedule(schedule)) {
    return "Expired one-time schedules cannot be set back to active.";
  }

  if (scheduleId == null || schedule.classId == null) return null;

  const [capacityRow] = await db
    .select({
      capacity: classesTable.capacity,
      bookedCount: sql<number>`(
        select count(*)::int
        from ${bookingsTable}
        where ${bookingsTable.scheduleId} = ${scheduleId}
          -- RESERVED seats only; pending requests do not reserve a seat.
          and ${bookingsTable.bookingStatus} in ('confirmed', 'attended')
      )`,
    })
    .from(classesTable)
    .where(eq(classesTable.id, schedule.classId))
    .limit(1);

  if (capacityRow && capacityRow.bookedCount >= capacityRow.capacity) {
    return "Full schedules cannot be set back to active while booked seats are at capacity.";
  }

  return null;
}

async function syncAutomaticScheduleStatuses(): Promise<void> {
  await db
    .update(schedulesTable)
    .set({ status: "expired" })
    .where(sql`
      ${schedulesTable.type} = 'one_time'
      and ${schedulesTable.date} is not null
      and (${schedulesTable.date}::text || ' ' || ${schedulesTable.endTime})::timestamp
        < (now() at time zone 'Africa/Cairo')
      and ${schedulesTable.status} <> 'expired'
    `);

  await db
    .update(schedulesTable)
    .set({ status: "completed" })
    .where(sql`
      ${schedulesTable.status} = 'active'
      and exists (
        select 1
        from ${classesTable}
        where ${classesTable.id} = ${schedulesTable.classId}
          and ${classesTable.capacity} <= (
            select count(*)::int
            from ${bookingsTable}
            where ${bookingsTable.scheduleId} = ${schedulesTable.id}
              -- RESERVED seats only; pending requests do not auto-complete a schedule.
              and ${bookingsTable.bookingStatus} in ('confirmed', 'attended')
          )
      )
    `);
}

function normalizeScheduleInput(
  input: ScheduleInput,
  existing?: typeof schedulesTable.$inferSelect,
): ScheduleInput | { error: string } {
  const merged = { ...(existing ?? {}), ...input } as ScheduleInput;
  const type = merged.type ?? (merged.isRecurring === false ? "one_time" : "weekly");

  if (!SCHEDULE_TYPES.includes(type)) {
    return { error: "Schedule type must be weekly or one_time." };
  }

  if (merged.status && !SCHEDULE_STATUSES.includes(merged.status)) {
    return { error: "Schedule status must be active, completed, expired, or cancelled." };
  }

  if (type === "weekly") {
    if (merged.dayOfWeek == null || merged.dayOfWeek < 0 || merged.dayOfWeek > 6) {
      return { error: "Weekly schedules require a valid dayOfWeek." };
    }

    return {
      ...input,
      type,
      dayOfWeek: merged.dayOfWeek,
      date: null,
      isRecurring: true,
      packageEligible: merged.packageEligible ?? true,
    };
  }

  if (!merged.date) {
    return { error: "One-time schedules require a date." };
  }

  return {
    ...input,
    type,
    dayOfWeek: merged.dayOfWeek ?? dayOfWeekFromDate(merged.date),
    date: merged.date,
    isRecurring: false,
    packageEligible: merged.packageEligible ?? true,
  };
}

function scheduleDisplay(schedule: typeof schedulesTable.$inferSelect): string {
  const dateOrDay = schedule.date ?? (schedule.dayOfWeek != null ? `day ${schedule.dayOfWeek}` : "your scheduled class");
  return `${dateOrDay} ${schedule.startTime}-${schedule.endTime}`;
}

function didScheduleChange(
  before: typeof schedulesTable.$inferSelect,
  after: typeof schedulesTable.$inferSelect,
): boolean {
  return before.type !== after.type
    || before.dayOfWeek !== after.dayOfWeek
    || before.date !== after.date
    || before.startTime !== after.startTime
    || before.endTime !== after.endTime
    || before.location !== after.location;
}

async function notifyScheduleBookings(
  client: DbClient,
  scheduleId: number,
  title: string,
  body: string,
) {
  const rows = await client
    .select({
      bookingId: bookingsTable.id,
      studentEmail: bookingsTable.studentEmail,
      participantName: bookingsTable.studentName,
      participantChildId: bookingsTable.participantChildId,
      bookingScope: bookingsTable.bookingScope,
      className: classesTable.title,
      instructorName: instructorsTable.name,
      branch: schedulesTable.location,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .where(and(
      eq(bookingsTable.scheduleId, scheduleId),
      inArray(bookingsTable.bookingStatus, ["pending", "confirmed"]),
    ));

  for (const booking of rows) {
    await createStudentNotification(client, {
      studentEmail: booking.studentEmail,
      title,
      body,
      type: title.toLowerCase().includes("cancel") ? "schedule_cancelled" : "schedule_changed",
      relatedEntityType: "booking",
      relatedEntityId: booking.bookingId,
      metadata: {
        bookingId: booking.bookingId,
        className: booking.className,
        instructorName: booking.instructorName,
        branch: booking.branch,
        scheduleId,
        scheduleLabel: body,
        participantName: booking.participantName,
        participantChildId: booking.participantChildId,
        bookingScope: booking.bookingScope ?? (booking.participantChildId != null ? "child" : "self"),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// GET /schedules/today
//
// Returns all schedules that run on today's day-of-week, joined with the
// class title and instructor name.  Used by the admin check-in dialog to
// populate the "which class?" dropdown so check-ins are linked to real rows.
//
// Day-of-week mapping matches schedulesTable.dayOfWeek:
//   0 = Sunday, 1 = Monday, ..., 6 = Saturday  (same as JavaScript Date.getDay())
//
// Must be registered BEFORE /schedules/:id to prevent Express from treating
// the literal string "today" as a numeric :id parameter.
// ---------------------------------------------------------------------------
router.get("/schedules/today", async (req, res): Promise<void> => {
  await syncAutomaticScheduleStatuses();
  const { dayOfWeek: todayDow, date: todayIso } = cairoToday();

  const rows = await db
    .select({
      scheduleId: schedulesTable.id,
      scheduleType: schedulesTable.type,
      scheduleStatus: schedulesTable.status,
      classId: classesTable.id,
      classTitle: classesTable.title,
      scheduleDate: schedulesTable.date,
      packageEligible: schedulesTable.packageEligible,
      priceEgp: schedulesTable.priceEgp,
      startTime: schedulesTable.startTime,
      endTime: schedulesTable.endTime,
      location: schedulesTable.location,
      instructorName: instructorsTable.name,
    })
    .from(schedulesTable)
    .innerJoin(classesTable, eq(schedulesTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(or(
      and(eq(schedulesTable.type, "weekly"), eq(schedulesTable.dayOfWeek, todayDow), eq(schedulesTable.status, "active")),
      and(eq(schedulesTable.type, "one_time"), eq(schedulesTable.date, todayIso), eq(schedulesTable.status, "active")),
    ))
    .orderBy(schedulesTable.startTime);

  res.json(rows);
});

router.get("/schedules", async (req, res): Promise<void> => {
  await syncAutomaticScheduleStatuses();
  const query = ListSchedulesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const scheduleRows = query.data.classId != null
    ? await db
        .select()
        .from(schedulesTable)
        .where(eq(schedulesTable.classId, query.data.classId))
        .orderBy(schedulesTable.type, schedulesTable.date, schedulesTable.dayOfWeek, schedulesTable.startTime)
    : await db
        .select()
        .from(schedulesTable)
        .orderBy(schedulesTable.type, schedulesTable.date, schedulesTable.dayOfWeek, schedulesTable.startTime);

  // Occurrence-aware booked count (BOOKINGS, not attendance): tally active
  // (non-cancelled/rejected) bookings grouped by (schedule, occurrence_date), then
  // take only the count for each schedule's CURRENT upcoming occurrence. So a
  // weekly class's progress bar reflects this week, not lifetime bookings.
  // TODO: Replace schedule-level grouping with occurrence-level bookedCount when
  // the recurring occurrence model is introduced.
  const ids = scheduleRows.map((s) => s.id);
  const countRows = ids.length
    ? await db
        .select({
          scheduleId: bookingsTable.scheduleId,
          occ: bookingsTable.occurrenceDate,
          n: sql<number>`count(*)::int`,
        })
        .from(bookingsTable)
        .where(and(
          inArray(bookingsTable.scheduleId, ids),
          // RESERVED seats only — pending requests do NOT count toward the bar.
          inArray(bookingsTable.bookingStatus, [...RESERVED_SEAT_STATUSES]),
        ))
        .groupBy(bookingsTable.scheduleId, bookingsTable.occurrenceDate)
    : [];
  const countByKey = new Map<string, number>();
  for (const c of countRows) {
    countByKey.set(`${c.scheduleId}|${c.occ ?? ""}`, Number(c.n));
  }
  const enriched = scheduleRows.map((s) => {
    const occ = currentOccurrenceDate(s);
    const bookedCount = occ ? countByKey.get(`${s.id}|${occ}`) ?? 0 : 0;
    return { ...s, bookedCount, currentOccurrenceDate: occ };
  });
  res.json(ListSchedulesResponse.parse(enriched));
});

router.post("/schedules", blockStudentJwt, requireAdminAuth, requireAdminPermission("schedules", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const normalized = normalizeScheduleInput(parsed.data);
  if ("error" in normalized) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  const activeError = await validateActiveScheduleAllowed({
    ...normalized,
    status: normalized.status ?? "active",
  });
  if (activeError) {
    res.status(400).json({ error: activeError });
    return;
  }
  // normalizeScheduleInput widens every field to optional, but CreateScheduleBody
  // (zod) already guarantees the required columns (classId/startTime/endTime) are
  // present, so this insert payload is complete at runtime.
  const [row] = await db
    .insert(schedulesTable)
    .values(normalized as typeof schedulesTable.$inferInsert)
    .returning();
  await logActivity(req, {
    action: "create",
    module: "schedules",
    entityType: "schedule",
    entityId: row.id,
    entityLabel: scheduleDisplay(row),
    after: Object.fromEntries(SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Created schedule ${scheduleDisplay(row)}`,
  });
  res.status(201).json(GetScheduleResponse.parse(row));
});

router.get("/schedules/:id", async (req, res): Promise<void> => {
  await syncAutomaticScheduleStatuses();
  const params = GetScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(schedulesTable).where(eq(schedulesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  res.json(GetScheduleResponse.parse(row));
});

router.patch("/schedules/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("schedules", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(schedulesTable).where(eq(schedulesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const normalized = normalizeScheduleInput(parsed.data, existing);
  if ("error" in normalized) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  const candidate = { ...existing, ...normalized } as ScheduleInput;
  const activeError = await validateActiveScheduleAllowed(candidate, existing.id);
  if (activeError) {
    res.status(400).json({ error: activeError });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(schedulesTable).set(normalized).where(eq(schedulesTable.id, params.data.id)).returning();
    if (!updated) return null;

    if (didScheduleChange(existing, updated)) {
      await notifyScheduleBookings(
        tx,
        updated.id,
        "Schedule changed",
        `The schedule for your booked class changed to ${scheduleDisplay(updated)}.`,
      );
    }

    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  const { before, after } = diffFields(
    Object.fromEntries(SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
    Object.fromEntries(SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    SCHEDULE_ACTIVITY_FIELDS,
  );
  const changedKeys = Object.keys(after);
  if (changedKeys.length > 0) {
    const statusChanged = existing.status !== row.status;
    const action = statusChanged
      ? row.status === "cancelled"
        ? "cancel"
        : row.status === "completed"
          ? "complete"
          : "statusChange"
      : "update";
    await logActivity(req, {
      action,
      module: "schedules",
      entityType: "schedule",
      entityId: row.id,
      entityLabel: scheduleDisplay(row),
      before,
      after,
      summary: statusChanged
        ? `${action === "cancel" ? "Cancelled" : action === "complete" ? "Completed" : "Changed status for"} schedule ${scheduleDisplay(row)}`
        : `Updated schedule ${scheduleDisplay(row)}: ${changedKeys.join(", ")}`,
    });
  }
  res.json(UpdateScheduleResponse.parse(row));
});

router.delete("/schedules/:id", blockStudentJwt, requireAdminAuth, requireAdminPermission("schedules", "delete"), async (req: AdminRequest, res): Promise<void> => {
  const params = DeleteScheduleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schedulesTable).where(eq(schedulesTable.id, params.data.id));
    if (!existing) return null;

    await notifyScheduleBookings(
      tx,
      existing.id,
      "Class cancelled",
      "A booked class schedule was cancelled.",
    );

    const [deleted] = await tx.delete(schedulesTable).where(eq(schedulesTable.id, params.data.id)).returning();
    return deleted ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  await logActivity(req, {
    action: "delete",
    module: "schedules",
    entityType: "schedule",
    entityId: row.id,
    entityLabel: scheduleDisplay(row),
    before: Object.fromEntries(SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
    summary: `Deleted schedule ${scheduleDisplay(row)}`,
  });
  res.sendStatus(204);
});

export default router;
