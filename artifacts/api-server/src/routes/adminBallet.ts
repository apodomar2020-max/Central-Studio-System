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
import { and, asc, count, desc, eq, ilike, inArray, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletAssessmentSlotsTable,
  balletLevelsTable,
  balletSettingsTable,
  balletLevelAssignmentsTable,
  balletGroupsTable,
  balletPaymentsTable,
  systemUsersTable,
  notificationsTable,
  BALLET_APPLICATION_STATUSES,
} from "@workspace/db";
import type { BalletApplicationStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";

const router: IRouter = Router();
const BALLET_LEVEL_ACTIVITY_FIELDS = ["name", "sortOrder", "isActive"] as const;
const BALLET_SLOT_ACTIVITY_FIELDS = ["date", "startTime", "endTime", "capacity", "notes", "isActive"] as const;
const BALLET_SETTINGS_ACTIVITY_FIELDS = ["preBalletPriceEgp", "preBalletHoursMonthly", "levelsPriceEgp", "levelsHoursMonthly", "fewSeatsThreshold", "assessmentInstructions", "requirements", "acceptanceMessageTemplate"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(BALLET_APPLICATION_STATUSES);

function isValidStatus(s: string): s is BalletApplicationStatus {
  return VALID_STATUSES.has(s as BalletApplicationStatus);
}

// ── Status-transition whitelist (Phase A / P0-2a) ───────────────────────────
//
// Only the (fromStatus → toStatus) pairs listed below are permitted. Any
// pair not present here — including a same-status no-op like
// pending → pending — is rejected with 422 by PATCH .../status below. There
// is no special-casing: an excluded pair simply isn't in the allow-list.
//
// Four transitions are DELIBERATELY EXCLUDED pending an unresolved product
// decision from the human architect (see the Phase A / P0-2a backlog item's
// STOP CONDITION — do not add these without an explicit decision):
//   - accepted        → rejected
//   - assignedToLevel → rejected
//   - active          → cancelled
//   - any same-status no-op (e.g. pending → pending, active → active, ...)
//
// assignedToLevel → active is approved, but is never a "free" manual flip —
// PATCH .../status additionally runs the three-part activation gate
// (assignedLevelId set, the active assignment's groupId set, a paid
// ballet_payments row on file) whenever the target status is "active",
// regardless of which approved fromStatus led here.
const BALLET_STATUS_TRANSITIONS: Readonly<Record<BalletApplicationStatus, readonly BalletApplicationStatus[]>> = {
  pending:         ["accepted", "rejected", "needsFollowUp", "cancelled"],
  needsFollowUp:   ["accepted", "rejected", "cancelled"],
  accepted:        ["cancelled"],
  assignedToLevel: ["active"],
  active:          [],
  rejected:        [],
  cancelled:       [],
};

function isTransitionAllowed(from: BalletApplicationStatus, to: BalletApplicationStatus): boolean {
  return BALLET_STATUS_TRANSITIONS[from].includes(to);
}

function requireApplicationStatusPermission(req: Request, res: Response, next: NextFunction): void {
  const status = req.body?.status;
  const action = status === "rejected"
    ? "reject"
    : ["accepted", "assignedToLevel", "active"].includes(status)
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
    case "pending":
      return {
        title: "Application Received",
        body: `We've received ${childName}'s ballet application. We'll be in touch with next steps soon.`,
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
    case "active":
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
//   page    (default 1)
//   limit   (default 20, max 100)
//   status  (one of the valid statuses, or omit for all)
//   search  (searches parent_name, parent_phone, parent_email, child_name,
//            and assigned ballet level name)
//   levelId (Phase 4A: filter by assigned ballet level)
//
// Returns: { data: BalletApplication[], total, page, limit, totalPages }
// Each row also carries `levelName` (assigned level name, or null).
// ─────────────────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  status:  z.string().optional(),
  search:  z.string().optional(),
  levelId: z.coerce.number().int().positive().optional(),
});

router.get("/admin/ballet/applications", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit, status, search, levelId } = parsed.data;
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

  if (levelId != null) {
    conditions.push(eq(balletApplicationsTable.assignedLevelId, levelId));
  }

  if (search && search.trim().length > 0) {
    const pattern = `%${search.trim()}%`;
    // Level-name search: resolve matching level ids first so the main query
    // shape (no join) stays identical — levels are a tiny table.
    const matchingLevels = await db
      .select({ id: balletLevelsTable.id })
      .from(balletLevelsTable)
      .where(ilike(balletLevelsTable.name, pattern));
    const searchClauses = [
      ilike(balletApplicationsTable.parentName, pattern),
      ilike(balletApplicationsTable.parentPhone, pattern),
      ilike(balletApplicationsTable.parentEmail, pattern),
      ilike(balletApplicationsTable.childName, pattern),
    ];
    if (matchingLevels.length > 0) {
      searchClauses.push(
        inArray(
          balletApplicationsTable.assignedLevelId,
          matchingLevels.map((level) => level.id),
        ),
      );
    }
    conditions.push(or(...searchClauses));
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
        updatedAt:     balletApplicationsTable.updatedAt,
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

  // Enrich rows with the assigned level name (one small lookup, no join —
  // keeps the paginated query untouched).
  const levelIds = [...new Set(rows.map((r) => r.assignedLevelId).filter((id): id is number => id != null))];
  const levelNameById = new Map<number, string>();
  if (levelIds.length > 0) {
    const levels = await db
      .select({ id: balletLevelsTable.id, name: balletLevelsTable.name })
      .from(balletLevelsTable)
      .where(inArray(balletLevelsTable.id, levelIds));
    for (const level of levels) levelNameById.set(level.id, level.name);
  }

  // Enrich rows with the current payment status (A1). An application can have
  // more than one ballet_payments row — surface the most recently updated
  // one's status for the list view. Batched lookup, ordered oldest→newest so
  // the last write into the Map per applicationId wins (= most recent).
  const applicationIds = rows.map((r) => r.id);
  const paymentStatusByApplicationId = new Map<number, string>();
  if (applicationIds.length > 0) {
    const payments = await db
      .select({
        applicationId: balletPaymentsTable.applicationId,
        status:        balletPaymentsTable.status,
      })
      .from(balletPaymentsTable)
      .where(inArray(balletPaymentsTable.applicationId, applicationIds))
      .orderBy(asc(balletPaymentsTable.updatedAt));
    for (const p of payments) paymentStatusByApplicationId.set(p.applicationId, p.status);
  }

  res.json({
    data: rows.map((row) => ({
      ...row,
      levelName: row.assignedLevelId != null ? levelNameById.get(row.assignedLevelId) ?? null : null,
      paymentStatus: paymentStatusByApplicationId.get(row.id) ?? null,
    })),
    total: Number(total),
    page,
    limit,
    totalPages: Math.ceil(Number(total) / limit),
  });
});

// ─── GET /api/admin/ballet/applications/:id ───────────────────────────────────
//
// Returns the full application record plus:
//   slot          — the assessment slot details (if slotId is set)
//   level         — the assigned level (if assignedLevelId is set)
//   group         — the assigned group on the current active level
//                   assignment (Phase 4E), or null if none set yet
//   assignmentId  — id of that active ballet_level_assignments row, or null
//   events        — full event history (newest first)
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

  // Load slot, assigned level, active level assignment, and events in parallel
  const [slotRows, levelRows, assignmentRows, events] = await Promise.all([
    app.slotId
      ? db.select().from(balletAssessmentSlotsTable).where(eq(balletAssessmentSlotsTable.id, app.slotId)).limit(1)
      : Promise.resolve([]),

    app.assignedLevelId
      ? db.select().from(balletLevelsTable).where(eq(balletLevelsTable.id, app.assignedLevelId)).limit(1)
      : Promise.resolve([]),

    db
      .select({ id: balletLevelAssignmentsTable.id, groupId: balletLevelAssignmentsTable.groupId })
      .from(balletLevelAssignmentsTable)
      .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
      .orderBy(desc(balletLevelAssignmentsTable.id))
      .limit(1),

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

  const activeAssignment = assignmentRows[0] ?? null;
  const groupRows = activeAssignment?.groupId != null
    ? await db.select({ id: balletGroupsTable.id, name: balletGroupsTable.name }).from(balletGroupsTable).where(eq(balletGroupsTable.id, activeAssignment.groupId)).limit(1)
    : [];

  // Payments (A1) — return the full history (newest first, don't collapse it)
  // plus a clear pointer to the most recently updated "current" one for the
  // list-parity header display.
  const payments = await db
    .select()
    .from(balletPaymentsTable)
    .where(eq(balletPaymentsTable.applicationId, id))
    .orderBy(desc(balletPaymentsTable.updatedAt));

  res.json({
    application:  app,
    slot:         slotRows[0] ?? null,
    level:        levelRows[0] ?? null,
    group:        groupRows[0] ?? null,
    assignmentId: activeAssignment?.id ?? null,
    events,
    payments,
    currentPayment: payments[0] ?? null,
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
        assignedLevelId: balletApplicationsTable.assignedLevelId,
      })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, id))
      .limit(1);

    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    const fromStatus = app.status as BalletApplicationStatus;

    // ── Status-transition whitelist ─────────────────────────────────────────
    // See BALLET_STATUS_TRANSITIONS above for the full allow-list and the
    // four transitions currently excluded pending a human decision.
    if (!isTransitionAllowed(fromStatus, status)) {
      res.status(422).json({
        error: `Cannot change status from "${fromStatus}" to "${status}" — this transition is not permitted.`,
      });
      return;
    }

    // ── Activation gate ─────────────────────────────────────────────────────
    // Only applies when the TARGET status is exactly "active" — no other
    // transition is affected.
    if (status === "active") {
      if (app.assignedLevelId == null) {
        res.status(422).json({ error: "Cannot activate: no level assigned yet." });
        return;
      }

      const [activeAssignment] = await db
        .select({ id: balletLevelAssignmentsTable.id, groupId: balletLevelAssignmentsTable.groupId })
        .from(balletLevelAssignmentsTable)
        .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
        .orderBy(desc(balletLevelAssignmentsTable.id))
        .limit(1);

      if (!activeAssignment || activeAssignment.groupId == null) {
        res.status(422).json({ error: "Cannot activate: assign a group first." });
        return;
      }

      // Match on applicationId only — levelAssignmentId is optional/nullable
      // on ballet_payments, so not every paid row is guaranteed to carry it.
      // A payment row's status is either "paid" or "refunded", never both, so
      // this alone correctly handles the multi-payment case: one refunded
      // row never blocks activation if a separate row is genuinely "paid".
      const [paidPayment] = await db
        .select({ id: balletPaymentsTable.id })
        .from(balletPaymentsTable)
        .where(and(eq(balletPaymentsTable.applicationId, id), eq(balletPaymentsTable.status, "paid")))
        .limit(1);

      if (!paidPayment) {
        res.status(422).json({ error: "Cannot activate: no paid payment on file for this application." });
        return;
      }
    }

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
    if (fromStatus !== status) {
      await logActivity(req, {
        action: "statusChange",
        module: "ballet.applications",
        entityType: "ballet_application",
        entityId: id,
        entityLabel: app.childName,
        before: { status: fromStatus },
        after: { status, note: note ?? null },
        summary: `Changed ballet application status for ${app.childName} from ${fromStatus} to ${status}`,
      });
    }

    res.json({ success: true, status });
  },
);

