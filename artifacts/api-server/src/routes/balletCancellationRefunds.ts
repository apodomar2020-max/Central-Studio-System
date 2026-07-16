import { Router, type IRouter, type Response } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletEnrollmentCancellationRequestsTable,
  balletLevelAssignmentsTable,
  balletPaymentsTable,
  balletRefundsTable,
  studentsTable,
  systemUsersTable,
} from "@workspace/db";
import { requireStudentAuth, requireVerifiedStudent } from "../middlewares/studentAuth";
import { requireAdminAuth, requireAdminPermission, type AdminRequest } from "./adminAuth";
import { createStudentNotification } from "../lib/notifications";
import { adminActivityActor, logActivity } from "../lib/activityLog";
import { currentSubscription, getPaymentCyclesForApplication } from "../lib/balletSubscriptions";
import { logger } from "../lib/logger";
import { finalizeBalletCancellationRequest } from "../lib/balletCancellationFinalization";
import { resolveApplicationCurrentCycle, eligiblePaymentForContext, refundableRemainingEgp, todayDateOnly, type BalletRefundEligibilityContext, type ResolvedCurrentBalletCycle } from "../lib/balletRefundEligibility";

const router: IRouter = Router();

const PRE_ACTIVATION_CANCELLABLE = ["pending", "needsFollowUp", "accepted", "assignedToLevel"] as const;
const OPEN_CANCELLATION_REQUEST_STATUSES = ["pendingReview", "approved"] as const;
const OPEN_REFUND_STATUSES = ["underReview", "approved", "processing"] as const;
const SUPPORTED_REFUND_METHOD = "cash" as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getAdminId(req: AdminRequest): number | null {
  return req.adminUser?.id ?? req.adminUser?.sub ?? null;
}

function appOwnerCondition(applicationId: number, parentStudentId: number) {
  return and(eq(balletApplicationsTable.id, applicationId), eq(balletApplicationsTable.parentStudentId, parentStudentId));
}

async function notifyParent(client: typeof db, input: {
  parentStudentId: number | null;
  title: string;
  body: string;
  type: string;
  relatedEntityType: string;
  relatedEntityId: number;
  metadata?: Record<string, unknown>;
}) {
  if (input.parentStudentId == null) return null;
  return createStudentNotification(client, {
    studentId: input.parentStudentId,
    title: input.title,
    body: input.body,
    type: input.type,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    metadata: input.metadata ?? null,
    dedupe: true,
  });
}

const ParentReason = z.string().trim().min(5, "Reason must be at least 5 characters").max(500, "Reason must be at most 500 characters");

function cancellationAuditPayload(input: {
  applicationId: number | null;
  levelAssignmentId: number | null;
  cancellationRequestId?: number | null;
  beforeApplicationStatus?: string | null;
  afterApplicationStatus?: string | null;
  beforeAssignmentStatus?: string | null;
  afterAssignmentStatus?: string | null;
  beforeCancellationRequestStatus?: string | null;
  afterCancellationRequestStatus?: string | null;
  requestedTiming?: string | null;
  approvedTiming?: string | null;
  approvedEffectiveDate?: string | null;
  parentReason?: string | null;
  refundId?: number | null;
  paymentId?: number | null;
  timestamp: string;
}) {
  return input;
}

function refundAuditPayload(input: {
  applicationId: number | null;
  levelAssignmentId: number | null;
  cancellationRequestId?: number | null;
  refundId: number;
  paymentId: number | null;
  beforeRefundStatus?: string | null;
  afterRefundStatus?: string | null;
  approvedRefundAmount?: number | null;
  completedRefundAmount?: number | null;
  refundMethod?: string | null;
  transactionReference?: string | null;
  timestamp: string;
}) {
  return input;
}

async function maybeCreateCashRefundRequest(client: typeof db, input: {
  cancellationRequestId: number | null;
  applicationId: number;
  levelAssignmentId: number | null;
  parentStudentId: number | null;
  reason: string;
  eligibilityContext: BalletRefundEligibilityContext;
}) {
  const payment = await eligiblePaymentForContext(input.applicationId, input.eligibilityContext, client);
  if (!payment) return null;

  const remaining = await refundableRemainingEgp(payment.id, payment.amountEgp, client);
  if (remaining <= 0) return null;

  const [existing] = await client
    .select()
    .from(balletRefundsTable)
    .where(and(
      eq(balletRefundsTable.paymentId, payment.id),
      inArray(balletRefundsTable.status, [...OPEN_REFUND_STATUSES]),
      input.cancellationRequestId == null
        ? sql`${balletRefundsTable.cancellationRequestId} is null`
        : eq(balletRefundsTable.cancellationRequestId, input.cancellationRequestId),
    ))
    .limit(1);
  if (existing) return existing;

  const [refund] = await client
    .insert(balletRefundsTable)
    .values({
      cancellationRequestId: input.cancellationRequestId,
      applicationId: input.applicationId,
      levelAssignmentId: input.levelAssignmentId,
      paymentId: payment.id,
      parentStudentId: input.parentStudentId,
      status: "underReview",
      refundMethod: SUPPORTED_REFUND_METHOD,
      requestedReason: input.reason,
      requestedAmountEgp: null,
    })
    .returning();
  return refund;
}

async function loadApplicationDetailForParent(applicationId: number, parentStudentId: number) {
  const [application] = await db
    .select()
    .from(balletApplicationsTable)
    .where(appOwnerCondition(applicationId, parentStudentId))
    .limit(1);
  if (!application) return null;

  const [activeAssignment] = await db
    .select()
    .from(balletLevelAssignmentsTable)
    .where(and(eq(balletLevelAssignmentsTable.applicationId, applicationId), eq(balletLevelAssignmentsTable.status, "active")))
    .orderBy(desc(balletLevelAssignmentsTable.id))
    .limit(1);

  const [openCancellationRequest] = activeAssignment
    ? await db
        .select()
        .from(balletEnrollmentCancellationRequestsTable)
        .where(and(
          eq(balletEnrollmentCancellationRequestsTable.levelAssignmentId, activeAssignment.id),
          inArray(balletEnrollmentCancellationRequestsTable.status, [...OPEN_CANCELLATION_REQUEST_STATUSES]),
        ))
        .orderBy(desc(balletEnrollmentCancellationRequestsTable.createdAt))
        .limit(1)
    : [];

  const refunds = await db
    .select()
    .from(balletRefundsTable)
    .where(eq(balletRefundsTable.applicationId, applicationId))
    .orderBy(desc(balletRefundsTable.createdAt));

  const payments = await getPaymentCyclesForApplication(applicationId);
  return {
    application,
    activeAssignment: activeAssignment ?? null,
    openCancellationRequest: openCancellationRequest ?? null,
    currentPayment: currentSubscription(payments),
    refunds,
  };
}

