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
  balletGroupSchedulesTable,
  balletSchedulesTable,
  balletPackagesTable,
  balletPaymentsTable,
  balletClassesTable,
  balletInstructorsTable,
  attendanceTable,
  systemUsersTable,
  notificationsTable,
  BALLET_APPLICATION_STATUSES,
} from "@workspace/db";
import type { BalletApplicationStatus } from "@workspace/db";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import { computeBalletMonthlyAttendanceSummary, currentBillingMonth, isValidBillingMonth } from "../lib/balletAttendance";
import { buildBalletApplicationPdfBuffer, balletApplicationPdfFilename } from "./balletApplicationPdf";
import {
  currentSubscription,
  getCurrentSubscriptionForApplication,
  getPaymentCyclesForApplication,
  getPaymentCyclesForApplications,
} from "../lib/balletSubscriptions";

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
  subscription: z.enum(["pending", "active", "expiringSoon", "expired", "renewed"]).optional(),
});

router.get("/admin/ballet/applications", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit, status, search, levelId, subscription } = parsed.data;
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

  if (subscription) {
    const paymentRows = await getPaymentCyclesForApplications(
      (await db.select({ id: balletApplicationsTable.id }).from(balletApplicationsTable)).map((row) => row.id),
    );
    const matchingApplicationIds: number[] = [];
    for (const [applicationId, payments] of paymentRows.entries()) {
      const current = currentSubscription(payments);
      const matches =
        subscription === "pending" ? !current || current.subscriptionStatus === "pending"
        : subscription === "active" ? current?.subscriptionStatus === "active"
        : subscription === "renewed" ? current?.subscriptionStatus === "renewed"
        : subscription === "expired" ? current?.subscriptionStatus === "expired"
        : Boolean(current?.hasActiveSubscription && current.daysRemaining != null && current.daysRemaining <= 7);
      if (matches) matchingApplicationIds.push(applicationId);
    }
    if (subscription === "pending") {
      const allIds = (await db.select({ id: balletApplicationsTable.id }).from(balletApplicationsTable)).map((row) => row.id);
      for (const id of allIds) if (!paymentRows.has(id)) matchingApplicationIds.push(id);
    }
    conditions.push(matchingApplicationIds.length > 0 ? inArray(balletApplicationsTable.id, [...new Set(matchingApplicationIds)]) : sql`false`);
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
  const subscriptionByApplicationId = new Map<number, ReturnType<typeof currentSubscription>>();
  if (applicationIds.length > 0) {
    const paymentCycles = await getPaymentCyclesForApplications(applicationIds);
    for (const [applicationId, payments] of paymentCycles.entries()) {
      const current = currentSubscription(payments);
      subscriptionByApplicationId.set(applicationId, current);
      if (current) paymentStatusByApplicationId.set(applicationId, current.status);
    }
  }

  res.json({
    data: rows.map((row) => ({
      ...row,
      levelName: row.assignedLevelId != null ? levelNameById.get(row.assignedLevelId) ?? null : null,
      paymentStatus: paymentStatusByApplicationId.get(row.id) ?? null,
      subscription: subscriptionByApplicationId.get(row.id) ?? null,
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

  // C3: the active group's schedule slots, so the "Mark Attendance" control on
  // the detail page can offer a picker scoped to exactly the schedules the
  // attendance endpoint will accept (same group→ballet_group_schedules join).
  const groupSchedules = activeAssignment?.groupId != null
    ? await db
        .select({
          id:        balletSchedulesTable.id,
          dayOfWeek: balletSchedulesTable.dayOfWeek,
          startTime: balletSchedulesTable.startTime,
          endTime:   balletSchedulesTable.endTime,
          status:    balletSchedulesTable.status,
          classId:   balletClassesTable.id,
          classTitle: balletClassesTable.title,
          instructorId: balletInstructorsTable.id,
          instructorName: balletInstructorsTable.name,
        })
        .from(balletGroupSchedulesTable)
        .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.id, balletGroupSchedulesTable.scheduleId))
        .leftJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
        .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
        .where(eq(balletGroupSchedulesTable.groupId, activeAssignment.groupId))
        .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime))
    : [];

  // Payments (A1) — return the full history (newest first, don't collapse it)
  // plus a clear pointer to the most recently updated "current" one for the
  // list-parity header display.
  const payments = await getPaymentCyclesForApplication(id);
  const currentPayment = currentSubscription(payments);

  // Attendance-hours summary (C4) for the requested (default current) calendar
  // month. Only meaningful once there's an active level assignment; null
  // otherwise. When ?month is supplied it must be a valid YYYY-MM.
  const monthParam = typeof req.query["month"] === "string" ? req.query["month"] : undefined;
  if (monthParam != null && !isValidBillingMonth(monthParam)) {
    res.status(400).json({ error: "month must be in YYYY-MM format" });
    return;
  }
  const billingMonth = monthParam ?? currentBillingMonth();
  const attendanceSummary = activeAssignment
    ? await computeBalletMonthlyAttendanceSummary(activeAssignment.id, id, billingMonth)
    : null;

  res.json({
    application:  app,
    slot:         slotRows[0] ?? null,
    level:        levelRows[0] ?? null,
    group:        groupRows[0] ?? null,
    assignmentId: activeAssignment?.id ?? null,
    groupSchedules,
    events,
    payments,
    currentPayment,
    currentSubscription: currentPayment,
    attendanceSummary,
  });
});