// ─── POST /api/admin/ballet/applications/:id/assign-level ────────────────────
//
// Body: { levelId: number, note?: string }
//
// Validates the level exists and is active.
//
// Guarantees at most one ballet_level_assignments row with status="active"
// per application:
//   - No existing row at all              → insert a new one (groupId null).
//   - Most recent row's status = "active" → UPDATE it in place (levelId
//     changes, groupId is cleared since the level changed and the group must
//     be re-picked).
//   - Most recent row's status is anything else (withdrawn/graduated/paused)
//     → that row is historical and is NEVER touched or reused (this matters
//     most for "withdrawn" — a prior refund's history must never be
//     silently overwritten). Insert a brand new row instead.
// Updates the application record and appends an event — all in one
// transaction.
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

    const { assignment, supersededExistingAssignment } = await db.transaction(async (tx) => {
      // Find the most recent assignment row for this application (if any).
      const [mostRecent] = await tx
        .select({ id: balletLevelAssignmentsTable.id, status: balletLevelAssignmentsTable.status })
        .from(balletLevelAssignmentsTable)
        .where(eq(balletLevelAssignmentsTable.applicationId, id))
        .orderBy(desc(balletLevelAssignmentsTable.id))
        .limit(1);

      let assignmentRow: { id: number };
      let superseded = false;

      if (mostRecent && mostRecent.status === "active") {
        // Supersede the existing active row in place — level changed, so the
        // group must be re-picked (cleared here).
        const [updated] = await tx
          .update(balletLevelAssignmentsTable)
          .set({
            levelId,
            groupId:    null,
            enrolledAt: now,
            notes:      note ?? null,
            updatedAt:  now,
          })
          .where(eq(balletLevelAssignmentsTable.id, mostRecent.id))
          .returning({ id: balletLevelAssignmentsTable.id });
        assignmentRow = updated;
        superseded = true;
      } else {
        // No assignment yet, or the most recent one is historical
        // (withdrawn/graduated/paused) — never touch that row.
        const [inserted] = await tx
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
        assignmentRow = inserted;
      }

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

      return { assignment: assignmentRow, supersededExistingAssignment: superseded };
    });

    logger.info({ applicationId: id, levelId, levelName: level.name, adminId, supersededExistingAssignment }, "Ballet level assigned");
    await logActivity(req, {
      action: "assignLevel",
      module: "ballet.applications",
      entityType: "ballet_application",
      entityId: id,
      entityLabel: level.name,
      before: { status: fromStatus },
      after: {
        status: "assignedToLevel",
        assignedLevelId: levelId,
        levelName: level.name,
        assignmentId: assignment.id,
        supersededExistingAssignment,
      },
      summary: `Assigned ballet application ${id} to ${level.name}`,
    });

    res.status(201).json({ success: true, assignmentId: assignment.id, levelName: level.name });
  },
);

