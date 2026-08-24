/**
 * Student Permanent Account Deletion — Phase B3B3: Proven Ownership
 * Backfill Executor.
 *
 * THE ONLY consumer of a durable PROVEN_OWNER Level-B resolution. Its single
 * effect is to populate ONE canonical historical ownership FK:
 *
 *     package_orders.student_id   (NULL -> the resolved student)
 *
 * SUPPORTED DOMAIN — package_orders ONLY. This is not a simplification: it
 * is the only domain that currently has a channel-C (independent, immutable,
 * non-email-derived) evidence source at all. `credit_transactions` and
 * `attendance` both carry `package_order_id`; neither carries a booking id
 * or a feedback id, so `deriveLevelBEvidence` covers package_orders only and
 * `computePackageOrderCandidateUniverse` is the only canonical universe
 * function that exists. bookings/feedback are channel-A/B only and therefore
 * can never produce a Level-B PROVEN_OWNER decision to consume. No
 * speculative generic backfill machinery is created here for them.
 *
 * WHAT THIS MODULE NEVER DOES
 *   - never writes account_status (no 'deleted'), no tombstone, no
 *     anonymization, no permanent delete;
 *   - never touches Level C / Level D rows;
 *   - never rewrites a historical snapshot: legacy email, payer/contact
 *     name/email/phone, amounts, payment data, package snapshot columns,
 *     created_at/updated_at semantics, credit_transactions, attendance,
 *     provenance history;
 *   - never deletes or mutates a `student_legacy_identity_resolutions` row
 *     (that table stays strictly append-only; ownership state itself —
 *     `package_orders.student_id IS NOT NULL` — is the source of truth for
 *     "already applied", so no `applied` flag and no migration is needed);
 *   - never trusts anything from the client: the request carries only the
 *     student id (URL) and the workflow id (staleness matching). Target ids,
 *     owner ids and evidence are all re-derived server-side.
 *
 * TRANSACTION MODEL (documented choice): ONE TRANSACTION PER CANDIDATE.
 * A preflight pass establishes the student/workflow-level preconditions and
 * the eligible candidate list; each candidate is then applied in its own
 * transaction that re-locks the student row, re-validates every precondition
 * fresh, locks the target `package_orders` row `FOR UPDATE`, and re-derives
 * the Level-B evidence from `credit_transactions`/`attendance` again inside
 * that lock. Per-candidate transactions are chosen over one giant
 * transaction so that a late-arriving conflict on candidate N cannot roll
 * back already-correct, independently-proven ownership on candidates 1..N-1,
 * and so the lock footprint stays small. Each candidate is therefore its own
 * atomic, individually-proven unit; the response reports every candidate's
 * outcome so the caller sees exactly what happened.
 */
import { sql } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import { getActivePreparation } from "./studentDeletionPreparation";
import {
  checkCanonicalLevelBCandidate,
  currentResolutionFor,
  deriveLevelBEvidence,
} from "./studentDeletionManualResolution";
import { computePackageOrderCandidateUniverse } from "./studentDeletionCandidateUniverse";
import { fingerprintStudentEmail } from "./studentEmailProvenance";

export const OWNERSHIP_BACKFILL_POLICY_VERSION = "1";

/** The one and only domain this executor supports — see module doc. */
export type BackfillDomain = "package_orders";
export const BACKFILL_DOMAIN: BackfillDomain = "package_orders";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

interface Row { [key: string]: unknown }
async function one<T = Row>(executor: any, query: any): Promise<T | null> {
  const result = await executor.execute(query);
  return (result.rows[0] ?? null) as T | null;
}
async function many<T = Row>(executor: any, query: any): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as T[];
}

function isWellFormedEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Same (t0, knownFingerprints) derivation the planner and the manual
 * resolution layer feed into `computePackageOrderCandidateUniverse` — kept
 * identical so all three consumers see the same canonical universe.
 */
async function getStudentProvenanceContext(executor: Executor, studentId: number) {
  const studentRow = await one<{ email: string | null }>(executor, sql`
    SELECT email FROM students WHERE id = ${studentId} LIMIT 1
  `);
  const t0Row = await one<{ activated_at: string | null }>(executor, sql`
    SELECT activated_at FROM provenance_activation ORDER BY id ASC LIMIT 1
  `);
  const knownFingerprints = new Set<string>();
  if (isWellFormedEmail(studentRow?.email)) {
    knownFingerprints.add(fingerprintStudentEmail((studentRow!.email as string).trim().toLowerCase()));
  }
  const historyRows = await many<{ email_fingerprint: string }>(executor, sql`
    SELECT DISTINCT email_fingerprint FROM student_email_identity_history WHERE student_id = ${studentId}
  `);
  for (const r of historyRows) knownFingerprints.add(r.email_fingerprint);
  return { t0: t0Row?.activated_at ?? null, knownFingerprints };
}

