/**
 * Admin Ballet Schedules routes — /api/admin/ballet/schedules/*
 *
 * Weekly time slots for ballet classes, independent of the generic
 * `schedules` table.
 *
 * Routes:
 *   GET   /api/admin/ballet/schedules       — paginated list
 *   PATCH /api/admin/ballet/schedules/:id   — update schedule
 *
 * Schedule creation is intentionally disabled: a schedule is created only
 * with its owning class by adminBalletClasses.ts. This route remains an
 * operational list/edit view of that single schedule.
 *
 * Every error response is `{ error, code, ...(requestId for 5xx) }` — 5xx
 * bodies never carry raw SQL/driver text (see respondWithScheduleError);
 * full detail always goes to the server log, keyed by the same requestId.
 */

import { Router, type IRouter, type Response } from "express";
import { asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, balletClassesTable, balletSchedulesTable, BALLET_SCHEDULE_STATUSES } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_SCHEDULE_ACTIVITY_FIELDS = ["classId", "dayOfWeek", "startTime", "endTime", "status", "durationMins"] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function deriveDuration(startTime: string, endTime: string): number {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const duration = toMinutes(endTime) - toMinutes(startTime);
  if (duration <= 0) throw new Error("END_TIME_MUST_FOLLOW_START_TIME");
  return duration;
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "view"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters", code: "VALIDATION_ERROR" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(balletSchedulesTable).orderBy(asc(balletSchedulesTable.createdAt)).limit(limit).offset(offset),
      db.select({ total: count(balletSchedulesTable.id) }).from(balletSchedulesTable),
    ]);

    res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
  } catch (err) {
    respondWithScheduleError(req, res, err, "GET /admin/ballet/schedules");
  }
});

const UpdateScheduleBody = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(TIME_PATTERN, "startTime must use HH:MM").optional(),
  endTime: z.string().regex(TIME_PATTERN, "endTime must use HH:MM").optional(),
  status: z.enum(BALLET_SCHEDULE_STATUSES).optional(),
}).strict();

/**
 * Translates a caught exception from an insert/update into a safe HTTP
 * response: known Postgres error codes get a specific, client-safe message;
 * everything else stays a generic 500 with the pino-http request id
 * (req.id) attached so it can be correlated against server logs, following
 * this project's existing established pattern (ExposableHttpError /
 * Security Phase G) of never leaking raw SQL/driver internals to the
 * client. Full error detail is always logged server-side regardless.
 */
function respondWithScheduleError(req: AdminRequest, res: Response, err: unknown, action: string): void {
  logger.error({ err, requestId: req.id }, `${action} failed`);

  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr?.code === "23503" && pgErr.constraint?.includes("class_id")) {
    res.status(422).json({ error: "The selected Ballet class no longer exists.", code: "CLASS_NOT_FOUND" });
    return;
  }

  res.status(500).json({
    error: "The schedules service returned an unexpected server error.",
    code: "INTERNAL_ERROR",
    requestId: req.id,
  });
}

router.post("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "create"), (_req, res): void => {
  res.status(405).json({ error: "Create the Ballet Class to create its weekly schedule.", code: "CREATE_CLASS_REQUIRED" });
});

router.patch("/admin/ballet/schedules/:id", requireAdminAuth, requireAdminPermission("ballet.schedules", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid schedule ID", code: "VALIDATION_ERROR" }); return; }

  const parsed = UpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body", code: "VALIDATION_ERROR" });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ballet_schedules where id = ${id} for update`);
      const [existing] = await tx.select().from(balletSchedulesTable).where(eq(balletSchedulesTable.id, id)).limit(1);
      if (!existing) return null;
      const [owningClass] = await tx.select({ isLegacy: balletClassesTable.isLegacy }).from(balletClassesTable).where(eq(balletClassesTable.id, existing.classId)).limit(1);
      if (owningClass?.isLegacy) throw new Error("LEGACY_SCHEDULE");
      const startTime = parsed.data.startTime ?? existing.startTime;
      const endTime = parsed.data.endTime ?? existing.endTime;
      const durationMins = deriveDuration(startTime, endTime);
      const now = new Date().toISOString();
      const [schedule] = await tx
        .update(balletSchedulesTable)
        .set({ ...parsed.data, startTime, endTime, durationMins, updatedAt: now })
        .where(eq(balletSchedulesTable.id, id))
        .returning();
      if (parsed.data.status != null) {
        await tx.update(balletClassesTable)
          .set({ isActive: parsed.data.status === "active", updatedAt: now })
          .where(eq(balletClassesTable.id, existing.classId));
      }
      return { existing, schedule };
    });
    if (!result) { res.status(404).json({ error: "Schedule not found", code: "SCHEDULE_NOT_FOUND" }); return; }
    const { existing, schedule } = result;

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
    if (err instanceof Error && err.message === "END_TIME_MUST_FOLLOW_START_TIME") {
      res.status(422).json({ error: "End time must be later than start time", code: "INVALID_TIME_RANGE" });
      return;
    }
    if (err instanceof Error && err.message === "LEGACY_SCHEDULE") {
      res.status(422).json({
        error: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.",
        code: "LEGACY_CLASS_SCHEDULE",
      });
      return;
    }
    respondWithScheduleError(req, res, err, "PATCH /admin/ballet/schedules/:id");
  }
});

export default router;
