import { Router, type IRouter } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, bookingsTable, schedulesTable, classesTable, instructorsTable } from "@workspace/db";
import { createStudentNotification } from "../lib/notifications";
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

const SCHEDULE_TYPES = ["weekly", "one_time"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

type ScheduleInput = {
  classId?: number;
  type?: ScheduleType;
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

function normalizeScheduleInput(
  input: ScheduleInput,
  existing?: typeof schedulesTable.$inferSelect,
): ScheduleInput | { error: string } {
  const merged = { ...(existing ?? {}), ...input } as ScheduleInput;
  const type = merged.type ?? (merged.isRecurring === false ? "one_time" : "weekly");

  if (!SCHEDULE_TYPES.includes(type)) {
    return { error: "Schedule type must be weekly or one_time." };
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
  client: typeof db,
  scheduleId: number,
  title: string,
  body: string,
) {
  const rows = await client
    .select({
      bookingId: bookingsTable.id,
      studentEmail: bookingsTable.studentEmail,
    })
    .from(bookingsTable)
    .where(and(
      eq(bookingsTable.scheduleId, scheduleId),
      inArray(bookingsTable.bookingStatus, ["pending", "confirmed"]),
    ));

  for (const booking of rows) {
    await createStudentNotification(client, {
      studentEmail: booking.studentEmail,
      title,
      body: `${body} Booking #${booking.bookingId}.`,
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
  const todayDow = new Date().getDay(); // 0=Sun … 6=Sat
  const todayIso = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      scheduleId: schedulesTable.id,
      scheduleType: schedulesTable.type,
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
      and(eq(schedulesTable.type, "weekly"), eq(schedulesTable.dayOfWeek, todayDow)),
      and(eq(schedulesTable.type, "one_time"), eq(schedulesTable.date, todayIso)),
    ))
    .orderBy(schedulesTable.startTime);

  res.json(rows);
});

router.get("/schedules", async (req, res): Promise<void> => {
  const query = ListSchedulesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  let rows;
  if (query.data.classId != null) {
    rows = await db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.classId, query.data.classId))
      .orderBy(schedulesTable.type, schedulesTable.date, schedulesTable.dayOfWeek, schedulesTable.startTime);
  } else {
    rows = await db
      .select()
      .from(schedulesTable)
      .orderBy(schedulesTable.type, schedulesTable.date, schedulesTable.dayOfWeek, schedulesTable.startTime);
  }
  res.json(ListSchedulesResponse.parse(rows));
});

router.post("/schedules", async (req, res): Promise<void> => {
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
  const [row] = await db.insert(schedulesTable).values(normalized).returning();
  res.status(201).json(GetScheduleResponse.parse(row));
});

router.get("/schedules/:id", async (req, res): Promise<void> => {
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

router.patch("/schedules/:id", async (req, res): Promise<void> => {
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
  res.json(UpdateScheduleResponse.parse(row));
});

router.delete("/schedules/:id", async (req, res): Promise<void> => {
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
  res.sendStatus(204);
});

export default router;
