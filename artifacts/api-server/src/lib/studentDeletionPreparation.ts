/**
 * Phase B3B0-2: deletion-preparation freeze foundation.
 *
 * Small helper library over `student_deletion_workflows`. Preparation is a
 * separate, orthogonal, administrative workflow concept from deactivation
 * (which governs authentication/access via account_status). Starting or
 * cancelling a preparation NEVER touches account_status, token_version,
 * notification_devices, Finance/Bookings, or provenance history — those are
 * each other phases' concerns.
 *
 * Current policy version for new preparations. A simple string constant —
 * bump this if the preparation-precondition rules ever change in a future
 * phase. Not tied to any other versioning scheme in the codebase.
 */
export const DELETION_PREPARATION_POLICY_VERSION = "1";

export const STUDENT_DELETION_PREPARATION_ACTIVE_CODE = "STUDENT_DELETION_PREPARATION_ACTIVE";

import { and, eq } from "drizzle-orm";
import { db, studentDeletionWorkflowsTable } from "@workspace/db";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Returns the active (status='PREPARING') workflow row for a student, if
 * any, using the given executor (so callers already inside a transaction —
 * e.g. holding a FOR UPDATE lock on the student row — read through the same
 * connection rather than racing a separate one).
 */
export async function getActivePreparation(executor: Executor, studentId: number) {
  const [row] = await executor
    .select()
    .from(studentDeletionWorkflowsTable)
    .where(and(eq(studentDeletionWorkflowsTable.studentId, studentId), eq(studentDeletionWorkflowsTable.status, "PREPARING")))
    .limit(1);
  return row ?? null;
}
