/**
 * Admin Ballet Classes routes — /api/admin/ballet/classes/*
 *
 * Class catalogue for the Ballet system, independent of the generic
 * `classes` table.
 *
 * Routes:
 *   GET   /api/admin/ballet/classes       — paginated list
 *   POST  /api/admin/ballet/classes       — create class
 *   PATCH /api/admin/ballet/classes/:id   — update class
 *
 * groupIds/levelIds are wire-level number arrays backed by the
 * ballet_class_groups / ballet_class_levels join tables (many-to-many) —
 * NOT columns on ballet_classes itself. Every id is validated to exist
 * before being written. instructorId is a scalar FK and is also validated.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletClassesTable,
  balletInstructorsTable,
  balletGroupsTable,
  balletLevelsTable,
  balletClassGroupsTable,
  balletClassLevelsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";

const router: IRouter = Router();
const BALLET_CLASS_ACTIVITY_FIELDS = ["title", "instructorId", "classImageUrl", "classVideoUrl", "isActive"] as const;

function arraysEqualAsSets(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

async function findMissingIds(client: DbClient, ids: number[], table: typeof balletGroupsTable | typeof balletLevelsTable): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await client.select({ id: table.id }).from(table).where(inArray(table.id, ids));
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

async function getClassGroupIds(client: DbClient, classId: number): Promise<number[]> {
  const rows = await client.select({ groupId: balletClassGroupsTable.groupId }).from(balletClassGroupsTable).where(eq(balletClassGroupsTable.classId, classId));
  return rows.map((r) => r.groupId);
}

async function getClassLevelIds(client: DbClient, classId: number): Promise<number[]> {
  const rows = await client.select({ levelId: balletClassLevelsTable.levelId }).from(balletClassLevelsTable).where(eq(balletClassLevelsTable.classId, classId));
  return rows.map((r) => r.levelId);
}

async function syncClassGroups(client: DbClient, classId: number, desiredGroupIds: number[]): Promise<void> {
  const existingIds = await getClassGroupIds(client, classId);
  const desiredSet = new Set(desiredGroupIds);
  const existingSet = new Set(existingIds);
  const toDelete = existingIds.filter((id) => !desiredSet.has(id));
  const toInsert = desiredGroupIds.filter((id) => !existingSet.has(id));
  if (toDelete.length > 0) {
    await client.delete(balletClassGroupsTable).where(and(eq(balletClassGroupsTable.classId, classId), inArray(balletClassGroupsTable.groupId, toDelete)));
  }
  if (toInsert.length > 0) {
    await client.insert(balletClassGroupsTable).values(toInsert.map((groupId) => ({ classId, groupId })));
  }
}

async function syncClassLevels(client: DbClient, classId: number, desiredLevelIds: number[]): Promise<void> {
  const existingIds = await getClassLevelIds(client, classId);
  const desiredSet = new Set(desiredLevelIds);
  const existingSet = new Set(existingIds);
  const toDelete = existingIds.filter((id) => !desiredSet.has(id));
  const toInsert = desiredLevelIds.filter((id) => !existingSet.has(id));
  if (toDelete.length > 0) {
    await client.delete(balletClassLevelsTable).where(and(eq(balletClassLevelsTable.classId, classId), inArray(balletClassLevelsTable.levelId, toDelete)));
  }
  if (toInsert.length > 0) {
    await client.insert(balletClassLevelsTable).values(toInsert.map((levelId) => ({ classId, levelId })));
  }
}

async function attachGroupsAndLevels<T extends { id: number }>(rows: T[]): Promise<Array<T & { groupIds: number[]; levelIds: number[] }>> {
  if (rows.length === 0) return [];
  const classIds = rows.map((r) => r.id);
  const [groupRows, levelRows] = await Promise.all([
    db.select({ classId: balletClassGroupsTable.classId, groupId: balletClassGroupsTable.groupId }).from(balletClassGroupsTable).where(inArray(balletClassGroupsTable.classId, classIds)),
    db.select({ classId: balletClassLevelsTable.classId, levelId: balletClassLevelsTable.levelId }).from(balletClassLevelsTable).where(inArray(balletClassLevelsTable.classId, classIds)),
  ]);
  const groupsByClass = new Map<number, number[]>();
  for (const row of groupRows) groupsByClass.set(row.classId, [...(groupsByClass.get(row.classId) ?? []), row.groupId]);
  const levelsByClass = new Map<number, number[]>();
  for (const row of levelRows) levelsByClass.set(row.classId, [...(levelsByClass.get(row.classId) ?? []), row.levelId]);
  return rows.map((row) => ({ ...row, groupIds: groupsByClass.get(row.id) ?? [], levelIds: levelsByClass.get(row.id) ?? [] }));
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/classes", requireAdminAuth, requireAdminPermission("ballet.classes", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletClassesTable).orderBy(asc(balletClassesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletClassesTable.id) }).from(balletClassesTable),
  ]);
  const data = await attachGroupsAndLevels(rows);

  res.json({ data, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreateClassBody = z.object({
  title:         z.string().min(1, "Title is required"),
  groupIds:      z.array(z.number().int().positive()).optional(),
  levelIds:      z.array(z.number().int().positive()).optional(),
  instructorId:  z.number().int().positive().nullable().optional(),
  classImageUrl: z.string().nullable().optional(),
  classVideoUrl: z.string().nullable().optional(),
  isActive:      z.boolean().optional(),
});

async function validateInstructorId(instructorId: number | null | undefined): Promise<boolean> {
  if (instructorId == null) return true;
  const [row] = await db.select({ id: balletInstructorsTable.id }).from(balletInstructorsTable).where(eq(balletInstructorsTable.id, instructorId)).limit(1);
  return !!row;
}

router.post("/admin/ballet/classes", requireAdminAuth, requireAdminPermission("ballet.classes", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  if (!(await validateInstructorId(parsed.data.instructorId))) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }

  const groupIds = [...new Set(parsed.data.groupIds ?? [])];
  const levelIds = [...new Set(parsed.data.levelIds ?? [])];

  const missingGroupIds = await findMissingIds(db, groupIds, balletGroupsTable);
  if (missingGroupIds.length > 0) {
    res.status(404).json({ error: `ballet_groups id(s) not found: ${missingGroupIds.join(", ")}` });
    return;
  }
  const missingLevelIds = await findMissingIds(db, levelIds, balletLevelsTable);
  if (missingLevelIds.length > 0) {
    res.status(404).json({ error: `ballet_levels id(s) not found: ${missingLevelIds.join(", ")}` });
    return;
  }

  const { groupIds: _g, levelIds: _l, ...scalarFields } = parsed.data;

  try {
    const balletClass = await db.transaction(async (tx) => {
      const [row] = await tx.insert(balletClassesTable).values(scalarFields).returning();
      if (groupIds.length > 0) await tx.insert(balletClassGroupsTable).values(groupIds.map((groupId) => ({ classId: row.id, groupId })));
      if (levelIds.length > 0) await tx.insert(balletClassLevelsTable).values(levelIds.map((levelId) => ({ classId: row.id, levelId })));
      return row;
    });

    await logActivity(req, {
      action: "create",
      module: "ballet.classes",
      entityType: "ballet_class",
      entityId: balletClass.id,
      entityLabel: balletClass.title,
      after: {
        ...Object.fromEntries(BALLET_CLASS_ACTIVITY_FIELDS.map((key) => [key, balletClass[key]])),
        groupIds,
        levelIds,
      },
      summary: `Created ballet class ${balletClass.title}`,
    });
    res.status(201).json({ class: { ...balletClass, groupIds, levelIds } });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/classes failed");
    res.status(500).json({ error: "Failed to create class" });
  }
});

const UpdateClassBody = CreateClassBody.partial();

router.patch("/admin/ballet/classes/:id", requireAdminAuth, requireAdminPermission("ballet.classes", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid class ID" }); return; }

  const parsed = UpdateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "instructorId") && !(await validateInstructorId(parsed.data.instructorId))) {
    res.status(404).json({ error: "Instructor not found" });
    return;
  }

  const groupIdsProvided = parsed.data.groupIds !== undefined;
  const levelIdsProvided = parsed.data.levelIds !== undefined;
  const groupIds = groupIdsProvided ? [...new Set(parsed.data.groupIds ?? [])] : undefined;
  const levelIds = levelIdsProvided ? [...new Set(parsed.data.levelIds ?? [])] : undefined;

  if (groupIds) {
    const missing = await findMissingIds(db, groupIds, balletGroupsTable);
    if (missing.length > 0) { res.status(404).json({ error: `ballet_groups id(s) not found: ${missing.join(", ")}` }); return; }
  }
  if (levelIds) {
    const missing = await findMissingIds(db, levelIds, balletLevelsTable);
    if (missing.length > 0) { res.status(404).json({ error: `ballet_levels id(s) not found: ${missing.join(", ")}` }); return; }
  }

  const scalarUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === "groupIds" || k === "levelIds") continue;
    if (v !== undefined) scalarUpdates[k] = v;
  }

  if (Object.keys(scalarUpdates).length === 0 && !groupIdsProvided && !levelIdsProvided) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  try {
    const [existing] = await db.select().from(balletClassesTable).where(eq(balletClassesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Class not found" }); return; }

    const [existingGroupIds, existingLevelIds] = await Promise.all([
      getClassGroupIds(db, id),
      getClassLevelIds(db, id),
    ]);

    scalarUpdates["updatedAt"] = new Date().toISOString();

    const balletClass = await db.transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await tx.update(balletClassesTable).set(scalarUpdates as any).where(eq(balletClassesTable.id, id)).returning();
      if (groupIds) await syncClassGroups(tx, id, groupIds);
      if (levelIds) await syncClassLevels(tx, id, levelIds);
      return row;
    });

    if (!balletClass) { res.status(404).json({ error: "Class not found" }); return; }

    const finalGroupIds = groupIds ?? existingGroupIds;
    const finalLevelIds = levelIds ?? existingLevelIds;

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_CLASS_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_CLASS_ACTIVITY_FIELDS.map((key) => [key, balletClass[key]])),
      BALLET_CLASS_ACTIVITY_FIELDS,
    );
    if (groupIdsProvided && !arraysEqualAsSets(existingGroupIds, finalGroupIds)) {
      before["groupIds"] = existingGroupIds;
      after["groupIds"] = finalGroupIds;
    }
    if (levelIdsProvided && !arraysEqualAsSets(existingLevelIds, finalLevelIds)) {
      before["levelIds"] = existingLevelIds;
      after["levelIds"] = finalLevelIds;
    }

    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== balletClass.isActive ? balletClass.isActive ? "activate" : "deactivate" : "update";
      await logActivity(req, {
        action,
        module: "ballet.classes",
        entityType: "ballet_class",
        entityId: balletClass.id,
        entityLabel: balletClass.title,
        before,
        after,
        summary: action === "activate"
          ? `Activated ballet class ${balletClass.title}`
          : action === "deactivate"
            ? `Deactivated ballet class ${balletClass.title}`
            : `Updated ballet class ${balletClass.title}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ class: { ...balletClass, groupIds: finalGroupIds, levelIds: finalLevelIds } });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/classes/:id failed");
    res.status(500).json({ error: "Failed to update class" });
  }
});

export default router;
