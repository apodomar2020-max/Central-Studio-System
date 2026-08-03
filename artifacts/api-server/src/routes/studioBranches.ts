import { Router, type IRouter, type NextFunction, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, studioBranchesTable, studioRoomsTable } from "@workspace/db";
import {
  CreateAdminBranchBody,
  CreateAdminBranchResponse,
  CreateAdminBranchRoomBody,
  CreateAdminBranchRoomParams,
  CreateAdminBranchRoomResponse,
  GetAdminBranchParams,
  GetAdminBranchResponse,
  ListAdminBranchesResponse,
  ListAdminBranchRoomsParams,
  ListAdminBranchRoomsResponse,
  UpdateAdminBranchBody,
  UpdateAdminBranchParams,
  UpdateAdminBranchResponse,
  UpdateAdminRoomBody,
  UpdateAdminRoomParams,
  UpdateAdminRoomResponse,
} from "@workspace/api-zod";
import { hasRolePermission } from "@workspace/api-zod";
import { blockStudentJwt } from "../middlewares/auth";
import { diffFields, logActivity } from "../lib/activityLog";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";

const router: IRouter = Router();
const protect = [blockStudentJwt, requireAdminAuth] as const;
const BRANCH_FIELDS = ["name", "address", "googleMapsLink", "isActive"] as const;
const ROOM_FIELDS = ["name", "isActive"] as const;

// Exported for reuse by routes/adminCalendar.ts — the calendar surfaces the
// same schedule location data as the schedule-location lookups below, so it
// reuses this exact "any of schedules/ballet.schedules view|create|edit"
// gate rather than introducing a new permission module.
export function requireScheduleLocationLookup(req: AdminRequest, res: Response, next: NextFunction): void {
  const admin = req.adminUser;
  const allowed = admin?.isSuperAdmin || ["schedules", "ballet.schedules", "room_reservations"].some((module) =>
    ["view", "create", "edit"].some((action) => hasRolePermission(admin?.permissions ?? {}, module, action)),
  );
  if (!admin) { res.status(401).json({ error: "Admin authentication required" }); return; }
  if (!allowed) { res.status(403).json({ error: "Permission denied" }); return; }
  next();
}

function isUniqueViolation(error: unknown): boolean {
  const typed = error as { code?: string; cause?: { code?: string }; driverError?: { code?: string } };
  return typed?.code === "23505" || typed?.cause?.code === "23505" || typed?.driverError?.code === "23505";
}

function cleanOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const branchSelection = {
  id: studioBranchesTable.id,
  name: studioBranchesTable.name,
  code: studioBranchesTable.code,
  address: studioBranchesTable.address,
  googleMapsLink: studioBranchesTable.googleMapsLink,
  isActive: studioBranchesTable.isActive,
  roomCount: sql<number>`(select count(*)::int from ${studioRoomsTable} where ${studioRoomsTable.branchId} = ${studioBranchesTable.id})`,
  createdAt: studioBranchesTable.createdAt,
  updatedAt: studioBranchesTable.updatedAt,
};

router.get("/admin/branches", ...protect, requireAdminPermission("branches", "view"), async (_req, res): Promise<void> => {
  const rows = await db.select(branchSelection).from(studioBranchesTable).orderBy(studioBranchesTable.createdAt);
  res.json(ListAdminBranchesResponse.parse(rows));
});

router.post("/admin/branches", ...protect, requireAdminPermission("branches", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateAdminBranchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const values = {
    name: parsed.data.name.trim(),
    address: cleanOptional(parsed.data.address),
    googleMapsLink: cleanOptional(parsed.data.googleMapsLink),
    isActive: parsed.data.isActive,
  };
  if (!values.name) { res.status(400).json({ error: "Branch name is required" }); return; }
  try {
    const [created] = await db.insert(studioBranchesTable).values(values).returning();
    const row = { ...created, roomCount: 0 };
    await logActivity(req, {
      action: "branch.create", module: "branches", entityType: "studio_branch", entityId: row.id, entityLabel: row.name,
      after: { ...Object.fromEntries(BRANCH_FIELDS.map((key) => [key, row[key]])), branchCode: row.code },
      summary: `Created branch ${row.name} (${row.code})`,
    });
    res.status(201).json(CreateAdminBranchResponse.parse(row));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "A branch with this name already exists" }); return; }
    throw error;
  }
});

router.get("/admin/branches/:id", ...protect, requireAdminPermission("branches", "view"), async (req, res): Promise<void> => {
  const params = GetAdminBranchParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select(branchSelection).from(studioBranchesTable).where(eq(studioBranchesTable.id, params.data.id)).limit(1);
  if (!row) { res.status(404).json({ error: "Branch not found" }); return; }
  res.json(GetAdminBranchResponse.parse(row));
});

