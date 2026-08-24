/**
 * Student Permanent Account Deletion — Phase B3B1: Read-Only Historical
 * Attribution Planner.
 *
 * ZERO WRITES. This module only ever SELECTs, inside a single db.transaction
 * for a consistent point-in-time read (matching studentDeletionImpact.ts's
 * pattern). No audit row, no student/booking/package/feedback/provenance
 * mutation happens here.
 *
 * PRE-CONDITION: the planner may only produce an AUTHORITATIVE plan when the
 * Student has an active (PREPARING) deletion-preparation workflow — see
 * getActivePreparation. Callers must 409 (STUDENT_DELETION_PREPARATION_REQUIRED)
 * otherwise. There is no preview mode in v1 (see Phase B3B1 report Section E).
 *
 * CORE MATCHING RULE (Section 7 of the B3B1 brief): a legacy row's email E at
 * time T is SAFE_TO_ATTRIBUTE to Student S only if:
 *   - E's fingerprint matches an OPEN-OR-CLOSED interval in
 *     student_email_identity_history for S, AND
 *   - valid_from <= T AND (valid_to IS NULL OR T < valid_to)  [half-open], AND
 *   - no OTHER student's interval also covers fingerprint(E) at T
 *     (=> AMBIGUOUS_PROVENANCE), AND
 *   - domain semantics allow Student ownership at all (package_orders
 *     participantType='child' rows are never attributable to the payer).
 * "current email == legacy email" alone is NEVER sufficient proof.
 *
 * PRE-T0: a row timestamped before provenance_activation.activated_at can
 * never be SAFE_TO_ATTRIBUTE — classified UNPROVEN_PRE_T0 regardless of any
 * apparent email match, because the interval table is never backdated.
 *
 * NO RAW EMAIL / NO FINGERPRINT IN RESPONSE: this module returns only
 * counts, domain names, classification codes, and reason codes. Raw email
 * and fingerprint strings are used internally for matching only and never
 * appear on the returned StudentAttributionPlan.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { fingerprintStudentEmail } from "./studentEmailProvenance";

export const DELETION_ATTRIBUTION_PLANNER_POLICY_VERSION = "1";

export type AttributionClassification =
  | "ALREADY_ATTRIBUTED"
  | "SAFE_TO_ATTRIBUTE"
  | "UNPROVEN_PRE_T0"
  | "AMBIGUOUS_PROVENANCE"
  | "NO_MATCH"
  | "SEMANTICALLY_NOT_STUDENT_OWNERSHIP"
  | "MISSING_REQUIRED_TIMESTAMP"
  | "MALFORMED_LEGACY_IDENTITY";

export type AttributionDomain = "bookings" | "package_orders" | "feedback";

export interface DomainAttributionEntry {
  domain: AttributionDomain;
  classification: AttributionClassification;
  count: number;
  reasonCode: string;
  executionEligible: boolean;
}

export interface StudentAttributionPlan {
  studentId: number;
  workflowId: number;
  preparationStatus: "PREPARING";
  generatedAt: string;
  policyVersion: string;
  provenanceActivationReference: string | null;
  summary: {
    alreadyAttributed: number;
    safeToAttribute: number;
    ambiguous: number;
    unproven: number;
    nonAttributable: number;
  };
  domains: DomainAttributionEntry[];
}

export type AttributionPlanOutcome =
  | { kind: "notFound" }
  | { kind: "alreadyDeleted" }
  | { kind: "preparationRequired" }
  | { kind: "ok"; plan: StudentAttributionPlan };

interface Row { [key: string]: unknown }
async function one<T = Row>(executor: any, query: any): Promise<T> {
  const result = await executor.execute(query);
  return (result.rows[0] ?? {}) as T;
}
async function many<T = Row>(executor: any, query: any): Promise<T[]> {
  const result = await executor.execute(query);
  return result.rows as T[];
}

const REASON = {
  ALREADY_ATTRIBUTED: "Row already carries an explicit Student FK; email fallback is not consulted.",
  SAFE_TO_ATTRIBUTE: "Row's legacy email fingerprint falls inside a single, unambiguous provenance interval owned by this Student at the row's timestamp.",
  UNPROVEN_PRE_T0: "Row predates provenance activation (T0); pre-T0 ownership is never backdated or inferred from current-email uniqueness.",
  AMBIGUOUS_PROVENANCE: "More than one Student's provenance interval covers this email fingerprint at the row's timestamp.",
  NO_MATCH: "Row's legacy email fingerprint is in this Student's known identity set, but no covering provenance interval was found for it at the row's timestamp.",
  SEMANTICALLY_NOT_STUDENT_OWNERSHIP: "Row's participant/entitlement semantics identify a different owner (e.g. a child) than the contact/payer email; email match is not proof of Student ownership here.",
  MISSING_REQUIRED_TIMESTAMP: "Row has no usable creation timestamp for interval comparison.",
  MALFORMED_LEGACY_IDENTITY: "Row's legacy email field is empty or not a well-formed address.",
} as const satisfies Record<AttributionClassification, string>;

function isWellFormedEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

interface IntervalRow { student_id: number; valid_from: string; valid_to: string | null }

/**
 * Classifies a single legacy row that has ALREADY been confirmed to be a
 * CANDIDATE for targetStudentId — i.e. its own stored raw email's
 * fingerprint is a member of targetStudentId's known-fingerprint set (see
 * candidateFingerprint() in computeStudentDeletionAttributionPlan). Rows
 * that are not candidates for this student are filtered out before this
 * function is ever called — they must never be classified (NO_MATCH or
 * otherwise) inside this student's plan.
 *
 * Consequently, a NO_MATCH result from this function means precisely: "this
 * row's fingerprint IS in the target student's known identity set, but no
 * covering provenance interval/temporal match was found for it at the
 * row's timestamp" — never "this is just some unrelated row elsewhere in
 * the system" (such rows are excluded upstream and never reach here).
 */
