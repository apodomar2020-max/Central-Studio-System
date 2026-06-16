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

import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletAssessmentSlotsTable,
  balletLevelsTable,
  balletLevelAssignmentsTable,
  systemUsersTable,
  BALLET_APPLICATION_STATUSES,
} from "@workspace/db";
import type { BalletApplicationStatus } from "@workspace/db";
import { requireAdminAuth, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(BALLET_APPLICATION_STATUSES);

function isValidStatus(s: string): s is BalletApplicationStatus {
  return VALID_STATUSES.has(s as BalletApplicationStatus);
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

router.get("/admin/ballet/applications", requireAdminAuth, async (req, res): Promise<void> => {
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

router.get("/admin/ballet/applications/:id", requireAdminAuth, async (req, res): Promise<void> => {
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
      .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status })
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
// Returns all active ballet levels ordered by sortOrder asc.
// Used by the admin UI to populate the level assignment dropdown.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/levels", requireAdminAuth, async (_req, res): Promise<void> => {
  const levels = await db
    .select({
      id:        balletLevelsTable.id,
      name:      balletLevelsTable.name,
      sortOrder: balletLevelsTable.sortOrder,
      isActive:  balletLevelsTable.isActive,
    })
    .from(balletLevelsTable)
    .where(eq(balletLevelsTable.isActive, true))
    .orderBy(asc(balletLevelsTable.sortOrder));

  res.json({ levels });
});

export default router;