router.patch("/admin/branches/:id", ...protect, requireAdminPermission("branches", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateAdminBranchParams.safeParse(req.params);
  const parsed = UpdateAdminBranchBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(studioBranchesTable).where(eq(studioBranchesTable.id, params.data.id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Branch not found" }); return; }
  const updates = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.address !== undefined ? { address: cleanOptional(parsed.data.address) } : {}),
    ...(parsed.data.googleMapsLink !== undefined ? { googleMapsLink: cleanOptional(parsed.data.googleMapsLink) } : {}),
    ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    updatedAt: new Date().toISOString(),
  };
  if ("name" in updates && !updates.name) { res.status(400).json({ error: "Branch name is required" }); return; }
  try {
    await db.update(studioBranchesTable).set(updates).where(eq(studioBranchesTable.id, params.data.id));
    const [row] = await db.select(branchSelection).from(studioBranchesTable).where(eq(studioBranchesTable.id, params.data.id)).limit(1);
    const { before, after } = diffFields(existing, row, BRANCH_FIELDS);
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "branch.update", module: "branches", entityType: "studio_branch", entityId: row.id, entityLabel: row.name,
        before: { ...before, branchCode: row.code }, after: { ...after, branchCode: row.code },
        summary: `Updated branch ${row.name} (${row.code})`,
      });
    }
    res.json(UpdateAdminBranchResponse.parse(row));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "A branch with this name already exists" }); return; }
    throw error;
  }
});

router.get("/admin/branches/:branchId/rooms", ...protect, requireAdminPermission("branches", "view"), async (req, res): Promise<void> => {
  const params = ListAdminBranchRoomsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [branch] = await db.select({ id: studioBranchesTable.id }).from(studioBranchesTable).where(eq(studioBranchesTable.id, params.data.branchId)).limit(1);
  if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
  const rows = await db.select().from(studioRoomsTable).where(eq(studioRoomsTable.branchId, params.data.branchId)).orderBy(studioRoomsTable.createdAt);
  res.json(ListAdminBranchRoomsResponse.parse(rows));
});

router.post("/admin/branches/:branchId/rooms", ...protect, requireAdminPermission("branches", "create"), async (req: AdminRequest, res): Promise<void> => {
  const params = CreateAdminBranchRoomParams.safeParse(req.params);
  const parsed = CreateAdminBranchRoomBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [branch] = await db.select({ id: studioBranchesTable.id, name: studioBranchesTable.name }).from(studioBranchesTable).where(eq(studioBranchesTable.id, params.data.branchId)).limit(1);
  if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
  const name = parsed.data.name.trim();
  if (!name) { res.status(400).json({ error: "Room name is required" }); return; }
  try {
    const [row] = await db.insert(studioRoomsTable).values({ branchId: branch.id, name, isActive: parsed.data.isActive }).returning();
    await logActivity(req, {
      action: "room.create", module: "branches", entityType: "studio_room", entityId: row.id, entityLabel: row.name,
      after: { branchId: branch.id, branchName: branch.name, roomCode: row.code, name: row.name, isActive: row.isActive },
      summary: `Created room ${row.name} (${row.code}) in ${branch.name}`,
    });
    res.status(201).json(CreateAdminBranchRoomResponse.parse(row));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "A room with this name already exists in this branch" }); return; }
    throw error;
  }
});

router.patch("/admin/rooms/:id", ...protect, requireAdminPermission("branches", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const params = UpdateAdminRoomParams.safeParse(req.params);
  const parsed = UpdateAdminRoomBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(studioRoomsTable).where(eq(studioRoomsTable.id, params.data.id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Room not found" }); return; }
  const updates = {
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    updatedAt: new Date().toISOString(),
  };
  if ("name" in updates && !updates.name) { res.status(400).json({ error: "Room name is required" }); return; }
  try {
    const [row] = await db.update(studioRoomsTable).set(updates).where(eq(studioRoomsTable.id, params.data.id)).returning();
    const { before, after } = diffFields(existing, row, ROOM_FIELDS);
    if (Object.keys(after).length > 0) {
      await logActivity(req, {
        action: "room.update", module: "branches", entityType: "studio_room", entityId: row.id, entityLabel: row.name,
        before: { ...before, branchId: row.branchId, roomCode: row.code }, after: { ...after, branchId: row.branchId, roomCode: row.code },
        summary: `Updated room ${row.name} (${row.code})`,
      });
    }
    res.json(UpdateAdminRoomResponse.parse(row));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "A room with this name already exists in this branch" }); return; }
    throw error;
  }
});

router.get("/admin/schedule-location-options/branches", ...protect, requireScheduleLocationLookup, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: studioBranchesTable.id, name: studioBranchesTable.name, code: studioBranchesTable.code,
    address: studioBranchesTable.address, googleMapsLink: studioBranchesTable.googleMapsLink, isActive: studioBranchesTable.isActive,
  }).from(studioBranchesTable).where(eq(studioBranchesTable.isActive, true)).orderBy(studioBranchesTable.name);
  res.json(rows);
});

router.get("/admin/schedule-location-options/branches/:branchId/rooms", ...protect, requireScheduleLocationLookup, async (req, res): Promise<void> => {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) { res.status(400).json({ error: "Invalid Branch ID" }); return; }
  const [branch] = await db.select({ id: studioBranchesTable.id, isActive: studioBranchesTable.isActive }).from(studioBranchesTable).where(eq(studioBranchesTable.id, branchId)).limit(1);
  if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
  if (!branch.isActive) { res.status(422).json({ error: "Branch is inactive" }); return; }
  const rows = await db.select().from(studioRoomsTable).where(and(eq(studioRoomsTable.branchId, branchId), eq(studioRoomsTable.isActive, true))).orderBy(studioRoomsTable.name);
  res.json(rows);
});

export default router;