async function cancelPreActivationApplication(input: {
  applicationId: number;
  actorParentStudentId?: number;
  adminId?: number | null;
  reason?: string | null;
  requestRefund?: boolean;
}) {
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(balletApplicationsTable)
      .where(input.actorParentStudentId != null
        ? appOwnerCondition(input.applicationId, input.actorParentStudentId)
        : eq(balletApplicationsTable.id, input.applicationId))
      .limit(1)
      .for("update");

    if (!app) return { kind: "not_found" as const };
    if (!PRE_ACTIVATION_CANCELLABLE.includes(app.status as any)) {
      return { kind: "invalid_status" as const, status: app.status };
    }
    const reason = ParentReason.parse(input.reason ?? "");

    let assignment: typeof balletLevelAssignmentsTable.$inferSelect | null = null;
    if (app.status === "assignedToLevel") {
      const [row] = await tx
        .select()
        .from(balletLevelAssignmentsTable)
        .where(and(eq(balletLevelAssignmentsTable.applicationId, app.id), eq(balletLevelAssignmentsTable.status, "active")))
        .orderBy(desc(balletLevelAssignmentsTable.id))
        .limit(1)
        .for("update");
      assignment = row ?? null;
      if (assignment) {
        await tx
          .update(balletLevelAssignmentsTable)
          .set({
            status: "withdrawn",
            withdrawnAt: now,
            withdrawalEffectiveDate: todayIso(),
            withdrawalReason: reason,
            withdrawnByAdminId: input.adminId ?? null,
            updatedAt: now,
          })
          .where(eq(balletLevelAssignmentsTable.id, assignment.id));
      }
    }

    await tx
      .update(balletApplicationsTable)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(balletApplicationsTable.id, app.id));

    await tx.insert(balletApplicationEventsTable).values({
      applicationId: app.id,
      fromStatus: app.status,
      toStatus: "cancelled",
      changedById: input.adminId ?? null,
      note: reason,
    });

    const refund = input.requestRefund
      ? await maybeCreateCashRefundRequest(tx as typeof db, {
          cancellationRequestId: null,
          applicationId: app.id,
          levelAssignmentId: assignment?.id ?? null,
          parentStudentId: app.parentStudentId,
          reason,
          // Pre-activation cancellation — never a subscription-cycle payment.
          eligibilityContext: { kind: "preActivation" },
        })
      : null;

    await notifyParent(tx as typeof db, {
      parentStudentId: app.parentStudentId,
      title: "Ballet application cancelled",
      body: `${app.childName}'s Ballet application has been cancelled.`,
      type: "ballet_application_cancelled",
      relatedEntityType: "ballet_application",
      relatedEntityId: app.id,
      metadata: { applicationId: app.id, transition: "cancelled" },
    });

    return { kind: "cancelled" as const, application: { ...app, status: "cancelled" }, beforeApplicationStatus: app.status, assignment, refund };
  });
}

const CancelApplicationBody = z.object({
  reason: ParentReason,
  requestRefund: z.boolean().optional(),
});

router.get("/ballet/applications/:id", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid application ID" }); return; }
  const detail = await loadApplicationDetailForParent(id, req.studentId!);
  if (!detail) { res.status(404).json({ error: "Application not found" }); return; }
  res.json(detail);
});

router.post("/ballet/applications/:id/cancel", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid application ID" }); return; }
  const parsed = CancelApplicationBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }

  const result = await cancelPreActivationApplication({
    applicationId: id,
    actorParentStudentId: req.studentId!,
    reason: parsed.data.reason,
    requestRefund: parsed.data.requestRefund === true,
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Application not found" }); return; }
  if (result.kind === "invalid_status") {
    res.status(422).json({ error: `Application status "${result.status}" cannot use Cancel Application. Active enrollments must use Request Ballet Cancellation.`, code: "BALLET_APPLICATION_NOT_CANCELLABLE" });
    return;
  }
  res.json({ success: true, application: result.application, refund: result.refund ?? null });
});

const CreateCancellationRequestBody = z.object({
  requestedTiming: z.enum(["immediate", "endOfPeriod"]),
  reason: ParentReason,
  requestRefund: z.boolean().optional(),
});

router.post("/ballet/enrollments/:levelAssignmentId/cancellation-requests", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const levelAssignmentId = Number(req.params["levelAssignmentId"]);
  if (!Number.isInteger(levelAssignmentId) || levelAssignmentId <= 0) { res.status(400).json({ error: "Invalid level assignment ID" }); return; }
  const parsed = CreateCancellationRequestBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }

  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(balletLevelAssignmentsTable)
      .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
      .limit(1)
      .for("update");
    if (!assignment || assignment.status !== "active") return { kind: "assignment_not_active" as const };

    const [app] = await tx
      .select()
      .from(balletApplicationsTable)
      .where(and(
        eq(balletApplicationsTable.id, assignment.applicationId),
        eq(balletApplicationsTable.parentStudentId, req.studentId!),
      ))
      .limit(1)
      .for("update");
    if (!app) return { kind: "not_found" as const };
    if (app.status !== "active") return { kind: "app_not_active" as const, status: app.status };

    const [open] = await tx
      .select({ id: balletEnrollmentCancellationRequestsTable.id })
      .from(balletEnrollmentCancellationRequestsTable)
      .where(and(
        eq(balletEnrollmentCancellationRequestsTable.levelAssignmentId, assignment.id),
        inArray(balletEnrollmentCancellationRequestsTable.status, [...OPEN_CANCELLATION_REQUEST_STATUSES]),
      ))
      .limit(1)
      .for("update");
    if (open) return { kind: "duplicate" as const, id: open.id };

    const isImmediate = parsed.data.requestedTiming === "immediate";
    const today = todayIso();
    // Resolve the current paid subscription cycle ONCE, anchored to today,
    // and reuse that SAME identity for both the effective-date derivation
    // and the refund-eligibility check below — never two independent
    // lookups. Deliberately NOT currentSubscription(getPaymentCyclesForApplication(...)):
    // that helper has no concept of "today" — it just sorts by latest
    // subscriptionStartDate — so given both a current cycle and an
    // already-paid future renewal, it returns the RENEWAL, not the cycle
    // actually active now.
    const resolvedCycle = await resolveApplicationCurrentCycle(app.id, today, tx as typeof db);
    // Effective cancellation date — today for immediate; for end-of-period,
    // the resolved cycle's own expiry. Persisted on requestedEffectiveDate
    // below (when a cycle was resolved) so this identity is ESTABLISHED once,
    // at creation time, and an admin approving this request later reads it
    // straight back rather than re-resolving anything — a renewal created
    // AFTER this request cannot retroactively change it (see
    // approve-end-of-period's handling of requestedEffectiveDate).
    const effectiveDate = isImmediate
      ? today
      : resolvedCycle?.subscriptionExpiresAt ?? today;

    const [request] = await tx
      .insert(balletEnrollmentCancellationRequestsTable)
      .values({
        applicationId: app.id,
        levelAssignmentId: assignment.id,
        childId: assignment.childId ?? app.childId ?? null,
        parentStudentId: app.parentStudentId,
        initiatedByType: "parent",
        initiatedByAdminId: null,
        status: "pendingReview",
        requestedTiming: parsed.data.requestedTiming,
        requestedEffectiveDate: isImmediate ? today : resolvedCycle?.subscriptionExpiresAt ?? null,
        reason: parsed.data.reason,
        requestRefund: parsed.data.requestRefund === true,
      })
      .returning();

    const refund = parsed.data.requestRefund === true
      ? await maybeCreateCashRefundRequest(tx as typeof db, {
          cancellationRequestId: request.id,
          applicationId: app.id,
          levelAssignmentId: assignment.id,
          parentStudentId: app.parentStudentId,
          // Refund eligibility evaluates against the SAME resolvedCycle used
          // to derive effectiveDate above — no second, independent lookup.
          // This is what avoids the circular-boundary bug: reusing a cycle's
          // own (derived, possibly future) expiry as a NEW search key could
          // ambiguously match a back-to-back renewal starting that same day;
          // reusing the already-resolved identity directly cannot.
          eligibilityContext: { kind: "activeEnrollment", resolvedCycle },
          reason: parsed.data.reason,
        })
      : null;

    await notifyParent(tx as typeof db, {
      parentStudentId: app.parentStudentId,
      title: "Ballet cancellation request submitted",
      body: `Your cancellation request for ${app.childName}'s Ballet enrollment has been submitted for review.`,
      type: "ballet_cancellation_requested",
      relatedEntityType: "ballet_enrollment_cancellation_request",
      relatedEntityId: request.id,
      metadata: { applicationId: app.id, transition: "pendingReview" },
    });
    return { kind: "created" as const, request, refund };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Enrollment not found" }); return; }
  if (result.kind === "assignment_not_active" || result.kind === "app_not_active") { res.status(422).json({ error: "Only active Ballet enrollments can request cancellation." }); return; }
  if (result.kind === "duplicate") { res.status(409).json({ error: "An open cancellation request already exists for this enrollment.", cancellationRequestId: result.id }); return; }
  res.status(201).json({ cancellationRequest: result.request, refund: result.refund ?? null, refundCreated: Boolean(result.refund) });
});