// ─── POST /api/admin/ballet/applications/:id/assign-group ────────────────────
//
// Body: { groupId: number, note?: string }
//
// Requires an existing status="active" ballet_level_assignments row for this
// application (i.e. a level must already be assigned) — 422 if none exists.
// Validates the group exists, is active, and belongs to the same level as
// the current assignment. Updates that assignment row's groupId; does NOT
// change the application's status. Calling again with a different groupId
// reassigns (updates the same row again).
//
// Phase A / P0-6: if the group has a non-null capacity, the count of OTHER
// status="active" ballet_level_assignments rows already pointed at it is
// checked (under a row lock on the group, taken before the count) and the
// request is rejected with 422 if assigning would exceed it. Re-saving an
// assignment that already points at this same group never counts against
// its own slot, so a same-group no-op update can't spuriously fail at exact
// capacity.
// ─────────────────────────────────────────────────────────────────────────────

const AssignGroupBody = z.object({
  groupId: z.number({ required_error: "groupId is required" }).int().positive(),
  note:    z.string().optional(),
});

router.post(
  "/admin/ballet/applications/:id/assign-group",
  requireAdminAuth,
  requireAdminPermission("ballet.applications", "approve"),
  async (req: AdminRequest, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

    const parsed = AssignGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const { groupId, note } = parsed.data;
    const adminId = req.adminUser?.sub ?? null;

    // Load application
    const [app] = await db
      .select({ id: balletApplicationsTable.id, status: balletApplicationsTable.status, childName: balletApplicationsTable.childName })
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, id))
      .limit(1);

    if (!app) { res.status(404).json({ error: "Application not found" }); return; }

    // Find the current active level assignment — never set a group on a
    // withdrawn/graduated/paused row.
    const [assignment] = await db
      .select({ id: balletLevelAssignmentsTable.id, levelId: balletLevelAssignmentsTable.levelId, groupId: balletLevelAssignmentsTable.groupId })
      .from(balletLevelAssignmentsTable)
      .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
      .orderBy(desc(balletLevelAssignmentsTable.id))
      .limit(1);

    if (!assignment) {
      res.status(422).json({ error: "No active level assignment — assign a level first." });
      return;
    }

    // Validate group
    const [group] = await db
      .select({ id: balletGroupsTable.id, name: balletGroupsTable.name, levelId: balletGroupsTable.levelId, isActive: balletGroupsTable.isActive })
      .from(balletGroupsTable)
      .where(eq(balletGroupsTable.id, groupId))
      .limit(1);

    if (!group) { res.status(404).json({ error: "Group not found" }); return; }
    if (!group.isActive) { res.status(422).json({ error: `Group "${group.name}" is inactive and cannot be assigned` }); return; }
    if (group.levelId !== assignment.levelId) {
      res.status(422).json({ error: `Group "${group.name}" belongs to a different level than this application's assigned level.` });
      return;
    }

    const previousGroupId = assignment.groupId;
    const isReassignment = previousGroupId != null;
    const isSameGroupNoOp = previousGroupId === groupId;
    const now = new Date().toISOString();

    try {
      await db.transaction(async (tx) => {
        // Phase A / P0-6: lock the target group row for the lifetime of this
        // check+update so two concurrent assign-group calls against the same
        // group serialize on the capacity count below instead of both
        // reading the same pre-update count and both passing it.
        const [lockedGroup] = await tx
          .select({ id: balletGroupsTable.id, capacity: balletGroupsTable.capacity })
          .from(balletGroupsTable)
          .where(eq(balletGroupsTable.id, groupId))
          .limit(1)
          .for("update");

        if (lockedGroup?.capacity != null) {
          const [{ activeCount }] = await tx
            .select({ activeCount: count(balletLevelAssignmentsTable.id) })
            .from(balletLevelAssignmentsTable)
            .where(and(
              eq(balletLevelAssignmentsTable.groupId, groupId),
              eq(balletLevelAssignmentsTable.status, "active"),
            ));

          // If this exact assignment is already pointed at this exact group,
          // it's already counted in activeCount above — exclude it so a
          // same-group no-op update isn't spuriously rejected at exact
          // capacity (re-saving an already-assigned student must never fail).
          const effectiveCount = isSameGroupNoOp ? Number(activeCount) - 1 : Number(activeCount);

          if (effectiveCount >= lockedGroup.capacity) {
            throw Object.assign(
              new Error(`Group "${group.name}" is at capacity (${lockedGroup.capacity}) and cannot accept another student.`),
              { status: 422 },
            );
          }
        }

        await tx
          .update(balletLevelAssignmentsTable)
          .set({ groupId, updatedAt: now })
          .where(eq(balletLevelAssignmentsTable.id, assignment.id));

        // Group assignment doesn't change application status — fromStatus and
        // toStatus are both the application's current status.
        await tx.insert(balletApplicationEventsTable).values({
          applicationId: id,
          fromStatus:    app.status,
          toStatus:      app.status,
          changedById:   adminId,
          note: note
            ? `${isReassignment ? "Reassigned" : "Assigned"} to group: ${group.name}. ${note}`
            : `${isReassignment ? "Reassigned" : "Assigned"} to group: ${group.name}`,
        });
      });
    } catch (err: unknown) {
      const typed = err as { status?: number; message?: string };
      if (typed.status === 422) {
        res.status(422).json({ error: typed.message });
        return;
      }
      logger.error({ err, applicationId: id, groupId }, "POST /admin/ballet/applications/:id/assign-group failed");
      res.status(500).json({ error: "Failed to assign group" });
      return;
    }

    logger.info({ applicationId: id, groupId, groupName: group.name, adminId, isReassignment }, "Ballet group assigned");
    await logActivity(req, {
      action: isReassignment ? "reassignGroup" : "assignGroup",
      module: "ballet.applications",
      entityType: "ballet_application",
      entityId: id,
      entityLabel: group.name,
      before: { groupId: previousGroupId },
      after: { groupId, groupName: group.name, assignmentId: assignment.id },
      summary: `${isReassignment ? "Reassigned" : "Assigned"} ballet application ${id} to group ${group.name}`,
    });

    res.status(201).json({ success: true, assignmentId: assignment.id, groupName: group.name });
  },
);

