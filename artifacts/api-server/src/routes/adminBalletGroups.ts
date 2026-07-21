/** Admin Ballet Group routes for the canonical one-level group model. */
import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, balletGroupsTable, balletLevelsTable, balletLevelAssignmentsTable, balletClassesTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import { isAssignmentReadyClass } from "../lib/balletClassEntitlement";

const router: IRouter = Router();
const ACTIVITY_FIELDS = ["name", "levelId", "isActive", "capacity"] as const;

async function getLevel(levelId: number) {
  const [level] = await db.select({ id: balletLevelsTable.id, name: balletLevelsTable.name, isActive: balletLevelsTable.isActive })
    .from(balletLevelsTable).where(eq(balletLevelsTable.id, levelId)).limit(1);
  return level;
}

/**
 * assignmentReadyClassCount means "assignment-ready" per the shared
 * isAssignmentReadyClass predicate (balletClassEntitlement.ts) — the same
 * definition adminBallet.ts uses for Group assignment, Activation, and
 * Attendance. No join against ballet_schedules here: isAssignmentReadyClass
 * proves "exactly one" via a correlated subquery, so a Class with two active
 * Schedules (a data-integrity edge case, since that uniqueness is only
 * enforced by the API today, not the DB) can never be double-counted.
 */
function assignmentReadyClassCountQuery(groupIdFilter: SQL) {
  return db.select({ groupId: balletClassesTable.groupId, value: count(balletClassesTable.id) })
    .from(balletClassesTable)
    .where(and(groupIdFilter, isAssignmentReadyClass()))
    .groupBy(balletClassesTable.groupId);
}

async function attachOperationalCounts<T extends { id: number }>(rows: T[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [assignmentRows, classRows, readyClassRows] = await Promise.all([
    db.select({ groupId: balletLevelAssignmentsTable.groupId, value: count(balletLevelAssignmentsTable.id) })
      .from(balletLevelAssignmentsTable)
      .where(and(inArray(balletLevelAssignmentsTable.groupId, ids), eq(balletLevelAssignmentsTable.status, "active")))
      .groupBy(balletLevelAssignmentsTable.groupId),
    db.select({ groupId: balletClassesTable.groupId, value: count(balletClassesTable.id) })
      .from(balletClassesTable).where(inArray(balletClassesTable.groupId, ids)).groupBy(balletClassesTable.groupId),
    assignmentReadyClassCountQuery(inArray(balletClassesTable.groupId, ids)),
  ]);
  const assignments = new Map(assignmentRows.map((row) => [row.groupId, Number(row.value)]));
  const classes = new Map(classRows.map((row) => [row.groupId, Number(row.value)]));
  const readyClasses = new Map(readyClassRows.map((row) => [row.groupId, Number(row.value)]));
  return rows.map((row) => ({ ...row, activeAssignmentCount: assignments.get(row.id) ?? 0, classCount: classes.get(row.id) ?? 0, assignmentReadyClassCount: readyClasses.get(row.id) ?? 0 }));
}

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/groups", requireAdminAuth, requireAdminPermission("ballet.groups", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletGroupsTable).orderBy(asc(balletGroupsTable.createdAt)).limit(limit).offset((page - 1) * limit),
    db.select({ total: count(balletGroupsTable.id) }).from(balletGroupsTable),
  ]);
  res.json({ data: await attachOperationalCounts(rows), total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreateGroupBody = z.object({
  name: z.string().trim().min(1, "Name is required"),
  levelId: z.number({ required_error: "levelId is required" }).int().positive(),
  isActive: z.boolean().optional(),
  capacity: z.number().int().positive().nullable().optional(),
}).strict();

router.post("/admin/ballet/groups", requireAdminAuth, requireAdminPermission("ballet.groups", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const level = await getLevel(parsed.data.levelId);
  if (!level) { res.status(404).json({ error: "Level not found" }); return; }
  if (!level.isActive) { res.status(422).json({ error: "The selected level is inactive" }); return; }
  try {
    const [group] = await db.insert(balletGroupsTable).values(parsed.data).returning();
    await logActivity(req, {
      action: "create", module: "ballet.groups", entityType: "ballet_group", entityId: group.id, entityLabel: group.name,
      after: Object.fromEntries(ACTIVITY_FIELDS.map((key) => [key, group[key]])), summary: `Created ballet group ${group.name}`,
    });
    res.status(201).json({ group: { ...group, activeAssignmentCount: 0, classCount: 0, assignmentReadyClassCount: 0 } });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/groups failed");
    res.status(500).json({ error: "Failed to create group" });
  }
});

const UpdateGroupBody = CreateGroupBody.partial().strict();

router.patch("/admin/ballet/groups/:id", requireAdminAuth, requireAdminPermission("ballet.groups", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid group ID" }); return; }
  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  if (!Object.keys(parsed.data).length) { res.json({ success: true, message: "No changes" }); return; }
  if (parsed.data.levelId != null) {
    const level = await getLevel(parsed.data.levelId);
    if (!level) { res.status(404).json({ error: "Level not found" }); return; }
    if (!level.isActive) { res.status(422).json({ error: "The selected level is inactive" }); return; }
  }

  try {
    const [existing] = await db.select().from(balletGroupsTable).where(eq(balletGroupsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Group not found" }); return; }
    const [[{ activeAssignments }], [{ classCount }], readyClassRows] = await Promise.all([
      db.select({ activeAssignments: count(balletLevelAssignmentsTable.id) }).from(balletLevelAssignmentsTable)
        .where(and(eq(balletLevelAssignmentsTable.groupId, id), eq(balletLevelAssignmentsTable.status, "active"))),
      db.select({ classCount: count(balletClassesTable.id) }).from(balletClassesTable).where(eq(balletClassesTable.groupId, id)),
      assignmentReadyClassCountQuery(eq(balletClassesTable.groupId, id)),
    ]);
    const assignmentCount = Number(activeAssignments);
    const ownedClassCount = Number(classCount);
    const readyClassCount = Number(readyClassRows[0]?.value ?? 0);
    if (parsed.data.levelId != null && parsed.data.levelId !== existing.levelId && (assignmentCount > 0 || ownedClassCount > 0)) {
      res.status(422).json({ error: `Cannot change this group's level while it has ${assignmentCount} active assignment(s) or ${ownedClassCount} class(es).` });
      return;
    }
    if (parsed.data.isActive === false && existing.isActive && (assignmentCount > 0 || readyClassCount > 0)) {
      res.status(422).json({ error: `Cannot deactivate "${existing.name}" while it has ${assignmentCount} active assignment(s) or ${readyClassCount} assignment-ready class(es).` });
      return;
    }
    const [group] = await db.update(balletGroupsTable).set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(balletGroupsTable.id, id)).returning();
    const { before, after } = diffFields(existing, group, ACTIVITY_FIELDS);
    if (Object.keys(after).length) {
      await logActivity(req, {
        action: existing.isActive !== group.isActive ? group.isActive ? "activate" : "deactivate" : "update",
        module: "ballet.groups", entityType: "ballet_group", entityId: id, entityLabel: group.name,
        before, after, summary: `Updated ballet group ${group.name}: ${Object.keys(after).join(", ")}`,
      });
    }
    res.json({ group: { ...group, activeAssignmentCount: assignmentCount, classCount: ownedClassCount, assignmentReadyClassCount: readyClassCount } });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/groups/:id failed");
    res.status(500).json({ error: "Failed to update group" });
  }
});

export default router;