router.get("/ballet/enrollments/:levelAssignmentId/cancellation-request", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const levelAssignmentId = Number(req.params["levelAssignmentId"]);
  if (!Number.isInteger(levelAssignmentId) || levelAssignmentId <= 0) { res.status(400).json({ error: "Invalid level assignment ID" }); return; }
  const [assignment] = await db
    .select({ id: balletLevelAssignmentsTable.id, applicationId: balletLevelAssignmentsTable.applicationId })
    .from(balletLevelAssignmentsTable)
    .where(eq(balletLevelAssignmentsTable.id, levelAssignmentId))
    .limit(1);
  if (!assignment) { res.status(404).json({ error: "Enrollment not found" }); return; }
  const [app] = await db
    .select({ id: balletApplicationsTable.id })
    .from(balletApplicationsTable)
    .where(and(eq(balletApplicationsTable.id, assignment.applicationId), eq(balletApplicationsTable.parentStudentId, req.studentId!)))
    .limit(1);
  if (!app) { res.status(404).json({ error: "Enrollment not found" }); return; }
  const [request] = await db
    .select()
    .from(balletEnrollmentCancellationRequestsTable)
    .where(eq(balletEnrollmentCancellationRequestsTable.levelAssignmentId, levelAssignmentId))
    .orderBy(desc(balletEnrollmentCancellationRequestsTable.createdAt))
    .limit(1);
  const refunds = request
    ? await db.select().from(balletRefundsTable).where(eq(balletRefundsTable.cancellationRequestId, request.id)).orderBy(desc(balletRefundsTable.createdAt))
    : [];
  res.json({ cancellationRequest: request ?? null, refunds });
});

router.post("/ballet/enrollment-cancellation-requests/:id/withdraw", requireStudentAuth, requireVerifiedStudent, async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(balletEnrollmentCancellationRequestsTable)
      .where(and(eq(balletEnrollmentCancellationRequestsTable.id, id), eq(balletEnrollmentCancellationRequestsTable.parentStudentId, req.studentId!)))
      .limit(1)
      .for("update");
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pendingReview") return { kind: "invalid_status" as const, status: request.status };
    const [updated] = await tx
      .update(balletEnrollmentCancellationRequestsTable)
      .set({ status: "withdrawnByParent", withdrawnAt: now, updatedAt: now })
      .where(eq(balletEnrollmentCancellationRequestsTable.id, id))
      .returning();
    await tx
      .update(balletRefundsTable)
      .set({ status: "withdrawn", updatedAt: now })
      .where(and(eq(balletRefundsTable.cancellationRequestId, id), eq(balletRefundsTable.status, "underReview")));
    await notifyParent(tx as typeof db, {
      parentStudentId: request.parentStudentId,
      title: "Ballet cancellation request withdrawn",
      body: "Your Ballet cancellation request has been withdrawn.",
      type: "ballet_cancellation_withdrawn",
      relatedEntityType: "ballet_enrollment_cancellation_request",
      relatedEntityId: id,
      metadata: { applicationId: request.applicationId, transition: "withdrawnByParent" },
    });
    return { kind: "withdrawn" as const, request: updated };
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Cancellation request not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Cannot withdraw a request in status "${result.status}".` }); return; }
  res.json({ cancellationRequest: result.request });
});

router.post("/admin/ballet/applications/:id/cancel", requireAdminAuth, requireAdminPermission("ballet.applications", "cancel"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid application ID" }); return; }
  const parsed = CancelApplicationBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const result = await cancelPreActivationApplication({
    applicationId: id,
    adminId: getAdminId(req),
    reason: parsed.data.reason ?? null,
    requestRefund: parsed.data.requestRefund === true,
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Application not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Application status "${result.status}" cannot be cancelled by this action.` }); return; }
  await logActivity(req, {
    action: "cancel",
    module: "ballet.applications",
    entityType: "ballet_application",
    entityId: id,
    entityLabel: result.application.childName,
    before: cancellationAuditPayload({
      applicationId: result.application.id,
      levelAssignmentId: result.assignment?.id ?? null,
      beforeApplicationStatus: result.beforeApplicationStatus,
      beforeAssignmentStatus: result.assignment?.status ?? null,
      parentReason: parsed.data.reason,
      timestamp: new Date().toISOString(),
    }),
    after: cancellationAuditPayload({
      applicationId: result.application.id,
      levelAssignmentId: result.assignment?.id ?? null,
      refundId: result.refund?.id ?? null,
      paymentId: result.refund?.paymentId ?? null,
      afterApplicationStatus: "cancelled",
      afterAssignmentStatus: result.assignment ? "withdrawn" : null,
      parentReason: parsed.data.reason,
      timestamp: new Date().toISOString(),
    }),
    summary: `Cancelled Ballet application ${id}`,
  });
  res.json({ success: true, application: result.application, refund: result.refund ?? null });
});

// ─── Admin-initiated ACTIVE enrollment cancellation ─────────────────────────────
//
// Reuses the exact same cancellation-request + finalization workflow as the
// parent path — it does NOT touch assignment/application rows directly from the
// caller. The admin action creates a request row (attributed to the admin) and
// immediately approves it: "immediate" is created, approved, and finalized in
// one transaction; "endOfPeriod" is created and approved, staying active until
// the scheduled finalizer runs. Either way exactly one cancellation-request
// record and one Audit Log are produced, and refunds stay separate (cash-only,
// underReview) — never auto-completed.

