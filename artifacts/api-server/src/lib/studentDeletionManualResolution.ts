/**
 * Student Permanent Account Deletion — Phase B3B2E: Level-B Manual
 * Resolution Decision Layer.
 *
 * LEVEL-B EVIDENCE MODEL (re-derived server-side, never trusted from a
 * client claim): a `package_orders` row with `student_id IS NULL` qualifies
 * as Level B for candidate student S if and only if:
 *   - the package_order itself has NO explicit `student_id` (it is a
 *     genuine unattributed candidate at all — not already owned), AND
 *   - it is currently part of S's live B3B1-planner-computed candidate set
 *     (its own email fingerprint-matches S's known fingerprint set), AND
 *   - AT LEAST ONE `credit_transactions` row with
 *     `credit_transactions.package_order_id = package_orders.id` has
 *     `credit_transactions.student_id = S` (immutable ledger evidence), AND
 *   - AT LEAST ONE `attendance` row with
 *     `attendance.package_order_id = package_orders.id` has
 *     `attendance.student_id = S` (immutable check-in evidence), AND
 *   - across ALL credit_transactions and attendance rows referencing this
 *     package_order_id that carry a non-null student_id, every one of them
 *     agrees on the SAME student (S) — any other student_id present on
 *     either side is a conflict and downgrades the row out of Level B.
 *
 * This is NOT "any two matches" — both sources must be independent
 * (distinct immutable tables, non-email-derived), semantically relevant
 * (both genuinely reference package ownership/consumption), and
 * non-conflicting. A row with only one of the two sources, or with
 * conflicting student_ids across sources, is NOT Level B (it is Level C/D
 * territory, out of scope for this layer).
 *
 * ZERO WRITES to package_orders/credit_transactions/attendance/bookings/
 * feedback ownership FKs happen anywhere in this module. This module only
 * ever reads evidence and, via recordManualResolution, writes to the
 * dedicated `student_legacy_identity_resolutions` table.
 */
import { sql } from "drizzle-orm";
import { db, studentLegacyIdentityResolutionsTable, studentsTable } from "@workspace/db";
import { getActivePreparation } from "./studentDeletionPreparation";
import { fingerprintStudentEmail } from "./studentEmailProvenance";
import { computePackageOrderCandidateUniverse } from "./studentDeletionCandidateUniverse";

export const MANUAL_RESOLUTION_POLICY_VERSION = "1";

export type ManualResolutionDomain = "package_orders";
export type ManualResolutionDecision = "PROVEN_OWNER" | "NOT_THIS_STUDENT" | "UNRESOLVED";

export const EVIDENCE_REASON_CREDIT_AND_ATTENDANCE_AGREE = "CREDIT_TXN_AND_ATTENDANCE_AGREE";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

