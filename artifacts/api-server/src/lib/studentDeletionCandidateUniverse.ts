/**
 * Student Permanent Account Deletion — Phase B3B2E Canonicalization Fix.
 *
 * ONE canonical, read-only, Student-scoped candidate-derivation function,
 * shared by studentDeletionAttributionPlanner.ts (B3B1) and
 * studentDeletionManualResolution.ts (B3B2E). Narrowly scoped to exactly:
 * "for domain X and target student S, return every candidate row with its
 * admission channel(s), explicit-ownership state, provenance/email-relevance
 * state (channel B — reuses classifyRow unchanged), independent Level-B
 * evidence state (channel C — reuses deriveLevelBEvidence unchanged), and
 * evidence-conflict state."
 *
 * Never returns raw email/fingerprint/payment-detail/child-PII — only
 * classification codes, counts, internal record ids, and student ids used
 * for internal computation.
 *
 * ZERO WRITES.
 */
import { sql } from "drizzle-orm";
import { fingerprintStudentEmail } from "./studentEmailProvenance";
import { deriveLevelBEvidence, type LevelBEvidenceOutcome } from "./studentDeletionManualResolution";

export type CandidateChannel = "A" | "B" | "C";

export type ProvenanceClassification =
  | "ALREADY_ATTRIBUTED"
  | "SAFE_TO_ATTRIBUTE"
  | "UNPROVEN_PRE_T0"
  | "AMBIGUOUS_PROVENANCE"
  | "NO_MATCH"
  | "SEMANTICALLY_NOT_STUDENT_OWNERSHIP"
  | "MISSING_REQUIRED_TIMESTAMP"
  | "MALFORMED_LEGACY_IDENTITY"
  | "NOT_A_CANDIDATE"; // row never entered channel B at all (fingerprint not in S's known set)

export type CandidateDomain = "bookings" | "package_orders" | "feedback";

export interface CanonicalCandidate {
  domain: CandidateDomain;
  targetRecordId: number;
  channels: CandidateChannel[];
  explicitOwner: boolean; // channel A
  provenanceClassification: ProvenanceClassification; // channel B (unchanged classifyRow logic)
  levelBEvidence: "NONE" | "INSUFFICIENT" | "LEVEL_B" | "CONFLICT"; // channel C
  /**
   * True when channel B implies ownership by a DIFFERENT student than
   * channel C's independent evidence for the SAME row (Section 5). Distinct
   * from levelBEvidence === "CONFLICT" (which is a credit-vs-attendance
   * disagreement within channel C itself, or a multi-student spread across
   * those two immutable sources — see deriveLevelBEvidence).
   */
  crossSignalConflict: boolean;
}

export const EVIDENCE_CONFLICT_REASON = "EVIDENCE_CONFLICT";

function isWellFormedEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface IntervalRow { student_id: number; valid_from: string; valid_to: string | null }

/**
 * Unchanged from B3B1 studentDeletionAttributionPlanner.classifyRow —
 * duplicated verbatim here as the single canonical copy; the planner now
 * imports THIS function instead of keeping its own private copy, so there
 * is exactly one authored definition (Section 4/7 of the brief: do not
 * touch this logic).
 */
export function classifyRow(
  targetStudentId: number,
  rawEmail: string | null,
  timestamp: string | null,
  t0: string | null,
  intervalsByFingerprint: Map<string, IntervalRow[]>,
): Exclude<ProvenanceClassification, "NOT_A_CANDIDATE" | "SEMANTICALLY_NOT_STUDENT_OWNERSHIP" | "ALREADY_ATTRIBUTED"> {
  if (!isWellFormedEmail(rawEmail)) return "MALFORMED_LEGACY_IDENTITY";
  if (!timestamp) return "MISSING_REQUIRED_TIMESTAMP";

  const fp = fingerprintStudentEmail(rawEmail as string);
  const intervals = intervalsByFingerprint.get(fp) ?? [];
  const covering = intervals.filter((iv) => {
    return iv.valid_from <= timestamp && (iv.valid_to === null || timestamp < iv.valid_to);
  });

  if (covering.length === 0) {
    if (t0 && timestamp < t0) return "UNPROVEN_PRE_T0";
    return "NO_MATCH";
  }
  const distinctOwners = new Set(covering.map((iv) => iv.student_id));
  if (distinctOwners.size > 1) return "AMBIGUOUS_PROVENANCE";
  const owner = covering[0]!.student_id;
  if (owner !== targetStudentId) {
    if (t0 && timestamp < t0) return "UNPROVEN_PRE_T0";
    return "NO_MATCH";
  }
  if (t0 && timestamp < t0) return "UNPROVEN_PRE_T0";
  return "SAFE_TO_ATTRIBUTE";
}

