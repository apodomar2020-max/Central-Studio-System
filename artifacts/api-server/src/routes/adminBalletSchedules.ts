/**
 * Admin Ballet Schedules routes — /api/admin/ballet/schedules/*
 *
 * Weekly time slots for ballet classes, independent of the generic
 * `schedules` table.
 *
 * Routes:
 *   GET   /api/admin/ballet/schedules       — paginated list
 *   POST  /api/admin/ballet/schedules       — create one weekly schedule row
 *   PATCH /api/admin/ballet/schedules/:id   — update schedule
 *
 * Schedule creation is independent from class creation. One Ballet Class may
 * own multiple weekly schedule rows.
 *
 * Every error response is `{ error, code, ...(requestId for 5xx) }` — 5xx
 * bodies never carry raw SQL/driver text (see respondWithScheduleError);
 * full detail always goes to the server log, keyed by the same requestId.
 */

import { Router, type IRouter, type Response } from "express";
import { and, asc, count, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletClassesTable,
  balletGroupsTable,
  balletInstructorsTable,
  balletLevelsTable,
  balletSchedulesTable,
  BALLET_SCHEDULE_STATUSES,
  studioBranchesTable,
  studioRoomsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";
import { ScheduleLocationError, validateScheduleLocation } from "../lib/scheduleLocation";

const router: IRouter = Router();
const BALLET_SCHEDULE_ACTIVITY_FIELDS = ["classId", "branchId", "roomId", "dayOfWeek", "startTime", "endTime", "status", "durationMins"] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function deriveBalletScheduleDuration(startTime: string, endTime: string): number {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const duration = toMinutes(endTime) - toMinutes(startTime);
  if (duration <= 0) throw new Error("INVALID_BALLET_SCHEDULE_TIME_RANGE");
  return duration;
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateScheduleBody = z.object({
  classId: z.number({ required_error: "classId is required" }).int().positive(),
  branchId: z.number({ required_error: "branchId is required" }).int().positive(),
  roomId: z.number({ required_error: "roomId is required" }).int().positive(),
  dayOfWeek: z.number({ required_error: "dayOfWeek is required" }).int().min(0).max(6),
  startTime: z.string().trim().regex(TIME_PATTERN, "startTime must use HH:MM"),
  endTime: z.string().trim().regex(TIME_PATTERN, "endTime must use HH:MM"),
  status: z.enum(BALLET_SCHEDULE_STATUSES).default("active"),
}).strict();

async function attachLocations<T extends { branchId: number | null; roomId: number | null }>(rows: T[]) {
  const branchIds = [...new Set(rows.flatMap((row) => row.branchId == null ? [] : [row.branchId]))];
  const roomIds = [...new Set(rows.flatMap((row) => row.roomId == null ? [] : [row.roomId]))];
  const [branches, rooms] = await Promise.all([
    branchIds.length ? db.select().from(studioBranchesTable).where(inArray(studioBranchesTable.id, branchIds)) : [],
    roomIds.length ? db.select().from(studioRoomsTable).where(inArray(studioRoomsTable.id, roomIds)) : [],
  ]);
  const branchById = new Map(branches.map((row) => [row.id, row]));
  const roomById = new Map(rooms.map((row) => [row.id, row]));
  return rows.map((row) => ({ ...row, branch: row.branchId == null ? null : branchById.get(row.branchId) ?? null, room: row.roomId == null ? null : roomById.get(row.roomId) ?? null }));
}

/**
 * Single source of truth for "is this classId+dayOfWeek+startTime+endTime
 * slot already taken by another Schedule row" — used identically by POST
 * (excludeId omitted) and PATCH (excludeId = the row being edited), so the
 * two routes can never drift apart on what counts as a duplicate. Callers
 * must pass already-normalized (trimmed, canonical HH:MM) values — this
 * function does no normalization of its own, matching the same values that
 * get written to the row.
 */
async function findDuplicateScheduleId(
  client: DbClient,
  classId: number,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeId?: number,
): Promise<number | null> {
  const conditions = [
    eq(balletSchedulesTable.classId, classId),
    eq(balletSchedulesTable.dayOfWeek, dayOfWeek),
    eq(balletSchedulesTable.startTime, startTime),
    eq(balletSchedulesTable.endTime, endTime),
    ne(balletSchedulesTable.status, "cancelled"),
  ];
  if (excludeId != null) conditions.push(ne(balletSchedulesTable.id, excludeId));
  const [duplicate] = await client
    .select({ id: balletSchedulesTable.id })
    .from(balletSchedulesTable)
    .where(and(...conditions))
    .limit(1);
  return duplicate?.id ?? null;
}

async function findOverlappingScheduleId(
  client: DbClient,
  classId: number,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeId?: number,
): Promise<number | null> {
  const conditions = [
    eq(balletSchedulesTable.classId, classId),
    eq(balletSchedulesTable.dayOfWeek, dayOfWeek),
    ne(balletSchedulesTable.status, "cancelled"),
    lt(balletSchedulesTable.startTime, endTime),
    gt(balletSchedulesTable.endTime, startTime),
  ];
  if (excludeId != null) conditions.push(ne(balletSchedulesTable.id, excludeId));
  const [overlap] = await client
    .select({ id: balletSchedulesTable.id })
    .from(balletSchedulesTable)
    .where(and(...conditions))
    .limit(1);
  return overlap?.id ?? null;
}

async function assertScheduleSlotAvailable(
  client: DbClient,
  classId: number,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  status: string,
  excludeId?: number,
): Promise<void> {
  if (status === "cancelled") return;

  const duplicateId = await findDuplicateScheduleId(client, classId, dayOfWeek, startTime, endTime, excludeId);
  if (duplicateId) throw new Error("DUPLICATE_BALLET_SCHEDULE_SLOT");

  const overlapId = await findOverlappingScheduleId(client, classId, dayOfWeek, startTime, endTime, excludeId);
  if (overlapId) throw new Error("BALLET_SCHEDULE_TIME_CONFLICT");
}

async function validateScheduleClass(client: DbClient, classId: number): Promise<string | null> {
  const [row] = await client
    .select({
      id: balletClassesTable.id,
      isLegacy: balletClassesTable.isLegacy,
      isActive: balletClassesTable.isActive,
      levelId: balletClassesTable.levelId,
      groupId: balletClassesTable.groupId,
      instructorId: balletClassesTable.instructorId,
      levelIsActive: balletLevelsTable.isActive,
      groupLevelId: balletGroupsTable.levelId,
      groupIsActive: balletGroupsTable.isActive,
      instructorIsActive: balletInstructorsTable.isActive,
    })
    .from(balletClassesTable)
    .leftJoin(balletLevelsTable, eq(balletLevelsTable.id, balletClassesTable.levelId))
    .leftJoin(balletGroupsTable, eq(balletGroupsTable.id, balletClassesTable.groupId))
    .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
    .where(eq(balletClassesTable.id, classId))
    .limit(1);

  if (!row) return "NOT_FOUND";
  if (row.isLegacy) return "LEGACY_CLASS";
  if (!row.isActive) return "CLASS_INACTIVE";
  if (row.levelId == null || row.levelIsActive !== true) return "LEVEL_INACTIVE";
  if (row.groupId == null || row.groupIsActive !== true) return "GROUP_INACTIVE";
  if (row.groupLevelId !== row.levelId) return "GROUP_LEVEL_MISMATCH";
  if (row.instructorId == null || row.instructorIsActive !== true) return "INSTRUCTOR_INACTIVE";
  return null;
}

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

    res.json({ data: await attachLocations(rows), total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
  } catch (err) {
    respondWithScheduleError(req, res, err, "GET /admin/ballet/schedules");
  }
});

const UpdateScheduleBody = z.object({
  branchId: z.number().int().positive().nullable().optional(),
  roomId: z.number().int().positive().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  startTime: z.string().trim().regex(TIME_PATTERN, "startTime must use HH:MM").optional(),
  endTime: z.string().trim().regex(TIME_PATTERN, "endTime must use HH:MM").optional(),
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

router.post("/admin/ballet/schedules", requireAdminAuth, requireAdminPermission("ballet.schedules", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body", code: "VALIDATION_ERROR" });
    return;
  }

  try {
    const schedule = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ballet_classes where id = ${parsed.data.classId} for update`);
      const classError = await validateScheduleClass(tx, parsed.data.classId);
      if (classError) throw new Error(classError);
      await validateScheduleLocation(tx, parsed.data.branchId, parsed.data.roomId);

      const durationMins = deriveBalletScheduleDuration(parsed.data.startTime, parsed.data.endTime);
      await assertScheduleSlotAvailable(
        tx,
        parsed.data.classId,
        parsed.data.dayOfWeek,
        parsed.data.startTime,
        parsed.data.endTime,
        parsed.data.status,
      );

      const [created] = await tx.insert(balletSchedulesTable).values({
        classId: parsed.data.classId,
        branchId: parsed.data.branchId,
        roomId: parsed.data.roomId,
        dayOfWeek: parsed.data.dayOfWeek,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        durationMins,
        status: parsed.data.status,
      }).returning();
      return created;
    });

    await logActivity(req, {
      action: "create",
      module: "ballet.schedules",
      entityType: "ballet_schedule",
      entityId: schedule.id,
      entityLabel: `${schedule.startTime}-${schedule.endTime}`,
      after: Object.fromEntries(BALLET_SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, schedule[key]])),
      summary: `Created ballet schedule ${schedule.startTime}-${schedule.endTime}`,
    });
    res.status(201).json({ schedule: (await attachLocations([schedule]))[0] });
  } catch (err) {
    if (err instanceof ScheduleLocationError) { res.status(err.status).json({ error: err.message, code: err.code }); return; }
    if (err instanceof Error) {
      if (err.message === "INVALID_BALLET_SCHEDULE_TIME_RANGE") {
        res.status(422).json({ error: "End time must be later than start time.", code: "INVALID_BALLET_SCHEDULE_TIME_RANGE" });
        return;
      }
      if (err.message === "NOT_FOUND") { res.status(404).json({ error: "Class not found", code: "CLASS_NOT_FOUND" }); return; }
      if (err.message === "LEGACY_CLASS") {
        res.status(422).json({ error: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.", code: "LEGACY_CLASS" });
        return;
      }
      if (err.message === "CLASS_INACTIVE") { res.status(422).json({ error: "The selected Class is inactive.", code: "CLASS_INACTIVE" }); return; }
      if (err.message === "LEVEL_INACTIVE") { res.status(422).json({ error: "The selected Class has no active Level.", code: "LEVEL_INACTIVE" }); return; }
      if (err.message === "GROUP_INACTIVE") { res.status(422).json({ error: "The selected Class has no active Group.", code: "GROUP_INACTIVE" }); return; }
      if (err.message === "GROUP_LEVEL_MISMATCH") { res.status(422).json({ error: "The selected Class Group does not belong to its Level.", code: "GROUP_LEVEL_MISMATCH" }); return; }
      if (err.message === "INSTRUCTOR_INACTIVE") { res.status(422).json({ error: "The selected Class has no active Instructor.", code: "INSTRUCTOR_INACTIVE" }); return; }
      if (err.message === "DUPLICATE_BALLET_SCHEDULE_SLOT") {
        res.status(409).json({
          error: "This Class already has a Schedule with the same day, start time, and end time.",
          code: "DUPLICATE_BALLET_SCHEDULE_SLOT",
        });
        return;
      }
      if (err.message === "BALLET_SCHEDULE_TIME_CONFLICT") {
        res.status(409).json({
          error: "This Class already has an overlapping Schedule on this day.",
          code: "BALLET_SCHEDULE_TIME_CONFLICT",
        });
        return;
      }
    }
    respondWithScheduleError(req, res, err, "POST /admin/ballet/schedules");
  }
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
      // Lock the owning Class row too — the same lock POST takes — so a
      // concurrent POST for this Class and this PATCH can never race past
      // each other's duplicate check.
      await tx.execute(sql`select id from ballet_classes where id = ${existing.classId} for update`);
      const [owningClass] = await tx.select({ isLegacy: balletClassesTable.isLegacy }).from(balletClassesTable).where(eq(balletClassesTable.id, existing.classId)).limit(1);
      if (owningClass?.isLegacy) throw new Error("LEGACY_SCHEDULE");
      const dayOfWeek = parsed.data.dayOfWeek ?? existing.dayOfWeek;
      const startTime = (parsed.data.startTime ?? existing.startTime).trim();
      const endTime = (parsed.data.endTime ?? existing.endTime).trim();
      const status = parsed.data.status ?? existing.status;
      const durationMins = deriveBalletScheduleDuration(startTime, endTime);

      const locationProvided = Object.prototype.hasOwnProperty.call(parsed.data, "branchId") || Object.prototype.hasOwnProperty.call(parsed.data, "roomId");
      if (locationProvided) {
        const branchId = parsed.data.branchId === undefined ? existing.branchId : parsed.data.branchId;
        const roomId = parsed.data.roomId === undefined ? existing.roomId : parsed.data.roomId;
        await validateScheduleLocation(tx, branchId, roomId, { branchId: existing.branchId, roomId: existing.roomId });
      }

      await assertScheduleSlotAvailable(tx, existing.classId, dayOfWeek, startTime, endTime, status, id);

      const now = new Date().toISOString();
      const [schedule] = await tx
        .update(balletSchedulesTable)
        .set({ ...parsed.data, dayOfWeek, startTime, endTime, durationMins, updatedAt: now })
        .where(eq(balletSchedulesTable.id, id))
        .returning();
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
    res.json({ schedule: (await attachLocations([schedule]))[0] });
  } catch (err) {
    if (err instanceof ScheduleLocationError) { res.status(err.status).json({ error: err.message, code: err.code }); return; }
    if (err instanceof Error && err.message === "INVALID_BALLET_SCHEDULE_TIME_RANGE") {
      res.status(422).json({ error: "End time must be later than start time.", code: "INVALID_BALLET_SCHEDULE_TIME_RANGE" });
      return;
    }
    if (err instanceof Error && err.message === "LEGACY_SCHEDULE") {
      res.status(422).json({
        error: "This Class uses the retired Ballet Class model. Create a new Class to resume the program.",
        code: "LEGACY_CLASS_SCHEDULE",
      });
      return;
    }
    if (err instanceof Error && err.message === "DUPLICATE_BALLET_SCHEDULE_SLOT") {
      res.status(409).json({
        error: "This Class already has a Schedule with the same day, start time, and end time.",
        code: "DUPLICATE_BALLET_SCHEDULE_SLOT",
      });
      return;
    }
    if (err instanceof Error && err.message === "BALLET_SCHEDULE_TIME_CONFLICT") {
      res.status(409).json({
        error: "This Class already has an overlapping Schedule on this day.",
        code: "BALLET_SCHEDULE_TIME_CONFLICT",
      });
      return;
    }
    respondWithScheduleError(req, res, err, "PATCH /admin/ballet/schedules/:id");
  }
});

export default router;
