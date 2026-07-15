/**
 * Admin Ballet Packages routes — /api/admin/ballet/packages/*
 *
 * Admin-managed pricing packages for the Ballet system.
 *
 * Routes:
 *   GET   /api/admin/ballet/packages       — paginated list
 *   POST  /api/admin/ballet/packages       — create package
 *   PATCH /api/admin/ballet/packages/:id   — update package
 *
 * levelIds is a wire-level number array backed by the ballet_package_levels
 * join table (many-to-many) — NOT a column on ballet_packages itself. Every
 * id is validated to exist before being written.
 */

import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, balletPackagesTable, balletLevelsTable, balletPackageLevelsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import type { DbClient } from "../lib/dbTypes";

const router: IRouter = Router();
const BALLET_PACKAGE_ACTIVITY_FIELDS = ["name", "monthlyClasses", "monthlyHours", "priceEgp", "isActive"] as const;

function arraysEqualAsSets(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

async function findMissingLevelIds(client: DbClient, ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await client.select({ id: balletLevelsTable.id }).from(balletLevelsTable).where(inArray(balletLevelsTable.id, ids));
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

async function getPackageLevelIds(client: DbClient, packageId: number): Promise<number[]> {
  const rows = await client.select({ levelId: balletPackageLevelsTable.levelId }).from(balletPackageLevelsTable).where(eq(balletPackageLevelsTable.packageId, packageId));
  return rows.map((r) => r.levelId);
}

async function syncPackageLevels(client: DbClient, packageId: number, desiredLevelIds: number[]): Promise<void> {
  const existingIds = await getPackageLevelIds(client, packageId);
  const desiredSet = new Set(desiredLevelIds);
  const existingSet = new Set(existingIds);
  const toDelete = existingIds.filter((id) => !desiredSet.has(id));
  const toInsert = desiredLevelIds.filter((id) => !existingSet.has(id));
  if (toDelete.length > 0) {
    await client.delete(balletPackageLevelsTable).where(and(eq(balletPackageLevelsTable.packageId, packageId), inArray(balletPackageLevelsTable.levelId, toDelete)));
  }
  if (toInsert.length > 0) {
    await client.insert(balletPackageLevelsTable).values(toInsert.map((levelId) => ({ packageId, levelId })));
  }
}

async function attachLevelIds<T extends { id: number }>(rows: T[]): Promise<Array<T & { levelIds: number[] }>> {
  if (rows.length === 0) return [];
  const packageIds = rows.map((r) => r.id);
  const levelRows = await db.select({ packageId: balletPackageLevelsTable.packageId, levelId: balletPackageLevelsTable.levelId }).from(balletPackageLevelsTable).where(inArray(balletPackageLevelsTable.packageId, packageIds));
  const levelsByPackage = new Map<number, number[]>();
  for (const row of levelRows) levelsByPackage.set(row.packageId, [...(levelsByPackage.get(row.packageId) ?? []), row.levelId]);
  return rows.map((row) => ({ ...row, levelIds: levelsByPackage.get(row.id) ?? [] }));
}

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/packages", requireAdminAuth, requireAdminPermission("ballet.packages", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletPackagesTable).orderBy(asc(balletPackagesTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletPackagesTable.id) }).from(balletPackagesTable),
  ]);
  const data = await attachLevelIds(rows);

  res.json({ data, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreatePackageBody = z.object({
  name:           z.string().min(1, "Name is required"),
  monthlyClasses: z.number({ required_error: "monthlyClasses is required" }).int().positive(),
  monthlyHours:   z.number({ required_error: "monthlyHours is required" }).int().positive(),
  priceEgp:       z.number({ required_error: "priceEgp is required" }).int().positive(),
  levelIds:       z.array(z.number().int().positive()).optional(),
  isActive:       z.boolean().optional(),
});

router.post("/admin/ballet/packages", requireAdminAuth, requireAdminPermission("ballet.packages", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const levelIds = [...new Set(parsed.data.levelIds ?? [])];
  const missingLevelIds = await findMissingLevelIds(db, levelIds);
  if (missingLevelIds.length > 0) {
    res.status(404).json({ error: `ballet_levels id(s) not found: ${missingLevelIds.join(", ")}` });
    return;
  }

  const { levelIds: _l, ...scalarFields } = parsed.data;

  try {
    const pkg = await db.transaction(async (tx) => {
      const [row] = await tx.insert(balletPackagesTable).values(scalarFields).returning();
      if (levelIds.length > 0) await tx.insert(balletPackageLevelsTable).values(levelIds.map((levelId) => ({ packageId: row.id, levelId })));
      return row;
    });

    await logActivity(req, {
      action: "create",
      module: "ballet.packages",
      entityType: "ballet_package",
      entityId: pkg.id,
      entityLabel: pkg.name,
      after: {
        ...Object.fromEntries(BALLET_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, pkg[key]])),
        levelIds,
      },
      summary: `Created ballet package ${pkg.name}`,
    });
    res.status(201).json({ package: { ...pkg, levelIds } });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/packages failed");
    res.status(500).json({ error: "Failed to create package" });
  }
});

const UpdatePackageBody = CreatePackageBody.partial();

router.patch("/admin/ballet/packages/:id", requireAdminAuth, requireAdminPermission("ballet.packages", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid package ID" }); return; }

  const parsed = UpdatePackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const levelIdsProvided = parsed.data.levelIds !== undefined;
  const levelIds = levelIdsProvided ? [...new Set(parsed.data.levelIds ?? [])] : undefined;

  if (levelIds) {
    const missing = await findMissingLevelIds(db, levelIds);
    if (missing.length > 0) { res.status(404).json({ error: `ballet_levels id(s) not found: ${missing.join(", ")}` }); return; }
  }

  const scalarUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === "levelIds") continue;
    if (v !== undefined) scalarUpdates[k] = v;
  }

  if (Object.keys(scalarUpdates).length === 0 && !levelIdsProvided) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  try {
    const [existing] = await db.select().from(balletPackagesTable).where(eq(balletPackagesTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Package not found" }); return; }

    const existingLevelIds = await getPackageLevelIds(db, id);

    scalarUpdates["updatedAt"] = new Date().toISOString();

    const pkg = await db.transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [row] = await tx.update(balletPackagesTable).set(scalarUpdates as any).where(eq(balletPackagesTable.id, id)).returning();
      if (levelIds) await syncPackageLevels(tx, id, levelIds);
      return row;
    });

    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }

    const finalLevelIds = levelIds ?? existingLevelIds;

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_PACKAGE_ACTIVITY_FIELDS.map((key) => [key, pkg[key]])),
      BALLET_PACKAGE_ACTIVITY_FIELDS,
    );
    if (levelIdsProvided && !arraysEqualAsSets(existingLevelIds, finalLevelIds)) {
      before["levelIds"] = existingLevelIds;
      after["levelIds"] = finalLevelIds;
    }

    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== pkg.isActive ? pkg.isActive ? "activate" : "deactivate" : "update";
      await logActivity(req, {
        action,
        module: "ballet.packages",
        entityType: "ballet_package",
        entityId: pkg.id,
        entityLabel: pkg.name,
        before,
        after,
        summary: action === "activate"
          ? `Activated ballet package ${pkg.name}`
          : action === "deactivate"
            ? `Deactivated ballet package ${pkg.name}`
            : `Updated ballet package ${pkg.name}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ package: { ...pkg, levelIds: finalLevelIds } });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/packages/:id failed");
    res.status(500).json({ error: "Failed to update package" });
  }
});

export default router;