// ─── GET /api/admin/ballet/students ───────────────────────────────────────────
//
// Phase B / A5: the enrolled-students roster. A "student" is an application
// whose status is exactly "active". Per the three-part activation gate in
// PATCH .../status (assignedLevelId set, active assignment's groupId set, a
// paid ballet_payments row on file), an application cannot reach "active"
// without an assigned level, an assigned group, and a paid payment — so
// status = "active" is the ONLY filter needed here; no extra level/group/
// payment condition is required (confirmed against that handler above).
//
// Columns (matching the original spec): Student Name, Date Joined, Parent
// Name, Age, Level, Group. "Date Joined" = the current active
// ballet_level_assignments row's enrolledAt (closest match to "became a
// student"), NOT the application's createdAt — judgment call, per A5.
//
// Reuses the ballet.applications "view" permission (no new permission module)
// and the same pagination conventions as the applications list.
// ─────────────────────────────────────────────────────────────────────────────

const StudentsListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/admin/ballet/students", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = StudentsListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  // Active applications joined to their single active level assignment (at
  // most one per application, guaranteed by the assign-level logic) — which
  // carries enrolledAt (Date Joined), the level, and the group. leftJoins on
  // level/group name are defensive: the activation gate guarantees both are
  // present for an active row, but a null renders as an empty cell rather
  // than dropping the student.
  const where = eq(balletApplicationsTable.status, "active");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        applicationId: balletApplicationsTable.id,
        studentName:   balletApplicationsTable.childName,
        parentName:    balletApplicationsTable.parentName,
        age:           balletApplicationsTable.childAge,
        dateJoined:    balletLevelAssignmentsTable.enrolledAt,
        levelId:       balletLevelsTable.id,
        levelName:     balletLevelsTable.name,
        groupId:       balletGroupsTable.id,
        groupName:     balletGroupsTable.name,
      })
      .from(balletApplicationsTable)
      .leftJoin(
        balletLevelAssignmentsTable,
        and(
          eq(balletLevelAssignmentsTable.applicationId, balletApplicationsTable.id),
          eq(balletLevelAssignmentsTable.status, "active"),
        ),
      )
      .leftJoin(balletLevelsTable, eq(balletLevelsTable.id, balletLevelAssignmentsTable.levelId))
      .leftJoin(balletGroupsTable, eq(balletGroupsTable.id, balletLevelAssignmentsTable.groupId))
      .where(where)
      .orderBy(desc(balletLevelAssignmentsTable.enrolledAt))
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

