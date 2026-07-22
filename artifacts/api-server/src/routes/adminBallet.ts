/**
 * Admin Ballet routes — /api/admin/ballet/*
 *
 * All routes require:
 *   1. requireAuth          (shared API key, applied globally)
 *   2. requireAdminAuth     (X-Admin-Token JWT)
 *
 * Routes:
 *   GET   /api/admin/ballet/applications              — paginated list + filter + search
 *   GET   /api/admin/ballet/applications/:id          — full detail with assessment schedule, level, events
 *   PATCH /api/admin/ballet/applications/:id/status   — change status + append event
 *   POST  /api/admin/ballet/applications/:id/assign-level — assign level + update app + event
 */

import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletLevelsTable,
  balletSettingsTable,
  balletLevelAssignmentsTable,
  balletGroupsTable,
  balletSchedulesTable,
  balletPackagesTable,
  balletPaymentsTable,
  balletEnrollmentCancellationRequestsTable,
  balletRefundsTable,
  balletClassesTable,
  balletClassLevelsTable,
  balletInstructorsTable,
  balletProgramRequirementSectionsTable,
  balletProgramRequirementItemsTable,
  balletFaqsTable,
  attendanceTable,
  systemUsersTable,
  notificationsTable,
  BALLET_APPLICATION_STATUSES,
} from "@workspace/db";
import type { BalletApplicationStatus } from "@workspace/db";
import { isTransitionAllowed } from "@workspace/api-zod";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { logger } from "../lib/logger";
import { diffFields, logActivity } from "../lib/activityLog";
import { computeBalletMonthlyAttendanceSummary, currentBillingMonth, isValidBillingMonth } from "../lib/balletAttendance";
import { balletRefundEligibilitySummary, resolveApplicationCurrentCycle, todayDateOnly, type BalletRefundEligibilityContext } from "../lib/balletRefundEligibility";
import { buildBalletApplicationPdfBuffer, balletApplicationPdfFilename } from "./balletApplicationPdf";
import { isAssignmentReadyClass, scheduleShapeCondition } from "../lib/balletClassEntitlement";
import {
  currentSubscription,
  getCurrentSubscriptionForApplication,
  getPaymentCyclesForApplication,
  getPaymentCyclesForApplications,
} from "../lib/balletSubscriptions";

