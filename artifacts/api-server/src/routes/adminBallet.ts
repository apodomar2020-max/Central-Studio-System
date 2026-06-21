/**
 * Admin Ballet routes — /api/admin/ballet/*
 *
 * All routes require:
 *   1. requireAuth          (shared API key, applied globally)
 *   2. requireAdminAuth     (X-Admin-Token JWT)
 *
 * Routes:
 *   GET   /api/admin/ballet/applications              — paginated list + filter + search
 *   GET   /api/admin/ballet/applications/:id          — full detail with slot, level, events
 *   PATCH /api/admin/ballet/applications/:id/status   — change status + append event
 *   POST  /api/admin/ballet/applications/:id/assign-level — assign level + update app + event
 */

import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, count, desc, eq, ilike, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletAssessmentSlotsTable,
  balletLevelsTable,
  balletSettingsTable,
  balletLevelAssignmentsTable,
  systemUsersTable,
  notificationsTable,
  BALLET_APPLICATION_STATUSES,
} from "@workspace/db";
import type { BalletApplicationStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(BALLET_APPLICATION_STATUSES);

function isValidStatus(s: string): s is BalletApplicationStatus {
  return VALID_STATUSES.has(s as BalletApplicationStatus);
}

function requireApplicationStatusPermission(req: Request, res: Response, next: NextFunction): void {
  const status = req.body?.status;
  const action = status === "rejected"
    ? "reject"
    : ["accepted", "assignedToLevel", "activeBallet"].includes(status)
      ? "approve"
      : "review";
  requireAdminPermission("ballet.applications", action)(req, res, next);
}

function requireAssessmentSlotUpdatePermission(req: Request, res: Response, next: NextFunction): void {
  const action = req.body?.isActive === false ? "delete" : "edit";
  requireAdminPermission("ballet.assessmentDates", action)(req, res, next);
}

/** Human-readable notification content for each ballet application status change. */
function getStatusNotification(
  status: string,
  childName: string,
): { title: string; body: string } {
  switch (status) {
    case "pendingAssessment":
      return {
        title: "Assessment Scheduled 📅",
        body: `${childName}'s ballet assessment has been scheduled. We'll contact you with the exact date and time.`,
      };
    case "needsFollowUp":
      return {
        title: "Follow-up Required",
        body: `Your application for ${childName} requires some follow-up. Please check the app or contact us for details.`,
      };
    case "accepted":
      return {
        title: "Application Accepted! 🎉",
        body: `Great news! ${childName} has been accepted into the Central Studio Ballet Program.`,
      };
    case "assignedToLevel":
      return {
        title: "Ballet Level Assigned 🩰",
        body: `${childName} has been placed in a ballet level. Check the app for details about classes and schedule.`,
      };
    case "activeBallet":
      return {
        title: "Enrolled in Ballet! ✨",
        body: `${childName} is now an active ballet student at Central Studio. Welcome to the program!`,
      };
    case "rejected":
      return {
        title: "Application Update",
        body: `We've reviewed ${childName}'s application. Unfortunately we're unable to accept it at this time. Contact us for more information.`,
      };
    case "cancelled":
      return {
        title: "Application Cancelled",
        body: `The ballet application for ${childName} has been cancelled. Contact us if you have any questions.`,
      };
    default:
      return {
        title: "Ballet Application Updated",
        body: `The status of ${childName}'s ballet application has been updated.`,
      };
  }
}

// ─── GET /api/admin/ballet/applications ───────────────────────────────────────
//
// Query params:
//   page   (default 1)
//   limit  (default 20, max 100)
//   status (one of the valid statuses, or omit for all)
//   search (searches parent_name, parent_phone, parent_email, child_name)
//
// Returns: { data: BalletApplication[], total, page, limit, totalPages }
// ─────────────────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().optional(),
});

