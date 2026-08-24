/**
 * Student Permanent Account Deletion — Phase B3B4: Final Permanent
 * Delete / Tombstone.
 *
 * WHAT THIS DOES — a single, atomic account-lifecycle transition:
 *   account_status: "deactivated" -> "deleted"  (terminal; no route ever
 *     transitions out of "deleted")
 *   + Student PII anonymized in place on the SAME row
 *   + token_version bumped (every outstanding JWT invalidated)
 *   + notification_devices deactivated (same pattern as /deactivate)
 *
 * WHAT THIS NEVER DOES
 *   - never issues `DELETE FROM students` or any physical row deletion —
 *     the Student row remains, forever, as a tombstone;
 *   - never rewrites a historical snapshot: bookings/package_orders/
 *     feedback rows, their payer/contact email/name/phone columns, amounts,
 *     payment_records, payment_refunds, credit_transactions, attendance,
 *     package snapshot columns are completely untouched — the ownership FK
 *     (student_id) on those rows keeps pointing at this now-tombstoned id,
 *     which is exactly what "preserve historical participation without
 *     retaining unnecessary Student PII" means: the PII lived on the
 *     Student row, not duplicated onto the historical rows, so anonymizing
 *     the one row is sufficient and nothing else needs touching;
 *   - never touches Level C / Level D legacy rows in any way — they are
 *     categorically outside this transition (binding B3B4 policy);
 *   - never touches children/ballet entities — no cascade of any kind;
 *   - never mutates Finance amounts/totals — nothing here writes to
 *     payment_records, payment_refunds, or credit_transactions;
 *   - never trusts a client-supplied `canDelete` — the full blocker set
 *     (computeStudentDeletionImpact) is recomputed fresh, inside this same
 *     locked transaction, exactly as that module's own doc comment requires.
 *
 * PRECONDITIONS (all re-checked fresh, under a row lock, in one transaction):
 *   Student exists; account_status = "deactivated"; an active deletion
 *   preparation exists and matches the submitted workflowId (staleness
 *   gate, same pattern as B3B2E/B3B3); computeStudentDeletionImpact says
 *   canDelete=true (this already encodes: no unresolved Level-B, no
 *   EVIDENCE_CONFLICT, no other financial/package/booking/ballet blocker —
 *   applyManualResolutionBlocker is layered on top exactly as the existing
 *   deletion-impact ROUTE already does, so the SAME authoritative check the
 *   Admin UI reads from is what gates the real mutation, not a re-derived
 *   copy); zero PROVEN_OWNER decisions still pending application
 *   (listEligibleBackfillTargets returns empty — a pending backfill is a
 *   hard block, per binding policy, not something this phase silently
 *   applies on the caller's behalf).
 *
 * IDEMPOTENCY — a second identical request against an already-deleted
 * Student is a stable, side-effect-free "already deleted" outcome, not an
 * error and not a re-anonymization. Concurrency is handled by locking the
 * student row FOR UPDATE before reading account_status, exactly like
 * /deactivate and /reactivate.
 */
import { sql } from "drizzle-orm";
import { db, studentsTable, notificationDevicesTable } from "@workspace/db";
import { getActivePreparation } from "./studentDeletionPreparation";
import { listEligibleBackfillTargets } from "./studentDeletionOwnershipBackfill";
import { computeStudentDeletionImpact, applyManualResolutionBlocker } from "./studentDeletionImpact";
import { computeManualResolutionBlockSummary } from "./studentDeletionManualResolution";

export const PERMANENT_DELETE_POLICY_VERSION = "1";

export type PermanentDeleteRejectionReason =
  | "studentNotFound"
  | "studentActive"
  | "preparationRequired"
  | "workflowStale"
  | "canDeleteFalse"
  | "pendingOwnershipBackfill";

export type PermanentDeleteOutcome =
  | { kind: "rejected"; reason: PermanentDeleteRejectionReason; blockers?: Array<{ key: string; label: string }> }
  | { kind: "alreadyDeleted"; studentId: number; deletedAt: string | null }
  | { kind: "deleted"; studentId: number; workflowId: number; deletedAt: string };

