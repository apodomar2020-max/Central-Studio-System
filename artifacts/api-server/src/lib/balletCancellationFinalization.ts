import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  balletApplicationsTable,
  balletApplicationEventsTable,
  balletEnrollmentCancellationRequestsTable,
  balletLevelAssignmentsTable,
} from "@workspace/db";
import { createStudentNotification } from "./notifications";
import { logger } from "./logger";
import { enqueueJob, QUEUE_NAMES, type BalletCancellationFinalizationJob } from "./queue";
import { logActivityWithActor, systemActivityActor, type ActivityActorSnapshot } from "./activityLog";

type DbClient = typeof db;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDue(date: string | null, nowDate = todayIso()): boolean {
  return Boolean(date && date <= nowDate);
}

export async function finalizeBalletCancellationRequest(
  client: DbClient,
  input: {
    requestId: number;
    adminId: number | null;
    adminNotes?: string | null;
    forceImmediate?: boolean;
    source?: "admin" | "worker";
    auditActor?: ActivityActorSnapshot;
    auditAction?: "approveImmediate" | "finalize";
  },
) {
  const now = new Date().toISOString();
  const [request] = await client
    .select()
    .from(balletEnrollmentCancellationRequestsTable)
    .where(eq(balletEnrollmentCancellationRequestsTable.id, input.requestId))
    .limit(1)
    .for("update");

  if (!request) return { kind: "not_found" as const };

  if (request.status === "completed") {
    return { kind: "completed" as const, request, alreadyCompleted: true, didMutate: false };
  }

  if (!["pendingReview", "approved"].includes(request.status)) {
    return { kind: "invalid_status" as const, status: request.status };
  }

  if (!request.applicationId || !request.levelAssignmentId) {
    return { kind: "missing_links" as const };
  }

  const approvedTiming = request.approvedTiming ?? request.requestedTiming;
  const approvedEffectiveDate = request.approvedEffectiveDate ?? request.requestedEffectiveDate ?? todayIso();
  const immediate = input.forceImmediate || approvedTiming === "immediate";
  if (!immediate && !isDue(approvedEffectiveDate)) {
    return { kind: "not_due" as const, approvedEffectiveDate };
  }

  const [assignment] = await client
    .select()
    .from(balletLevelAssignmentsTable)
    .where(eq(balletLevelAssignmentsTable.id, request.levelAssignmentId))
    .limit(1)
    .for("update");
  const [app] = await client
    .select()
    .from(balletApplicationsTable)
    .where(eq(balletApplicationsTable.id, request.applicationId))
    .limit(1)
    .for("update");

  if (!assignment || !app) return { kind: "missing_links" as const };

  if (assignment.status !== "withdrawn") {
    await client.update(balletLevelAssignmentsTable).set({
      status: "withdrawn",
      withdrawnAt: now,
      withdrawalEffectiveDate: approvedEffectiveDate,
      withdrawalReason: request.reason,
      withdrawnByAdminId: input.adminId,
      withdrawnByCancellationRequestId: request.id,
      updatedAt: now,
    }).where(eq(balletLevelAssignmentsTable.id, assignment.id));
  }

  if (app.status !== "withdrawn") {
    await client.update(balletApplicationsTable).set({ status: "withdrawn", updatedAt: now }).where(eq(balletApplicationsTable.id, app.id));
    await client.insert(balletApplicationEventsTable).values({
      applicationId: app.id,
      fromStatus: app.status,
      toStatus: "withdrawn",
      changedById: input.adminId,
      note: input.adminNotes ?? "Enrollment cancellation completed",
    });
  }

  const [updated] = await client.update(balletEnrollmentCancellationRequestsTable).set({
    status: "completed",
    completedAt: request.completedAt ?? now,
    adminNotes: input.adminNotes ?? request.adminNotes,
    updatedAt: now,
  }).where(eq(balletEnrollmentCancellationRequestsTable.id, request.id)).returning();

  await createStudentNotification(client, {
    studentId: request.parentStudentId,
    title: "Ballet enrollment ended",
    body: `${app.childName}'s Ballet enrollment has ended.`,
    type: "ballet_cancellation_completed",
    relatedEntityType: "ballet_enrollment_cancellation_request",
    relatedEntityId: request.id,
    metadata: { applicationId: app.id, transition: "completed" },
    dedupe: true,
  });

  const didMutate = assignment.status !== "withdrawn" || app.status !== "withdrawn" || request.status !== "completed";
  if (didMutate) {
    await logActivityWithActor(client, input.auditActor ?? systemActivityActor(), {
      action: input.auditAction ?? (input.forceImmediate ? "approveImmediate" : "finalize"),
      module: "ballet.applications",
      entityType: "ballet_enrollment_cancellation_request",
      entityId: request.id,
      entityLabel: app.childName,
      before: {
        applicationId: app.id,
        levelAssignmentId: assignment.id,
        cancellationRequestId: request.id,
        beforeApplicationStatus: app.status,
        beforeAssignmentStatus: assignment.status,
        beforeCancellationRequestStatus: request.status,
        requestedTiming: request.requestedTiming,
        approvedTiming: request.approvedTiming,
        approvedEffectiveDate: request.approvedEffectiveDate,
        parentReason: request.reason,
        timestamp: now,
      },
      after: {
        applicationId: app.id,
        levelAssignmentId: assignment.id,
        cancellationRequestId: request.id,
        afterApplicationStatus: "withdrawn",
        afterAssignmentStatus: "withdrawn",
        afterCancellationRequestStatus: "completed",
        requestedTiming: updated.requestedTiming,
        approvedTiming: updated.approvedTiming,
        approvedEffectiveDate: updated.approvedEffectiveDate,
        completedAt: updated.completedAt,
        timestamp: now,
      },
      summary: input.forceImmediate
        ? `Approved and finalized immediate Ballet cancellation request ${request.id}`
        : `Finalized Ballet cancellation request ${request.id}`,
    });
  }

  return {
    kind: "completed" as const,
    request: updated,
    application: app,
    assignment,
    alreadyCompleted: false,
    didMutate,
  };
}

