/**
 * Finance Phase 2D-2 — dry-run evidence binding.
 *
 * A batch's approval must be bound to the EXACT dry-run evidence it was
 * granted against: the same classifier version, code commit, source scope,
 * filters, and expected aggregate counts. If any of that changes before
 * approval is exercised, the approval must be treated as stale — this
 * module produces a deterministic fingerprint over exactly that bound
 * evidence (and nothing else) so staleness can be detected with a single
 * string comparison instead of a deep structural diff.
 *
 * No customer PII or raw source rows are ever part of this evidence — only
 * the same aggregate-only fields the Phase 2D-1B dry-run report already
 * exposes.
 */
import { createHash } from "node:crypto";
import type { DryRunFilters, DryRunReport } from "./financeBackfillDryRun";

/**
 * The subset of a DryRunReport that a batch's approval is bound to. Deep
 * per-row samples, generatedTimestamp, and codeCommit-as-reported are
 * deliberately excluded from the canonicalized/fingerprinted form —
 * codeCommit is instead tracked as its own top-level, explicitly-compared
 * field (see BoundEvidence.codeCommit) so a stale-commit check can produce
 * its own distinct error rather than being folded into a generic
 * fingerprint mismatch.
 */
export interface BoundEvidence {
  classifierVersion: string;
  reportSchemaVersion: string;
  codeCommit: string;
  filters: DryRunFilters;
  aggregateCounts: {
    scannedCount: number;
    classifiedCount: number;
    truncated: boolean;
    eligibilityCounts: Record<string, number>;
    classificationCounts: Record<string, number>;
    evidenceClassCounts: Record<string, number>;
    amountAvailabilityCounts: Record<string, number>;
    reasonCodeCounts: Record<string, number>;
    warningCodeCounts: Record<string, number>;
    alreadyCanonicalCount: number;
    manualReviewCount: number;
    excludedCount: number;
    corruptCount: number;
    estimatedOnlyCount: number;
    unknownAmountCount: number;
    legacyPendingCount: number;
    exactEligibleCount: number;
  };
}

export function boundEvidenceFromReport(report: DryRunReport): BoundEvidence {
  return {
    classifierVersion: report.classifierVersion,
    reportSchemaVersion: report.reportSchemaVersion,
    codeCommit: report.codeCommit,
    filters: report.appliedFilters,
    aggregateCounts: {
      scannedCount: report.scannedCount,
      classifiedCount: report.classifiedCount,
      truncated: report.truncated,
      eligibilityCounts: report.aggregates.eligibilityCounts,
      classificationCounts: report.aggregates.classificationCounts,
      evidenceClassCounts: report.aggregates.evidenceClassCounts,
      amountAvailabilityCounts: report.aggregates.amountAvailabilityCounts,
      reasonCodeCounts: report.aggregates.reasonCodeCounts,
      warningCodeCounts: report.aggregates.warningCodeCounts,
      alreadyCanonicalCount: report.aggregates.alreadyCanonicalCount,
      manualReviewCount: report.aggregates.manualReviewCount,
      excludedCount: report.aggregates.excludedCount,
      corruptCount: report.aggregates.corruptCount,
      estimatedOnlyCount: report.aggregates.estimatedOnlyCount,
      unknownAmountCount: report.aggregates.unknownAmountCount,
      legacyPendingCount: report.aggregates.legacyPendingCount,
      exactEligibleCount: report.aggregates.automaticExactCount,
    },
  };
}

/** Recursively sorts object keys so JSON.stringify is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic fingerprint: identical evidence (regardless of key order or
 * count-map insertion order) always produces the identical fingerprint.
 * Any change to any bound field changes the fingerprint.
 */
export function fingerprintEvidence(evidence: BoundEvidence): string {
  const canonical = canonicalize(evidence);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

export function fingerprintFromReport(report: DryRunReport): string {
  return fingerprintEvidence(boundEvidenceFromReport(report));
}

/**
 * Stable identity for a batch's SCOPE (not its evidence) — used to enforce
 * "no overlapping active batch for equivalent scope". Deliberately narrower
 * than the evidence fingerprint: two dry-runs of the identical scope taken
 * minutes apart may have different aggregate counts (if source data
 * changed) but must still collide as "the same scope" for overlap
 * purposes.
 */
export function scopeKeyFromFilters(
  filters: DryRunFilters,
  expectedClassifierVersion: string,
  expectedCodeCommit: string,
): string {
  const canonical = canonicalize({
    sourceFamilies: filters.sourceFamilies,
    operationalStatuses: filters.operationalStatuses ?? null,
    createdAfter: filters.createdAfter ?? null,
    createdBefore: filters.createdBefore ?? null,
    classificationCodes: filters.classificationCodes ?? null,
    eligibilityClasses: filters.eligibilityClasses ?? null,
    expectedClassifierVersion,
    expectedCodeCommit,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