router.get("/admin/ballet/applications", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit, status, search } = parsed.data;
  const offset = (page - 1) * limit;

  // Build WHERE conditions
  const conditions = [];

  if (status) {
    if (!isValidStatus(status)) {
      res.status(400).json({ error: `Invalid status: ${status}` });
      return;
    }
    conditions.push(eq(balletApplicationsTable.status, status));
  }

  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    conditions.push(
      or(
        ilike(balletApplicationsTable.parentName, pattern),
        ilike(balletApplicationsTable.parentPhone, pattern),
        ilike(balletApplicationsTable.parentEmail, pattern),
        ilike(balletApplicationsTable.childName, pattern),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch page + total in parallel
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id:            balletApplicationsTable.id,
        childName:     balletApplicationsTable.childName,
        parentName:    balletApplicationsTable.parentName,
        parentPhone:   balletApplicationsTable.parentPhone,
        parentEmail:   balletApplicationsTable.parentEmail,
        slotId:        balletApplicationsTable.slotId,
        slotLabel:     balletApplicationsTable.slotLabel,
        status:        balletApplicationsTable.status,
        createdAt:     balletApplicationsTable.createdAt,
        assignedLevelId: balletApplicationsTable.assignedLevelId,
      })
      .from(balletApplicationsTable)
      .where(where)
      .orderBy(desc(balletApplicationsTable.createdAt))
      .limit(limit)
      .offset(offset),

    db
      .select({ total: count(balletApplicationsTable.id) })
      .from(balletApplicationsTable)
      .where(where),
  ]);

  res.json({
    data: rows,
    total: Number(total),
    page,
    limit,
    totalPages: Math.ceil(Number(total) / limit),
  });
});

// ─── GET /api/admin/ballet/applications/:id ───────────────────────────────────
//
// Returns the full application record plus:
//   slot      — the assessment slot details (if slotId is set)
//   level     — the assigned level (if assignedLevelId is set)
//   events    — full event history (newest first)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/applications/:id", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

  // Load application
  const [app] = await db
    .select()
    .from(balletApplicationsTable)
    .where(eq(balletApplicationsTable.id, id))
    .limit(1);

  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  // Load slot, assigned level, and events in parallel
  const [slotRows, levelRows, events] = await Promise.all([
    app.slotId
      ? db.select().from(balletAssessmentSlotsTable).where(eq(balletAssessmentSlotsTable.id, app.slotId)).limit(1)
      : Promise.resolve([]),

    app.assignedLevelId
      ? db.select().from(balletLevelsTable).where(eq(balletLevelsTable.id, app.assignedLevelId)).limit(1)
      : Promise.resolve([]),

    db
      .select({
        id:          balletApplicationEventsTable.id,
        fromStatus:  balletApplicationEventsTable.fromStatus,
        toStatus:    balletApplicationEventsTable.toStatus,
        note:        balletApplicationEventsTable.note,
        createdAt:   balletApplicationEventsTable.createdAt,
        changedById: balletApplicationEventsTable.changedById,
        // Resolve admin username for display
        changedByUsername: systemUsersTable.username,
        changedByFullName: systemUsersTable.fullName,
      })
      .from(balletApplicationEventsTable)
      .leftJoin(
        systemUsersTable,
        eq(balletApplicationEventsTable.changedById, systemUsersTable.id),
      )
      .where(eq(balletApplicationEventsTable.applicationId, id))
      .orderBy(desc(balletApplicationEventsTable.createdAt)),
  ]);

  res.json({
    application: app,
    slot:        slotRows[0] ?? null,
    level:       levelRows[0] ?? null,
    events,
  });
});

// ─── PATCH /api/admin/ballet/applications/:id/status ─────────────────────────
//
// Body: { status: BalletApplicationStatus, note?: string }
//
// Updates application.status and inserts a ballet_application_events row.
// Both ops run in a transaction.
// ─────────────────────────────────────────────────────────────────────────────

const UpdateStatusBody = z.object({
  status: z.string().min(1),
  note:   z.string().optional(),
});

