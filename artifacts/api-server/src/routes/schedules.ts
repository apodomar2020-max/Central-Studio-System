import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, schedulesTable, classesTable, instructorsTable } from "@workspace/db";
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

  const rows = await db
    .select({
      scheduleId: schedulesTable.id,
      classId: classesTable.id,
      classTitle: classesTable.title,
      startTime: schedulesTable.startTime,
      endTime: schedulesTable.endTime,
      location: schedulesTable.location,
      instructorName: instructorsTable.name,
    })
    .from(schedulesTable)
    .innerJoin(classesTable, eq(schedulesTable.classId, classesTable.id))
    .leftJoin(instructorsTable, eq(classesTable.instructorId, instructorsTable.id))
    .where(eq(schedulesTable.dayOfWeek, todayDow))
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
    rows = await db.select().from(schedulesTable).where(eq(schedulesTable.classId, query.data.classId));
  } else {
    rows = await db.select().from(schedulesTable).orderBy(schedulesTable.dayOfWeek);
  }
  res.json(ListSchedulesResponse.parse(rows));
});

router.post("/schedules", async (req, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(schedulesTable).values(parsed.data).returning();
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
  const [row] = await db.update(schedulesTable).set(parsed.data).where(eq(schedulesTable.id, params.data.id)).returning();
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
  const [row] = await db.delete(schedulesTable).where(eq(schedulesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Schedule not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