const AdminInitiateCancellationBody = z.object({
  requestedTiming: z.enum(["immediate", "endOfPeriod"]),
  reason: ParentReason,
  adminNotes: z.string().max(2000).optional(),
  requestRefund: z.boolean().optional(),
  approvedEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/admin/ballet/applications/:id/request-cancellation", requireAdminAuth, requireAdminPermission("ballet.applications", "cancel"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid application ID" }); return; }
  const parsed = AdminInitiateCancellationBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const adminId = getAdminId(req);
  const now = new Date().toISOString();

  const result = await db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(balletApplicationsTable)
      .where(eq(balletApplicationsTable.id, id))
      .limit(1)
      .for("update");
    if (!app) return { kind: "not_found" as const };
    if (app.status !== "active") return { kind: "app_not_active" as const, status: app.status };

    const [assignment] = await tx
      .select()
      .from(balletLevelAssignmentsTable)
      .where(and(eq(balletLevelAssignmentsTable.applicationId, id), eq(balletLevelAssignmentsTable.status, "active")))
      .orderBy(desc(balletLevelAssignmentsTable.id))
      .limit(1)
      .for("update");
    if (!assignment) return { kind: "no_active_assignment" as const };

    const [open] = await tx
      .select({ id: balletEnrollmentCancellationRequestsTable.id })
      .from(balletEnrollmentCancellationRequestsTable)
      .where(and(
        eq(balletEnrollmentCancellationRequestsTable.levelAssignmentId, assignment.id),
        inArray(balletEnrollmentCancellationRequestsTable.status, [...OPEN_CANCELLATION_REQUEST_STATUSES]),
      ))
      .limit(1)
      .for("update");
    if (open) return { kind: "duplicate" as const, id: open.id };

    const isImmediate = parsed.data.requestedTiming === "immediate";
    const initiationDate = todayIso();
    // Resolve the current paid subscription cycle ONCE, anchored to the
    // initiation date (today), and reuse that SAME identity for both the
    // stored effective date and refund eligibility below — same shared
    // resolver and same rules as the Parent path. Deliberately NOT
    // currentSubscription(getPaymentCyclesForApplication(...)): that helper
    // has no concept of "today" and would return a paid future renewal
    // instead of the cycle actually active now.
    const resolvedCycle = await resolveApplicationCurrentCycle(id, initiationDate, tx as typeof db);
    // Stored effective date: an explicit admin-supplied date always takes
    // precedence (unchanged, for storage purposes only); otherwise the
    // resolved cycle's own expiry, anchored to the initiation date — never a
    // future renewal's expiry.
    const effectiveDate = isImmediate
      ? initiationDate
      : parsed.data.approvedEffectiveDate
        ?? resolvedCycle?.subscriptionExpiresAt
        ?? initiationDate;

    const [request] = await tx
      .insert(balletEnrollmentCancellationRequestsTable)
      .values({
        applicationId: app.id,
        levelAssignmentId: assignment.id,
        childId: assignment.childId ?? app.childId ?? null,
        parentStudentId: app.parentStudentId,
        initiatedByType: "admin",
        initiatedByAdminId: adminId,
        status: "approved",
        requestedTiming: parsed.data.requestedTiming,
        approvedTiming: parsed.data.requestedTiming,
        requestedEffectiveDate: isImmediate ? todayIso() : null,
        approvedEffectiveDate: effectiveDate,
        reason: parsed.data.reason,
        requestRefund: parsed.data.requestRefund === true,
        adminNotes: parsed.data.adminNotes ?? null,
        reviewedByAdminId: adminId,
        reviewedAt: now,
      })
      .returning();

    const refund = parsed.data.requestRefund === true
      ? await maybeCreateCashRefundRequest(tx as typeof db, {
          cancellationRequestId: request.id,
          applicationId: app.id,
          levelAssignmentId: assignment.id,
          parentStudentId: app.parentStudentId,
          reason: parsed.data.reason,
          // Refund eligibility always evaluates against resolvedCycle (the
          // cycle active on the initiation date) — deliberately NOT the
          // (possibly admin-overridden) `effectiveDate` above, so an
          // arbitrary admin-supplied storage date never becomes a second,
          // independent payment-selection search key. A future renewal
          // cannot define this result regardless of what effectiveDate ends
          // up stored.
          eligibilityContext: { kind: "activeEnrollment", resolvedCycle },
        })
      : null;

    if (isImmediate) {
      // Create → approve → finalize in one transaction. finalizeBallet…
      // withdraws the active assignment (with metadata), sets the application
      // to withdrawn, preserves attendance/history, completes the request,
      // notifies the parent, and emits exactly one Audit Log.
      const finalized = await finalizeBalletCancellationRequest(tx as typeof db, {
        requestId: request.id,
        adminId,
        adminNotes: parsed.data.adminNotes ?? null,
        forceImmediate: true,
        auditActor: adminActivityActor(req),
        auditAction: "approveImmediate",
      });
      if (finalized.kind !== "completed") return { kind: "finalize_failed" as const, detail: finalized.kind };
      return { kind: "immediate" as const, request: finalized.request, refund };
    }

    // End-of-period: keep the enrollment active until the scheduled finalizer
    // runs on/after the effective date. Approve now, notify, one Audit Log.
    await notifyParent(tx as typeof db, {
      parentStudentId: app.parentStudentId,
      title: "Ballet cancellation scheduled",
      body: `${app.childName}'s Ballet enrollment cancellation has been approved for ${effectiveDate}.`,
      type: "ballet_cancellation_scheduled",
      relatedEntityType: "ballet_enrollment_cancellation_request",
      relatedEntityId: request.id,
      metadata: { applicationId: app.id, transition: "approved" },
    });
    return { kind: "endOfPeriod" as const, request, refund, application: app, assignment, effectiveDate };
  });

  if (result.kind === "not_found") { res.status(404).json({ error: "Application not found" }); return; }
  if (result.kind === "app_not_active") { res.status(422).json({ error: `Application status "${result.status}" is not an active enrollment. Use Cancel Application for pre-activation statuses.`, code: "BALLET_APPLICATION_NOT_ACTIVE" }); return; }
  if (result.kind === "no_active_assignment") { res.status(422).json({ error: "This application has no active level assignment to cancel." }); return; }
  if (result.kind === "duplicate") { res.status(409).json({ error: "An open cancellation request already exists for this enrollment.", cancellationRequestId: result.id }); return; }
  if (result.kind === "finalize_failed") { res.status(422).json({ error: `Immediate cancellation could not be finalized: ${result.detail}.` }); return; }

  if (result.kind === "endOfPeriod") {
    await logActivity(req, {
      action: "approveEndOfPeriod",
      module: "ballet.applications",
      entityType: "ballet_enrollment_cancellation_request",
      entityId: result.request.id,
      entityLabel: result.application.childName,
      before: cancellationAuditPayload({
        applicationId: result.application.id,
        levelAssignmentId: result.assignment.id,
        cancellationRequestId: result.request.id,
        beforeApplicationStatus: result.application.status,
        beforeAssignmentStatus: result.assignment.status,
        parentReason: result.request.reason,
        timestamp: now,
      }),
      after: cancellationAuditPayload({
        applicationId: result.application.id,
        levelAssignmentId: result.assignment.id,
        cancellationRequestId: result.request.id,
        afterCancellationRequestStatus: "approved",
        approvedTiming: "endOfPeriod",
        approvedEffectiveDate: result.effectiveDate,
        refundId: result.refund?.id ?? null,
        paymentId: result.refund?.paymentId ?? null,
        parentReason: result.request.reason,
        timestamp: now,
      }),
      summary: `Admin-initiated end-of-period Ballet cancellation request ${result.request.id}`,
    });
  }

  res.status(201).json({
    cancellationRequest: result.request,
    refund: result.refund ?? null,
    refundCreated: Boolean(result.refund),
    timing: result.kind,
  });
});

const ListCancellationRequestsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pendingReview", "approved", "rejected", "withdrawnByParent", "completed"]).optional(),
});

router.get("/admin/ballet/cancellation-requests", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const parsed = ListCancellationRequestsQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit, status } = parsed.data;
  const where = status ? eq(balletEnrollmentCancellationRequestsTable.status, status) : undefined;
  const offset = (page - 1) * limit;
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: balletEnrollmentCancellationRequestsTable.id,
      applicationId: balletEnrollmentCancellationRequestsTable.applicationId,
      levelAssignmentId: balletEnrollmentCancellationRequestsTable.levelAssignmentId,
      status: balletEnrollmentCancellationRequestsTable.status,
      requestedTiming: balletEnrollmentCancellationRequestsTable.requestedTiming,
      approvedTiming: balletEnrollmentCancellationRequestsTable.approvedTiming,
      approvedEffectiveDate: balletEnrollmentCancellationRequestsTable.approvedEffectiveDate,
      requestRefund: balletEnrollmentCancellationRequestsTable.requestRefund,
      reason: balletEnrollmentCancellationRequestsTable.reason,
      initiatedByType: balletEnrollmentCancellationRequestsTable.initiatedByType,
      initiatedByAdminId: balletEnrollmentCancellationRequestsTable.initiatedByAdminId,
      initiatedByAdminName: systemUsersTable.fullName,
      initiatedByAdminUsername: systemUsersTable.username,
      createdAt: balletEnrollmentCancellationRequestsTable.createdAt,
      updatedAt: balletEnrollmentCancellationRequestsTable.updatedAt,
      childName: balletApplicationsTable.childName,
      parentName: balletApplicationsTable.parentName,
    })
      .from(balletEnrollmentCancellationRequestsTable)
      .leftJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletEnrollmentCancellationRequestsTable.applicationId))
      .leftJoin(systemUsersTable, eq(systemUsersTable.id, balletEnrollmentCancellationRequestsTable.initiatedByAdminId))
      .where(where)
      .orderBy(desc(balletEnrollmentCancellationRequestsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count(balletEnrollmentCancellationRequestsTable.id) }).from(balletEnrollmentCancellationRequestsTable).where(where),
  ]);
  res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

