/**
 * Canonical Admin Ballet Class routes.
 *
 * One class owns one active level, one active group, one active instructor,
 * and exactly one weekly schedule. Class and schedule writes are atomic.
 */
import { Router, type IRouter } from "express";
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletClassesTable,
  balletSchedulesTable,
  balletInstructorsTable,
  balletGroupsTable,
  balletLevelsTable,
  BALLET_SCHEDULE_STATUSES,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";

const router: IRouter = Router();
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ACTIVITY_FIELDS = ["title", "levelId", "groupId", "instructorId", "classImageUrl", "classVideoUrl", "isActive"] as const;
const SCHEDULE_ACTIVITY_FIELDS = ["dayOfWeek", "startTime", "endTime", "status", "durationMins"] as const;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ClassScheduleFields = z.object({
  title: z.string().trim().min(1, "Title is required"),
  levelId: z.number({ required_error: "levelId is required" }).int().positive(),
  groupId: z.number({ required_error: "groupId is required" }).int().positive(),
  instructorId: z.number({ required_error: "instructorId is required" }).int().positive(),
  dayOfWeek: z.number({ required_error: "dayOfWeek is required" }).int().min(0).max(6),
  startTime: z.string().regex(TIME_PATTERN, "startTime must use HH:MM"),
  endTime: z.string().regex(TIME_PATTERN, "endTime must use HH:MM"),
  isActive: z.boolean().default(true),
  scheduleStatus: z.enum(BALLET_SCHEDULE_STATUSES).default("active"),
  classImageUrl: z.string().url().nullable().optional(),
  classVideoUrl: z.string().url().nullable().optional(),
}).strict();

function validateOperationalState(data: { isActive?: boolean; scheduleStatus?: string }, ctx: z.RefinementCtx): void {
  if (data.isActive != null && data.scheduleStatus != null
    && data.isActive !== (data.scheduleStatus === "active")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Class and schedule operational states must match" });
  }
}

export const ClassScheduleBody = ClassScheduleFields.superRefine(validateOperationalState);
export const UpdateClassScheduleBody = ClassScheduleFields.partial().superRefine(validateOperationalState);

function minuteOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function deriveBalletClassDuration(startTime: string, endTime: string): number {
  const duration = minuteOfDay(endTime) - minuteOfDay(startTime);
  if (duration <= 0) throw new Error("END_TIME_MUST_FOLLOW_START_TIME");
  return duration;
}

async function validateCanonicalRelations(client: DbClient, levelId: number, groupId: number, instructorId: number, requireActive = true): Promise<string | null> {
  const [[level], [group], [instructor]] = await Promise.all([
    client.select({ id: balletLevelsTable.id, isActive: balletLevelsTable.isActive }).from(balletLevelsTable).where(eq(balletLevelsTable.id, levelId)).limit(1),
    client.select({ id: balletGroupsTable.id, levelId: balletGroupsTable.levelId, isActive: balletGroupsTable.isActive }).from(balletGroupsTable).where(eq(balletGroupsTable.id, groupId)).limit(1),
    client.select({ id: balletInstructorsTable.id, isActive: balletInstructorsTable.isActive }).from(balletInstructorsTable).where(eq(balletInstructorsTable.id, instructorId)).limit(1),
  ]);
  if (!level) return "Level not found";
  if (requireActive && !level.isActive) return "The selected level is inactive";
  if (!group) return "Group not found";
  if (requireActive && !group.isActive) return "The selected group is inactive";
  if (group.levelId !== levelId) return "The selected group does not belong to the selected level";
  if (!instructor) return "Instructor not found";
  if (requireActive && !instructor.isActive) return "The selected instructor is inactive";
  return null;
}

async function attachSchedules<T extends { id: number }>(rows: T[]): Promise<Array<T & { schedule: typeof balletSchedulesTable.$inferSelect | null }>> {
  if (rows.length === 0) return [];
  const schedules = await db.select().from(balletSchedulesTable).where(inArray(balletSchedulesTable.classId, rows.map((row) => row.id)));
  const scheduleByClass = new Map(schedules.map((schedule) => [schedule.classId, schedule]));
  return rows.map((row) => ({ ...row, schedule: scheduleByClass.get(row.id) ?? null }));
}

