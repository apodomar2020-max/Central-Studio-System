/**
 * Admin Ballet Groups routes — /api/admin/ballet/groups/*
 *
 * A cohort of children within one level. A group can be assigned to more
 * than one weekly schedule slot (e.g. Monday 5pm AND Wednesday 5pm) — that
 * many-to-many relationship is tracked via the ballet_group_schedules join
 * table, exposed on the wire as `scheduleIds`.
 *
 * A schedule can only be assigned to a group if the group is already linked
 * (via ballet_class_groups) to the class that owns that schedule — a group
 * cannot be scheduled for a class it doesn't belong to. That linkage is
 * managed by adminBalletClasses.ts's groupIds field.
 *
 * Routes:
 *   GET   /api/admin/ballet/groups       — paginated list
 *   POST  /api/admin/ballet/groups       — create group
 *   PATCH /api/admin/ballet/groups/:id   — update group
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletGroupsTable,
  balletLevelsTable,
  balletSchedulesTable,
  balletClassGroupsTable,
  balletGroupSchedulesTable,
  balletLevelAssignmentsTable,
} from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";

const router: IRouter = Router();
const BALLET_GROUP_ACTIVITY_FIELDS = ["name", "levelId", "isActive"] as const;

class BalletGroupValidationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function arraysEqualAsSets(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

async function validateLevelId(levelId: number): Promise<boolean> {
  const [row] = await db.select({ id: balletLevelsTable.id }).from(balletLevelsTable).where(eq(balletLevelsTable.id, levelId)).limit(1);
  return !!row;
}

async function findMissingScheduleIds(client: DbClient, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await client.select({ id: balletSchedulesTable.id }).from(balletSchedulesTable).where(inArray(balletSchedulesTable.id, ids));
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

/** Maps each scheduleId to the classId that owns it (assumes all ids already validated to exist). */
async function getClassIdByScheduleId(client: DbClient, scheduleIds: number[]): Promise<Map<number, number>> {
  if (scheduleIds.length === 0) return new Map();
  const rows = await client.select({ id: balletSchedulesTable.id, classId: balletSchedulesTable.classId }).from(balletSchedulesTable).where(inArray(balletSchedulesTable.id, scheduleIds));
  return new Map(rows.map((r) => [r.id, r.classId]));
}

/** Returns the subset of scheduleIds whose owning class is NOT linked to this group via ballet_class_groups. */
async function findUnlinkedScheduleIds(client: DbClient, groupId: number, scheduleIds: number[], classIdByScheduleId: Map<number, number>): Promise<number[]> {
  if (scheduleIds.length === 0) return [];
  const classIds = [...new Set(scheduleIds.map((id) => classIdByScheduleId.get(id)!))];
  const linkedRows = await client
    .select({ classId: balletClassGroupsTable.classId })
    .from(balletClassGroupsTable)
    .where(and(eq(balletClassGroupsTable.groupId, groupId), inArray(balletClassGroupsTable.classId, classIds)));
  const linkedClassIds = new Set(linkedRows.map((r) => r.classId));
  return scheduleIds.filter((scheduleId) => !linkedClassIds.has(classIdByScheduleId.get(scheduleId)!));
}

function unlinkedScheduleError(unlinked: number[]): BalletGroupValidationError {
  return new BalletGroupValidationError(
    422,
    unlinked.length === 1
      ? `This group is not linked to the class that owns schedule ${unlinked[0]}`
      : `This group is not linked to the class that owns schedule(s): ${unlinked.join(", ")}`,
  );
}

async function getGroupScheduleIds(client: DbClient, groupId: number): Promise<number[]> {
  const rows = await client.select({ scheduleId: balletGroupSchedulesTable.scheduleId }).from(balletGroupSchedulesTable).where(eq(balletGroupSchedulesTable.groupId, groupId));
  return rows.map((r) => r.scheduleId);
}

async function syncGroupSchedules(client: DbClient, groupId: number, desiredScheduleIds: number[]): Promise<void> {
  const existingIds = await getGroupScheduleIds(client, groupId);
  const desiredSet = new Set(desiredScheduleIds);
  const existingSet = new Set(existingIds);
  const toDelete = existingIds.filter((id) => !desiredSet.has(id));
  const toInsert = desiredScheduleIds.filter((id) => !existingSet.has(id));
  if (toDelete.length > 0) {
    await client.delete(balletGroupSchedulesTable).where(and(eq(balletGroupSchedulesTable.groupId, groupId), inArray(balletGroupSchedulesTable.scheduleId, toDelete)));
  }
  if (toInsert.length > 0) {
    await client.insert(balletGroupSchedulesTable).values(toInsert.map((scheduleId) => ({ groupId, scheduleId })));
  }
}