router.get("/admin/ballet/cancellation-requests/:id", requireAdminAuth, requireAdminPermission("ballet.applications", "view"), async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const [request] = await db.select().from(balletEnrollmentCancellationRequestsTable).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).limit(1);
  if (!request) { res.status(404).json({ error: "Cancellation request not found" }); return; }
  const [application] = request.applicationId
    ? await db.select().from(balletApplicationsTable).where(eq(balletApplicationsTable.id, request.applicationId)).limit(1)
    : [];
  const [assignment] = request.levelAssignmentId
    ? await db.select().from(balletLevelAssignmentsTable).where(eq(balletLevelAssignmentsTable.id, request.levelAssignmentId)).limit(1)
    : [];
  const [initiatingAdmin] = request.initiatedByAdminId != null
    ? await db.select({ id: systemUsersTable.id, fullName: systemUsersTable.fullName, username: systemUsersTable.username }).from(systemUsersTable).where(eq(systemUsersTable.id, request.initiatedByAdminId)).limit(1)
    : [];
  const refunds = await db.select().from(balletRefundsTable).where(eq(balletRefundsTable.cancellationRequestId, id)).orderBy(desc(balletRefundsTable.createdAt));
  res.json({
    cancellationRequest: request,
    application: application ?? null,
    assignment: assignment ?? null,
    refunds,
    initiatedByAdmin: initiatingAdmin ? { id: initiatingAdmin.id, name: initiatingAdmin.fullName ?? initiatingAdmin.username } : null,
  });
});

const AdminDecisionBody = z.object({
  adminNotes: z.string().max(2000).optional(),
  approvedEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/admin/ballet/cancellation-requests/:id/approve-immediate", requireAdminAuth, requireAdminPermission("ballet.applications", "approve"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const parsed = AdminDecisionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const adminId = getAdminId(req);
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(balletEnrollmentCancellationRequestsTable).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).limit(1).for("update");
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pendingReview") return { kind: "invalid_status" as const, status: request.status };
    await tx.update(balletEnrollmentCancellationRequestsTable).set({
      status: "approved",
      approvedTiming: "immediate",
      approvedEffectiveDate: parsed.data.approvedEffectiveDate ?? todayIso(),
      reviewedByAdminId: adminId,
      reviewedAt: now,
      adminNotes: parsed.data.adminNotes ?? null,
      updatedAt: now,
    }).where(eq(balletEnrollmentCancellationRequestsTable.id, id));
    return finalizeBalletCancellationRequest(tx as typeof db, {
      requestId: id,
      adminId,
      adminNotes: parsed.data.adminNotes ?? null,
      forceImmediate: true,
      auditActor: adminActivityActor(req),
      auditAction: "approveImmediate",
    });
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Cancellation request not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Cannot approve request in status "${result.status}".` }); return; }
  if (result.kind === "missing_links") { res.status(422).json({ error: "Cancellation request is missing application or assignment links." }); return; }
  res.json({ cancellationRequest: result.request });
});

router.post("/admin/ballet/cancellation-requests/:id/approve-end-of-period", requireAdminAuth, requireAdminPermission("ballet.applications", "approve"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const parsed = AdminDecisionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const now = new Date().toISOString();
  const adminId = getAdminId(req);
  const result = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(balletEnrollmentCancellationRequestsTable).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).limit(1).for("update");
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pendingReview") return { kind: "invalid_status" as const, status: request.status };
    // Identity preservation, never "latest payment": prefer an explicit admin
    // override, then whatever effective date was ALREADY established when
    // the parent created this request (requestedEffectiveDate, set once at
    // creation time from the cycle resolved then — see the parent route
    // above). Only if NEITHER is available does this fall back to resolving
    // a cycle at all, and even then it resolves against the REQUEST's own
    // creation date, never approval-day "today" — a renewal created after
    // this request was submitted (but before an admin got to it) must never
    // retroactively change an older request's effective date.
    //
    // This endpoint never creates or touches a refund row, so the payment
    // identity already linked via any existing ballet_refunds.paymentId (set
    // at request-creation time, see maybeCreateCashRefundRequest) is left
    // completely untouched here — nothing to preserve-by-code beyond simply
    // not recomputing it, which this endpoint already never did.
    const effectiveDate = parsed.data.approvedEffectiveDate
      ?? request.requestedEffectiveDate
      ?? (request.applicationId
          ? (await resolveApplicationCurrentCycle(request.applicationId, todayDateOnly(new Date(request.createdAt)), tx as typeof db))?.subscriptionExpiresAt
          : null)
      ?? todayIso();
    const [updated] = await tx.update(balletEnrollmentCancellationRequestsTable).set({
      status: "approved",
      approvedTiming: "endOfPeriod",
      approvedEffectiveDate: effectiveDate,
      reviewedByAdminId: adminId,
      reviewedAt: now,
      adminNotes: parsed.data.adminNotes ?? null,
      updatedAt: now,
    }).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).returning();
    await notifyParent(tx as typeof db, {
      parentStudentId: request.parentStudentId,
      title: "Ballet cancellation scheduled",
      body: `Your Ballet enrollment cancellation has been approved for ${effectiveDate}.`,
      type: "ballet_cancellation_scheduled",
      relatedEntityType: "ballet_enrollment_cancellation_request",
      relatedEntityId: id,
      metadata: { applicationId: request.applicationId, transition: "approved" },
    });
    return { kind: "approved" as const, request: updated, beforeRequest: request };
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Cancellation request not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Cannot approve request in status "${result.status}".` }); return; }
  await logActivity(req, {
    action: "approveEndOfPeriod",
    module: "ballet.applications",
    entityType: "ballet_enrollment_cancellation_request",
    entityId: id,
    before: cancellationAuditPayload({
      applicationId: result.beforeRequest.applicationId,
      levelAssignmentId: result.beforeRequest.levelAssignmentId,
      cancellationRequestId: id,
      beforeCancellationRequestStatus: result.beforeRequest.status,
      requestedTiming: result.beforeRequest.requestedTiming,
      approvedTiming: result.beforeRequest.approvedTiming,
      approvedEffectiveDate: result.beforeRequest.approvedEffectiveDate,
      parentReason: result.beforeRequest.reason,
      timestamp: now,
    }),
    after: cancellationAuditPayload({
      applicationId: result.request.applicationId,
      levelAssignmentId: result.request.levelAssignmentId,
      cancellationRequestId: id,
      afterCancellationRequestStatus: result.request.status,
      requestedTiming: result.request.requestedTiming,
      approvedTiming: result.request.approvedTiming,
      approvedEffectiveDate: result.request.approvedEffectiveDate,
      parentReason: result.request.reason,
      timestamp: now,
    }),
    summary: `Approved end-of-period Ballet cancellation request ${id}`,
  });
  res.json({ cancellationRequest: result.request });
});