interface Row { [key: string]: unknown }
async function one<T = Row>(executor: any, query: any): Promise<T> {
  const result = await executor.execute(query);
  return (result.rows[0] ?? {}) as T;
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
 * Builds the (t0, knownFingerprints) context computePackageOrderCandidateUniverse
 * needs, mirroring studentDeletionAttributionPlanner's own derivation
 * exactly (same queries, same semantics) so both callers feed the shared
 * function identical inputs for the same student.
 */
async function getStudentProvenanceContext(executor: Executor, studentId: number) {
  const studentRow = await one<{ email: string | null }>(executor, sql`
    SELECT email FROM students WHERE id = ${studentId} LIMIT 1
  `);
  const t0Row = await one<{ activated_at: string | null }>(executor, sql`
    SELECT activated_at FROM provenance_activation ORDER BY id ASC LIMIT 1
  `);
  const knownFingerprints = new Set<string>();
  if (isWellFormedEmail(studentRow.email)) {
    knownFingerprints.add(fingerprintStudentEmail((studentRow.email as string).trim().toLowerCase()));
  }
  const historyRows = await many<{ email_fingerprint: string }>(executor, sql`
    SELECT DISTINCT email_fingerprint FROM student_email_identity_history WHERE student_id = ${studentId}
  `);
  for (const r of historyRows) knownFingerprints.add(r.email_fingerprint);
  return { t0: t0Row.activated_at ?? null, knownFingerprints };
}

export type LevelBEvidenceOutcome =
  | { kind: "notCandidate"; reason: "ALREADY_OWNED" | "NOT_A_PACKAGE_ORDER" }
  | { kind: "insufficientEvidence"; reason: "LEVEL_C_OR_D" }
  | { kind: "conflict"; reason: "CONFLICTING_STUDENT_IDS" }
  | { kind: "levelB"; reasonCode: string; creditTransactionIds: number[]; attendanceIds: number[] };

/**
 * Fresh, server-side re-derivation of Level-B evidence for one
 * (studentId, domain='package_orders', targetRecordId) pair. Must be called
 * inside the SAME transaction as any resolution insert (Section 7/9 of the
 * brief) — never trust a client-supplied evidenceLevel claim.
 */
export async function deriveLevelBEvidence(
  executor: Executor,
  studentId: number,
  domain: ManualResolutionDomain,
  targetRecordId: number,
): Promise<LevelBEvidenceOutcome> {
  if (domain !== "package_orders") {
    return { kind: "notCandidate", reason: "NOT_A_PACKAGE_ORDER" };
  }

  const order = await one<{ id: number; student_id: number | null }>(executor, sql`
    SELECT id, student_id FROM package_orders WHERE id = ${targetRecordId} LIMIT 1
  `);
  if (order.id === undefined) {
    return { kind: "notCandidate", reason: "NOT_A_PACKAGE_ORDER" };
  }
  if (order.student_id !== null && order.student_id !== undefined) {
    return { kind: "notCandidate", reason: "ALREADY_OWNED" };
  }

  const creditRows = await many<{ id: number; student_id: number | null }>(executor, sql`
    SELECT id, student_id FROM credit_transactions
    WHERE package_order_id = ${targetRecordId} AND student_id IS NOT NULL
  `);
  const attendanceRows = await many<{ id: number; student_id: number | null }>(executor, sql`
    SELECT id, student_id FROM attendance
    WHERE package_order_id = ${targetRecordId} AND student_id IS NOT NULL
  `);

  const allStudentIds = new Set<number>([
    ...creditRows.map((r) => Number(r.student_id)),
    ...attendanceRows.map((r) => Number(r.student_id)),
  ]);
  if (allStudentIds.size > 1) {
    return { kind: "conflict", reason: "CONFLICTING_STUDENT_IDS" };
  }

  const creditForStudent = creditRows.filter((r) => Number(r.student_id) === studentId);
  const attendanceForStudent = attendanceRows.filter((r) => Number(r.student_id) === studentId);

  if (creditForStudent.length === 0 || attendanceForStudent.length === 0) {
    return { kind: "insufficientEvidence", reason: "LEVEL_C_OR_D" };
  }

  return {
    kind: "levelB",
    reasonCode: EVIDENCE_REASON_CREDIT_AND_ATTENDANCE_AGREE,
    creditTransactionIds: creditForStudent.map((r) => Number(r.id)),
    attendanceIds: attendanceForStudent.map((r) => Number(r.id)),
  };
}

export type RecordResolutionOutcome =
  | { kind: "studentNotFound" }
  | { kind: "studentAlreadyDeleted" }
  | { kind: "studentNotDeactivated" }
  | { kind: "preparationRequired" }
  | { kind: "workflowStale" }
  | { kind: "notCandidate"; reason: string }
  | { kind: "notLevelB"; reason: string }
  | { kind: "evidenceConflict" }
  | { kind: "recorded"; row: typeof studentLegacyIdentityResolutionsTable.$inferSelect };

/**
 * Records one append-only resolution EVENT row. Never UPDATEs an existing
 * row — see the schema module doc for why append-only + latest-wins is the
 * chosen model. Every precondition (Section 8/9 of the brief) is re-checked
 * fresh, inside this same transaction, holding a row lock on the student.
 */
export async function recordManualResolution(params: {
  studentId: number;
  workflowId: number;
  domain: ManualResolutionDomain;
  targetRecordId: number;
  decision: ManualResolutionDecision;
  adminId: number;
}): Promise<RecordResolutionOutcome> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: studentsTable.id, accountStatus: studentsTable.accountStatus })
      .from(studentsTable)
      .where(sql`${studentsTable.id} = ${params.studentId}`)
      .for("update")
      .limit(1);
    if (!locked) return { kind: "studentNotFound" };
    if (locked.accountStatus === "deleted") return { kind: "studentAlreadyDeleted" };
    if (locked.accountStatus !== "deactivated") return { kind: "studentNotDeactivated" };

    const activePrep = await getActivePreparation(tx, params.studentId);
    if (!activePrep) return { kind: "preparationRequired" };
    if (Number(activePrep.id) !== Number(params.workflowId)) return { kind: "workflowStale" };

    const evidence = await deriveLevelBEvidence(tx, params.studentId, params.domain, params.targetRecordId);
    if (evidence.kind === "notCandidate") return { kind: "notCandidate", reason: evidence.reason };
    if (evidence.kind === "conflict") return { kind: "notLevelB", reason: evidence.reason };
    if (evidence.kind === "insufficientEvidence") {
      // Section 5/9: before concluding this is merely insufficient evidence,
      // fresh-check for a CROSS-SIGNAL conflict via the SAME canonical
      // shared-derivation gate the planner consumes — e.g. this row's
      // channel-C evidence agrees on a DIFFERENT student while channel-B
      // provenance points at params.studentId (studentId sees no evidence
      // of its own => "insufficientEvidence" from deriveLevelBEvidence's
      // narrow per-student view, but the row is genuinely conflicted, not
      // silently non-candidate).
      const conflictCheck = await checkCanonicalLevelBCandidate(tx, params.studentId, params.targetRecordId);
      if (!conflictCheck.eligible && conflictCheck.reason === "EVIDENCE_CONFLICT") return { kind: "evidenceConflict" };
      return { kind: "notLevelB", reason: evidence.reason };
    }

    // Section 5/9: fresh cross-signal conflict re-check via the SAME
    // canonical shared-derivation gate the planner consumes. A row whose
    // channel-B provenance points at a different student than this row's
    // independent channel-C evidence must be rejected, for either student,
    // until a future policy resolves it — never silently prioritized.
    const canonicalCheck = await checkCanonicalLevelBCandidate(tx, params.studentId, params.targetRecordId);
    if (!canonicalCheck.eligible) {
      if (canonicalCheck.reason === "EVIDENCE_CONFLICT") return { kind: "evidenceConflict" };
      return { kind: "notCandidate", reason: canonicalCheck.reason };
    }

    const snapshotRef = `wf${params.workflowId}:credit=${evidence.creditTransactionIds.slice().sort((a, b) => a - b).join(",")}:att=${evidence.attendanceIds.slice().sort((a, b) => a - b).join(",")}`;

    const [inserted] = await tx
      .insert(studentLegacyIdentityResolutionsTable)
      .values({
        studentId: params.studentId,
        domain: params.domain,
        targetRecordId: params.targetRecordId,
        deletionWorkflowId: params.workflowId,
        evidenceLevel: "B",
        decision: params.decision,
        evidenceReasonCode: evidence.reasonCode,
        evidenceSnapshotRef: snapshotRef,
        resolvedByAdminId: params.adminId,
      })
      .returning();

    return { kind: "recorded", row: inserted! };
  });
}

