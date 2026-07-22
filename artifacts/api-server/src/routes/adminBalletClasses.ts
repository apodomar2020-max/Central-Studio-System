/**
 * Canonical Admin Ballet Class routes.
 *
 * A Ballet Class owns catalogue metadata and canonical relationships only.
 * Weekly timing rows are managed independently by adminBalletSchedules.ts.
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
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";

const router: IRouter = Router();
const ACTIVITY_FIELDS = ["title", "levelId", "groupId", "instructorId", "classImageUrl", "classVideoUrl", "isActive"] as const;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const BalletClassFields = z.object({
  title: z.string().trim().min(1, "Title is required"),
  levelId: z.number({ required_error: "levelId is required" }).int().positive(),
  groupId: z.number({ required_error: "groupId is required" }).int().positive(),
  instructorId: z.number({ required_error: "instructorId is required" }).int().positive(),
  isActive: z.boolean().default(true),
  classImageUrl: z.string().url().nullable().optional(),
  classVideoUrl: z.string().url().nullable().optional(),
}).strict();

export const BalletClassBody = BalletClassFields;
export const UpdateBalletClassBody = BalletClassFields.partial();

type BalletScheduleRow = typeof balletSchedulesTable.$inferSelect;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidActiveSchedule(schedule: BalletScheduleRow): boolean {
  return schedule.status === "active"
    && schedule.dayOfWeek >= 0
    && schedule.dayOfWeek <= 6
    && TIME_PATTERN.test(schedule.startTime)
    && TIME_PATTERN.test(schedule.endTime)
    && minuteOfDay(schedule.startTime) < minuteOfDay(schedule.endTime)
    && schedule.durationMins != null
    && schedule.durationMins > 0;
}

function primarySchedule(schedules: BalletScheduleRow[]): BalletScheduleRow | null {
  return schedules.find(isValidActiveSchedule) ?? null;
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

async function attachSchedules<T extends { id: number }>(
  rows: T[],
): Promise<Array<T & { schedules: BalletScheduleRow[]; /** @deprecated Use schedules[] instead. */ schedule: BalletScheduleRow | null }>> {
  if (rows.length === 0) return [];
  const schedules = await db
    .select()
    .from(balletSchedulesTable)
    .where(inArray(balletSchedulesTable.classId, rows.map((row) => row.id)))
    .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime), asc(balletSchedulesTable.id));
  const schedulesByClass = new Map<number, BalletScheduleRow[]>();
  for (const schedule of schedules) {
    const existing = schedulesByClass.get(schedule.classId) ?? [];
    existing.push(schedule);
    schedulesByClass.set(schedule.classId, existing);
  }
  return rows.map((row) => {
    const classSchedules = schedulesByClass.get(row.id) ?? [];
    return { ...row, schedules: classSchedules, schedule: primarySchedule(classSchedules) };
  });
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
  const parsed = BalletClassBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }

  try {
    const balletClass = await db.transaction(async (tx) => {
      const relationError = await validateCanonicalRelations(tx, parsed.data.levelId, parsed.data.groupId, parsed.data.instructorId);
      if (relationError) throw new Error(`VALIDATION:${relationError}`);
      const [created] = await tx.insert(balletClassesTable).values({
        title: parsed.data.title,
        isLegacy: false,
        levelId: parsed.data.levelId,
        groupId: parsed.data.groupId,
        instructorId: parsed.data.instructorId,
        classImageUrl: parsed.data.classImageUrl ?? null,
        classVideoUrl: parsed.data.classVideoUrl ?? null,
        isActive: parsed.data.isActive,
      }).returning();
      return created;
    });

    await logActivity(req, {
      action: "create", module: "ballet.classes", entityType: "ballet_class", entityId: balletClass.id,
      entityLabel: balletClass.title,
      after: Object.fromEntries(ACTIVITY_FIELDS.map((key) => [key, balletClass[key]])),
      summary: `Created ballet class ${balletClass.title}`,
    });
    res.status(201).json({ class: { ...balletClass, schedules: [], schedule: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("VALIDATION:")) { res.status(422).json({ error: message.slice(11) }); return; }
    logger.error({ err }, "POST /admin/ballet/classes failed");
    res.status(500).json({ error: "Failed to create class" });
  }
});

router.patch("/admin/ballet/classes/:id", requireAdminAuth, requireAdminPermission("ballet.classes", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid class ID" }); return; }
  const parsed = UpdateBalletClassBody.safeParse(req.body);
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

      const merged = {
        title: parsed.data.title ?? existingClass.title,
        levelId: parsed.data.levelId ?? existingClass.levelId,
        groupId: parsed.data.groupId ?? existingClass.groupId,
        instructorId: parsed.data.instructorId ?? existingClass.instructorId,
        classImageUrl: parsed.data.classImageUrl === undefined ? existingClass.classImageUrl : parsed.data.classImageUrl,
        classVideoUrl: parsed.data.classVideoUrl === undefined ? existingClass.classVideoUrl : parsed.data.classVideoUrl,
        isActive: parsed.data.isActive ?? existingClass.isActive,
      };
      if (merged.levelId == null || merged.groupId == null || merged.instructorId == null) {
        throw new Error("INVALID_STATE:Canonical class is missing a required relationship");
      }
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
      const now = new Date().toISOString();
      const [balletClass] = await tx.update(balletClassesTable).set({
        title: merged.title,
        levelId: merged.levelId,
        groupId: merged.groupId,
        instructorId: merged.instructorId,
        classImageUrl: merged.classImageUrl,
        classVideoUrl: merged.classVideoUrl,
        isActive: merged.isActive,
        updatedAt: now,
      }).where(eq(balletClassesTable.id, id)).returning();
      return { existingClass, balletClass };
    });

    const classDiff = diffFields(result.existingClass, result.balletClass, ACTIVITY_FIELDS);
    if (Object.keys(classDiff.after).length) {
      await logActivity(req, {
        action: result.existingClass.isActive !== result.balletClass.isActive ? result.balletClass.isActive ? "activate" : "deactivate" : "update",
        module: "ballet.classes", entityType: "ballet_class", entityId: id, entityLabel: result.balletClass.title,
        before: classDiff.before, after: classDiff.after,
        summary: `Updated ballet class ${result.balletClass.title}`,
      });
    }
    const [withSchedules] = await attachSchedules([result.balletClass]);
    res.json({ class: withSchedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NOT_FOUND:")) { res.status(404).json({ error: message.slice(10) + " not found" }); return; }
    if (message.startsWith("LEGACY:")) { res.status(422).json({ error: message.slice(7) }); return; }
    if (message.startsWith("VALIDATION:")) { res.status(422).json({ error: message.slice(11) }); return; }
    if (message.startsWith("INVALID_STATE:")) { res.status(409).json({ error: message.slice(14) }); return; }
    logger.error({ err, classId: id }, "PATCH /admin/ballet/classes/:id failed");
    res.status(500).json({ error: "Failed to update class" });
  }
});

export default router;