router.post("/admin/ballet/cancellation-requests/:id/reject", requireAdminAuth, requireAdminPermission("ballet.applications", "reject"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const parsed = AdminDecisionBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const now = new Date().toISOString();
  const adminId = getAdminId(req);
  const result = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(balletEnrollmentCancellationRequestsTable).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).limit(1).for("update");
    if (!request) return { kind: "not_found" as const };
    if (request.status !== "pendingReview") return { kind: "invalid_status" as const, status: request.status };
    const [updated] = await tx.update(balletEnrollmentCancellationRequestsTable).set({ status: "rejected", reviewedByAdminId: adminId, reviewedAt: now, adminNotes: parsed.data.adminNotes ?? null, updatedAt: now }).where(eq(balletEnrollmentCancellationRequestsTable.id, id)).returning();
    await tx.update(balletRefundsTable).set({ status: "rejected", reviewedByAdminId: adminId, reviewedAt: now, adminNotes: "Cancellation request rejected", updatedAt: now }).where(and(eq(balletRefundsTable.cancellationRequestId, id), eq(balletRefundsTable.status, "underReview")));
    await notifyParent(tx as typeof db, { parentStudentId: request.parentStudentId, title: "Ballet cancellation request rejected", body: "Your Ballet cancellation request was not approved. Please contact the studio for details.", type: "ballet_cancellation_rejected", relatedEntityType: "ballet_enrollment_cancellation_request", relatedEntityId: id, metadata: { applicationId: request.applicationId, transition: "rejected" } });
    return { kind: "rejected" as const, request: updated, beforeRequest: request };
  });
  if (result.kind === "not_found") { res.status(404).json({ error: "Cancellation request not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Cannot reject request in status "${result.status}".` }); return; }
  await logActivity(req, {
    action: "reject",
    module: "ballet.applications",
    entityType: "ballet_enrollment_cancellation_request",
    entityId: id,
    before: cancellationAuditPayload({
      applicationId: result.beforeRequest.applicationId,
      levelAssignmentId: result.beforeRequest.levelAssignmentId,
      cancellationRequestId: id,
      beforeCancellationRequestStatus: result.beforeRequest.status,
      requestedTiming: result.beforeRequest.requestedTiming,
      approvedTiming: result.beforeRequest.approvedTiming,
      approvedEffectiveDate: result.beforeRequest.approvedEffectiveDate,
      parentReason: result.beforeRequest.reason,
      timestamp: now,
    }),
    after: cancellationAuditPayload({
      applicationId: result.request.applicationId,
      levelAssignmentId: result.request.levelAssignmentId,
      cancellationRequestId: id,
      afterCancellationRequestStatus: result.request.status,
      requestedTiming: result.request.requestedTiming,
      approvedTiming: result.request.approvedTiming,
      approvedEffectiveDate: result.request.approvedEffectiveDate,
      parentReason: result.request.reason,
      timestamp: now,
    }),
    summary: `Rejected Ballet cancellation request ${id}`,
  });
  res.json({ cancellationRequest: result.request });
});

router.post("/admin/ballet/cancellation-requests/:id/finalize", requireAdminAuth, requireAdminPermission("ballet.applications", "approve"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid request ID" }); return; }
  const parsed = AdminDecisionBody.safeParse(req.body ?? {});
  const result = await db.transaction((tx) => finalizeBalletCancellationRequest(tx as typeof db, {
    requestId: id,
    adminId: getAdminId(req),
    adminNotes: parsed.success ? parsed.data.adminNotes ?? null : null,
    auditActor: adminActivityActor(req),
    auditAction: "finalize",
  }));
  if (result.kind === "not_found") { res.status(404).json({ error: "Cancellation request not found" }); return; }
  if (result.kind === "invalid_status") { res.status(422).json({ error: `Cannot finalize request in status "${result.status}".` }); return; }
  if (result.kind === "missing_links") { res.status(422).json({ error: "Cancellation request is missing application or assignment links." }); return; }
  if (result.kind === "not_due") { res.status(422).json({ error: `Cancellation cannot be finalized before ${result.approvedEffectiveDate}.`, code: "BALLET_CANCELLATION_NOT_DUE", approvedEffectiveDate: result.approvedEffectiveDate }); return; }
  res.json({ cancellationRequest: result.request });
});

const ListRefundsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["underReview", "approved", "rejected", "processing", "refunded", "failed", "withdrawn"]).optional(),
});

router.get("/admin/ballet/refunds", requireAdminAuth, requireAdminPermission("ballet.payments", "view"), async (req, res): Promise<void> => {
  const parsed = ListRefundsQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters" }); return; }
  const { page, limit, status } = parsed.data;
  const where = status ? eq(balletRefundsTable.status, status) : undefined;
  const offset = (page - 1) * limit;
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: balletRefundsTable.id,
      cancellationRequestId: balletRefundsTable.cancellationRequestId,
      applicationId: balletRefundsTable.applicationId,
      paymentId: balletRefundsTable.paymentId,
      status: balletRefundsTable.status,
      refundMethod: balletRefundsTable.refundMethod,
      approvedAmountEgp: balletRefundsTable.approvedAmountEgp,
      refundedAmountEgp: balletRefundsTable.refundedAmountEgp,
      requestedReason: balletRefundsTable.requestedReason,
      transactionReference: balletRefundsTable.transactionReference,
      createdAt: balletRefundsTable.createdAt,
      updatedAt: balletRefundsTable.updatedAt,
      processedAt: balletRefundsTable.processedAt,
      childName: balletApplicationsTable.childName,
      parentName: balletApplicationsTable.parentName,
      paymentAmountEgp: balletPaymentsTable.amountEgp,
      paymentMethod: balletPaymentsTable.paymentMethod,
    })
      .from(balletRefundsTable)
      .leftJoin(balletApplicationsTable, eq(balletApplicationsTable.id, balletRefundsTable.applicationId))
      .leftJoin(balletPaymentsTable, eq(balletPaymentsTable.id, balletRefundsTable.paymentId))
      .where(where)
      .orderBy(desc(balletRefundsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count(balletRefundsTable.id) }).from(balletRefundsTable).where(where),
  ]);
  res.json({ data: rows, total: Number(total), page, limit, totalPages: Math.ceil(Number(total) / limit) });
});

router.get("/admin/ballet/refunds/:id", requireAdminAuth, requireAdminPermission("ballet.payments", "view"), async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid refund ID" }); return; }
  const [refund] = await db.select().from(balletRefundsTable).where(eq(balletRefundsTable.id, id)).limit(1);
  if (!refund) { res.status(404).json({ error: "Refund not found" }); return; }
  const [payment] = await db.select().from(balletPaymentsTable).where(eq(balletPaymentsTable.id, refund.paymentId)).limit(1);
  const remainingRefundableEgp = payment ? await refundableRemainingEgp(payment.id, payment.amountEgp) : 0;
  res.json({ refund, payment: payment ?? null, remainingRefundableEgp });
});

const ApproveRefundBody = z.object({
  approvedAmountEgp: z.number().int().positive(),
  refundMethod: z.enum(["cash", "originalPaymentMethod"]),
  adminNotes: z.string().max(2000).optional(),
});