function classifyRow(
  targetStudentId: number,
  rawEmail: string | null,
  timestamp: string | null,
  t0: string | null,
  intervalsByFingerprint: Map<string, IntervalRow[]>,
): AttributionClassification {
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
    // Covered, but by a DIFFERENT student's interval — not this student's row.
    if (t0 && timestamp < t0) return "UNPROVEN_PRE_T0";
    return "NO_MATCH";
  }
  if (t0 && timestamp < t0) return "UNPROVEN_PRE_T0";
  return "SAFE_TO_ATTRIBUTE";
}

/**
 * Computes the read-only attribution plan for one student. Returns a stable
 * outcome discriminant; callers (route) map it to HTTP status.
 *
 * Query architecture (fixed QUERY COUNT, does not scale with row volume —
 * see the B3B1B report's Section P for the honest ROW-COUNT scaling
 * analysis, which is a materially different claim):
 *   1. student lookup
 *   2. active preparation lookup
 *   3. provenance_activation T0 lookup
 *   4. this student's OWN known fingerprints: DISTINCT email_fingerprint
 *      FROM student_email_identity_history WHERE student_id = S (plus the
 *      fingerprint of S's current students.email, computed in JS — no
 *      extra query). This is the student's actual "candidate identity set".
 *   5-7. one query per domain (bookings/package_orders/feedback) fetching
 *        every row lacking an explicit Student FK (`IS NULL`). This scope
 *        is NOT further reducible at the SQL level without a new indexed
 *        fingerprint column: the provenance table stores fingerprints, not
 *        raw email, so we cannot ask Postgres to filter these domain
 *        tables' raw emails by fingerprint membership directly. Instead,
 *        each fetched row is filtered in APPLICATION CODE immediately
 *        after fetch, before it is ever classified or tallied: a row whose
 *        own stored email does not fingerprint-match step 4's set is
 *        dropped from this student's candidate rows entirely (see
 *        candidateFingerprint()). An unrelated row is therefore READ once
 *        per domain query but never contributes to this student's plan.
 *   8. a single batched interval lookup keyed by the distinct fingerprints
 *      collected from steps 5-7's *filtered* candidate rows (covers every
 *      student at those fingerprints, so competing-owner/AMBIGUOUS_PROVENANCE
 *      detection is possible) — one query, not one per row.
 * Total: fixed ~8 queries regardless of data volume (see
 * studentDeletionAttributionPlanner.queryCount test for the instrumented
 * count on a real run) — but see Section P of the B3B1B report for why
 * ROWS FETCHED by steps 5-7 still scales with total system-wide
 * unattributed-row volume, not with this student's relevant-row count.
 */