/**
 * Deterministic, non-reusable, per-row anonymized values for the fields
 * that identify or authenticate the Student. `email` must stay non-null and
 * unique (students.email has a UNIQUE constraint) so the tombstone id is
 * embedded directly rather than a random value, guaranteeing no collision
 * across repeated runs or across different deleted students.
 */
function tombstoneFields(studentId: number) {
  return {
    name: `Deleted Student #${studentId}`,
    email: `deleted-student-${studentId}@tombstone.invalid`,
    phone: null,
    passwordHash: null,
    authProvider: null,
    googleId: null,
    appleId: null,
    facebookId: null,
    avatarUrl: null,
    avatarSource: null,
    providerAvatarUrl: null,
    providerDisplayName: null,
    gender: null,
    dateOfBirth: null,
    city: null,
    nationality: null,
    howDidYouHearAboutUs: null,
    notes: null,
  } as const;
}

export async function applyStudentPermanentDelete(params: {
  studentId: number;
  workflowId: number;
  adminId: number;
}): Promise<PermanentDeleteOutcome> {
  const { studentId, workflowId, adminId } = params;

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: studentsTable.id, accountStatus: studentsTable.accountStatus, deletedAt: studentsTable.deletedAt })
      .from(studentsTable)
      .where(sql`${studentsTable.id} = ${studentId}`)
      .for("update")
      .limit(1);
    if (!locked) return { kind: "rejected", reason: "studentNotFound" };

    if (locked.accountStatus === "deleted") {
      // Idempotent terminal state: no second anonymization pass, no error,
      // no duplicate audit/token-version effect.
      return { kind: "alreadyDeleted", studentId, deletedAt: locked.deletedAt };
    }
    if (locked.accountStatus !== "deactivated") {
      return { kind: "rejected", reason: "studentActive" };
    }

    const activePrep = await getActivePreparation(tx, studentId);
    if (!activePrep) return { kind: "rejected", reason: "preparationRequired" };
    if (Number(activePrep.id) !== Number(workflowId)) return { kind: "rejected", reason: "workflowStale" };

    // Zero pending PROVEN_OWNER backfill. This is a hard precondition, not
    // something silently applied on the caller's behalf — B3B3's executor
    // is the only thing ever allowed to populate an ownership FK, and it
    // must be run (as its own explicit Admin action) before permanent
    // delete becomes eligible.
    const pendingBackfill = await listEligibleBackfillTargets(tx, studentId, workflowId);
    if (pendingBackfill.length > 0) return { kind: "rejected", reason: "pendingOwnershipBackfill" };

    // Full blocker recomputation, fresh, inside this lock — the SAME
    // authoritative check the deletion-impact route composes for the Admin
    // UI (base impact blockers + the manual-resolution/EVIDENCE_CONFLICT
    // layer), never a client-supplied value.
    const impactOutcome = await computeStudentDeletionImpact(studentId, tx);
    if (impactOutcome.kind !== "ok") {
      // notFound/alreadyDeleted are unreachable here (we already hold the
      // lock and just proved accountStatus === "deactivated"), but fail
      // closed rather than assume.
      return { kind: "rejected", reason: "studentNotFound" };
    }
    const manualResolutionSummary = await computeManualResolutionBlockSummary(tx, studentId);
    const finalImpact = applyManualResolutionBlocker(impactOutcome.result, manualResolutionSummary);
    if (!finalImpact.canDelete) {
      return {
        kind: "rejected",
        reason: "canDeleteFalse",
        blockers: finalImpact.blockers.map((b) => ({ key: b.key, label: b.label })),
      };
    }

    const deletedAt = new Date().toISOString();
    await tx
      .update(studentsTable)
      .set({
        accountStatus: "deleted",
        deletedAt,
        deletedByAdminId: adminId,
        tokenVersion: sql`${studentsTable.tokenVersion} + 1`,
        ...tombstoneFields(studentId),
      })
      .where(sql`${studentsTable.id} = ${studentId}`);

    // Same pattern as /deactivate — devices go inactive, not deleted.
    await tx
      .update(notificationDevicesTable)
      .set({ isActive: false })
      .where(sql`${notificationDevicesTable.studentId} = ${studentId}`);

    return { kind: "deleted", studentId, workflowId, deletedAt };
  });
}