async function validateRefundAmount(tx: typeof db, refundId: number, amountEgp: number) {
  const [refund] = await tx.select().from(balletRefundsTable).where(eq(balletRefundsTable.id, refundId)).limit(1).for("update");
  if (!refund) return { kind: "not_found" as const };
  const [payment] = await tx.select().from(balletPaymentsTable).where(eq(balletPaymentsTable.id, refund.paymentId)).limit(1).for("update");
  if (!payment) return { kind: "payment_not_found" as const };
  if (payment.applicationId !== refund.applicationId) return { kind: "relationship_mismatch" as const };
  if (refund.levelAssignmentId != null) {
    const [assignment] = await tx.select({ id: balletLevelAssignmentsTable.id, applicationId: balletLevelAssignmentsTable.applicationId })
      .from(balletLevelAssignmentsTable)
      .where(eq(balletLevelAssignmentsTable.id, refund.levelAssignmentId))
      .limit(1)
      .for("update");
    if (!assignment || assignment.applicationId !== refund.applicationId) return { kind: "relationship_mismatch" as const };
  }
  if (refund.cancellationRequestId != null) {
    const [request] = await tx.select({ id: balletEnrollmentCancellationRequestsTable.id, applicationId: balletEnrollmentCancellationRequestsTable.applicationId, levelAssignmentId: balletEnrollmentCancellationRequestsTable.levelAssignmentId })
      .from(balletEnrollmentCancellationRequestsTable)
      .where(eq(balletEnrollmentCancellationRequestsTable.id, refund.cancellationRequestId))
      .limit(1)
      .for("update");
    if (!request || request.applicationId !== refund.applicationId || (refund.levelAssignmentId != null && request.levelAssignmentId !== refund.levelAssignmentId)) return { kind: "relationship_mismatch" as const };
  }
  if (payment.paymentMethod !== "inPerson") return { kind: "method_not_supported" as const };
  if (payment.status !== "paid" || !payment.paidAt || payment.amountEgp <= 0) return { kind: "payment_not_collected" as const };
  const remaining = await refundableRemainingEgp(payment.id, payment.amountEgp, tx, refundId);
  if (amountEgp > remaining) return { kind: "amount_exceeds_remaining" as const, remaining };
  return { kind: "ok" as const, refund, payment, remaining };
}

router.post("/admin/ballet/refunds/:id/approve", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid refund ID" }); return; }
  const parsed = ApproveRefundBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  if (parsed.data.refundMethod !== "cash") { res.status(422).json({ error: "Only cash refunds for Pay at Studio payments are available in this phase.", code: "BALLET_REFUND_METHOD_UNAVAILABLE" }); return; }
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const valid = await validateRefundAmount(tx as typeof db, id, parsed.data.approvedAmountEgp);
    if (valid.kind !== "ok") return valid;
    if (valid.refund.status !== "underReview") return { kind: "invalid_status" as const, status: valid.refund.status };
    const [updated] = await tx.update(balletRefundsTable).set({
      status: "approved",
      refundMethod: "cash",
      approvedAmountEgp: parsed.data.approvedAmountEgp,
      adminNotes: parsed.data.adminNotes ?? null,
      reviewedByAdminId: getAdminId(req),
      reviewedAt: now,
      updatedAt: now,
    }).where(eq(balletRefundsTable.id, id)).returning();
    await notifyParent(tx as typeof db, { parentStudentId: updated.parentStudentId, title: "Ballet refund approved", body: `A cash refund of ${parsed.data.approvedAmountEgp} EGP has been approved.`, type: "ballet_refund_approved", relatedEntityType: "ballet_refund", relatedEntityId: id, metadata: { applicationId: updated.applicationId, transition: "approved" } });
    return { kind: "approved" as const, refund: updated, beforeRefund: valid.refund, payment: valid.payment };
  });
  if (result.kind !== "approved") { res.status(result.kind === "not_found" ? 404 : 422).json({ error: `Refund cannot be approved: ${result.kind}`, code: result.kind, remainingRefundableEgp: "remaining" in result ? result.remaining : undefined }); return; }
  await logActivity(req, {
    action: "approve",
    module: "ballet.payments",
    entityType: "ballet_refund",
    entityId: id,
    before: refundAuditPayload({
      applicationId: result.beforeRefund.applicationId,
      levelAssignmentId: result.beforeRefund.levelAssignmentId,
      cancellationRequestId: result.beforeRefund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      beforeRefundStatus: result.beforeRefund.status,
      refundMethod: result.beforeRefund.refundMethod,
      timestamp: now,
    }),
    after: refundAuditPayload({
      applicationId: result.refund.applicationId,
      levelAssignmentId: result.refund.levelAssignmentId,
      cancellationRequestId: result.refund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      afterRefundStatus: result.refund.status,
      approvedRefundAmount: result.refund.approvedAmountEgp,
      refundMethod: result.refund.refundMethod,
      timestamp: now,
    }),
    summary: `Approved Ballet refund ${id}`,
  });
  res.json({ refund: result.refund });
});

const AdminNotesBody = z.object({ adminNotes: z.string().min(1).max(2000).optional(), failedReason: z.string().min(1).max(2000).optional() });
const MarkRefundedBody = z.object({ refundedAmountEgp: z.number().int().positive(), transactionReference: z.string().min(1).max(500), processedAt: z.string().optional() });

router.post("/admin/ballet/refunds/:id/reject", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid refund ID" }); return; }
  const parsed = AdminNotesBody.safeParse(req.body ?? {});
  const note = parsed.success ? parsed.data.adminNotes ?? "Refund rejected" : "Refund rejected";
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const valid = await validateRefundAmount(tx as typeof db, id, 1);
    if (valid.kind !== "ok") return valid;
    if (valid.refund.status === "rejected") return { kind: "rejected" as const, refund: valid.refund, didMutate: false };
    if (valid.refund.status !== "underReview") return { kind: "invalid_status" as const, status: valid.refund.status };
    const [updated] = await tx.update(balletRefundsTable).set({ status: "rejected", adminNotes: note, reviewedByAdminId: getAdminId(req), reviewedAt: now, updatedAt: now }).where(eq(balletRefundsTable.id, id)).returning();
    await notifyParent(tx as typeof db, { parentStudentId: updated.parentStudentId, title: "Ballet refund rejected", body: "Your Ballet refund request was not approved. Please contact the studio for details.", type: "ballet_refund_rejected", relatedEntityType: "ballet_refund", relatedEntityId: id, metadata: { applicationId: updated.applicationId, transition: "rejected" } });
    return { kind: "rejected" as const, refund: updated, beforeRefund: valid.refund, payment: valid.payment, didMutate: true };
  });
  if (result.kind !== "rejected") { res.status(result.kind === "not_found" ? 404 : 422).json({ error: `Refund cannot be rejected: ${result.kind}`, code: result.kind }); return; }
  if (result.didMutate) await logActivity(req, {
    action: "reject",
    module: "ballet.payments",
    entityType: "ballet_refund",
    entityId: id,
    before: refundAuditPayload({
      applicationId: result.beforeRefund.applicationId,
      levelAssignmentId: result.beforeRefund.levelAssignmentId,
      cancellationRequestId: result.beforeRefund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      beforeRefundStatus: result.beforeRefund.status,
      refundMethod: result.beforeRefund.refundMethod,
      timestamp: now,
    }),
    after: refundAuditPayload({
      applicationId: result.refund.applicationId,
      levelAssignmentId: result.refund.levelAssignmentId,
      cancellationRequestId: result.refund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      afterRefundStatus: result.refund.status,
      refundMethod: result.refund.refundMethod,
      timestamp: now,
    }),
    summary: `Rejected Ballet refund ${id}`,
  });
  res.json({ refund: result.refund });
});

