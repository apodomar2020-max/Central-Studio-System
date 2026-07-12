/**
 * Admin Ballet Schedules routes — /api/admin/ballet/schedules/*
 *
 * Weekly time slots for ballet classes, independent of the generic
 * `schedules` table.
 *
 * Routes:
 *   GET   /api/admin/ballet/schedules       — paginated list
 *   POST  /api/admin/ballet/schedules       — create schedule
 *   PATCH /api/admin/ballet/schedules/:id   — update schedule
 */

import { Router, type IRouter } from "express";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, balletSchedulesTable, balletClassesTable, BALLET_SCHEDULE_STATUSES } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_SCHEDULE_ACTIVITY_FIELDS = ["classId", "dayOfWeek", "startTime", "endTime", "status", "durationMins"] as const;
const VALID_SCHEDULE_STATUSES = new Set(BALLET_SCHEDULE_STATUSES);

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletSchedulesTable).orderBy(asc(balletSchedulesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletSchedulesTable.id) }).from(balletSchedulesTable),
  ]);

  res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreateScheduleBody = z.object({
  classId:      z.number({ required_error: "classId is required" }).int().positive(),
  dayOfWeek:    z.number({ required_error: "dayOfWeek is required" }).int().min(0).max(6),
  startTime:    z.string().min(1, "startTime is required"),
  endTime:      z.string().min(1, "endTime is required"),
  status:       z.string().optional(),
  durationMins: z.number().int().positive().optional(),
});

async function validateClassId(classId: number): Promise<boolean> {
  const [row] = await db.select({ id: balletClassesTable.id }).from(balletClassesTable).where(eq(balletClassesTable.id, classId)).limit(1);
  return !!row;
}

router.post("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  if (parsed.data.status && !VALID_SCHEDULE_STATUSES.has(parsed.data.status as (typeof BALLET_SCHEDULE_STATUSES)[number])) {
    res.status(400).json({ error: `Invalid status: ${parsed.data.status}. Must be one of: ${BALLET_SCHEDULE_STATUSES.join(", ")}` });
    return;
  }
  if (!(await validateClassId(parsed.data.classId))) {
    res.status(404).json({ error: "Class not found" });
    return;
  }

  try {
    const [schedule] = await db.insert(balletSchedulesTable).values(parsed.data).returning();
    await logActivity(req, {
      action: "create",
      module: "ballet.schedules",
      entityType: "ballet_schedule",
      entityId: schedule.id,
      entityLabel: `${schedule.startTime}-${schedule.endTime}`,
      after: Object.fromEntries(BALLET_SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, schedule[key]])),
      summary: `Created ballet schedule ${schedule.startTime}-${schedule.endTime}`,
    });
    res.status(201).json({ schedule });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/schedules failed");
    res.status(500).json({ error: "Failed to create schedule" });
  }
});

const UpdateScheduleBody = CreateScheduleBody.partial();

router.patch("/admin/ballet/schedules/:id", requireAdminAuth, requireAdminPermission("ballet.schedules", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid schedule ID" }); return; }

  const parsed = UpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  if (parsed.data.status && !VALID_SCHEDULE_STATUSES.has(parsed.data.status as (typeof BALLET_SCHEDULE_STATUSES)[number])) {
    res.status(400).json({ error: `Invalid status: ${parsed.data.status}. Must be one of: ${BALLET_SCHEDULE_STATUSES.join(", ")}` });
    return;
  }
  if (parsed.data.classId != null && !(await validateClassId(parsed.data.classId))) {
    res.status(404).json({ error: "Class not found" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [existing] = await db.select().from(balletSchedulesTable).where(eq(balletSchedulesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Schedule not found" }); return; }
    const [schedule] = await db
      .update(balletSchedulesTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletSchedulesTable.id, id))
      .returning();
    if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, schedule[key]])),
      BALLET_SCHEDULE_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.schedules",
        entityType: "ballet_schedule",
        entityId: schedule.id,
        entityLabel: `${schedule.startTime}-${schedule.endTime}`,
        before,
        after,
        summary: `Updated ballet schedule ${schedule.startTime}-${schedule.endTime}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ schedule });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/schedules/:id failed");
    res.status(500).json({ error: "Failed to update schedule" });
  }
});

export default router;