/** Student/workflow-level rejections — the whole request fails closed. */
export type BackfillRejection =
  | { reason: "studentNotFound" }
  | { reason: "studentAlreadyDeleted" }
  | { reason: "studentNotDeactivated" }
  | { reason: "preparationRequired" }
  | { reason: "workflowStale" }
  | { reason: "ownershipConflict"; targetRecordId: number; currentOwnerStudentId: number };

export type BackfillCandidateAction =
  /** FK was NULL, is now this student. */
  | "APPLIED"
  /** FK already pointed at this student — idempotent no-op, not an error. */
  | "ALREADY_APPLIED";

export interface BackfillCandidateResult {
  domain: BackfillDomain;
  targetRecordId: number;
  action: BackfillCandidateAction;
  /** id of the durable resolution row that authorized this application. */
  resolutionId: number | null;
}

export type BackfillOutcome =
  | ({ kind: "rejected" } & BackfillRejection)
  | {
      kind: "completed";
      workflowId: number;
      appliedCount: number;
      alreadyAppliedCount: number;
      results: BackfillCandidateResult[];
    };

/**
 * Re-validates the student/workflow-level preconditions inside whatever
 * executor (and therefore transaction/lock) it is handed. Returns null when
 * everything holds, otherwise the rejection.
 */
async function revalidateStudentAndWorkflow(
  tx: any,
  studentId: number,
  workflowId: number,
): Promise<BackfillRejection | null> {
  const [locked] = await tx
    .select({ id: studentsTable.id, accountStatus: studentsTable.accountStatus })
    .from(studentsTable)
    .where(sql`${studentsTable.id} = ${studentId}`)
    .for("update")
    .limit(1);
  if (!locked) return { reason: "studentNotFound" };
  if (locked.accountStatus === "deleted") return { reason: "studentAlreadyDeleted" };
  if (locked.accountStatus !== "deactivated") return { reason: "studentNotDeactivated" };

  const activePrep = await getActivePreparation(tx, studentId);
  if (!activePrep) return { reason: "preparationRequired" };
  if (Number(activePrep.id) !== Number(workflowId)) return { reason: "workflowStale" };
  return null;
}

/**
 * Read-only: the target ids that currently hold a PROVEN_OWNER decision for
 * this student under this workflow AND are still canonical, still Level-B,
 * still unattributed. This is the number the Admin UI shows as "eligible".
 */
export async function listEligibleBackfillTargets(
  executor: Executor,
  studentId: number,
  workflowId: number,
): Promise<Array<{ targetRecordId: number; resolutionId: number }>> {
  const { t0, knownFingerprints } = await getStudentProvenanceContext(executor, studentId);
  const canonical = await computePackageOrderCandidateUniverse(executor, studentId, t0, knownFingerprints);

  const eligible: Array<{ targetRecordId: number; resolutionId: number }> = [];
  for (const cand of canonical) {
    if (cand.crossSignalConflict) continue;
    if (cand.levelBEvidence !== "LEVEL_B") continue;
    const latest = await currentResolutionFor(executor, studentId, BACKFILL_DOMAIN, cand.targetRecordId);
    if (!latest) continue;
    if (latest.decision !== "PROVEN_OWNER") continue;
    // Staleness: a decision recorded under a workflow that is no longer the
    // active one is never consumed. The workflow was restarted since; the
    // decision must be re-taken under the current workflow.
    if (Number((latest as any).deletion_workflow_id) !== Number(workflowId)) continue;
    eligible.push({ targetRecordId: cand.targetRecordId, resolutionId: Number((latest as any).id) });
  }
  return eligible;
}

/**
 * Applies ONE candidate in its own transaction, re-validating everything
 * fresh under a row lock on both the student and the target package_order.
 * Returns either the candidate result, a hard rejection, or null when the
 * candidate silently stopped being eligible (evidence changed, resolution
 * superseded, no longer canonical) — a null is NOT applied and NOT an error
 * for the request as a whole; it simply drops out of the applied set, and
 * the caller reports it via the counts (which is why a request that finds
 * nothing eligible reports appliedCount 0 rather than pretending success on
 * a row it did not touch).
 */
async function applyOneCandidate(
  studentId: number,
  workflowId: number,
  targetRecordId: number,
): Promise<
  | { kind: "result"; result: BackfillCandidateResult }
  | { kind: "rejected"; rejection: BackfillRejection }
  | { kind: "skipped" }