export async function computeStudentDeletionAttributionPlan(studentId: number): Promise<AttributionPlanOutcome> {
  return db.transaction(async (tx) => {
    const student = await one<{ id: number; account_status: string; email: string }>(tx, sql`
      SELECT id, account_status, email FROM students WHERE id = ${studentId} LIMIT 1
    `);
    if (student.id === undefined) return { kind: "notFound" };
    if (student.account_status === "deleted") return { kind: "alreadyDeleted" };

    const activePrep = await one<{ id: number }>(tx, sql`
      SELECT id FROM student_deletion_workflows
      WHERE student_id = ${studentId} AND status = 'PREPARING'
      LIMIT 1
    `);
    if (activePrep.id === undefined) return { kind: "preparationRequired" };
    const workflowId = Number(activePrep.id);

    const t0Row = await one<{ activated_at: string | null }>(tx, sql`
      SELECT activated_at FROM provenance_activation ORDER BY id ASC LIMIT 1
    `);
    const t0 = t0Row.activated_at ?? null;

    // ── Candidate-scoping (B3B1B fix) ──────────────────────────────────
    // "Candidate for Student S" = a legacy (no-FK) row whose OWN stored raw
    // email, once normalized+fingerprinted, matches one of S's KNOWN
    // fingerprints: the fingerprint of S's current email (students.email),
    // or any fingerprint appearing in S's own student_email_identity_history
    // rows (S's past emails). This is queryable even though the history
    // table stores no raw email, because it stores S's own fingerprints
    // directly (WHERE student_id = S), unlike the legacy domain tables
    // which store raw email but no FK for these rows.
    //
    // A legacy row's fingerprint that is NOT in S's known-fingerprint set is
    // excluded from S's candidate universe entirely — it is never run
    // through classifyRow, never tallied, and never appears in the plan, no
    // matter which classification it might otherwise have received. This is
    // an include/exclude gate applied BEFORE classification, so it cannot
    // short-circuit into automatic attribution or interfere with pre-T0 /
    // email-reuse temporal semantics, which are unchanged (see classifyRow).
    const knownFingerprints = new Set<string>();
    if (isWellFormedEmail(student.email)) {
      knownFingerprints.add(fingerprintStudentEmail((student.email as string).trim().toLowerCase()));
    }
    const ownHistoryRows = await many<{ email_fingerprint: string }>(tx, sql`
      SELECT DISTINCT email_fingerprint FROM student_email_identity_history
      WHERE student_id = ${studentId}
    `);
    for (const r of ownHistoryRows) knownFingerprints.add(r.email_fingerprint);

    // Malformed/empty legacy emails carry no identifiable ownership signal
    // at all (there is nothing to fingerprint), so the candidate-scoping
    // gate below does not apply to them — they fall straight through to
    // classifyRow's existing MALFORMED_LEGACY_IDENTITY / (missing
    // timestamp) handling, exactly as before this fix. This is a distinct,
    // out-of-scope concern from the confirmed fingerprint-matching defect
    // this fix targets (see B3B1B report Section C / Y).
    function isCandidateRow(rawEmail: string | null): boolean {
      if (!isWellFormedEmail(rawEmail)) return true;
      const fp = fingerprintStudentEmail((rawEmail as string).trim().toLowerCase());
      return knownFingerprints.has(fp);
    }

    // Domain queries: the `IS NULL` scope (rows genuinely lacking an
    // explicit Student FK) is the smallest SQL-expressible bound available
    // — see Section 7/12 of the B3B1B report for why a further SQL-level
    // narrowing by past-email fingerprint is not possible without a new
    // indexed fingerprint column (no raw email is stored in the provenance
    // table to filter by). The candidate-membership gate below is applied
    // in application code, before any row contributes to this student's
    // counts, so an unrelated row may be READ from the DB but never enters
    // this student's plan.
    const allBookingRows = await many<{ id: number; student_email: string | null; created_at: string | null }>(tx, sql`
      SELECT id, student_email, created_at FROM bookings
      WHERE account_owner_student_id IS NULL
    `);
    const allPackageOrderRows = await many<{ id: number; student_email: string | null; created_at: string | null; participant_type: string | null }>(tx, sql`
      SELECT id, student_email, created_at, participant_type FROM package_orders
      WHERE student_id IS NULL
    `);
    const allFeedbackRows = await many<{ id: number; student_email: string | null; created_at: string | null }>(tx, sql`
      SELECT id, student_email_snapshot AS student_email, created_at FROM feedback
      WHERE student_id IS NULL
    `);

    const bookingRows = allBookingRows.filter((r) => isCandidateRow(r.student_email));
    const packageOrderRows = allPackageOrderRows.filter((r) => isCandidateRow(r.student_email));
    const feedbackRows = allFeedbackRows.filter((r) => isCandidateRow(r.student_email));

    // Collect distinct well-formed emails across all three domains (now
    // already scoped to this student's candidate set), compute their
    // fingerprints once, then a single batched interval lookup.
    const distinctEmails = new Set<string>();
    for (const r of bookingRows) if (isWellFormedEmail(r.student_email)) distinctEmails.add((r.student_email as string).trim().toLowerCase());
    for (const r of packageOrderRows) if (isWellFormedEmail(r.student_email)) distinctEmails.add((r.student_email as string).trim().toLowerCase());
    for (const r of feedbackRows) if (isWellFormedEmail(r.student_email)) distinctEmails.add((r.student_email as string).trim().toLowerCase());

    const fingerprintList = Array.from(distinctEmails).map((e) => fingerprintStudentEmail(e));
    const intervalsByFingerprint = new Map<string, IntervalRow[]>();
    if (fingerprintList.length > 0) {
      const intervalRows = await many<IntervalRow>(tx, sql`
        SELECT student_id, email_fingerprint, valid_from, valid_to
        FROM student_email_identity_history
        WHERE email_fingerprint IN (${sql.join(fingerprintList.map((f) => sql`${f}`), sql`,`)})
      `);
      for (const row of intervalRows as any[]) {
        const fp = row.email_fingerprint as string;
        const list = intervalsByFingerprint.get(fp) ?? [];
        list.push({ student_id: Number(row.student_id), valid_from: row.valid_from, valid_to: row.valid_to });
        intervalsByFingerprint.set(fp, list);
      }
    }

    function tally(counts: Map<AttributionClassification, number>, c: AttributionClassification) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }

    // ── bookings ──
    const bookingCounts = new Map<AttributionClassification, number>();
    for (const r of bookingRows) {
      const c = classifyRow(studentId, r.student_email, r.created_at, t0, intervalsByFingerprint);
      tally(bookingCounts, c);
    }
    const bookingAttributedAlready = await one<{ n: string }>(tx, sql`
      SELECT count(*) AS n FROM bookings WHERE account_owner_student_id = ${studentId}
    `);
    if (Number(bookingAttributedAlready.n ?? "0") > 0) tally(bookingCounts, "ALREADY_ATTRIBUTED");

    // ── package_orders ── (payer/contact vs entitlement-owner semantics)
    const packageCounts = new Map<AttributionClassification, number>();
    for (const r of packageOrderRows) {
      if (r.participant_type === "child") {
        // Semantics forbid attribution regardless of temporal match.
        if (!isWellFormedEmail(r.student_email)) { tally(packageCounts, "MALFORMED_LEGACY_IDENTITY"); continue; }
        if (!r.created_at) { tally(packageCounts, "MISSING_REQUIRED_TIMESTAMP"); continue; }
        tally(packageCounts, "SEMANTICALLY_NOT_STUDENT_OWNERSHIP");
        continue;
      }
      const c = classifyRow(studentId, r.student_email, r.created_at, t0, intervalsByFingerprint);
      tally(packageCounts, c);
    }
    const packageAttributedAlready = await one<{ n: string }>(tx, sql`
      SELECT count(*) AS n FROM package_orders WHERE student_id = ${studentId}
    `);
    if (Number(packageAttributedAlready.n ?? "0") > 0) tally(packageCounts, "ALREADY_ATTRIBUTED");

    // ── feedback ──
    const feedbackCounts = new Map<AttributionClassification, number>();
    for (const r of feedbackRows) {
      const c = classifyRow(studentId, r.student_email, r.created_at, t0, intervalsByFingerprint);
      tally(feedbackCounts, c);
    }
    const feedbackAttributedAlready = await one<{ n: string }>(tx, sql`
      SELECT count(*) AS n FROM feedback WHERE student_id = ${studentId}
    `);
    if (Number(feedbackAttributedAlready.n ?? "0") > 0) tally(feedbackCounts, "ALREADY_ATTRIBUTED");

    function domainEntries(domain: AttributionDomain, counts: Map<AttributionClassification, number>): DomainAttributionEntry[] {
      const entries: DomainAttributionEntry[] = [];
      for (const [classification, count] of counts.entries()) {
        if (count === 0) continue;
        entries.push({
          domain,
          classification,
          count,
          reasonCode: REASON[classification],
          executionEligible: classification === "SAFE_TO_ATTRIBUTE",
        });
      }
      return entries;
    }

    const domains: DomainAttributionEntry[] = [
      ...domainEntries("bookings", bookingCounts),
      ...domainEntries("package_orders", packageCounts),
      ...domainEntries("feedback", feedbackCounts),
    ];

    const summary = { alreadyAttributed: 0, safeToAttribute: 0, ambiguous: 0, unproven: 0, nonAttributable: 0 };
    for (const d of domains) {
      switch (d.classification) {
        case "ALREADY_ATTRIBUTED": summary.alreadyAttributed += d.count; break;
        case "SAFE_TO_ATTRIBUTE": summary.safeToAttribute += d.count; break;
        case "AMBIGUOUS_PROVENANCE": summary.ambiguous += d.count; break;
        case "UNPROVEN_PRE_T0": summary.unproven += d.count; break;
        case "NO_MATCH":
        case "SEMANTICALLY_NOT_STUDENT_OWNERSHIP":
        case "MISSING_REQUIRED_TIMESTAMP":
        case "MALFORMED_LEGACY_IDENTITY":
          summary.nonAttributable += d.count; break;
      }
    }

    // Deterministic ordering: domain name, then classification name.
    domains.sort((a, b) => (a.domain === b.domain ? a.classification.localeCompare(b.classification) : a.domain.localeCompare(b.domain)));

    const plan: StudentAttributionPlan = {
      studentId,
      workflowId,
      preparationStatus: "PREPARING",
      generatedAt: new Date().toISOString(),
      policyVersion: DELETION_ATTRIBUTION_PLANNER_POLICY_VERSION,
      provenanceActivationReference: t0,
      summary,
      domains,
    };
    return { kind: "ok", plan };
  });
}
