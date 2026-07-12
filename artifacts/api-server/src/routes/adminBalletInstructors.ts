/**
 * Admin Ballet Instructors routes — /api/admin/ballet/instructors/*
 *
 * Standalone instructor roster for the Ballet system (independent of the
 * generic `instructors` table). Mirrors the generic instructors route's
 * field set.
 *
 * Routes:
 *   GET   /api/admin/ballet/instructors       — paginated list
 *   POST  /api/admin/ballet/instructors       — create instructor
 *   PATCH /api/admin/ballet/instructors/:id   — update instructor
 */

import { Router, type IRouter } from "express";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, balletInstructorsTable } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_INSTRUCTOR_ACTIVITY_FIELDS = ["name", "bio", "photoUrl", "specialties", "experienceYears", "rating", "isActive", "instagramUrl", "tiktokUrl", "youtubeUrl", "teachingLevel", "achievements", "teachingPhilosophy", "professionalExperience"] as const;

const ListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/instructors", requireAdminAuth, requireAdminPermission("ballet.instructors", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(balletInstructorsTable).orderBy(asc(balletInstructorsTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count(balletInstructorsTable.id) }).from(balletInstructorsTable),
  ]);

  res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

const CreateInstructorBody = z.object({
  name:                   z.string().min(1, "Name is required"),
  bio:                    z.string().optional(),
  photoUrl:               z.string().optional(),
  specialties:            z.array(z.string()).optional(),
  experienceYears:        z.number().int().min(0).optional(),
  rating:                 z.number().optional(),
  isActive:               z.boolean().optional(),
  instagramUrl:           z.string().optional(),
  tiktokUrl:              z.string().optional(),
  youtubeUrl:             z.string().optional(),
  teachingLevel:          z.string().optional(),
  achievements:           z.array(z.string()).optional(),
  teachingPhilosophy:     z.string().optional(),
  professionalExperience: z.array(z.string()).optional(),
});

router.post("/admin/ballet/instructors", requireAdminAuth, requireAdminPermission("ballet.instructors", "create"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  try {
    const [instructor] = await db.insert(balletInstructorsTable).values(parsed.data).returning();
    await logActivity(req, {
      action: "create",
      module: "ballet.instructors",
      entityType: "ballet_instructor",
      entityId: instructor.id,
      entityLabel: instructor.name,
      after: Object.fromEntries(BALLET_INSTRUCTOR_ACTIVITY_FIELDS.map((key) => [key, instructor[key]])),
      summary: `Created ballet instructor ${instructor.name}`,
    });
    res.status(201).json({ instructor });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/instructors failed");
    res.status(500).json({ error: "Failed to create instructor" });
  }
});

const UpdateInstructorBody = CreateInstructorBody.partial();

router.patch("/admin/ballet/instructors/:id", requireAdminAuth, requireAdminPermission("ballet.instructors", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid instructor ID" }); return; }

  const parsed = UpdateInstructorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
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
    const [existing] = await db.select().from(balletInstructorsTable).where(eq(balletInstructorsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Instructor not found" }); return; }
    const [instructor] = await db
      .update(balletInstructorsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletInstructorsTable.id, id))
      .returning();
    if (!instructor) { res.status(404).json({ error: "Instructor not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_INSTRUCTOR_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_INSTRUCTOR_ACTIVITY_FIELDS.map((key) => [key, instructor[key]])),
      BALLET_INSTRUCTOR_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== instructor.isActive ? instructor.isActive ? "activate" : "deactivate" : "update";
      await logActivity(req, {
        action,
        module: "ballet.instructors",
        entityType: "ballet_instructor",
        entityId: instructor.id,
        entityLabel: instructor.name,
        before,
        after,
        summary: action === "activate"
          ? `Activated ballet instructor ${instructor.name}`
          : action === "deactivate"
            ? `Deactivated ballet instructor ${instructor.name}`
            : `Updated ballet instructor ${instructor.name}: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ instructor });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/instructors/:id failed");
    res.status(500).json({ error: "Failed to update instructor" });
  }
});

export default router;