> {
  return db.transaction(async (tx) => {
    const precondition = await revalidateStudentAndWorkflow(tx, studentId, workflowId);
    if (precondition) return { kind: "rejected" as const, rejection: precondition };

    // Lock the canonical historical row itself before reading its ownership.
    const target = await one<{ id: number; student_id: number | null }>(tx, sql`
      SELECT id, student_id FROM package_orders WHERE id = ${targetRecordId} FOR UPDATE
    `);
    if (!target) return { kind: "skipped" as const };

    if (target.student_id !== null && target.student_id !== undefined) {
      if (Number(target.student_id) === studentId) {
        // Idempotent: a previous identical execution already applied this.
        return {
          kind: "result" as const,
          result: { domain: BACKFILL_DOMAIN, targetRecordId, action: "ALREADY_APPLIED" as const, resolutionId: null },
        };
      }
      // Defended even though the precondition chain should make it
      // unreachable: never overwrite another student's ownership.
      return {
        kind: "rejected" as const,
        rejection: {
          reason: "ownershipConflict" as const,
          targetRecordId,
          currentOwnerStudentId: Number(target.student_id),
        },
      };
    }

    // Fresh durable-decision re-read under the lock: the decision may have
    // been superseded by a newer append-only row since the preflight pass.
    const latest = await currentResolutionFor(tx, studentId, BACKFILL_DOMAIN, targetRecordId);
    if (!latest) return { kind: "skipped" as const };
    if (latest.decision !== "PROVEN_OWNER") return { kind: "skipped" as const };
    if (Number((latest as any).deletion_workflow_id) !== Number(workflowId)) return { kind: "skipped" as const };

    // Fresh evidence re-derivation under the lock: the credit_transactions /
    // attendance rows that made this Level B may have changed or been
    // removed since the decision was recorded.
    const evidence = await deriveLevelBEvidence(tx, studentId, BACKFILL_DOMAIN, targetRecordId);
    if (evidence.kind !== "levelB") return { kind: "skipped" as const };

    // ...and the same canonical gate the planner/resolution layer use, so an
    // EVIDENCE_CONFLICT that appeared after the decision fails closed.
    const canonicalCheck = await checkCanonicalLevelBCandidate(tx, studentId, targetRecordId);
    if (!canonicalCheck.eligible) return { kind: "skipped" as const };

    // The ONLY mutation in this phase: one canonical ownership FK. The
    // `student_id IS NULL` predicate is a second belt-and-braces guard on
    // top of the FOR UPDATE lock.
    const updated = await many<{ id: number }>(tx, sql`
      UPDATE package_orders SET student_id = ${studentId}
      WHERE id = ${targetRecordId} AND student_id IS NULL
      RETURNING id
    `);
    if (updated.length === 0) return { kind: "skipped" as const };

    return {
      kind: "result" as const,
      result: {
        domain: BACKFILL_DOMAIN,
        targetRecordId,
        action: "APPLIED" as const,
        resolutionId: Number((latest as any).id),
      },
    };
  });
}

/**
 * Applies every currently-eligible PROVEN_OWNER decision for this student
 * and workflow. Fails closed on any student/workflow-level staleness and on
 * any ownership conflict; never deletes, anonymizes or tombstones anything.
 */
export async function applyProvenOwnershipBackfill(params: {
  studentId: number;
  workflowId: number;
}): Promise<BackfillOutcome> {
  // Preflight (its own transaction, student row locked) — establishes the
  // student/workflow-level preconditions definitively before any mutation,
  // and computes the candidate list. Every one of these checks is repeated
  // inside each per-candidate transaction; this pass exists so that a
  // request against a non-deactivated / unprepared / stale-workflow student
  // is rejected outright rather than quietly reporting "0 applied".
  const preflight = await db.transaction(async (tx) => {
    const precondition = await revalidateStudentAndWorkflow(tx, params.studentId, params.workflowId);
    if (precondition) return { kind: "rejected" as const, rejection: precondition };
    const targets = await listEligibleBackfillTargets(tx, params.studentId, params.workflowId);
    return { kind: "ok" as const, targets };
  });
  if (preflight.kind === "rejected") {
    return { kind: "rejected", ...preflight.rejection } as BackfillOutcome;
  }

  const results: BackfillCandidateResult[] = [];
  for (const target of preflight.targets) {
    const outcome = await applyOneCandidate(params.studentId, params.workflowId, target.targetRecordId);
    if (outcome.kind === "rejected") {
      return { kind: "rejected", ...outcome.rejection } as BackfillOutcome;
    }
    if (outcome.kind === "result") results.push(outcome.result);
  }

  return {
    kind: "completed",
    workflowId: params.workflowId,
    appliedCount: results.filter((r) => r.action === "APPLIED").length,
    alreadyAppliedCount: results.filter((r) => r.action === "ALREADY_APPLIED").length,
    results,
  };
}