// ─── GET /api/admin/ballet/applications/:id/export.pdf ───────────────────────

router.get("/admin/ballet/applications/:id/export.pdf", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

  const [app] = await db.select().from(balletApplicationsTable).where(eq(balletApplicationsTable.id, id)).limit(1);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  const [slotRows, levelRows, assignmentRows, events] = await Promise.all([
    app.slotId ? db.select().from(balletAssessmentSlotsTable).where(eq(balletAssessmentSlotsTable.id, app.slotId)).limit(1) : Promise.resolve([]),
    app.assignedLevelId ? db.select().from(balletLevelsTable).where(eq(balletLevelsTable.id, app.assignedLevelId)).limit(1) : Promise.resolve([]),
    db.select({ id: balletLevelAssignmentsTable.id, groupId: balletLevelAssignmentsTable.groupId })
      .from(balletLevelAssignmentsTable)
      .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
      .orderBy(desc(balletLevelAssignmentsTable.id))
      .limit(1),
    db
      .select({
        id: balletApplicationEventsTable.id,
        fromStatus: balletApplicationEventsTable.fromStatus,
        toStatus: balletApplicationEventsTable.toStatus,
        note: balletApplicationEventsTable.note,
        createdAt: balletApplicationEventsTable.createdAt,
        changedById: balletApplicationEventsTable.changedById,
        changedByUsername: systemUsersTable.username,
        changedByFullName: systemUsersTable.fullName,
      })
      .from(balletApplicationEventsTable)
      .leftJoin(systemUsersTable, eq(balletApplicationEventsTable.changedById, systemUsersTable.id))
      .where(eq(balletApplicationEventsTable.applicationId, id))
      .orderBy(desc(balletApplicationEventsTable.createdAt)),
  ]);

  const activeAssignment = assignmentRows[0] ?? null;
  const groupRows = activeAssignment?.groupId != null
    ? await db.select({ id: balletGroupsTable.id, name: balletGroupsTable.name }).from(balletGroupsTable).where(eq(balletGroupsTable.id, activeAssignment.groupId)).limit(1)
    : [];
  const groupSchedules = activeAssignment?.groupId != null
    ? await db
        .select({
          id: balletSchedulesTable.id,
          dayOfWeek: balletSchedulesTable.dayOfWeek,
          startTime: balletSchedulesTable.startTime,
          endTime: balletSchedulesTable.endTime,
          status: balletSchedulesTable.status,
          classId: balletClassesTable.id,
          classTitle: balletClassesTable.title,
          instructorId: balletInstructorsTable.id,
          instructorName: balletInstructorsTable.name,
        })
        .from(balletGroupSchedulesTable)
        .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.id, balletGroupSchedulesTable.scheduleId))
        .leftJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
        .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
        .where(eq(balletGroupSchedulesTable.groupId, activeAssignment.groupId))
        .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime))
    : [];

  const payments = await getPaymentCyclesForApplication(id);
  const currentPayment = currentSubscription(payments);
  const attendanceSummary = activeAssignment ? await computeBalletMonthlyAttendanceSummary(activeAssignment.id, id, currentBillingMonth()) : null;

  const buf = await buildBalletApplicationPdfBuffer({
    application: app,
    slot: slotRows[0] ?? null,
    level: levelRows[0] ?? null,
    group: groupRows[0] ?? null,
    groupSchedules,
    events,
    payments,
    currentPayment,
    attendanceSummary,
    generatedBy: req.adminUser?.username ?? "Admin",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${balletApplicationPdfFilename(app.id, app.childName)}"`);
  res.send(buf);
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

      const activeSubscription = await getCurrentSubscriptionForApplication(id);
      if (!activeSubscription?.hasActiveSubscription) {
        res.status(422).json({ error: "Cannot activate: no active paid Ballet subscription period on file for this application." });
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
// A Ballet student is the child identity, with one current assignment selected
// for the roster. Historical level/group rows remain intact for detail/history,
// but they must not multiply the operational Students list.
// ─────────────────────────────────────────────────────────────────────────────

const StudentsListQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function deriveStudentStage(applicationStatus: string, subscriptionStatus: string | null): "Pending Payment" | "Active" | "Renewed" | "Expired" {
  if (subscriptionStatus === "expired") return "Expired";
  if (subscriptionStatus === "renewed") return "Renewed";
  if (applicationStatus === "active" && subscriptionStatus === "active") return "Active";
  return "Pending Payment";
}

async function getLatestPaymentByApplicationIds(applicationIds: number[]) {
  const latestPaymentByApplicationId = new Map<number, ReturnType<typeof currentSubscription>>();
  const payments = await getPaymentCyclesForApplications(applicationIds);
  for (const [applicationId, rows] of payments.entries()) latestPaymentByApplicationId.set(applicationId, currentSubscription(rows));
  return latestPaymentByApplicationId;
}

interface BalletStudentListRow {
  [key: string]: unknown;
  assignmentId: number;
  applicationId: number;
  applicationStatus: string;
  studentName: string;
  parentName: string;
  parentPhone: string;
  age: number | null;
  dateJoined: string | null;
  levelId: number | null;
  levelName: string | null;
  groupId: number | null;
  groupName: string | null;
}

interface BalletStudentEnrollmentHistoryRow {
  [key: string]: unknown;
  assignmentId: number;
  applicationId: number;
  applicationStatus: string;
  assignmentStatus: string;
  levelId: number | null;
  levelName: string | null;
  groupId: number | null;
  groupName: string | null;
  enrolledAt: string | null;
  updatedAt: string | null;
}

const studentIdentitySql = sql`
  coalesce(
    'child:' || coalesce(ballet_level_assignments.child_id, ballet_applications.child_id)::text,
    'manual:' || coalesce(ballet_applications.parent_student_id::text, '') || ':' || lower(trim(ballet_applications.child_name)) || ':' || coalesce(ballet_applications.child_birthday, '')
  )
`;

const currentBalletStudentsCte = sql`
  with ranked_students as (
    select
      ballet_level_assignments.id as "assignmentId",
      ballet_applications.id as "applicationId",
      ballet_applications.status as "applicationStatus",
      ballet_applications.child_name as "studentName",
      ballet_applications.parent_name as "parentName",
      ballet_applications.parent_phone as "parentPhone",
      ballet_applications.child_age as "age",
      ballet_level_assignments.enrolled_at as "dateJoined",
      ballet_levels.id as "levelId",
      ballet_levels.name as "levelName",
      ballet_groups.id as "groupId",
      ballet_groups.name as "groupName",
      row_number() over (
        partition by ${studentIdentitySql}
        order by
          case when ballet_level_assignments.status = 'active' then 0 else 1 end,
          ballet_level_assignments.enrolled_at desc nulls last,
          ballet_level_assignments.id desc
      ) as rn
    from ballet_level_assignments
    inner join ballet_applications on ballet_applications.id = ballet_level_assignments.application_id
    left join ballet_levels on ballet_levels.id = ballet_level_assignments.level_id
    left join ballet_groups on ballet_groups.id = ballet_level_assignments.group_id
  )
`;

router.get("/admin/ballet/students", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = StudentsListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const [rowsResult, totalResult] = await Promise.all([
    db.execute<BalletStudentListRow>(sql`
      ${currentBalletStudentsCte}
      select
        "assignmentId",
        "applicationId",
        "applicationStatus",
        "studentName",
        "parentName",
        "parentPhone",
        "age",
        "dateJoined",
        "levelId",
        "levelName",
        "groupId",
        "groupName"
      from ranked_students
      where rn = 1
      order by "dateJoined" desc nulls last, "assignmentId" desc
      limit ${limit}
      offset ${offset}
    `),

    db.execute<{ total: number }>(sql`
      ${currentBalletStudentsCte}
      select count(*)::int as total
      from ranked_students
      where rn = 1
    `),
  ]);
  const rows = rowsResult.rows;
  const total = Number(totalResult.rows[0]?.total ?? 0);

  const latestPayments = await getLatestPaymentByApplicationIds(rows.map((row) => row.applicationId));

  res.json({
    data: rows.map((row) => {
      const payment = latestPayments.get(row.applicationId) ?? null;
      return {
        ...row,
        paymentStatus: payment?.status ?? null,
        subscriptionStatus: payment?.subscriptionStatus ?? "pending",
        subscriptionDisplayStatus: payment?.subscriptionDisplayStatus ?? "Pending Payment",
        subscriptionStartDate: payment?.subscriptionStartDate ?? null,
        subscriptionExpiresAt: payment?.subscriptionExpiresAt ?? null,
        daysRemaining: payment?.daysRemaining ?? null,
        studentStage: deriveStudentStage(row.applicationStatus, payment?.subscriptionStatus ?? null),
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

router.get("/admin/ballet/students/:assignmentId", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const assignmentId = parseInt(String(req.params["assignmentId"] ?? ""), 10);
  if (isNaN(assignmentId)) { res.status(400).json({ error: "Invalid assignment ID" }); return; }

  const [row] = await db
    .select({
      assignmentId: balletLevelAssignmentsTable.id,
      applicationId: balletApplicationsTable.id,
      applicationStatus: balletApplicationsTable.status,
      childId: balletApplicationsTable.childId,
      studentName: balletApplicationsTable.childName,
      birthday: balletApplicationsTable.childBirthday,
      age: balletApplicationsTable.childAge,
      gender: balletApplicationsTable.childGender,
      dateJoined: balletLevelAssignmentsTable.enrolledAt,
      parentName: balletApplicationsTable.parentName,
      parentPhone: balletApplicationsTable.parentPhone,
      parentEmail: balletApplicationsTable.parentEmail,
      emergencyContactName: balletApplicationsTable.emergencyContactName,
      emergencyContactPhone: balletApplicationsTable.emergencyContactPhone,
      preferredPaymentMethod: balletApplicationsTable.preferredPaymentMethod,
      levelId: balletLevelsTable.id,
      levelName: balletLevelsTable.name,
      groupId: balletGroupsTable.id,
      groupName: balletGroupsTable.name,
    })
    .from(balletLevelAssignmentsTable)
    .innerJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletLevelAssignmentsTable.applicationId))
    .leftJoin(balletLevelsTable, eq(balletLevelsTable.id, balletLevelAssignmentsTable.levelId))
    .leftJoin(balletGroupsTable, eq(balletGroupsTable.id, balletLevelAssignmentsTable.groupId))
    .where(eq(balletLevelAssignmentsTable.id, assignmentId))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Ballet student not found" }); return; }

  const [latestPayments, paymentRows, groupSchedules, attendanceSummary, enrollmentHistoryResult] = await Promise.all([
    getLatestPaymentByApplicationIds([row.applicationId]),
    getPaymentCyclesForApplication(row.applicationId),
    row.groupId != null
      ? db
          .select({
            id: balletSchedulesTable.id,
            dayOfWeek: balletSchedulesTable.dayOfWeek,
            startTime: balletSchedulesTable.startTime,
            endTime: balletSchedulesTable.endTime,
            status: balletSchedulesTable.status,
            classId: balletClassesTable.id,
            classTitle: balletClassesTable.title,
            instructorId: balletInstructorsTable.id,
            instructorName: balletInstructorsTable.name,
          })
          .from(balletGroupSchedulesTable)
          .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.id, balletGroupSchedulesTable.scheduleId))
          .leftJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
          .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
          .where(eq(balletGroupSchedulesTable.groupId, row.groupId))
          .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime))
      : Promise.resolve([]),
    computeBalletMonthlyAttendanceSummary(row.assignmentId, row.applicationId, currentBillingMonth()),
    db.execute<BalletStudentEnrollmentHistoryRow>(sql`
      with selected_student as (
        select ${studentIdentitySql} as identity_key
        from ballet_level_assignments
        inner join ballet_applications on ballet_applications.id = ballet_level_assignments.application_id
        where ballet_level_assignments.id = ${assignmentId}
        limit 1
      )
      select
        ballet_level_assignments.id as "assignmentId",
        ballet_applications.id as "applicationId",
        ballet_applications.status as "applicationStatus",
        ballet_level_assignments.status as "assignmentStatus",
        ballet_levels.id as "levelId",
        ballet_levels.name as "levelName",
        ballet_groups.id as "groupId",
        ballet_groups.name as "groupName",
        ballet_level_assignments.enrolled_at as "enrolledAt",
        ballet_level_assignments.updated_at as "updatedAt"
      from ballet_level_assignments
      inner join ballet_applications on ballet_applications.id = ballet_level_assignments.application_id
      left join ballet_levels on ballet_levels.id = ballet_level_assignments.level_id
      left join ballet_groups on ballet_groups.id = ballet_level_assignments.group_id
      cross join selected_student
      where ${studentIdentitySql} = selected_student.identity_key
      order by
        case when ballet_level_assignments.id = ${assignmentId} then 0 else 1 end,
        ballet_level_assignments.enrolled_at desc nulls last,
        ballet_level_assignments.id desc
    `),
  ]);

  const attendance = await db
    .select({
      id: attendanceTable.id,
      classDate: attendanceTable.classDate,
      status: attendanceTable.status,
      durationMinutes: attendanceTable.durationMinutes,
      notes: attendanceTable.notes,
      balletScheduleId: attendanceTable.balletScheduleId,
      createdAt: attendanceTable.createdAt,
    })
    .from(attendanceTable)
    .where(eq(attendanceTable.balletLevelAssignmentId, assignmentId))
    .orderBy(desc(attendanceTable.classDate), desc(attendanceTable.createdAt))
    .limit(100);

  const currentPayment = latestPayments.get(row.applicationId) ?? null;
  res.json({
    student: {
      ...row,
        paymentStatus: currentPayment?.status ?? null,
        subscriptionStatus: currentPayment?.subscriptionStatus ?? "pending",
        subscriptionDisplayStatus: currentPayment?.subscriptionDisplayStatus ?? "Pending Payment",
        subscriptionStartDate: currentPayment?.subscriptionStartDate ?? null,
        subscriptionExpiresAt: currentPayment?.subscriptionExpiresAt ?? null,
        daysRemaining: currentPayment?.daysRemaining ?? null,
        studentStage: deriveStudentStage(row.applicationStatus, currentPayment?.subscriptionStatus ?? null),
    },
    currentPayment,
    payments: paymentRows,
    enrollmentHistory: enrollmentHistoryResult.rows,
    groupSchedules,
    attendanceSummary,
    attendanceHistory: attendance,
  });
});

// ─── Ballet attendance: POST / PATCH / GET ────────────────────────────────────
//
// Phase B / C3 (+ D1 correction pass): the admin-recorded Ballet attendance
// path — enough to enforce the required identity/uniqueness rules, make C4's
// hours calculation real, and let staff correct a mis-recorded entry and see
// history. A full check-in UX (QR, self-check-in) is out of scope.
//
// POST /admin/ballet/attendance
//   Body: { levelAssignmentId, balletScheduleId, classDate (YYYY-MM-DD), status,
//           durationMinutes?, note? }
//   status ∈ checked_in | late | absent | cancelled
//
// Validation:
//   - the level assignment exists and is status = "active";
//   - balletScheduleId belongs to the assignment's CURRENT group (via
//     ballet_group_schedules — the same join shape used by the mobile
//     schedule-resolution in ballet.ts's GET /ballet/applications/my);
//   - balletClassId is derived server-side from ballet_schedules.classId — it
//     is never accepted from the client, to avoid a mismatched class/schedule.
//   - the attendance table's pre-existing NOT NULL studentName/studentEmail are
//     populated from the assignment's application (childName/parentEmail).
//   - durationMinutes: if omitted, copied from the selected schedule's
//     durationMins at record time and stored as an immutable snapshot on the
//     row (D2: the monthly calculation reads this snapshot, never a live
//     join, so later schedule-duration edits never rewrite past totals).
//   - a 23505 on the partial unique index (migration 0054) returns a clean
//     409 that includes the existing attendance row's id — never a 500, and
//     the existing row is never silently overwritten.
//
// PATCH /admin/ballet/attendance/:id
//   Corrects status / durationMinutes / note only. levelAssignmentId,
//   balletScheduleId, and classDate are immutable via this endpoint — to
//   change the occurrence itself, record a new attendance row instead.
//
// GET /admin/ballet/attendance?levelAssignmentId=&month=YYYY-MM
//   Returns the assignment's attendance history plus the same monthly
//   summary shape used elsewhere (C4).
// ─────────────────────────────────────────────────────────────────────────────

const BALLET_ATTENDANCE_STATUSES = ["checked_in", "late", "absent", "cancelled"] as const;

const CreateAttendanceBody = z.object({
  levelAssignmentId: z.number({ required_error: "levelAssignmentId is required" }).int().positive(),
  balletScheduleId:  z.number({ required_error: "balletScheduleId is required" }).int().positive(),
  classDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "classDate must be in YYYY-MM-DD format"),
  status:            z.enum(BALLET_ATTENDANCE_STATUSES),
  // D1: optional — defaults to the selected schedule's durationMins when omitted.
  durationMinutes:   z.number().int().nonnegative().optional(),
  note:              z.string().optional(),
});

router.post("/admin/ballet/attendance", requireAdminAuth, requireAdminPermission("attendance", "checkIn"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const { levelAssignmentId, balletScheduleId, classDate, status, durationMinutes: requestedDuration, note } = parsed.data;

  // Load the level assignment + its application identity (for the NOT NULL
  // studentName/studentEmail columns).
  const [assignment] = await db
    .select({
      id:            balletLevelAssignmentsTable.id,
      status:        balletLevelAssignmentsTable.status,
      groupId:       balletLevelAssignmentsTable.groupId,
      applicationId: balletLevelAssignmentsTable.applicationId,
      childName:     balletApplicationsTable.childName,
      parentEmail:   balletApplicationsTable.parentEmail,
    })
    .from(balletLevelAssignmentsTable)
    .innerJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletLevelAssignmentsTable.applicationId))
    .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
    .limit(1);

  if (!assignment) { res.status(404).json({ error: "Level assignment not found" }); return; }
  if (assignment.status !== "active") {
    res.status(422).json({ error: "Level assignment is not active — cannot record attendance." });
    return;
  }
  if (assignment.groupId == null) {
    res.status(422).json({ error: "This student has no assigned group — cannot record attendance." });
    return;
  }

  // The schedule must belong to the assignment's current group, and we derive
  // the class from the schedule itself (never trust a client-supplied classId).
  const [scheduleLink] = await db
    .select({
      scheduleId:   balletSchedulesTable.id,
      classId:      balletSchedulesTable.classId,
      durationMins: balletSchedulesTable.durationMins,
    })
    .from(balletGroupSchedulesTable)
    .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.id, balletGroupSchedulesTable.scheduleId))
    .where(and(
      eq(balletGroupSchedulesTable.groupId, assignment.groupId),
      eq(balletGroupSchedulesTable.scheduleId, balletScheduleId),
    ))
    .limit(1);

  if (!scheduleLink) {
    res.status(422).json({ error: "The selected schedule does not belong to this student's group." });
    return;
  }

  const adminEmail = req.adminUser?.email ?? null;
  // D1: snapshot the duration NOW — client override wins, else the schedule's
  // current durationMins, else null (never silently coerced to 0).
  const durationMinutes = requestedDuration ?? scheduleLink.durationMins ?? null;

  try {
    const [attendance] = await db
      .insert(attendanceTable)
      .values({
        // Ballet identity + occurrence
        balletLevelAssignmentId: levelAssignmentId,
        balletScheduleId,
        balletClassId: scheduleLink.classId,
        classDate,
        status,
        durationMinutes,
        notes: note ?? null,
        // Satisfy pre-existing NOT NULL columns with already-available data.
        studentName:  assignment.childName,
        studentEmail: assignment.parentEmail,
        checkedInBy:  adminEmail,
      })
      .returning();

    await logActivity(req, {
      action: "checkIn",
      module: "attendance",
      entityType: "ballet_attendance",
      entityId: attendance.id,
      entityLabel: assignment.childName,
      after: { levelAssignmentId, balletScheduleId, balletClassId: scheduleLink.classId, classDate, status, durationMinutes },
      summary: `Recorded ballet attendance (${status}) for ${assignment.childName} on ${classDate}`,
    });

    res.status(201).json({ attendance });
  } catch (err: unknown) {
    const cause = (err as { cause?: unknown }).cause;
    const pgErr = (cause ?? err) as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === "attendance_ballet_unique_per_slot_date") {
      // Never silently overwrite — surface the existing row's id so the
      // caller can look at (or correct via PATCH) what's already there.
      const [existing] = await db
        .select({ id: attendanceTable.id })
        .from(attendanceTable)
        .where(and(
          eq(attendanceTable.balletLevelAssignmentId, levelAssignmentId),
          eq(attendanceTable.balletScheduleId, balletScheduleId),
          eq(attendanceTable.classDate, classDate),
        ))
        .limit(1);
      res.status(409).json({
        error: "Attendance for this schedule and date is already recorded",
        existingAttendanceId: existing?.id ?? null,
      });
      return;
    }
    logger.error({ err, levelAssignmentId, balletScheduleId, classDate }, "POST /admin/ballet/attendance failed");
    res.status(500).json({ error: "Failed to record attendance" });
  }
});