async function attachScheduleIds<T extends { id: number }>(rows: T[]): Promise<Array<T & { scheduleIds: number[] }>> {
  if (rows.length === 0) return [];
  const groupIds = rows.map((r) => r.id);
  const scheduleRows = await db.select({ groupId: balletGroupSchedulesTable.groupId, scheduleId: balletGroupSchedulesTable.scheduleId }).from(balletGroupSchedulesTable).where(inArray(balletGroupSchedulesTable.groupId, groupIds));
  const schedulesByGroup = new Map<number, number[]>();
  for (const row of scheduleRows) schedulesByGroup.set(row.groupId, [...(schedulesByGroup.get(row.groupId) ?? []), row.scheduleId]);
  return rows.map((row) => ({ ...row, scheduleIds: schedulesByGroup.get(row.id) ?? [] }));
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/groups", requireAdminAuth, requireAdminPermission("ballet.groups", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletGroupsTable).orderBy(asc(balletGroupsTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletGroupsTable.id) }).from(balletGroupsTable),
  ]);
  const data = await attachScheduleIds(rows);

  res.json({ data, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreateGroupBody = z.object({
  name:     z.string().min(1, "Name is required"),
  levelId:  z.number({ required_error: "levelId is required" }).int().positive(),
  isActive: z.boolean().optional(),
});

router.post("/admin/ballet/groups", requireAdminAuth, requireAdminPermission("ballet.groups", "create"), async (req: AdminRequest, res): Promise<void> => {
  // A brand-new group cannot yet be linked to any class (that linkage is only
  // created via adminBalletClasses.ts's groupIds field), so it can never pass
  // the ownership check schedules require. Reject scheduleIds here rather
  // than let it reach a check that would always fail.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "scheduleIds")) {
    res.status(422).json({ error: "Schedules can only be assigned after the group is linked to a class — use PATCH after creating the group." });
    return;
  }

  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  if (!(await validateLevelId(parsed.data.levelId))) {
    res.status(404).json({ error: "Level not found" });
    return;
  }

  try {
    const [group] = await db.insert(balletGroupsTable).values(parsed.data).returning();

    await logActivity(req, {
      action: "create",
      module: "ballet.groups",
      entityType: "ballet_group",
      entityId: group.id,
      entityLabel: group.name,
      after: {
        ...Object.fromEntries(BALLET_GROUP_ACTIVITY_FIELDS.map((key) => [key, group[key]])),
        scheduleIds: [],
      },
      summary: `Created ballet group ${group.name}`,
    });
    res.status(201).json({ group: { ...group, scheduleIds: [] } });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/groups failed");
    res.status(500).json({ error: "Failed to create group" });
  }
});

const UpdateGroupBody = z.object({
  name:        z.string().min(1).optional(),
  levelId:     z.number().int().positive().optional(),
  scheduleIds: z.array(z.number().int().positive()).optional(),
  isActive:    z.boolean().optional(),
});

router.patch("/admin/ballet/groups/:id", requireAdminAuth, requireAdminPermission("ballet.groups", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid group ID" }); return; }

  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  if (parsed.data.levelId != null && !(await validateLevelId(parsed.data.levelId))) {
    res.status(404).json({ error: "Level not found" });
    return;
  }

  const scheduleIdsProvided = parsed.data.scheduleIds !== undefined;
  const scheduleIds = scheduleIdsProvided ? [...new Set(parsed.data.scheduleIds ?? [])] : undefined;

  if (scheduleIds) {
    const missing = await findMissingScheduleIds(db, scheduleIds);
    if (missing.length > 0) { res.status(404).json({ error: `ballet_schedules id(s) not found: ${missing.join(", ")}` }); return; }

    const classIdByScheduleId = await getClassIdByScheduleId(db, scheduleIds);
    const unlinked = await findUnlinkedScheduleIds(db, id, scheduleIds, classIdByScheduleId);
    if (unlinked.length > 0) {
      const validationError = unlinkedScheduleError(unlinked);
      res.status(validationError.status).json({ error: validationError.message });
      return;
    }
  }

  const scalarUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === "scheduleIds") continue;
    if (v !== undefined) scalarUpdates[k] = v;
  }

  if (Object.keys(scalarUpdates).length === 0 && !scheduleIdsProvided) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  try {
    const [existing] = await db.select().from(balletGroupsTable).where(eq(balletGroupsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Group not found" }); return; }

    // Guard: block deactivating a group that still has active students
    // assigned (a real enrollment consequence, not just a catalogue edit).
    if (scalarUpdates["isActive"] === false && existing.isActive) {
      const [{ activeCount }] = await db
        .select({ activeCount: count(balletLevelAssignmentsTable.id) })
        .from(balletLevelAssignmentsTable)
        .where(and(eq(balletLevelAssignmentsTable.groupId, id), eq(balletLevelAssignmentsTable.status, "active")));
      const n = Number(activeCount);
      if (n > 0) {
        res.status(422).json({ error: `Cannot deactivate "${existing.name}" — ${n} active student${n === 1 ? "" : "s"} are currently assigned to this group.` });
        return;
      }
    }

    const existingScheduleIds = await getGroupScheduleIds(db, id);

    scalarUpdates["updatedAt"] = new Date().toISOString();

    const group = await db.transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await tx.update(balletGroupsTable).set(scalarUpdates as any).where(eq(balletGroupsTable.id, id)).returning();
      if (scheduleIds) await syncGroupSchedules(tx, id, scheduleIds);
      return row;
    });

    if (!group) { res.status(404).json({ error: "Group not found" }); return; }

    const finalScheduleIds = scheduleIds ?? existingScheduleIds;

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_GROUP_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_GROUP_ACTIVITY_FIELDS.map((key) => [key, group[key]])),
      BALLET_GROUP_ACTIVITY_FIELDS,
    );
    if (scheduleIdsProvided && !arraysEqualAsSets(existingScheduleIds, finalScheduleIds)) {
      before["scheduleIds"] = existingScheduleIds;
      after["scheduleIds"] = finalScheduleIds;
    }

    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== group.isActive ? group.isActive ? "activate" : "deactivate" : "update";
      await logActivity(req, {
        action,
        module: "ballet.groups",
        entityType: "ballet_group",
        entityId: group.id,
        entityLabel: group.name,
        before,
        after,
        summary: action === "activate"
          ? `Activated ballet group ${group.name}`
          : action === "deactivate"
            ? `Deactivated ballet group ${group.name}`
            : `Updated ballet group ${group.name}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ group: { ...group, scheduleIds: finalScheduleIds } });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/groups/:id failed");
    res.status(500).json({ error: "Failed to update group" });
  }
});

export default router;