// ─── GET /api/admin/ballet/levels ─────────────────────────────────────────────
//
// Returns ALL ballet levels (active and inactive) ordered by sortOrder asc.
// Used by the Levels management page and the level assignment dropdown.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/levels", requireAdminAuth, requireAdminPermission("ballet.levels", "view"), async (_req, res): Promise<void> => {
  const levels = await db
    .select({
      id:           balletLevelsTable.id,
      name:         balletLevelsTable.name,
      sortOrder:    balletLevelsTable.sortOrder,
      isActive:     balletLevelsTable.isActive,
      description:  balletLevelsTable.description,
      requirements: balletLevelsTable.requirements,
      ageMin:       balletLevelsTable.ageMin,
      ageMax:       balletLevelsTable.ageMax,
      createdAt:    balletLevelsTable.createdAt,
    })
    .from(balletLevelsTable)
    .orderBy(asc(balletLevelsTable.sortOrder));

  res.json({ levels });
});

// ─── POST /api/admin/ballet/levels ────────────────────────────────────────────

const CreateLevelBody = z.object({
  name:         z.string().min(1, "Name is required"),
  sortOrder:    z.number().int().min(0).optional(),
  isActive:     z.boolean().optional(),
  description:  z.string().optional(),
  requirements: z.string().optional(),
  ageMin:       z.number().int().min(4).max(14).optional(),
  ageMax:       z.number().int().min(4).max(14).optional(),
});