/**
 * Returns, for one (studentId, domain, targetRecordId) pair, the latest
 * resolution row (by resolvedAt then id) — the append-only "current state"
 * derivation. Null if no resolution row exists for the pair yet.
 */
export async function currentResolutionFor(
  executor: Executor,
  studentId: number,
  domain: ManualResolutionDomain,
  targetRecordId: number,
) {
  const rows = await many<Row>(executor, sql`
    SELECT * FROM student_legacy_identity_resolutions
    WHERE student_id = ${studentId} AND domain = ${domain} AND target_record_id = ${targetRecordId}
    ORDER BY resolved_at DESC, id DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Computes this student's full Level-B candidate set (package_orders
 * currently unattributed, in this student's B3B1 candidate universe, with
 * fresh Level-B evidence) and, for each, the latest resolution (if any).
 * Used by both the B2B deletion-impact block and the B3B1 planner's
 * additive resolutionStatus field. Read-only.
 */
export async function computeLevelBCandidatesWithResolutions(
  executor: Executor,
  studentId: number,
): Promise<Array<{ targetRecordId: number; resolutionStatus: "NONE" | ManualResolutionDecision }>> {
  // Phase B3B2E: candidate universe is now sourced from the ONE canonical
  // shared derivation function (studentDeletionCandidateUniverse), the same
  // one the B3B1 planner uses — not a locally re-authored query. A row is
  // eligible for manual resolution here iff it is a canonical candidate
  // AND its channel-C evidence is genuinely Level B AND there is no
  // cross-signal conflict (Section 5/9 of the brief) — a conflicted row is
  // visible in the planner but NOT resolvable until a future policy exists.
  const { t0, knownFingerprints } = await getStudentProvenanceContext(executor, studentId);
  const canonical = await computePackageOrderCandidateUniverse(executor, studentId, t0, knownFingerprints);

  const results: Array<{ targetRecordId: number; resolutionStatus: "NONE" | ManualResolutionDecision }> = [];
  for (const cand of canonical) {
    if (cand.crossSignalConflict) continue;
    if (cand.levelBEvidence !== "LEVEL_B") continue;
    const latest = await currentResolutionFor(executor, studentId, "package_orders", cand.targetRecordId);
    results.push({
      targetRecordId: cand.targetRecordId,
      resolutionStatus: latest ? (latest.decision as ManualResolutionDecision) : "NONE",
    });
  }
  return results;
}

/**
 * Fresh server-side re-check (Section 9 of the brief): is targetRecordId
 * currently a canonical Level-B candidate for studentId with NO unresolved
 * evidence conflict? Used by recordManualResolution as the SAME shared-
 * function-derived gate the planner and computeLevelBCandidatesWithResolutions
 * use — never a separately-authored check.
 */
export async function checkCanonicalLevelBCandidate(
  executor: Executor,
  studentId: number,
  targetRecordId: number,
): Promise<{ eligible: true } | { eligible: false; reason: "NOT_CANONICAL_CANDIDATE" | "EVIDENCE_CONFLICT" }> {
  const { t0, knownFingerprints } = await getStudentProvenanceContext(executor, studentId);
  const canonical = await computePackageOrderCandidateUniverse(executor, studentId, t0, knownFingerprints);
  const cand = canonical.find((c) => c.targetRecordId === targetRecordId);
  // Conflict is checked FIRST, independent of whether this student's own
  // narrow levelBEvidence view reaches LEVEL_B: a row can be conflicted
  // from Student A's perspective (channel-B says A, channel-C says a
  // DIFFERENT student) even though deriveLevelBEvidence(A, row) alone
  // reports merely "insufficient" (A has none of the row's own credit/
  // attendance evidence) — the conflict must still surface, never be
  // silently swallowed as an ordinary non-candidate.
  if (cand?.crossSignalConflict) return { eligible: false, reason: "EVIDENCE_CONFLICT" };
  if (!cand || cand.levelBEvidence !== "LEVEL_B") return { eligible: false, reason: "NOT_CANONICAL_CANDIDATE" };
  if (cand.crossSignalConflict) return { eligible: false, reason: "EVIDENCE_CONFLICT" };
  return { eligible: true };
}

export interface ManualResolutionBlockSummary {
  requiredCount: number;
  resolvedOwnerCount: number;
  resolvedNotThisStudentCount: number;
  unresolvedCount: number;
  /**
   * Rows whose channel-B provenance and channel-C independent evidence point
   * at DIFFERENT students (EVIDENCE_CONFLICT). Additive observability field;
   * these rows are ALSO included in requiredCount and unresolvedCount.
   */
  conflictCount: number;
}

/**
 * Blocker-semantics aggregate for B2B deletion-impact (Section 13 of the
 * brief): Level-B + no row / UNRESOLVED both count toward unresolvedCount
 * (both BLOCK); PROVEN_OWNER and NOT_THIS_STUDENT are each counted
 * separately.
 *
 * EVIDENCE_CONFLICT POLICY (binding): a cross-signal conflict is NOT Level
 * C/D and is NOT "out of scope" — it is known, actionable ambiguity about
 * who owns a legacy row. Such a row can never be truthfully resolved
 * (recordManualResolution rejects PROVEN_OWNER, NOT_THIS_STUDENT and
 * UNRESOLVED alike while the conflict exists), so it must be counted as a
 * REQUIRED-and-UNRESOLVED case rather than silently dropped from the
 * counters. Dropping it would let a student whose only Level-B-relevant
 * legacy row is conflicted appear fully unblocked. No automatic precedence
 * between the email signal and the Level-B signal is invented here.
 *
 * This function therefore reads the canonical candidate universe directly
 * (the same shared derivation the planner uses) rather than the
 * resolvable-only subset returned by computeLevelBCandidatesWithResolutions.
 */
export async function computeManualResolutionBlockSummary(
  executor: Executor,
  studentId: number,
): Promise<ManualResolutionBlockSummary> {
  const { t0, knownFingerprints } = await getStudentProvenanceContext(executor, studentId);
  const canonical = await computePackageOrderCandidateUniverse(executor, studentId, t0, knownFingerprints);

  const summary: ManualResolutionBlockSummary = {
    requiredCount: 0,
    resolvedOwnerCount: 0,
    resolvedNotThisStudentCount: 0,
    unresolvedCount: 0,
    conflictCount: 0,
  };

  for (const cand of canonical) {
    if (cand.crossSignalConflict) {
      // Fail-closed: required, unresolved, and unresolvABLE until policy exists.
      summary.requiredCount += 1;
      summary.unresolvedCount += 1;
      summary.conflictCount += 1;
      continue;
    }
    if (cand.levelBEvidence !== "LEVEL_B") continue;
    summary.requiredCount += 1;
    const latest = await currentResolutionFor(executor, studentId, "package_orders", cand.targetRecordId);
    const status = latest ? (latest.decision as ManualResolutionDecision) : "NONE";
    if (status === "PROVEN_OWNER") summary.resolvedOwnerCount += 1;
    else if (status === "NOT_THIS_STUDENT") summary.resolvedNotThisStudentCount += 1;
    else summary.unresolvedCount += 1; // NONE or UNRESOLVED — both block, per Section 13.
  }

  return summary;
}