// ─── PATCH /api/admin/ballet/attendance/:id ───────────────────────────────────
//
// Corrects an existing ballet attendance row. Only status / durationMinutes /
// note may change — the occurrence identity (levelAssignmentId,
// balletScheduleId, classDate) is immutable here by design (not accepted in
// the body at all, so there's nothing to reject-if-present; a differently
// shaped occurrence is a new attendance row, not a correction to this one).
// ─────────────────────────────────────────────────────────────────────────────

const PatchAttendanceBody = z.object({
  status:          z.enum(BALLET_ATTENDANCE_STATUSES).optional(),
  durationMinutes: z.number().int().nonnegative().nullable().optional(),
  note:            z.string().nullable().optional(),
}).refine((b) => b.status !== undefined || b.durationMinutes !== undefined || b.note !== undefined, {
  message: "At least one of status, durationMinutes, or note is required",
});

router.patch("/admin/ballet/attendance/:id", requireAdminAuth, requireAdminPermission("attendance", "checkIn"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid attendance id" }); return; }

  const parsed = PatchAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const [existing] = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.id, id))
    .limit(1);

  if (!existing || existing.balletLevelAssignmentId == null) {
    res.status(404).json({ error: "Ballet attendance record not found" });
    return;
  }

  const { status, durationMinutes, note } = parsed.data;
  const updates: Partial<typeof attendanceTable.$inferInsert> = {};
  if (status !== undefined) updates.status = status;
  if (durationMinutes !== undefined) updates.durationMinutes = durationMinutes;
  if (note !== undefined) updates.notes = note;

  const [attendance] = await db
    .update(attendanceTable)
    .set(updates)
    .where(eq(attendanceTable.id, id))
    .returning();

  await logActivity(req, {
    action: "update",
    module: "attendance",
    entityType: "ballet_attendance",
    entityId: id,
    entityLabel: existing.studentName,
    before: { status: existing.status, durationMinutes: existing.durationMinutes, notes: existing.notes },
    after: { status: attendance.status, durationMinutes: attendance.durationMinutes, notes: attendance.notes },
    summary: `Corrected ballet attendance #${id} for ${existing.studentName}`,
  });

  res.json({ attendance });
});