router.post("/admin/ballet/levels", requireAdminAuth, requireAdminPermission("ballet.levels", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateLevelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const { name, sortOrder, isActive, description, requirements, ageMin, ageMax } = parsed.data;
  try {
    const [level] = await db
      .insert(balletLevelsTable)
      .values({
        name: name.trim(),
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? true,
        description:  description ?? null,
        requirements: requirements ?? null,
        ageMin:       ageMin ?? null,
        ageMax:       ageMax ?? null,
      })
      .returning();
    await logActivity(req, {
      action: "create",
      module: "ballet.levels",
      entityType: "ballet_level",
      entityId: level.id,
      entityLabel: level.name,
      after: Object.fromEntries(BALLET_LEVEL_ACTIVITY_FIELDS.map((key) => [key, level[key]])),
      summary: `Created ballet level ${level.name}`,
    });
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
  name:         z.string().min(1).optional(),
  sortOrder:    z.number().int().min(0).optional(),
  isActive:     z.boolean().optional(),
  description:  z.string().optional(),
  requirements: z.string().optional(),
  ageMin:       z.number().int().min(4).max(14).optional(),
  ageMax:       z.number().int().min(4).max(14).optional(),
});

router.patch("/admin/ballet/levels/:id", requireAdminAuth, requireAdminPermission("ballet.levels", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid level ID" }); return; }

  const parsed = UpdateLevelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name         !== undefined) updates["name"]         = parsed.data.name.trim();
  if (parsed.data.sortOrder    !== undefined) updates["sortOrder"]    = parsed.data.sortOrder;
  if (parsed.data.isActive     !== undefined) updates["isActive"]     = parsed.data.isActive;
  if (parsed.data.description  !== undefined) updates["description"]  = parsed.data.description;
  if (parsed.data.requirements !== undefined) updates["requirements"] = parsed.data.requirements;
  if (parsed.data.ageMin       !== undefined) updates["ageMin"]       = parsed.data.ageMin;
  if (parsed.data.ageMax       !== undefined) updates["ageMax"]       = parsed.data.ageMax;

  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }

  try {
    const [existing] = await db.select().from(balletLevelsTable).where(eq(balletLevelsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Level not found" }); return; }
    const [level] = await db
      .update(balletLevelsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletLevelsTable.id, id))
      .returning();
    if (!level) { res.status(404).json({ error: "Level not found" }); return; }
    const { before, after } = diffFields(
      Object.fromEntries(BALLET_LEVEL_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_LEVEL_ACTIVITY_FIELDS.map((key) => [key, level[key]])),
      BALLET_LEVEL_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== level.isActive ? level.isActive ? "activate" : "deactivate" : "update";
      await logActivity(req, {
        action,
        module: "ballet.levels",
        entityType: "ballet_level",
        entityId: level.id,
        entityLabel: level.name,
        before,
        after,
        summary: action === "activate"
          ? `Activated ballet level ${level.name}`
          : action === "deactivate"
            ? `Deactivated ballet level ${level.name}`
            : `Updated ballet level ${level.name}: ${changedKeys.join(", ")}`,
      });
    }
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

router.post("/admin/ballet/slots", requireAdminAuth, requireAdminPermission("ballet.assessmentDates", "create"), async (req: AdminRequest, res): Promise<void> => {
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
    await logActivity(req, {
      action: "create",
      module: "ballet.assessmentDates",
      entityType: "ballet_assessment_slot",
      entityId: slot.id,
      entityLabel: `${slot.date} ${slot.startTime}`,
      after: Object.fromEntries(BALLET_SLOT_ACTIVITY_FIELDS.map((key) => [key, slot[key]])),
      summary: `Created ballet assessment date ${slot.date} ${slot.startTime}`,
    });
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

router.patch("/admin/ballet/slots/:id", requireAdminAuth, requireAssessmentSlotUpdatePermission, async (req: AdminRequest, res): Promise<void> => {
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
    const [existing] = await db.select().from(balletAssessmentSlotsTable).where(eq(balletAssessmentSlotsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Slot not found" }); return; }
    const [slot] = await db
      .update(balletAssessmentSlotsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletAssessmentSlotsTable.id, id))
      .returning();
    if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
    const { before, after } = diffFields(
      Object.fromEntries(BALLET_SLOT_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_SLOT_ACTIVITY_FIELDS.map((key) => [key, slot[key]])),
      BALLET_SLOT_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      const action = existing.isActive !== slot.isActive ? slot.isActive ? "activate" : "delete" : "update";
      await logActivity(req, {
        action,
        module: "ballet.assessmentDates",
        entityType: "ballet_assessment_slot",
        entityId: slot.id,
        entityLabel: `${slot.date} ${slot.startTime}`,
        before,
        after,
        summary: action === "delete"
          ? `Deactivated ballet assessment date ${slot.date} ${slot.startTime}`
          : action === "activate"
            ? `Activated ballet assessment date ${slot.date} ${slot.startTime}`
            : `Updated ballet assessment date ${slot.date} ${slot.startTime}: ${changedKeys.join(", ")}`,
      });
    }
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

router.patch("/admin/ballet/settings", requireAdminAuth, requireAdminPermission("ballet.pricing", "edit"), async (req: AdminRequest, res): Promise<void> => {
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
    const [existing] = await db.select().from(balletSettingsTable).where(eq(balletSettingsTable.id, 1)).limit(1);
    if (!existing) { res.status(404).json({ error: "Settings not found" }); return; }
    const [row] = await db
      .update(balletSettingsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletSettingsTable.id, 1))
      .returning();
    if (!row) { res.status(404).json({ error: "Settings not found" }); return; }
    const { before, after } = diffFields(
      Object.fromEntries(BALLET_SETTINGS_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_SETTINGS_ACTIVITY_FIELDS.map((key) => [key, row[key]])),
      BALLET_SETTINGS_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.pricing",
        entityType: "ballet_settings",
        entityId: row.id,
        entityLabel: "Ballet pricing and settings",
        before,
        after,
        summary: `Updated ballet pricing/settings: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ settings: row });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/settings failed");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