router.post("/admin/ballet/refunds/:id/mark-processing", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid refund ID" }); return; }
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const valid = await validateRefundAmount(tx as typeof db, id, 1);
    if (valid.kind !== "ok") return valid;
    if (valid.refund.status === "processing") return { kind: "processing" as const, refund: valid.refund, didMutate: false };
    if (valid.refund.status !== "approved") return { kind: "invalid_status" as const, status: valid.refund.status };
    const [updated] = await tx.update(balletRefundsTable).set({ status: "processing", updatedAt: now }).where(eq(balletRefundsTable.id, id)).returning();
    await notifyParent(tx as typeof db, { parentStudentId: updated.parentStudentId, title: "Ballet refund processing", body: "Your approved cash refund is being processed.", type: "ballet_refund_processing", relatedEntityType: "ballet_refund", relatedEntityId: id, metadata: { applicationId: updated.applicationId, transition: "processing" } });
    return { kind: "processing" as const, refund: updated, beforeRefund: valid.refund, payment: valid.payment, didMutate: true };
  });
  if (result.kind !== "processing") { res.status(result.kind === "not_found" ? 404 : 422).json({ error: `Refund cannot move to processing: ${result.kind}`, code: result.kind }); return; }
  if (result.didMutate) await logActivity(req, {
    action: "processing",
    module: "ballet.payments",
    entityType: "ballet_refund",
    entityId: id,
    before: refundAuditPayload({
      applicationId: result.beforeRefund.applicationId,
      levelAssignmentId: result.beforeRefund.levelAssignmentId,
      cancellationRequestId: result.beforeRefund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      beforeRefundStatus: result.beforeRefund.status,
      approvedRefundAmount: result.beforeRefund.approvedAmountEgp,
      refundMethod: result.beforeRefund.refundMethod,
      timestamp: now,
    }),
    after: refundAuditPayload({
      applicationId: result.refund.applicationId,
      levelAssignmentId: result.refund.levelAssignmentId,
      cancellationRequestId: result.refund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      afterRefundStatus: result.refund.status,
      approvedRefundAmount: result.refund.approvedAmountEgp,
      refundMethod: result.refund.refundMethod,
      timestamp: now,
    }),
    summary: `Marked Ballet refund ${id} processing`,
  });
  res.json({ refund: result.refund });
});

router.post("/admin/ballet/refunds/:id/mark-refunded", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  const parsed = MarkRefundedBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const valid = await validateRefundAmount(tx as typeof db, id, parsed.data.refundedAmountEgp);
    if (valid.kind !== "ok") return valid;
    if (valid.refund.status === "refunded" && valid.refund.refundedAmountEgp === parsed.data.refundedAmountEgp && valid.refund.transactionReference === parsed.data.transactionReference) return { kind: "refunded" as const, refund: valid.refund, didMutate: false };
    if (!["approved", "processing"].includes(valid.refund.status)) return { kind: "invalid_status" as const, status: valid.refund.status };
    if (valid.refund.approvedAmountEgp == null) return { kind: "missing_approved_amount" as const };
    if (parsed.data.refundedAmountEgp !== valid.refund.approvedAmountEgp) return { kind: "amount_must_equal_approved" as const };
    const [updated] = await tx.update(balletRefundsTable).set({
      status: "refunded",
      refundedAmountEgp: parsed.data.refundedAmountEgp,
      transactionReference: parsed.data.transactionReference,
      processedByAdminId: getAdminId(req),
      processedAt: parsed.data.processedAt ?? now,
      updatedAt: now,
    }).where(eq(balletRefundsTable.id, id)).returning();
    await notifyParent(tx as typeof db, { parentStudentId: updated.parentStudentId, title: "Ballet refund completed", body: `Your cash refund of ${parsed.data.refundedAmountEgp} EGP has been completed.`, type: "ballet_refund_completed", relatedEntityType: "ballet_refund", relatedEntityId: id, metadata: { applicationId: updated.applicationId, transition: "refunded" } });
    return { kind: "refunded" as const, refund: updated, beforeRefund: valid.refund, payment: valid.payment, didMutate: true };
  });
  if (result.kind !== "refunded") { res.status(result.kind === "not_found" ? 404 : 422).json({ error: `Refund cannot be completed: ${result.kind}`, code: result.kind, remainingRefundableEgp: "remaining" in result ? result.remaining : undefined }); return; }
  if (result.didMutate) await logActivity(req, {
    action: "complete",
    module: "ballet.payments",
    entityType: "ballet_refund",
    entityId: id,
    before: refundAuditPayload({
      applicationId: result.beforeRefund.applicationId,
      levelAssignmentId: result.beforeRefund.levelAssignmentId,
      cancellationRequestId: result.beforeRefund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      beforeRefundStatus: result.beforeRefund.status,
      approvedRefundAmount: result.beforeRefund.approvedAmountEgp,
      refundMethod: result.beforeRefund.refundMethod,
      timestamp: now,
    }),
    after: refundAuditPayload({
      applicationId: result.refund.applicationId,
      levelAssignmentId: result.refund.levelAssignmentId,
      cancellationRequestId: result.refund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      afterRefundStatus: result.refund.status,
      approvedRefundAmount: result.refund.approvedAmountEgp,
      completedRefundAmount: result.refund.refundedAmountEgp,
      refundMethod: result.refund.refundMethod,
      transactionReference: result.refund.transactionReference,
      timestamp: now,
    }),
    summary: `Completed Ballet refund ${id}`,
  });
  res.json({ refund: result.refund });
});

router.post("/admin/ballet/refunds/:id/mark-failed", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), async (req: AdminRequest, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid refund ID" }); return; }
  const parsed = AdminNotesBody.safeParse(req.body ?? {});
  if (!parsed.success || !parsed.data.failedReason) { res.status(400).json({ error: "failedReason is required" }); return; }
  const now = new Date().toISOString();
  const result = await db.transaction(async (tx) => {
    const valid = await validateRefundAmount(tx as typeof db, id, 1);
    if (valid.kind !== "ok") return valid;
    if (valid.refund.status === "failed") return { kind: "failed" as const, refund: valid.refund, didMutate: false };
    if (!["approved", "processing"].includes(valid.refund.status)) return { kind: "invalid_status" as const, status: valid.refund.status };
    const [updated] = await tx.update(balletRefundsTable).set({ status: "failed", failedReason: parsed.data.failedReason, updatedAt: now }).where(eq(balletRefundsTable.id, id)).returning();
    await notifyParent(tx as typeof db, { parentStudentId: updated.parentStudentId, title: "Ballet refund failed", body: "Your Ballet refund could not be completed. Please contact the studio.", type: "ballet_refund_failed", relatedEntityType: "ballet_refund", relatedEntityId: id, metadata: { applicationId: updated.applicationId, transition: "failed" } });
    return { kind: "failed" as const, refund: updated, beforeRefund: valid.refund, payment: valid.payment, didMutate: true };
  });
  if (result.kind !== "failed") { res.status(result.kind === "not_found" ? 404 : 422).json({ error: `Refund cannot be marked failed: ${result.kind}`, code: result.kind }); return; }
  if (result.didMutate) await logActivity(req, {
    action: "fail",
    module: "ballet.payments",
    entityType: "ballet_refund",
    entityId: id,
    before: refundAuditPayload({
      applicationId: result.beforeRefund.applicationId,
      levelAssignmentId: result.beforeRefund.levelAssignmentId,
      cancellationRequestId: result.beforeRefund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      beforeRefundStatus: result.beforeRefund.status,
      approvedRefundAmount: result.beforeRefund.approvedAmountEgp,
      refundMethod: result.beforeRefund.refundMethod,
      timestamp: now,
    }),
    after: refundAuditPayload({
      applicationId: result.refund.applicationId,
      levelAssignmentId: result.refund.levelAssignmentId,
      cancellationRequestId: result.refund.cancellationRequestId,
      refundId: id,
      paymentId: result.payment.id,
      afterRefundStatus: result.refund.status,
      approvedRefundAmount: result.refund.approvedAmountEgp,
      refundMethod: result.refund.refundMethod,
      timestamp: now,
    }),
    summary: `Marked Ballet refund ${id} failed`,
  });
  res.json({ refund: result.refund });
});

export default router;