router.patch(
  "/admin/ballet/applications/:id/status",
  requireAdminAuth,
  requireApplicationStatusPermission,
  async (req: AdminRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parsed = UpdateStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { status, note } = parsed.data;
    if (!isValidStatus(status)) {
      res.status(400).json({ error: `Invalid status: ${status}. Must be one of: ${BALLET_APPLICATION_STATUSES.join(", ")}` });
      return;
    }

    // Load application (need current status for the event)
    const [app] = await db
      .select({
        id:              balletApplicationsTable.id,
        status:          balletApplicationsTable.status,
        childName:       balletApplicationsTable.childName,
        parentStudentId: balletApplicationsTable.parentStudentId,
      })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, id))
      .limit(1);

    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    const fromStatus = app.status;
    const adminId = req.adminUser?.sub ?? null;

    await db.transaction(async (tx) => {
      await tx
        .update(balletApplicationsTable)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(balletApplicationsTable.id, id));

      await tx.insert(balletApplicationEventsTable).values({
        applicationId: id,
        fromStatus,
        toStatus:    status,
        changedById: adminId,
        note:        note ?? null,
      });
    });

    // Create a per-student notification so the mobile badge updates
    if (app.parentStudentId) {
      const { title, body } = getStatusNotification(status as BalletApplicationStatus, app.childName);
      await db.insert(notificationsTable).values({
        title,
        body,
        target:   `student:${app.parentStudentId}`,
        isDraft:  false,
        sentAt:   new Date().toISOString(),
      });
    }

    logger.info({ applicationId: id, fromStatus, toStatus: status, adminId }, "Ballet application status updated");

    res.json({ success: true, status });
  },
);

// ─── POST /api/admin/ballet/applications/:id/assign-level ────────────────────
//
// Body: { levelId: number, note?: string }
//
// Validates the level exists and is active.
// Creates a ballet_level_assignments row, updates the application record,
// and appends an event — all in one transaction.
// ─────────────────────────────────────────────────────────────────────────────

const AssignLevelBody = z.object({
  levelId: z.number({ required_error: "levelId is required" }).int().positive(),
  note:    z.string().optional(),
});

router.post(
  "/admin/ballet/applications/:id/assign-level",
  requireAdminAuth,
  requireAdminPermission("ballet.applications", "approve"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parsed = AssignLevelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { levelId, note } = parsed.data;
    const adminId = req.adminUser?.sub ?? null;

    // Load application
    const [app] = await db
      .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, childId: balletApplicationsTable.childId })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, id))
      .limit(1);

    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    // Validate level
    const [level] = await db
      .select({ id: balletLevelsTable.id, name: balletLevelsTable.name, isActive: balletLevelsTable.isActive })
      .from(balletLevelsTable)
      .where(eq(balletLevelsTable.id, levelId))
      .limit(1);

    if (!level) { res.status(404).json({ error: "Level not found" }); return; }
    if (!level.isActive) { res.status(422).json({ error: `Level "${level.name}" is inactive and cannot be assigned` }); return; }

    const fromStatus = app.status;
    const now = new Date().toISOString();

    const assignment = await db.transaction(async (tx) => {
      // Create level assignment row
      const [newAssignment] = await tx
        .insert(balletLevelAssignmentsTable)
        .values({
          applicationId: id,
          childId:       app.childId ?? null,
          levelId,
          enrolledAt:    now,
          status:        "active",
          notes:         note ?? null,
        })
        .returning({ id: balletLevelAssignmentsTable.id });

      // Update application: set assigned level, assignedAt, status
      await tx
        .update(balletApplicationsTable)
        .set({
          assignedLevelId: levelId,
          assignedAt:      now,
          status:          "assignedToLevel",
          updatedAt:       now,
        })
        .where(eq(balletApplicationsTable.id, id));

      // Append event
      await tx.insert(balletApplicationEventsTable).values({
        applicationId: id,
        fromStatus,
        toStatus:      "assignedToLevel",
        changedById:   adminId,
        note:          note ? `Assigned to ${level.name}. ${note}` : `Assigned to ${level.name}`,
      });

      return newAssignment;
    });

    logger.info({ applicationId: id, levelId, levelName: level.name, adminId }, "Ballet level assigned");

    res.status(201).json({ success: true, assignmentId: assignment.id, levelName: level.name });
  },
);

