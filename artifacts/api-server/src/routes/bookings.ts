import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  bookingsTable,
  classesTable,
  schedulesTable,
  instructorsTable,
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
  if (query.data.studentEmail) conditions.push(eq(bookingsTable.studentEmail, query.data.studentEmail));

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
      scheduleStartTime: schedulesTable.startTime,
      scheduleEndTime: schedulesTable.endTime,
      scheduleLocation: schedulesTable.location,
    })
    .from(bookingsTable)
    .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
    .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id));

  const rows = conditions.length > 0
    ? await base.where(and(...conditions)).orderBy(bookingsTable.createdAt)
    : await base.orderBy(bookingsTable.createdAt);

  const enriched = rows.map((r) => {
    const dayName =
      r.scheduleDayOfWeek != null ? DAY_NAMES[r.scheduleDayOfWeek] ?? null : null;
    const start = formatTime(r.scheduleStartTime);
    const end = formatTime(r.scheduleEndTime);
    // scheduleLabel: "Sunday • 6:00 PM - 7:00 PM" — null when no schedule joined.
    const scheduleLabel =
      dayName && start && end ? `${dayName} • ${start} - ${end}` : null;
    return {
      ...r.booking,
      classTitle: r.classTitle ?? null,
      classDescription: r.classDescription ?? null,
      classCategory: r.classCategory ?? null,
      classDurationMins: r.classDurationMins ?? null,
      instructorName: r.instructorName ?? null,
      instructorPhotoUrl: r.instructorPhotoUrl ?? null,
      scheduleDayOfWeek: r.scheduleDayOfWeek ?? null,
      scheduleStartTime: r.scheduleStartTime ?? null,
      scheduleEndTime: r.scheduleEndTime ?? null,
      scheduleLocation: r.scheduleLocation ?? null,
      scheduleLabel,
      displayTitle: r.classTitle ?? `Booking #${r.booking.id}`,
    };
  });

  res.json(ListBookingsResponse.parse(enriched));
});

router.post("/bookings", async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(bookingsTable).values(parsed.data).returning();
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
  const [row] = await db.update(bookingsTable).set(parsed.data).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
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