// ─── GET /api/admin/ballet/attendance ─────────────────────────────────────────
//
// Query: ?levelAssignmentId=<number>&month=YYYY-MM (month optional, defaults
// to the current calendar month). Returns the assignment's full attendance
// history (all months, newest first) plus the requested month's summary —
// same shape as the applications/:id detail route's attendanceSummary.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/admin/ballet/attendance", requireAdminAuth, requireAdminPermission("attendance", "checkIn"), async (req: AdminRequest, res): Promise<void> => {
  const levelAssignmentId = parseInt(String(req.query["levelAssignmentId"] ?? ""), 10);
  if (isNaN(levelAssignmentId)) {
    res.status(400).json({ error: "levelAssignmentId is required" });
    return;
  }
  const monthParam = typeof req.query["month"] === "string" ? req.query["month"] : undefined;
  if (monthParam != null && !isValidBillingMonth(monthParam)) {
    res.status(400).json({ error: "month must be in YYYY-MM format" });
    return;
  }
  const month = monthParam ?? currentBillingMonth();

  const [assignment] = await db
    .select({ id: balletLevelAssignmentsTable.id, applicationId: balletLevelAssignmentsTable.applicationId })
    .from(balletLevelAssignmentsTable)
    .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
    .limit(1);

  if (!assignment) { res.status(404).json({ error: "Level assignment not found" }); return; }

  const [history, summary] = await Promise.all([
    db
      .select()
      .from(attendanceTable)
      .where(eq(attendanceTable.balletLevelAssignmentId, levelAssignmentId))
      .orderBy(desc(attendanceTable.classDate), desc(attendanceTable.createdAt)),
    computeBalletMonthlyAttendanceSummary(levelAssignmentId, assignment.applicationId, month),
  ]);

  res.json({ history, summary });
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
      totalStudents: sql<number>`coalesce(count(${balletLevelAssignmentsTable.id}), 0)::int`,
    })
    .from(balletLevelsTable)
    .leftJoin(
      balletLevelAssignmentsTable,
      and(
        eq(balletLevelAssignmentsTable.levelId, balletLevelsTable.id),
        eq(balletLevelAssignmentsTable.status, "active"),
      ),
    )
    .groupBy(balletLevelsTable.id)
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
