import assert from "node:assert/strict";
import test from "node:test";

import { boundEvidenceFromReport, fingerprintEvidence, fingerprintFromReport, scopeKeyFromFilters } from "./financeBackfillEvidence";
import type { DryRunReport, DryRunFilters } from "./financeBackfillDryRun";

function fakeReport(overrides: Partial<DryRunReport> = {}): DryRunReport {
  return {
    reportSchemaVersion: "2d1b.1.0.0",
    classifierVersion: "2d1.0.0",
    codeCommit: "a".repeat(40),
    generatedTimestamp: "2024-01-01T00:00:00.000Z",
    appliedFilters: { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50 },
    scannedCount: 10,
    classifiedCount: 10,
    truncated: false,
    nextCursors: { package_orders: null, bookings: 42, studio_walkins: null },
    pageInfo: {
      hasNextPage: true,
      nextCursors: { package_orders: null, bookings: "opaque-booking-cursor", studio_walkins: null },
    },
    aggregates: {
      sourceFamilyCounts: { bookings: 10 },
      sourceKindCounts: { booking: 10 },
      classificationCounts: { legacy_pending_booking_manual_review: 10 },
      eligibilityCounts: { manual_review: 10 },
      evidenceClassCounts: { unknown: 10 },
      amountAvailabilityCounts: { unknown: 10 },
      amountReliabilityCounts: {},
      discountReliabilityCounts: {},
      paymentStatusReliabilityCounts: {},
      paymentMethodReliabilityCounts: {},
      timestampReliabilityCounts: {},
      actorReliabilityCounts: {},
      reasonCodeCounts: {},
      warningCodeCounts: {},
      alreadyCanonicalCount: 0,
      automaticExactCount: 0,
      manualReviewCount: 10,
      excludedCount: 0,
      corruptCount: 0,
      estimatedOnlyCount: 0,
      unknownAmountCount: 0,
      legacyPendingCount: 10,
      multipleRecordCount: 0,
      mismatchedRecordCount: 0,
    },
    authoritativeTotals: { grossAmountMinor: 0, discountAmountMinor: 0, finalPayableAmountMinor: 0, rowCount: 0, currency: "EGP", label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY" },
    estimatedTotals: { estimatedTotalMinor: 0, estimatedRowCount: 0, currency: "EGP", label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE" },
    unknownAmountPopulation: { rowCount: 0, label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO" },
    ...overrides,
  };
}

test("fingerprint: identical evidence produces identical fingerprint", () => {
  const r1 = fakeReport();
  const r2 = fakeReport();
  assert.equal(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: key order in count maps does not change the fingerprint", () => {
  const r1 = fakeReport({ aggregates: { ...fakeReport().aggregates, classificationCounts: { a: 1, b: 2 } } });
  const r2 = fakeReport({ aggregates: { ...fakeReport().aggregates, classificationCounts: { b: 2, a: 1 } } });
  assert.equal(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: generatedTimestamp does not affect the fingerprint", () => {
  const r1 = fakeReport({ generatedTimestamp: "2024-01-01T00:00:00.000Z" });
  const r2 = fakeReport({ generatedTimestamp: "2099-12-31T00:00:00.000Z" });
  assert.equal(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: nextCursors (raw source IDs) do not affect the fingerprint", () => {
  const r1 = fakeReport({ nextCursors: { bookings: 1 } });
  const r2 = fakeReport({ nextCursors: { bookings: 999999 } });
  assert.equal(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: a change in classifier version changes the fingerprint", () => {
  const r1 = fakeReport({ classifierVersion: "2d1.0.0" });
  const r2 = fakeReport({ classifierVersion: "2d1.0.1" });
  assert.notEqual(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: a change in code commit changes the fingerprint", () => {
  const r1 = fakeReport({ codeCommit: "a".repeat(40) });
  const r2 = fakeReport({ codeCommit: "b".repeat(40) });
  assert.notEqual(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: a change in aggregate counts changes the fingerprint", () => {
  const r1 = fakeReport();
  const r2 = fakeReport({ aggregates: { ...fakeReport().aggregates, manualReviewCount: 11 } });
  assert.notEqual(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: a change in scope/filters changes the fingerprint", () => {
  const r1 = fakeReport({ appliedFilters: { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50 } });
  const r2 = fakeReport({ appliedFilters: { sourceFamilies: ["package_orders"], maxRows: 100, batchSize: 50 } });
  assert.notEqual(fingerprintFromReport(r1), fingerprintFromReport(r2));
});

test("fingerprint: bound evidence never carries a raw source row or PII field", () => {
  const evidence = boundEvidenceFromReport(fakeReport());
  const serialised = JSON.stringify(evidence).toLowerCase();
  for (const forbidden of ["studentname", "studentemail", "studentphone", "sourceid", "childname"]) {
    assert.equal(serialised.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("fingerprint: fingerprintEvidence is a pure function of its input (no hidden clock/random)", () => {
  const evidence = boundEvidenceFromReport(fakeReport());
  const f1 = fingerprintEvidence(evidence);
  const f2 = fingerprintEvidence(evidence);
  const f3 = fingerprintEvidence(JSON.parse(JSON.stringify(evidence)));
  assert.equal(f1, f2);
  assert.equal(f1, f3);
});

// ── Scope key ────────────────────────────────────────────────────────────────

function baseFilters(overrides: Partial<DryRunFilters> = {}): DryRunFilters {
  return { sourceFamilies: ["bookings"], maxRows: 100, batchSize: 50, ...overrides };
}

test("scopeKey: identical scope + expected classifier/commit produces identical key", () => {
  const k1 = scopeKeyFromFilters(baseFilters(), "2d1.0.0", "a".repeat(40));
  const k2 = scopeKeyFromFilters(baseFilters(), "2d1.0.0", "a".repeat(40));
  assert.equal(k1, k2);
});

test("scopeKey: maxRows/batchSize differences do NOT change the scope key (same logical scope, different page size)", () => {
  const k1 = scopeKeyFromFilters(baseFilters({ maxRows: 100, batchSize: 50 }), "2d1.0.0", "a".repeat(40));
  const k2 = scopeKeyFromFilters(baseFilters({ maxRows: 500, batchSize: 100 }), "2d1.0.0", "a".repeat(40));
  assert.equal(k1, k2);
});

test("scopeKey: a different source-family scope changes the key", () => {
  const k1 = scopeKeyFromFilters(baseFilters({ sourceFamilies: ["bookings"] }), "2d1.0.0", "a".repeat(40));
  const k2 = scopeKeyFromFilters(baseFilters({ sourceFamilies: ["package_orders"] }), "2d1.0.0", "a".repeat(40));
  assert.notEqual(k1, k2);
});

test("scopeKey: a different expected classifier version changes the key", () => {
  const k1 = scopeKeyFromFilters(baseFilters(), "2d1.0.0", "a".repeat(40));
  const k2 = scopeKeyFromFilters(baseFilters(), "2d1.0.1", "a".repeat(40));
  assert.notEqual(k1, k2);
});