const router: IRouter = Router();
const BALLET_LEVEL_ACTIVITY_FIELDS = ["name", "sortOrder", "isActive", "description", "requirements", "ageMin", "ageMax", "imageUrl"] as const;
const BALLET_SETTINGS_ACTIVITY_FIELDS = ["homeCardImageUrl", "whatsappNumber", "phoneNumber", "email", "studioLocationUrl"] as const;
const BALLET_REQUIREMENT_SECTION_ACTIVITY_FIELDS = ["title", "description", "sortOrder", "isActive"] as const;
const BALLET_REQUIREMENT_ITEM_ACTIVITY_FIELDS = ["sectionId", "text", "sortOrder", "isActive"] as const;
const BALLET_FAQ_ACTIVITY_FIELDS = ["question", "answer", "sortOrder", "isActive"] as const;
const GOOGLE_DRIVE_IMAGE_HOSTS = new Set(["drive.google.com", "www.drive.google.com", "docs.google.com"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set(BALLET_APPLICATION_STATUSES);

function isValidStatus(s: string): s is BalletApplicationStatus {
  return VALID_STATUSES.has(s as BalletApplicationStatus);
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

function extractGoogleDriveFileId(input: URL): string | null {
  const pathMatch = input.pathname.match(/\/file\/d\/([^/]+)/i);
  const raw = pathMatch?.[1] ?? input.searchParams.get("id");
  if (!raw) return null;
  const decoded = decodeURIComponent(raw).trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(decoded) ? decoded : null;
}

function normalizeBalletImageUrl(input: string | null | undefined, label = "Image URL"): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  if (!url.username && !url.password && !GOOGLE_DRIVE_IMAGE_HOSTS.has(url.hostname.toLowerCase())) {
    return url.toString();
  }

  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }

  const driveId = extractGoogleDriveFileId(url);
  if (!driveId) {
    throw new Error("Google Drive image URL must include a public file ID.");
  }

  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(driveId)}`;
}

function normalizePhoneNumber(input: string | null | undefined, label: string): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    .replace(/[\s().-]+/g, "")
    .replace(/^00/, "+");
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) {
    throw new Error(`${label} must contain 7 to 15 digits and may start with +.`);
  }
  return normalized;
}

function normalizeEmail(input: string | null | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  const parsed = z.string().email().safeParse(trimmed);
  if (!parsed.success) {
    throw new Error("Email must be a valid email address.");
  }
  return trimmed.toLowerCase();
}

function normalizeHttpsUrl(input: string | null | undefined, label: string): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return url.toString();
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
        assessmentScheduleId: balletApplicationsTable.assessmentScheduleId,
        assessmentDate:       balletApplicationsTable.assessmentDate,
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
//   assessmentSchedule — selected schedule details (if assessmentScheduleId is set)
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

  const [preferredPackage] = app.preferredPackageId != null
    ? await db
        .select({ id: balletPackagesTable.id, name: balletPackagesTable.name })
        .from(balletPackagesTable)
        .where(eq(balletPackagesTable.id, app.preferredPackageId))
        .limit(1)
    : [];

  // Load selected assessment schedule, assigned level, active level assignment,
  // and events in parallel.
  const [assessmentScheduleRows, levelRows, assignmentRows, events] = await Promise.all([
    app.assessmentScheduleId
      ? db
          .select({
            id:             balletSchedulesTable.id,
            dayOfWeek:      balletSchedulesTable.dayOfWeek,
            startTime:      balletSchedulesTable.startTime,
            endTime:        balletSchedulesTable.endTime,
            status:         balletSchedulesTable.status,
            classId:        balletClassesTable.id,
            classTitle:     balletClassesTable.title,
            instructorId:   balletInstructorsTable.id,
            instructorName: balletInstructorsTable.name,
            levelId:        balletLevelsTable.id,
            levelName:      balletLevelsTable.name,
          })
          .from(balletSchedulesTable)
          .leftJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
          .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
          .leftJoin(balletClassLevelsTable, eq(balletClassLevelsTable.classId, balletClassesTable.id))
          .leftJoin(balletLevelsTable, eq(balletLevelsTable.id, balletClassLevelsTable.levelId))
          .where(eq(balletSchedulesTable.id, app.assessmentScheduleId))
          .orderBy(asc(balletLevelsTable.sortOrder))
          .limit(1)
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
  // attendance endpoint will accept (canonical Class → Group, direct join —
  // no legacy ballet_group_schedules involvement for operational data).
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
        .from(balletClassesTable)
        .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
        .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
        .where(eq(balletClassesTable.groupId, activeAssignment.groupId))
        .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime))
    : [];

  // Payments (A1) — return the full history (newest first, don't collapse it)
  // plus a clear pointer to the most recently updated "current" one for the
  // list-parity header display.
  const [payments, cancellationRequests, refunds] = await Promise.all([
    getPaymentCyclesForApplication(id),
    db
      .select()
      .from(balletEnrollmentCancellationRequestsTable)
      .where(eq(balletEnrollmentCancellationRequestsTable.applicationId, id))
      .orderBy(desc(balletEnrollmentCancellationRequestsTable.createdAt)),
    db
      .select()
      .from(balletRefundsTable)
      .where(eq(balletRefundsTable.applicationId, id))
      .orderBy(desc(balletRefundsTable.createdAt)),
  ]);
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

  // Resolve initiator (parent/admin) names for cancellation-request records so
  // the admin detail page can attribute each request without an extra call.
  const initiatorAdminIds = [...new Set(cancellationRequests.map((r) => r.initiatedByAdminId).filter((v): v is number => v != null))];
  const initiatorAdmins = initiatorAdminIds.length > 0
    ? await db.select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName, username: systemUsersTable.username })
        .from(systemUsersTable)
        .where(inArray(systemUsersTable.id, initiatorAdminIds))
    : [];
  const initiatorNameById = new Map(initiatorAdmins.map((a) => [a.id, a.fullName ?? a.username]));
  const cancellationRequestsWithInitiator = cancellationRequests.map((r) => ({
    ...r,
    initiatedByAdminName: r.initiatedByAdminId != null ? initiatorNameById.get(r.initiatedByAdminId) ?? null : null,
  }));

  // Refund-eligibility summary for the Danger Zone (cash refunds against a paid
  // inPerson payment only). Admin sees the amounts; the refund itself stays a
  // separate, admin-decided underReview record. This is a read-only display,
  // not a cancellation submission, so there is no chosen timing yet — an
  // active enrollment's eligibility is shown as of today (what an immediate
  // cancellation right now would see); a pre-activation application uses the
  // flat-payment rule. Matches the same activeEnrollment/preActivation split
  // resolveBalletDangerAction() already uses for which button to show.
  const refundEligibilityContext: BalletRefundEligibilityContext =
    app.status === "active" && activeAssignment != null
      ? { kind: "activeEnrollment", resolvedCycle: await resolveApplicationCurrentCycle(id, todayDateOnly()) }
      : { kind: "preActivation" };
  const eligibleRefund = await balletRefundEligibilitySummary(id, refundEligibilityContext);

  res.json({
    application:  {
      ...app,
      preferredPackageName: preferredPackage?.name ?? null,
    },
    assessmentSchedule: assessmentScheduleRows[0] ?? null,
    level:        levelRows[0] ?? null,
    group:        groupRows[0] ?? null,
    assignmentId: activeAssignment?.id ?? null,
    groupSchedules,
    events,
    payments,
    currentPayment,
    currentSubscription: currentPayment,
    attendanceSummary,
    cancellationRequests: cancellationRequestsWithInitiator,
    refunds,
    eligibleRefund,
  });
});


// ─── GET /api/admin/ballet/applications/:id/export.pdf ───────────────────────

router.get("/admin/ballet/applications/:id/export.pdf", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid application ID" }); return; }

  const [app] = await db.select().from(balletApplicationsTable).where(eq(balletApplicationsTable.id, id)).limit(1);
  if (!app) { res.status(404).json({ error: "Application not found" }); return; }

  const [assessmentScheduleRows, levelRows, assignmentRows, events] = await Promise.all([
    app.assessmentScheduleId
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
            levelId: balletLevelsTable.id,
            levelName: balletLevelsTable.name,
          })
          .from(balletSchedulesTable)
          .leftJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
          .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
          .leftJoin(balletClassLevelsTable, eq(balletClassLevelsTable.classId, balletClassesTable.id))
          .leftJoin(balletLevelsTable, eq(balletLevelsTable.id, balletClassLevelsTable.levelId))
          .where(eq(balletSchedulesTable.id, app.assessmentScheduleId))
          .orderBy(asc(balletLevelsTable.sortOrder))
          .limit(1)
      : Promise.resolve([]),
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
        .from(balletClassesTable)
        .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
        .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
        .where(eq(balletClassesTable.groupId, activeAssignment.groupId))
        .orderBy(asc(balletSchedulesTable.dayOfWeek), asc(balletSchedulesTable.startTime))
    : [];

  const payments = await getPaymentCyclesForApplication(id);
  const currentPayment = currentSubscription(payments);
  const attendanceSummary = activeAssignment ? await computeBalletMonthlyAttendanceSummary(activeAssignment.id, id, currentBillingMonth()) : null;

  const buf = await buildBalletApplicationPdfBuffer({
    application: app,
    assessmentSchedule: assessmentScheduleRows[0] ?? null,
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

    if (status === fromStatus) {
      res.json({ success: true, status, message: "No change" });
      return;
    }

    // ── Status-transition whitelist ─────────────────────────────────────────
    if (!isTransitionAllowed(fromStatus, status as BalletApplicationStatus)) {
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
        .select({
          id: balletLevelAssignmentsTable.id,
          levelId: balletLevelAssignmentsTable.levelId,
          groupId: balletLevelAssignmentsTable.groupId,
          levelIsActive: balletLevelsTable.isActive,
          groupLevelId: balletGroupsTable.levelId,
          groupIsActive: balletGroupsTable.isActive,
        })
        .from(balletLevelAssignmentsTable)
        .innerJoin(balletLevelsTable, eq(balletLevelsTable.id, balletLevelAssignmentsTable.levelId))
        .leftJoin(balletGroupsTable, eq(balletGroupsTable.id, balletLevelAssignmentsTable.groupId))
        .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
        .orderBy(desc(balletLevelAssignmentsTable.id))
        .limit(1);

      if (!activeAssignment || activeAssignment.groupId == null) {
        res.status(422).json({ error: "Cannot activate: assign a group first." });
        return;
      }
      if (activeAssignment.levelId !== app.assignedLevelId || activeAssignment.groupLevelId !== activeAssignment.levelId) {
        res.status(422).json({ error: "Cannot activate: assigned level and group are inconsistent." });
        return;
      }
      if (!activeAssignment.levelIsActive || !activeAssignment.groupIsActive) {
        res.status(422).json({ error: "Cannot activate: assigned level and group must both be active." });
        return;
      }

      const [activeClassSchedule] = await db
        .select({ classId: balletClassesTable.id })
        .from(balletClassesTable)
        .where(and(
          eq(balletClassesTable.levelId, activeAssignment.levelId),
          eq(balletClassesTable.groupId, activeAssignment.groupId),
          isAssignmentReadyClass(),
        ))
        .limit(1);
      if (!activeClassSchedule) {
        res.status(422).json({ error: "Cannot activate: the assigned group has no active Ballet Class with a valid active schedule and instructor." });
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
      if (status === "cancelled" && fromStatus === "assignedToLevel") {
        const [assignment] = await tx
          .select({ id: balletLevelAssignmentsTable.id })
          .from(balletLevelAssignmentsTable)
          .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
          .orderBy(desc(balletLevelAssignmentsTable.id))
          .limit(1)
          .for("update");

        if (assignment) {
          const now = new Date().toISOString();
          await tx
            .update(balletLevelAssignmentsTable)
            .set({
              status: "withdrawn",
              withdrawnAt: now,
              withdrawalEffectiveDate: now.slice(0, 10),
              withdrawalReason: note ?? "Application cancelled before activation",
              withdrawnByAdminId: adminId,
              updatedAt: now,
            })
            .where(eq(balletLevelAssignmentsTable.id, assignment.id));
        }
      }

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

    const fromStatus = app.status as BalletApplicationStatus;
    // Allowlist, not a blocklist: only "accepted" (first level assignment)
    // and "assignedToLevel" (re-assigning before a group/activation) may
    // call this endpoint. Without this, calling assign-level on an "active"
    // application would silently supersede its live assignment and reset
    // the application's status back to "assignedToLevel" — an inappropriate
    // downgrade of an already-active student that must never happen through
    // this endpoint.
    if (fromStatus !== "accepted" && fromStatus !== "assignedToLevel") {
      res.status(422).json({
        error: `Cannot assign level to application in status "${fromStatus}". Only accepted or assigned applications can be assigned a level.`,
      });
      return;
    }

    // Validate level
    const [level] = await db
      .select({ id: balletLevelsTable.id, name: balletLevelsTable.name, isActive: balletLevelsTable.isActive })
      .from(balletLevelsTable)
      .where(eq(balletLevelsTable.id, levelId))
      .limit(1);

    if (!level) { res.status(404).json({ error: "Level not found" }); return; }
    if (!level.isActive) { res.status(422).json({ error: `Level "${level.name}" is inactive and cannot be assigned` }); return; }

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
    if (app.status !== "assignedToLevel" && app.status !== "active") {
      res.status(422).json({ error: `Cannot assign a group to application in status "${app.status}".` });
      return;
    }

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
    const [activeClassSchedule] = await db
      .select({ classId: balletClassesTable.id })
      .from(balletClassesTable)
      .where(and(
        eq(balletClassesTable.groupId, group.id),
        eq(balletClassesTable.levelId, assignment.levelId),
        isAssignmentReadyClass(),
      ))
      .limit(1);
    if (!activeClassSchedule) {
      res.status(422).json({ error: `Group "${group.name}" has no active Ballet Class with a valid active schedule and instructor.` });
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
          .from(balletClassesTable)
          .innerJoin(balletSchedulesTable, eq(balletSchedulesTable.classId, balletClassesTable.id))
          .leftJoin(balletInstructorsTable, eq(balletInstructorsTable.id, balletClassesTable.instructorId))
          .where(eq(balletClassesTable.groupId, row.groupId))
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
      levelId:       balletLevelAssignmentsTable.levelId,
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

  // The schedule must belong to the assignment's current group AND level,
  // resolve through an assignment-ready canonical Class (active, non-legacy,
  // active relationships, at least one well-formed active Schedule — see
  // balletClassEntitlement.ts), and the submitted schedule row itself must
  // independently satisfy scheduleShapeCondition. We derive the class from
  // the schedule itself (never trust a client-supplied classId). Legacy
  // Classes and cancelled/malformed Schedules can never satisfy this.
  const [scheduleLink] = await db
    .select({
      scheduleId:   balletSchedulesTable.id,
      classId:      balletSchedulesTable.classId,
      durationMins: balletSchedulesTable.durationMins,
    })
    .from(balletSchedulesTable)
    .innerJoin(balletClassesTable, eq(balletClassesTable.id, balletSchedulesTable.classId))
    .where(and(
      eq(balletClassesTable.groupId, assignment.groupId),
      eq(balletClassesTable.levelId, assignment.levelId),
      eq(balletSchedulesTable.id, balletScheduleId),
      scheduleShapeCondition(),
      isAssignmentReadyClass(),
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
      imageUrl:     balletLevelsTable.imageUrl,
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
  imageUrl:     z.string().nullable().optional(),
  ageMin:       z.number().int().min(4).max(14).optional(),
  ageMax:       z.number().int().min(4).max(14).optional(),
});

router.post("/admin/ballet/levels", requireAdminAuth, requireAdminPermission("ballet.levels", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateLevelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  let imageUrl: string | null = null;
  if (parsed.data.imageUrl !== undefined) {
    try {
      imageUrl = normalizeBalletImageUrl(parsed.data.imageUrl, "Level image URL");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid level image URL" });
      return;
    }
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
        imageUrl,
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
  imageUrl:     z.string().nullable().optional(),
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
  if (parsed.data.imageUrl     !== undefined) {
    try {
      updates["imageUrl"] = normalizeBalletImageUrl(parsed.data.imageUrl, "Level image URL");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid level image URL" });
      return;
    }
  }
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

// ─── Ballet Program Requirements ──────────────────────────────────────────────

async function getAdminRequirementSectionsWithItems(): Promise<Array<typeof balletProgramRequirementSectionsTable.$inferSelect & { items: Array<typeof balletProgramRequirementItemsTable.$inferSelect> }>> {
  const [sections, items] = await Promise.all([
    db
      .select()
      .from(balletProgramRequirementSectionsTable)
      .orderBy(asc(balletProgramRequirementSectionsTable.sortOrder), asc(balletProgramRequirementSectionsTable.id)),
    db
      .select()
      .from(balletProgramRequirementItemsTable)
      .orderBy(asc(balletProgramRequirementItemsTable.sectionId), asc(balletProgramRequirementItemsTable.sortOrder), asc(balletProgramRequirementItemsTable.id)),
  ]);

  const itemsBySection = new Map<number, typeof items>();
  for (const item of items) {
    itemsBySection.set(item.sectionId, [...(itemsBySection.get(item.sectionId) ?? []), item]);
  }

  return sections.map((section) => ({ ...section, items: itemsBySection.get(section.id) ?? [] }));
}

router.get("/admin/ballet/program-requirement-sections", requireAdminAuth, requireAdminPermission("ballet.settings", "view"), async (_req, res): Promise<void> => {
  try {
    const sections = await getAdminRequirementSectionsWithItems();
    res.json({ sections });
  } catch (err) {
    logger.error({ err }, "GET /admin/ballet/program-requirement-sections failed");
    res.status(500).json({ error: "Failed to load program requirements" });
  }
});

const CreateRequirementSectionBody = z.object({
  title:       z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  sortOrder:   z.number().int().optional(),
  isActive:    z.boolean().optional(),
});

router.post("/admin/ballet/program-requirement-sections", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateRequirementSectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  try {
    const [section] = await db.insert(balletProgramRequirementSectionsTable).values({
      title: parsed.data.title.trim(),
      description: parsed.data.description?.trim() || null,
      sortOrder: parsed.data.sortOrder ?? 0,
      isActive: parsed.data.isActive ?? true,
    }).returning();

    await logActivity(req, {
      action: "create",
      module: "ballet.settings",
      entityType: "ballet_program_requirement_section",
      entityId: section.id,
      entityLabel: section.title,
      after: Object.fromEntries(BALLET_REQUIREMENT_SECTION_ACTIVITY_FIELDS.map((key) => [key, section[key]])),
      summary: `Created ballet program requirement section ${section.title}`,
    });

    res.status(201).json({ section: { ...section, items: [] } });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/program-requirement-sections failed");
    res.status(500).json({ error: "Failed to create program requirement section" });
  }
});

const UpdateRequirementSectionBody = CreateRequirementSectionBody.partial();

router.patch("/admin/ballet/program-requirement-sections/:id", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid section ID" }); return; }

  const parsed = UpdateRequirementSectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates["title"] = parsed.data.title.trim();
  if (parsed.data.description !== undefined) updates["description"] = parsed.data.description?.trim() || null;
  if (parsed.data.sortOrder !== undefined) updates["sortOrder"] = parsed.data.sortOrder;
  if (parsed.data.isActive !== undefined) updates["isActive"] = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [existing] = await db.select().from(balletProgramRequirementSectionsTable).where(eq(balletProgramRequirementSectionsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Program requirement section not found" }); return; }
    const [section] = await db
      .update(balletProgramRequirementSectionsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletProgramRequirementSectionsTable.id, id))
      .returning();
    if (!section) { res.status(404).json({ error: "Program requirement section not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_REQUIREMENT_SECTION_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_REQUIREMENT_SECTION_ACTIVITY_FIELDS.map((key) => [key, section[key]])),
      BALLET_REQUIREMENT_SECTION_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.settings",
        entityType: "ballet_program_requirement_section",
        entityId: section.id,
        entityLabel: section.title,
        before,
        after,
        summary: `Updated ballet program requirement section ${section.title}: ${changedKeys.join(", ")}`,
      });
    }

    const items = await db
      .select()
      .from(balletProgramRequirementItemsTable)
      .where(eq(balletProgramRequirementItemsTable.sectionId, section.id))
      .orderBy(asc(balletProgramRequirementItemsTable.sortOrder), asc(balletProgramRequirementItemsTable.id));
    res.json({ section: { ...section, items } });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/program-requirement-sections/:id failed");
    res.status(500).json({ error: "Failed to update program requirement section" });
  }
});

const CreateRequirementItemBody = z.object({
  sectionId: z.number({ required_error: "sectionId is required" }).int().positive(),
  text:      z.string().min(1, "Text is required"),
  sortOrder: z.number().int().optional(),
  isActive:  z.boolean().optional(),
});

router.post("/admin/ballet/program-requirement-items", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateRequirementItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  try {
    const [section] = await db.select({ id: balletProgramRequirementSectionsTable.id }).from(balletProgramRequirementSectionsTable).where(eq(balletProgramRequirementSectionsTable.id, parsed.data.sectionId)).limit(1);
    if (!section) { res.status(404).json({ error: "Program requirement section not found" }); return; }

    const [item] = await db.insert(balletProgramRequirementItemsTable).values({
      sectionId: parsed.data.sectionId,
      text: parsed.data.text.trim(),
      sortOrder: parsed.data.sortOrder ?? 0,
      isActive: parsed.data.isActive ?? true,
    }).returning();

    await logActivity(req, {
      action: "create",
      module: "ballet.settings",
      entityType: "ballet_program_requirement_item",
      entityId: item.id,
      entityLabel: item.text,
      after: Object.fromEntries(BALLET_REQUIREMENT_ITEM_ACTIVITY_FIELDS.map((key) => [key, item[key]])),
      summary: `Created ballet program requirement item`,
    });

    res.status(201).json({ item });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/program-requirement-items failed");
    res.status(500).json({ error: "Failed to create program requirement item" });
  }
});

const UpdateRequirementItemBody = CreateRequirementItemBody.partial();

router.patch("/admin/ballet/program-requirement-items/:id", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid item ID" }); return; }

  const parsed = UpdateRequirementItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.sectionId !== undefined) updates["sectionId"] = parsed.data.sectionId;
  if (parsed.data.text !== undefined) updates["text"] = parsed.data.text.trim();
  if (parsed.data.sortOrder !== undefined) updates["sortOrder"] = parsed.data.sortOrder;
  if (parsed.data.isActive !== undefined) updates["isActive"] = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [existing] = await db.select().from(balletProgramRequirementItemsTable).where(eq(balletProgramRequirementItemsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Program requirement item not found" }); return; }
    if (parsed.data.sectionId !== undefined) {
      const [section] = await db.select({ id: balletProgramRequirementSectionsTable.id }).from(balletProgramRequirementSectionsTable).where(eq(balletProgramRequirementSectionsTable.id, parsed.data.sectionId)).limit(1);
      if (!section) { res.status(404).json({ error: "Program requirement section not found" }); return; }
    }

    const [item] = await db
      .update(balletProgramRequirementItemsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletProgramRequirementItemsTable.id, id))
      .returning();
    if (!item) { res.status(404).json({ error: "Program requirement item not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_REQUIREMENT_ITEM_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_REQUIREMENT_ITEM_ACTIVITY_FIELDS.map((key) => [key, item[key]])),
      BALLET_REQUIREMENT_ITEM_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.settings",
        entityType: "ballet_program_requirement_item",
        entityId: item.id,
        entityLabel: item.text,
        before,
        after,
        summary: `Updated ballet program requirement item: ${changedKeys.join(", ")}`,
      });
    }

    res.json({ item });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/program-requirement-items/:id failed");
    res.status(500).json({ error: "Failed to update program requirement item" });
  }
});

// ─── Ballet FAQs ──────────────────────────────────────────────────────────────

router.get("/admin/ballet/faqs", requireAdminAuth, requireAdminPermission("ballet.settings", "view"), async (_req, res): Promise<void> => {
  try {
    const faqs = await db
      .select()
      .from(balletFaqsTable)
      .orderBy(asc(balletFaqsTable.sortOrder), asc(balletFaqsTable.id));
    res.json({ faqs });
  } catch (err) {
    logger.error({ err }, "GET /admin/ballet/faqs failed");
    res.status(500).json({ error: "Failed to load Ballet FAQs" });
  }
});

const CreateFaqBody = z.object({
  question:  z.string().min(1, "Question is required"),
  answer:    z.string().min(1, "Answer is required"),
  sortOrder: z.number().int().optional(),
  isActive:  z.boolean().optional(),
});

router.post("/admin/ballet/faqs", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = CreateFaqBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  try {
    const [faq] = await db.insert(balletFaqsTable).values({
      question: parsed.data.question.trim(),
      answer: parsed.data.answer.trim(),
      sortOrder: parsed.data.sortOrder ?? 0,
      isActive: parsed.data.isActive ?? true,
    }).returning();

    await logActivity(req, {
      action: "create",
      module: "ballet.settings",
      entityType: "ballet_faq",
      entityId: faq.id,
      entityLabel: faq.question,
      after: Object.fromEntries(BALLET_FAQ_ACTIVITY_FIELDS.map((key) => [key, faq[key]])),
      summary: `Created Ballet FAQ ${faq.question}`,
    });

    res.status(201).json({ faq });
  } catch (err) {
    logger.error({ err }, "POST /admin/ballet/faqs failed");
    res.status(500).json({ error: "Failed to create Ballet FAQ" });
  }
});

const UpdateFaqBody = CreateFaqBody.partial();

router.patch("/admin/ballet/faqs/:id", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid FAQ ID" }); return; }

  const parsed = UpdateFaqBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.question !== undefined) updates["question"] = parsed.data.question.trim();
  if (parsed.data.answer !== undefined) updates["answer"] = parsed.data.answer.trim();
  if (parsed.data.sortOrder !== undefined) updates["sortOrder"] = parsed.data.sortOrder;
  if (parsed.data.isActive !== undefined) updates["isActive"] = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    res.json({ success: true, message: "No changes" });
    return;
  }
  updates["updatedAt"] = new Date().toISOString();

  try {
    const [existing] = await db.select().from(balletFaqsTable).where(eq(balletFaqsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Ballet FAQ not found" }); return; }
    const [faq] = await db
      .update(balletFaqsTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(updates as any)
      .where(eq(balletFaqsTable.id, id))
      .returning();
    if (!faq) { res.status(404).json({ error: "Ballet FAQ not found" }); return; }

    const { before, after } = diffFields(
      Object.fromEntries(BALLET_FAQ_ACTIVITY_FIELDS.map((key) => [key, existing[key]])),
      Object.fromEntries(BALLET_FAQ_ACTIVITY_FIELDS.map((key) => [key, faq[key]])),
      BALLET_FAQ_ACTIVITY_FIELDS,
    );
    const changedKeys = Object.keys(after);
    if (changedKeys.length > 0) {
      await logActivity(req, {
        action: "update",
        module: "ballet.settings",
        entityType: "ballet_faq",
        entityId: faq.id,
        entityLabel: faq.question,
        before,
        after,
        summary: `Updated Ballet FAQ ${faq.question}: ${changedKeys.join(", ")}`,
      });
    }

    res.json({ faq });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/faqs/:id failed");
    res.status(500).json({ error: "Failed to update Ballet FAQ" });
  }
});

// ─── GET /api/admin/ballet/settings ───────────────────────────────────────────

router.get("/admin/ballet/settings", requireAdminAuth, requireAdminPermission("ballet.settings", "view"), async (_req, res): Promise<void> => {
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
  homeCardImageUrl:  z.string().nullable().optional(),
  whatsappNumber:   z.string().nullable().optional(),
  phoneNumber:      z.string().nullable().optional(),
  email:            z.string().nullable().optional(),
  studioLocationUrl: z.string().nullable().optional(),
});

router.patch("/admin/ballet/settings", requireAdminAuth, requireAdminPermission("ballet.settings", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.homeCardImageUrl !== undefined) {
    try {
      updates["homeCardImageUrl"] = normalizeBalletImageUrl(parsed.data.homeCardImageUrl, "Home card image");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid home card image URL" });
      return;
    }
  }
  if (parsed.data.whatsappNumber !== undefined) {
    try {
      updates["whatsappNumber"] = normalizePhoneNumber(parsed.data.whatsappNumber, "WhatsApp number");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid WhatsApp number" });
      return;
    }
  }
  if (parsed.data.phoneNumber !== undefined) {
    try {
      updates["phoneNumber"] = normalizePhoneNumber(parsed.data.phoneNumber, "Phone number");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid phone number" });
      return;
    }
  }
  if (parsed.data.email !== undefined) {
    try {
      updates["email"] = normalizeEmail(parsed.data.email);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid email" });
      return;
    }
  }
  if (parsed.data.studioLocationUrl !== undefined) {
    try {
      updates["studioLocationUrl"] = normalizeHttpsUrl(parsed.data.studioLocationUrl, "Studio location link");
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid studio location link" });
      return;
    }
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
        module: "ballet.settings",
        entityType: "ballet_settings",
        entityId: row.id,
        entityLabel: "Ballet general settings",
        before,
        after,
        summary: `Updated ballet general settings: ${changedKeys.join(", ")}`,
      });
    }
    res.json({ settings: row });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/ballet/settings failed");
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