router.get("/admin/ballet/classes", requireAdminAuth, requireAdminPermission("ballet.classes", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletClassesTable).orderBy(asc(balletClassesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletClassesTable.id) }).from(balletClassesTable),
  ]);
  const data = await attachSchedules(rows);
  res.json({ data, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

router.post("/admin/ballet/classes", requireAdminAuth, requireAdminPermission("ballet.classes", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = ClassScheduleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  let durationMins: number;
  try { durationMins = deriveBalletClassDuration(parsed.data.startTime, parsed.data.endTime); }
  catch { res.status(422).json({ error: "End time must be later than start time" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const relationError = await validateCanonicalRelations(tx, parsed.data.levelId, parsed.data.groupId, parsed.data.instructorId);
      if (relationError) throw new Error(`VALIDATION:${relationError}`);
      const [balletClass] = await tx.insert(balletClassesTable).values({
        title: parsed.data.title,
        isLegacy: false,
        levelId: parsed.data.levelId,
        groupId: parsed.data.groupId,
        instructorId: parsed.data.instructorId,
        classImageUrl: parsed.data.classImageUrl ?? null,
        classVideoUrl: parsed.data.classVideoUrl ?? null,
        isActive: parsed.data.isActive,
      }).returning();
      const [schedule] = await tx.insert(balletSchedulesTable).values({
        classId: balletClass.id,
        dayOfWeek: parsed.data.dayOfWeek,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        durationMins,
        status: parsed.data.scheduleStatus,
      }).returning();
      return { balletClass, schedule };
    });

    await logActivity(req, {
      action: "create", module: "ballet.classes", entityType: "ballet_class", entityId: result.balletClass.id,
      entityLabel: result.balletClass.title,
      after: { ...Object.fromEntries(ACTIVITY_FIELDS.map((key) => [key, result.balletClass[key]])), schedule: Object.fromEntries(SCHEDULE_ACTIVITY_FIELDS.map((key) => [key, result.schedule[key]])) },
      summary: `Created ballet class ${result.balletClass.title} with its weekly schedule`,
    });
    res.status(201).json({ class: { ...result.balletClass, schedule: result.schedule } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("VALIDATION:")) { res.status(422).json({ error: message.slice(11) }); return; }
    logger.error({ err }, "POST /admin/ballet/classes failed");
    res.status(500).json({ error: "Failed to create class and schedule" });
  }
});

router.patch("/admin/ballet/classes/:id", requireAdminAuth, requireAdminPermission("ballet.classes", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid class ID" }); return; }
  const parsed = UpdateClassScheduleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  if (Object.keys(parsed.data).length === 0) { res.json({ success: true, message: "No changes" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ballet_classes where id = ${id} for update`);
      const [existingClass] = await tx.select().from(balletClassesTable).where(eq(balletClassesTable.id, id)).limit(1);
      if (!existingClass) throw new Error("NOT_FOUND:Class");
      if (existingClass.isLegacy) {
        throw new Error("LEGACY:This Class uses the retired Ballet Class model. Create a new Class to resume the program.");
      }
      if (existingClass.levelId == null || existingClass.groupId == null || existingClass.instructorId == null) {
        throw new Error("INVALID_STATE:Canonical class is missing a required relationship");
      }
      const [existingSchedule] = await tx.select().from(balletSchedulesTable).where(eq(balletSchedulesTable.classId, id)).limit(1);
      if (!existingSchedule) throw new Error("INVALID_STATE:Class has no schedule");

      const nextIsActive = parsed.data.isActive
        ?? (parsed.data.scheduleStatus != null ? parsed.data.scheduleStatus === "active" : existingClass.isActive);
      const nextScheduleStatus = parsed.data.scheduleStatus
        ?? (parsed.data.isActive != null ? parsed.data.isActive ? "active" : "deactivated" : existingSchedule.status);
      if (nextIsActive !== (nextScheduleStatus === "active")) {
        throw new Error("VALIDATION:Class and schedule operational states must match");
      }
      const merged = {
        title: parsed.data.title ?? existingClass.title,
        levelId: parsed.data.levelId ?? existingClass.levelId,
        groupId: parsed.data.groupId ?? existingClass.groupId,
        instructorId: parsed.data.instructorId ?? existingClass.instructorId,
        classImageUrl: parsed.data.classImageUrl === undefined ? existingClass.classImageUrl : parsed.data.classImageUrl,
        classVideoUrl: parsed.data.classVideoUrl === undefined ? existingClass.classVideoUrl : parsed.data.classVideoUrl,
        isActive: nextIsActive,
        dayOfWeek: parsed.data.dayOfWeek ?? existingSchedule.dayOfWeek,
        startTime: parsed.data.startTime ?? existingSchedule.startTime,
        endTime: parsed.data.endTime ?? existingSchedule.endTime,
        scheduleStatus: nextScheduleStatus,
      };
      const relationshipChanged = merged.levelId !== existingClass.levelId
        || merged.groupId !== existingClass.groupId
        || merged.instructorId !== existingClass.instructorId;
      const relationError = await validateCanonicalRelations(
        tx,
        merged.levelId,
        merged.groupId,
        merged.instructorId,
        relationshipChanged || merged.isActive,
      );
      if (relationError) throw new Error(`VALIDATION:${relationError}`);
      const durationMins = deriveBalletClassDuration(merged.startTime, merged.endTime);
      const now = new Date().toISOString();
      const [balletClass] = await tx.update(balletClassesTable).set({
        title: merged.title, levelId: merged.levelId, groupId: merged.groupId, instructorId: merged.instructorId,
        classImageUrl: merged.classImageUrl, classVideoUrl: merged.classVideoUrl, isActive: merged.isActive, updatedAt: now,
      }).where(eq(balletClassesTable.id, id)).returning();
      const [schedule] = await tx.update(balletSchedulesTable).set({
        dayOfWeek: merged.dayOfWeek, startTime: merged.startTime, endTime: merged.endTime,
        durationMins, status: merged.scheduleStatus, updatedAt: now,
      }).where(eq(balletSchedulesTable.classId, id)).returning();
      return { existingClass, existingSchedule, balletClass, schedule };
    });

    const classDiff = diffFields(result.existingClass, result.balletClass, ACTIVITY_FIELDS);
    const scheduleDiff = diffFields(result.existingSchedule, result.schedule, SCHEDULE_ACTIVITY_FIELDS);
    if (Object.keys(classDiff.after).length || Object.keys(scheduleDiff.after).length) {
      await logActivity(req, {
        action: result.existingClass.isActive !== result.balletClass.isActive ? result.balletClass.isActive ? "activate" : "deactivate" : "update",
        module: "ballet.classes", entityType: "ballet_class", entityId: id, entityLabel: result.balletClass.title,
        before: { ...classDiff.before, schedule: scheduleDiff.before }, after: { ...classDiff.after, schedule: scheduleDiff.after },
        summary: `Updated ballet class ${result.balletClass.title} and its weekly schedule`,
      });
    }
    res.json({ class: { ...result.balletClass, schedule: result.schedule } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NOT_FOUND:")) { res.status(404).json({ error: message.slice(10) + " not found" }); return; }
    if (message.startsWith("LEGACY:")) { res.status(422).json({ error: message.slice(7) }); return; }
    if (message.startsWith("VALIDATION:")) { res.status(422).json({ error: message.slice(11) }); return; }
    if (message === "END_TIME_MUST_FOLLOW_START_TIME") { res.status(422).json({ error: "End time must be later than start time" }); return; }
    if (message.startsWith("INVALID_STATE:")) { res.status(409).json({ error: message.slice(14) }); return; }
    logger.error({ err, classId: id }, "PATCH /admin/ballet/classes/:id failed");
    res.status(500).json({ error: "Failed to update class and schedule" });
  }
});

export default router;
