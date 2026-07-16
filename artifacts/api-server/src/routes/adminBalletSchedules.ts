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
 *
 * durationMins is optional and nullable — see OptionalDurationMins below for
 * the canonical contract (omitted/undefined/""/null all normalize cleanly;
 * zero, negative, decimal, and non-numeric values are rejected).
 *
 * Every error response is `{ error, code, ...(requestId for 5xx) }` — 5xx
 * bodies never carry raw SQL/driver text (see respondWithScheduleError);
 * full detail always goes to the server log, keyed by the same requestId.
 */

import { Router, type IRouter, type Response } from "express";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, balletSchedulesTable, balletClassesTable, BALLET_SCHEDULE_STATUSES } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_SCHEDULE_ACTIVITY_FIELDS = ["classId", "dayOfWeek", "startTime", "endTime", "status", "durationMins"] as const;
const VALID_SCHEDULE_STATUSES = new Set(BALLET_SCHEDULE_STATUSES);

/**
 * Canonical optional-duration contract: durationMins is nullable in the DB
 * (no duration recorded) and genuinely optional on the wire. This accepts
 * every representation a well-behaved client might send for "no value" —
 * an omitted key, `undefined`, an empty string, or explicit `null` — and
 * normalizes all of them the same way:
 *   - omitted / undefined → stays `undefined` (PATCH: leave unchanged)
 *   - "" or null          → normalized to `null` (PATCH: explicitly clear it)
 * Any other value must be a positive whole number; zero, negative numbers,
 * decimals, and non-numeric values are all rejected with a specific message
 * rather than silently coerced.
 */
export const OptionalDurationMins = z.preprocess(
  (val) => (val === "" ? null : val),
  z
    .number({ invalid_type_error: "durationMins must be a number" })
    .int("durationMins must be a whole number")
    .positive("durationMins must be a positive number")
    .nullable()
    .optional(),
);

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

export const CreateScheduleBody = z.object({
  classId:      z.number({ required_error: "classId is required" }).int().positive(),
  dayOfWeek:    z.number({ required_error: "dayOfWeek is required" }).int().min(0).max(6),
  startTime:    z.string().min(1, "startTime is required"),
  endTime:      z.string().min(1, "endTime is required"),
  status:       z.string().optional(),
  durationMins: OptionalDurationMins,
});

async function validateClassId(classId: number): Promise<boolean> {
  const [row] = await db.select({ id: balletClassesTable.id }).from(balletClassesTable).where(eq(balletClassesTable.id, classId)).limit(1);
  return !!row;
}

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

router.post("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body", code: "VALIDATION_ERROR" });
    return;
  }
  if (parsed.data.status && !VALID_SCHEDULE_STATUSES.has(parsed.data.status as (typeof BALLET_SCHEDULE_STATUSES)[number])) {
    res.status(400).json({ error: `Invalid status: ${parsed.data.status}. Must be one of: ${BALLET_SCHEDULE_STATUSES.join(", ")}`, code: "VALIDATION_ERROR" });
    return;
  }
  if (!(await validateClassId(parsed.data.classId))) {
    res.status(404).json({ error: "The selected Ballet class no longer exists.", code: "CLASS_NOT_FOUND" });
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
    respondWithScheduleError(req, res, err, "POST /admin/ballet/schedules");
  }
});

const UpdateScheduleBody = CreateScheduleBody.partial();

router.patch("/admin/ballet/schedules/:id", requireAdminAuth, requireAdminPermission("ballet.schedules", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid schedule ID", code: "VALIDATION_ERROR" }); return; }

  const parsed = UpdateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body", code: "VALIDATION_ERROR" });
    return;
  }
  if (parsed.data.status && !VALID_SCHEDULE_STATUSES.has(parsed.data.status as (typeof BALLET_SCHEDULE_STATUSES)[number])) {
    res.status(400).json({ error: `Invalid status: ${parsed.data.status}. Must be one of: ${BALLET_SCHEDULE_STATUSES.join(", ")}`, code: "VALIDATION_ERROR" });
    return;
  }
  if (parsed.data.classId != null && !(await validateClassId(parsed.data.classId))) {
    res.status(404).json({ error: "The selected Ballet class no longer exists.", code: "CLASS_NOT_FOUND" });
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
    if (!existing) { res.status(404).json({ error: "Schedule not found", code: "SCHEDULE_NOT_FOUND" }); return; }
    const [schedule] = await db
      .update(balletSchedulesTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletSchedulesTable.id, id))
      .returning();
    if (!schedule) { res.status(404).json({ error: "Schedule not found", code: "SCHEDULE_NOT_FOUND" }); return; }

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
    respondWithScheduleError(req, res, err, "PATCH /admin/ballet/schedules/:id");
  }
});

export default router;