// ─── GET /api/admin/ballet/levels ─────────────────────────────────────────────
//
// Returns ALL ballet levels (active and inactive) ordered by sortOrder asc.
// Used by the Levels management page and the level assignment dropdown.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/levels", requireAdminAuth, requireAdminPermission("ballet.levels", "view"), async (_req, res): Promise<void> => {
  const levels = await db
    .select({
      id:        balletLevelsTable.id,
      name:      balletLevelsTable.name,
      sortOrder: balletLevelsTable.sortOrder,
      isActive:  balletLevelsTable.isActive,
      createdAt: balletLevelsTable.createdAt,
    })
    .from(balletLevelsTable)
    .orderBy(asc(balletLevelsTable.sortOrder));

  res.json({ levels });
});

// ─── POST /api/admin/ballet/levels ────────────────────────────────────────────

const CreateLevelBody = z.object({
  name:      z.string().min(1, "Name is required"),
  sortOrder: z.number().int().min(0).optional(),
  isActive:  z.boolean().optional(),
});

router.post("/admin/ballet/levels", requireAdminAuth, requireAdminPermission("ballet.levels", "edit"), async (req, res): Promise<void> => {
  const parsed = CreateLevelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const { name, sortOrder, isActive } = parsed.data;
  try {
    const [level] = await db
      .insert(balletLevelsTable)
      .values({ name: name.trim(), sortOrder: sortOrder ?? 0, isActive: isActive ?? true })
      .returning();
    res.status(201).json({ level });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: `A level named "${name}" already exists` });
      return;
    }
    logger.error({ err }, "POST /admin/ballet/levels failed");
    res.status(500).json({ error: "Failed to create level" });
  }
});

// ─── PATCH /api/admin/ballet/levels/:id ───────────────────────────────────────

const UpdateLevelBody = z.object({
  name:      z.string().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive:  z.boolean().optional(),
});

router.patch("/admin/ballet/levels/:id", requireAdminAuth, requireAdminPermission("ballet.levels", "edit"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid level ID" }); return; }

  const parsed = UpdateLevelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name      !== undefined) updates["name"]      = parsed.data.name.trim();
  if (parsed.data.sortOrder !== undefined) updates["sortOrder"] = parsed.data.sortOrder;
  if (parsed.data.isActive  !== undefined) updates["isActive"]  = parsed.data.isActive;

  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  try {
    const [level] = await db
      .update(balletLevelsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletLevelsTable.id, id))
      .returning();
    if (!level) { res.status(404).json({ error: "Level not found" }); return; }
    res.json({ level });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A level with that name already exists" });
      return;
    }
    logger.error({ err }, "PATCH /admin/ballet/levels/:id failed");
    res.status(500).json({ error: "Failed to update level" });
  }
});

// ─── GET /api/admin/ballet/slots ──────────────────────────────────────────────
//
// Returns all assessment slots (past and future) with live booked count.
// Ordered by date asc, startTime asc.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/slots", requireAdminAuth, requireAdminPermission("ballet.assessmentDates", "view"), async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id:          balletAssessmentSlotsTable.id,
        date:        balletAssessmentSlotsTable.date,
        startTime:   balletAssessmentSlotsTable.startTime,
        endTime:     balletAssessmentSlotsTable.endTime,
        capacity:    balletAssessmentSlotsTable.capacity,
        notes:       balletAssessmentSlotsTable.notes,
        isActive:    balletAssessmentSlotsTable.isActive,
        createdAt:   balletAssessmentSlotsTable.createdAt,
        bookedCount: count(balletApplicationsTable.id),
      })
      .from(balletAssessmentSlotsTable)
      .leftJoin(
        balletApplicationsTable,
        and(
          eq(balletApplicationsTable.slotId, balletAssessmentSlotsTable.id),
          not(eq(balletApplicationsTable.status, "cancelled")),
        ),
      )
      .groupBy(balletAssessmentSlotsTable.id)
      .orderBy(asc(balletAssessmentSlotsTable.date), asc(balletAssessmentSlotsTable.startTime));

    res.json({ slots: rows.map((r) => ({ ...r, bookedCount: Number(r.bookedCount) })) });
  } catch (err) {
    logger.error({ err }, "GET /admin/ballet/slots failed");
    res.status(500).json({ error: "Failed to load slots" });
  }
});