export async function reconcileDueBalletCancellationRequests(limit = 100) {
  const dueRequests = await db
    .select({ id: balletEnrollmentCancellationRequestsTable.id })
    .from(balletEnrollmentCancellationRequestsTable)
    .where(and(
      eq(balletEnrollmentCancellationRequestsTable.status, "approved"),
      eq(balletEnrollmentCancellationRequestsTable.approvedTiming, "endOfPeriod"),
      sql`${balletEnrollmentCancellationRequestsTable.approvedEffectiveDate} is not null`,
      sql`${balletEnrollmentCancellationRequestsTable.approvedEffectiveDate} <= ${todayIso()}`,
    ))
    .orderBy(asc(balletEnrollmentCancellationRequestsTable.approvedEffectiveDate), asc(balletEnrollmentCancellationRequestsTable.id))
    .limit(limit);

  let enqueued = 0;
  let skipped = 0;
  for (const request of dueRequests) {
    const job = await enqueueJob<BalletCancellationFinalizationJob>(
      QUEUE_NAMES.balletCancellationFinalization,
      "finalize_cancellation_request",
      { type: "finalize_cancellation_request", requestId: request.id, source: "scheduler" },
      { jobId: `ballet-cancellation-finalize:${request.id}` },
    );
    if (job) enqueued += 1;
    else {
      skipped += 1;
      logger.warn({ requestId: request.id }, "Skipped due Ballet cancellation finalization enqueue");
    }
  }

  return { scanned: dueRequests.length, enqueued, skipped };
}

export async function processBalletCancellationFinalizationJob(job: BalletCancellationFinalizationJob) {
  if (job.type === "reconcile_due_cancellations") {
    return reconcileDueBalletCancellationRequests();
  }
  return db.transaction((tx) =>
    finalizeBalletCancellationRequest(tx as typeof db, {
      requestId: job.requestId,
      adminId: null,
      source: "worker",
    }),
  );
}