interface Row { [key: string]: unknown }
async function many<T = Row>(executor: any, query: any): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as T[];
}

/**
 * Returns the canonical package_orders candidate set for studentId,
 * combining channel B (email/provenance — reusing classifyRow unchanged)
 * and channel C (independent Level-B evidence — reusing deriveLevelBEvidence
 * unchanged) as a UNION, never double-counted, with cross-signal conflict
 * detection (Section 5).
 *
 * Only package_orders has a channel-C evidence source in this phase
 * (deriveLevelBEvidence covers package_orders only — credit_transactions
 * and attendance both carry package_order_id, not booking_id/feedback_id).
 * bookings and feedback remain channel-A/B only, which is expected and
 * documented, not a gap (brief Section 11, items 21/23).
 */
export async function computePackageOrderCandidateUniverse(
  executor: any,
  studentId: number,
  t0: string | null,
  knownFingerprints: Set<string>,
): Promise<CanonicalCandidate[]> {
  const allPackageOrderRows = await many<{ id: number; student_email: string | null; created_at: string | null; participant_type: string | null }>(executor, sql`
    SELECT id, student_email, created_at, participant_type FROM package_orders
    WHERE student_id IS NULL
  `);

  // Channel-C independent evidence: every unattributed package_order that
  // has ANY credit_transactions/attendance evidence pointing at studentId
  // OR at a conflicting other student on the SAME row alongside a channel-B
  // implication for studentId (handled below).
  const channelCRows = await many<{ package_order_id: number }>(executor, sql`
    SELECT DISTINCT package_order_id FROM (
      SELECT package_order_id FROM credit_transactions WHERE package_order_id IS NOT NULL
      UNION
      SELECT package_order_id FROM attendance WHERE package_order_id IS NOT NULL
    ) x
    WHERE package_order_id IN (SELECT id FROM package_orders WHERE student_id IS NULL)
  `);
  const channelCCandidateIds = new Set(channelCRows.map((r) => Number(r.package_order_id)));

  // Distinct emails across ALL unattributed rows relevant either via
  // channel B candidacy or channel C evidence-touch, for one batched
  // interval lookup (mirrors planner's existing query-count discipline).
  function isCandidateRow(rawEmail: string | null): boolean {
    if (!isWellFormedEmail(rawEmail)) return true;
    const fp = fingerprintStudentEmail((rawEmail as string).trim().toLowerCase());
    return knownFingerprints.has(fp);
  }

  const relevantRows = allPackageOrderRows.filter(
    (r) => isCandidateRow(r.student_email) || channelCCandidateIds.has(Number(r.id)),
  );

  const distinctEmails = new Set<string>();
  for (const r of relevantRows) if (isWellFormedEmail(r.student_email)) distinctEmails.add((r.student_email as string).trim().toLowerCase());
  const fingerprintList = Array.from(distinctEmails).map((e) => fingerprintStudentEmail(e));
  const intervalsByFingerprint = new Map<string, IntervalRow[]>();
  if (fingerprintList.length > 0) {
    const intervalRows = await many<any>(executor, sql`
      SELECT student_id, email_fingerprint, valid_from, valid_to
      FROM student_email_identity_history
      WHERE email_fingerprint IN (${sql.join(fingerprintList.map((f) => sql`${f}`), sql`,`)})
    `);
    for (const row of intervalRows) {
      const fp = row.email_fingerprint as string;
      const list = intervalsByFingerprint.get(fp) ?? [];
      list.push({ student_id: Number(row.student_id), valid_from: row.valid_from, valid_to: row.valid_to });
      intervalsByFingerprint.set(fp, list);
    }
  }

  const results: CanonicalCandidate[] = [];
  for (const r of relevantRows) {
    const id = Number(r.id);
    const channels: CandidateChannel[] = [];

    let provenanceClassification: ProvenanceClassification = "NOT_A_CANDIDATE";
    const isChannelBCandidate = isCandidateRow(r.student_email);
    if (isChannelBCandidate) {
      channels.push("B");
      if (r.participant_type === "child") {
        provenanceClassification = !isWellFormedEmail(r.student_email)
          ? "MALFORMED_LEGACY_IDENTITY"
          : !r.created_at
            ? "MISSING_REQUIRED_TIMESTAMP"
            : "SEMANTICALLY_NOT_STUDENT_OWNERSHIP";
      } else {
        provenanceClassification = classifyRow(studentId, r.student_email, r.created_at, t0, intervalsByFingerprint);
      }
    }

    let levelBEvidence: CanonicalCandidate["levelBEvidence"] = "NONE";
    let crossSignalConflict = false;
    if (channelCCandidateIds.has(id)) {
      const outcome: LevelBEvidenceOutcome = await deriveLevelBEvidence(executor, studentId, "package_orders", id);
      if (outcome.kind === "levelB") {
        channels.push("C");
        levelBEvidence = "LEVEL_B";
      } else if (outcome.kind === "conflict") {
        levelBEvidence = "CONFLICT";
      } else if (outcome.kind === "insufficientEvidence") {
        levelBEvidence = "INSUFFICIENT";
      }

      // Section 5: channel B implies studentId (SAFE_TO_ATTRIBUTE) or the
      // row is genuinely channel-B-owned by studentId, but the row's
      // credit_transactions/attendance evidence (any non-null student_id on
      // either immutable source) points at a DIFFERENT student than
      // studentId. This is detected by checking whether ANY evidence row
      // exists for a different student while channel B says this student.
      if (provenanceClassification === "SAFE_TO_ATTRIBUTE") {
        const otherEvidence = await many<{ n: string }>(executor, sql`
          SELECT count(*)::text AS n FROM (
            SELECT student_id FROM credit_transactions WHERE package_order_id = ${id} AND student_id IS NOT NULL AND student_id <> ${studentId}
            UNION ALL
            SELECT student_id FROM attendance WHERE package_order_id = ${id} AND student_id IS NOT NULL AND student_id <> ${studentId}
          ) y
        `);
        if (Number(otherEvidence[0]?.n ?? "0") > 0) {
          crossSignalConflict = true;
        }
      }
      // Symmetric case: channel C independently says studentId (LEVEL_B for
      // this student), but the row's OWN stored email has a covering
      // provenance interval for a DIFFERENT student at this row's
      // timestamp — regardless of whether that email is in studentId's own
      // known-fingerprint set (it deliberately is not, in the core Section
      // 3 case; a genuine conflict is when it covers ANOTHER student).
      if (levelBEvidence === "LEVEL_B" && isWellFormedEmail(r.student_email) && r.created_at) {
        const fp = fingerprintStudentEmail((r.student_email as string).trim().toLowerCase());
        const intervals = intervalsByFingerprint.get(fp) ?? [];
        const covering = intervals.filter((iv) => iv.valid_from <= (r.created_at as string) && (iv.valid_to === null || (r.created_at as string) < iv.valid_to));
        if (covering.some((iv) => iv.student_id !== studentId)) {
          crossSignalConflict = true;
        }
      }
    }

    if (channels.length === 0) continue; // not a canonical candidate for this student at all

    results.push({
      domain: "package_orders",
      targetRecordId: id,
      channels,
      explicitOwner: false,
      provenanceClassification,
      levelBEvidence,
      crossSignalConflict,
    });
  }
  return results;
}