// ─── POST /api/admin/ballet/slots ─────────────────────────────────────────────

const CreateSlotBody = z.object({
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  startTime: z.string().min(1, "startTime is required"),
  endTime:   z.string().min(1, "endTime is required"),
  capacity:  z.number().int().positive().default(10),
  notes:     z.string().nullable().optional(),   // nullable so frontend can send null for "no notes"
  isActive:  z.boolean().optional(),
});

router.post("/admin/ballet/slots", requireAdminAuth, requireAdminPermission("ballet.assessmentDates", "create"), async (req, res): Promise<void> => {
  const parsed = CreateSlotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  try {
    const [slot] = await db
      .insert(balletAssessmentSlotsTable)
      .values({
        date:      parsed.data.date,
        startTime: parsed.data.startTime,
        endTime:   parsed.data.endTime,
        capacity:  parsed.data.capacity,
        notes:     parsed.data.notes ?? null,
        isActive:  parsed.data.isActive ?? true,
      })
      .returning();
    res.status(201).json({ slot });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/slots failed");
    res.status(500).json({ error: "Failed to create slot" });
  }
});

// ─── PATCH /api/admin/ballet/slots/:id ────────────────────────────────────────

const UpdateSlotBody = z.object({
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().min(1).optional(),
  endTime:   z.string().min(1).optional(),
  capacity:  z.number().int().positive().optional(),
  notes:     z.string().nullable().optional(),
  isActive:  z.boolean().optional(),
});

router.patch("/admin/ballet/slots/:id", requireAdminAuth, requireAssessmentSlotUpdatePermission, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid slot ID" }); return; }

  const parsed = UpdateSlotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  const d = parsed.data;
  if (d.date      !== undefined) updates["date"]      = d.date;
  if (d.startTime !== undefined) updates["startTime"] = d.startTime;
  if (d.endTime   !== undefined) updates["endTime"]   = d.endTime;
  if (d.capacity  !== undefined) updates["capacity"]  = d.capacity;
  if (d.notes     !== undefined) updates["notes"]     = d.notes;
  if (d.isActive  !== undefined) updates["isActive"]  = d.isActive;

  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  updates["updatedAt"] = new Date().toISOString();

  try {
    const [slot] = await db
      .update(balletAssessmentSlotsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletAssessmentSlotsTable.id, id))
      .returning();
    if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
    res.json({ slot });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/slots/:id failed");
    res.status(500).json({ error: "Failed to update slot" });
  }
});

// ─── GET /api/admin/ballet/settings ───────────────────────────────────────────

router.get("/admin/ballet/settings", requireAdminAuth, requireAdminPermission("ballet.pricing", "view"), async (_req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(balletSettingsTable).where(eq(balletSettingsTable.id, 1)).limit(1);
    if (!row) { res.status(404).json({ error: "Settings not found" }); return; }
    res.json({ settings: row });
  } catch (err) {
    logger.error({ err }, "GET /admin/ballet/settings failed");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// ─── PATCH /api/admin/ballet/settings ─────────────────────────────────────────

const UpdateSettingsBody = z.object({
  preBalletPriceEgp:         z.number().int().positive().optional(),
  preBalletHoursMonthly:     z.number().int().positive().optional(),
  levelsPriceEgp:            z.number().int().positive().optional(),
  levelsHoursMonthly:        z.number().int().positive().optional(),
  fewSeatsThreshold:         z.number().int().min(1).max(20).optional(),
  assessmentInstructions:    z.string().nullable().optional(),
  requirements:              z.string().nullable().optional(),
  acceptanceMessageTemplate: z.string().nullable().optional(),
});

router.patch("/admin/ballet/settings", requireAdminAuth, requireAdminPermission("ballet.pricing", "edit"), async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) updates[k] = v;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [row] = await db
      .update(balletSettingsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletSettingsTable.id, 1))
      .returning();
    if (!row) { res.status(404).json({ error: "Settings not found" }); return; }
    res.json({ settings: row });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/settings failed");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
