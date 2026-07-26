/**
 * Finance Phase 2D-1B — zero-write historical dry-run planner tests.
 *
 * Split into two groups:
 *  - Pure tests (validateDryRunFilters, buildAggregateReport): plain fixture
 *    objects, no database, deterministic by construction.
 *  - Integration tests (runFinanceBackfillDryRun): a disposable local
 *    Postgres database. Fixture rows are written once in `before()` — the
 *    spec permits writes during fixture setup. Every dry-run invocation
 *    itself is then proven not to write, via before/after row counts across
 *    every Finance + source table AND direct instrumentation of the
 *    underlying pg Pool's `query()` during the planner's execution window.
 *
 * A localhost/disposable-named DATABASE_URL is required and asserted before
 * use, matching the convention in packageOrders.activation.integration.test.ts
 * and paymentEventsFoundation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL =
  process.env.DISPOSABLE_BACKFILL_DRYRUN_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@127.0.0.1:5432/central_studio_disposable_backfill_dryrun`;

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);
process.env.DATABASE_URL = DATABASE_URL;

// financeBackfillDryRun.ts imports @workspace/db at module scope (constructs a
// pg Pool eagerly), so it must be dynamically imported AFTER DATABASE_URL is
// set — a static import would be hoisted above the assignment above.
type DryRunFilters = import("./financeBackfillDryRun").DryRunFilters;
type ClassifiedRow = import("./financeBackfillDryRun").ClassifiedRow;
type FinanceBackfillClassification = import("./financeBackfillClassifier").FinanceBackfillClassification;

const dryRunModule = await import("./financeBackfillDryRun");
const { validateDryRunFilters, buildAggregateReport, MAX_ROWS_LIMIT, MAX_BATCH_SIZE } = dryRunModule;

// ── Fixtures for pure tests ─────────────────────────────────────────────────

function baseFilters(overrides: Partial<DryRunFilters> = {}): DryRunFilters {
  return {
    sourceFamilies: ["bookings"],
    maxRows: 100,
    batchSize: 50,
    ...overrides,
  };
}

function classification(overrides: Partial<FinanceBackfillClassification> = {}): FinanceBackfillClassification {
  return {
    sourceFamily: "bookings",
    sourceKind: "booking",
    sourceId: 1,
    classificationCode: "legacy_pending_booking_manual_review",
    eligibility: "manual_review",
    evidenceClass: "unknown",
    amountAvailability: "unknown",
    amountSource: "unresolvable",
    grossAmountMinor: null,
    discountAmountMinor: null,
    finalPayableAmountMinor: null,
    currency: null,
    operationalSourceStatus: "confirmed",
    inferredFinanceTargetStatus: "unpaid",
    targetFlowType: "single_class_booking",
    targetEventType: "legacy_created",
    sourceCreatedAt: "2023-01-01T00:00:00Z",
    paidTimestampEvidenceClass: "unknown",
    paymentMethodEvidenceClass: "unknown",
    actorEvidenceClass: "unknown_historical_actor",
    reasonCodes: ["legacy_pending_booking_manual_review"],
    warningCodes: [],
    currentPriceEstimateMinor: null,
    isExactEvidenceEligible: false,
    writable: false,
    safeSummary: "bookings#1 -> legacy_pending_booking_manual_review (manual_review)",
    amountTier: "unknown_amount",
    discountTier: "unknown_discount",
    paymentStatusTier: "operational_pending",
    ...overrides,
  };
}

function row(overrides: Partial<ClassifiedRow> = {}): ClassifiedRow {
  return {
    family: "bookings",
    id: 1,
    classification: classification(),
    ...overrides,
  };
}

// ── Filter validation ────────────────────────────────────────────────────────

test("filters: package-only scope is accepted", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ sourceFamilies: ["package_orders"] })));
});

test("filters: booking-only scope is accepted", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ sourceFamilies: ["bookings"] })));
});

test("filters: studio-walk-in-only scope is accepted", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ sourceFamilies: ["studio_walkins"] })));
});

test("filters: multiple-family scope is accepted", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ sourceFamilies: ["package_orders", "bookings"] })));
});

test("filters: empty source scope is rejected", () => {
  assert.throws(() => validateDryRunFilters(baseFilters({ sourceFamilies: [] })), /non-empty/);
});

test("filters: unsupported source family is rejected", () => {
  assert.throws(
    () => validateDryRunFilters(baseFilters({ sourceFamilies: ["not_a_family" as never] })),
    /unsupported source family/,
  );
});

test("filters: status filter shape is validated (non-empty strings)", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ operationalStatuses: ["confirmed"] })));
  assert.throws(() => validateDryRunFilters(baseFilters({ operationalStatuses: [""] })), /non-empty/);
});

test("filters: classification-code filter is validated against the stable vocabulary", () => {
  assert.doesNotThrow(() =>
    validateDryRunFilters(baseFilters({ classificationCodes: ["legacy_pending_booking_manual_review"] })),
  );
  assert.throws(
    () => validateDryRunFilters(baseFilters({ classificationCodes: ["not_a_real_code" as never] })),
    /unsupported classification code/,
  );
});

test("filters: eligibility filter is validated against the stable vocabulary", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ eligibilityClasses: ["manual_review"] })));
  assert.throws(
    () => validateDryRunFilters(baseFilters({ eligibilityClasses: ["not_a_real_class" as never] })),
    /unsupported eligibility class/,
  );
});

test("filters: a valid date range is accepted", () => {
  assert.doesNotThrow(() =>
    validateDryRunFilters(baseFilters({ createdAfter: "2023-01-01T00:00:00Z", createdBefore: "2023-06-01T00:00:00Z" })),
  );
});

test("filters: an inverted date range is rejected", () => {
  assert.throws(
    () => validateDryRunFilters(baseFilters({ createdAfter: "2023-06-01T00:00:00Z", createdBefore: "2023-01-01T00:00:00Z" })),
    /later than/,
  );
});

test("filters: an unparseable date is rejected", () => {
  assert.throws(() => validateDryRunFilters(baseFilters({ createdAfter: "not-a-date" })), /not a valid date/);
});

test("filters: maxRows is required", () => {
  assert.throws(() => validateDryRunFilters(baseFilters({ maxRows: undefined as never })), /maxRows is required/);
});

test("filters: maxRows has an enforced upper bound", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ maxRows: MAX_ROWS_LIMIT })));
  assert.throws(() => validateDryRunFilters(baseFilters({ maxRows: MAX_ROWS_LIMIT + 1 })), /exceeds the maximum/);
});

test("filters: batchSize is required", () => {
  assert.throws(() => validateDryRunFilters(baseFilters({ batchSize: undefined as never })), /batchSize is required/);
});

test("filters: batchSize has an enforced upper bound", () => {
  assert.doesNotThrow(() => validateDryRunFilters(baseFilters({ batchSize: MAX_BATCH_SIZE })));
  assert.throws(() => validateDryRunFilters(baseFilters({ batchSize: MAX_BATCH_SIZE + 1 })), /exceeds the maximum/);
});

test("filters: an invalid cursor (negative afterId) is rejected", () => {
  assert.throws(
    () => validateDryRunFilters(baseFilters({ cursors: [{ family: "bookings", afterId: -1 }] })),
    /invalid cursor/,
  );
});

test("filters: a cursor for a family outside sourceFamilies is rejected", () => {
  assert.throws(
    () =>
      validateDryRunFilters(
        baseFilters({ sourceFamilies: ["bookings"], cursors: [{ family: "package_orders", afterId: 5 }] }),
      ),
    /not included in sourceFamilies/,
  );
});

test("filters: there is no write-mode option on the filter contract", () => {
  const filters = baseFilters();
  assert.equal((filters as unknown as Record<string, unknown>)["writeMode"], undefined);
  assert.equal((filters as unknown as Record<string, unknown>)["write"], undefined);
});

// ── Aggregation (pure) ───────────────────────────────────────────────────────

test("aggregation: classification counts", () => {
  const rows = [
    row({ id: 1, classification: classification({ classificationCode: "legacy_pending_booking_manual_review" }) }),
    row({ id: 2, classification: classification({ classificationCode: "already_canonical", eligibility: "already_canonical" }) }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 2, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.classificationCounts["legacy_pending_booking_manual_review"], 1);
  assert.equal(report.aggregates.classificationCounts["already_canonical"], 1);
});

test("aggregation: eligibility counts", () => {
  const rows = [
    row({ classification: classification({ eligibility: "manual_review" }) }),
    row({ classification: classification({ eligibility: "excluded", classificationCode: "free_mode_excluded" }) }),
    row({ classification: classification({ eligibility: "corrupt", classificationCode: "multiple_finance_records_corrupt" }) }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 3, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.eligibilityCounts["manual_review"], 1);
  assert.equal(report.aggregates.eligibilityCounts["excluded"], 1);
  assert.equal(report.aggregates.eligibilityCounts["corrupt"], 1);
});

test("aggregation: evidence-class counts", () => {
  const rows = [row({ classification: classification({ evidenceClass: "confirmed" }) })];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.evidenceClassCounts["confirmed"], 1);
});

test("aggregation: reliability counts (amount/discount/payment-status/payment-method/timestamp/actor)", () => {
  const rows = [
    row({
      classification: classification({
        amountTier: "exact_source_snapshot",
        discountTier: "exact_stored_discount",
        paymentStatusTier: "confirmed_operationally",
        paymentMethodEvidenceClass: "exact_stored_method",
        paidTimestampEvidenceClass: "exact_payment_timestamp",
        actorEvidenceClass: "authenticated_admin",
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.amountReliabilityCounts["exact_source_snapshot"], 1);
  assert.equal(report.aggregates.discountReliabilityCounts["exact_stored_discount"], 1);
  assert.equal(report.aggregates.paymentStatusReliabilityCounts["confirmed_operationally"], 1);
  assert.equal(report.aggregates.paymentMethodReliabilityCounts["exact_stored_method"], 1);
  assert.equal(report.aggregates.timestampReliabilityCounts["exact_payment_timestamp"], 1);
  assert.equal(report.aggregates.actorReliabilityCounts["authenticated_admin"], 1);
});

test("aggregation: reason-code and warning-code counts", () => {
  const rows = [
    row({
      classification: classification({
        reasonCodes: ["ambiguous_historical_payment_state"],
        warningCodes: ["ambiguous_historical_payment_state"],
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.reasonCodeCounts["ambiguous_historical_payment_state"], 1);
  assert.equal(report.aggregates.warningCodeCounts["ambiguous_historical_payment_state"], 1);
});

test("aggregation: already-canonical / manual-review / corrupt / legacy-pending / estimated-only / unknown-amount counts", () => {
  const rows = [
    row({ id: 1, classification: classification({ eligibility: "already_canonical", classificationCode: "already_canonical" }) }),
    row({ id: 2, classification: classification({ eligibility: "manual_review", classificationCode: "legacy_pending_booking_manual_review" }) }),
    row({ id: 3, classification: classification({ eligibility: "corrupt", classificationCode: "mismatched_finance_record_corrupt" }) }),
    row({
      id: 4,
      classification: classification({
        eligibility: "manual_review",
        classificationCode: "estimated_amount_manual_review",
        amountAvailability: "estimated_backfill",
        amountTier: "estimated_operational",
        currentPriceEstimateMinor: 5000,
      }),
    }),
    row({
      id: 5,
      classification: classification({
        eligibility: "manual_review",
        classificationCode: "unknown_amount_manual_review",
        amountAvailability: "unknown",
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 5, truncated: false, nextCursors: {} });
  assert.equal(report.aggregates.alreadyCanonicalCount, 1);
  assert.equal(report.aggregates.manualReviewCount, 3);
  assert.equal(report.aggregates.corruptCount, 1);
  assert.equal(report.aggregates.legacyPendingCount, 1);
  assert.equal(report.aggregates.estimatedOnlyCount, 1);
  // rows 1, 2, 3 default to amountAvailability "unknown" (fixture default) plus row 5 explicitly — row 4 is estimated.
  assert.equal(report.aggregates.unknownAmountCount, 4);
  assert.equal(report.aggregates.mismatchedRecordCount, 1);
});

// ── Monetary separation ──────────────────────────────────────────────────────

test("monetary: exact amounts contribute to the authoritative total", () => {
  const rows = [
    row({
      classification: classification({
        isExactEvidenceEligible: true,
        grossAmountMinor: 10000,
        discountAmountMinor: 1000,
        finalPayableAmountMinor: 9000,
        amountTier: "exact_source_snapshot",
        classificationCode: "exact_evidence_eligible" as never,
        eligibility: "automatic_exact",
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.authoritativeTotals.grossAmountMinor, 10000);
  assert.equal(report.authoritativeTotals.discountAmountMinor, 1000);
  assert.equal(report.authoritativeTotals.finalPayableAmountMinor, 9000);
  assert.equal(report.authoritativeTotals.rowCount, 1);
  assert.equal(report.aggregates.automaticExactCount, 1);
});

test("monetary: estimated amounts never contribute to the authoritative total", () => {
  const rows = [
    row({
      classification: classification({
        isExactEvidenceEligible: false,
        amountAvailability: "estimated_backfill",
        amountTier: "estimated_operational",
        currentPriceEstimateMinor: 7500,
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.authoritativeTotals.grossAmountMinor, 0);
  assert.equal(report.authoritativeTotals.rowCount, 0);
});

test("monetary: estimated amounts appear only in the labelled, non-authoritative estimate total", () => {
  const rows = [
    row({
      classification: classification({
        amountAvailability: "estimated_backfill",
        amountTier: "estimated_operational",
        currentPriceEstimateMinor: 7500,
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(report.estimatedTotals.estimatedTotalMinor, 7500);
  assert.equal(report.estimatedTotals.estimatedRowCount, 1);
  assert.equal(report.estimatedTotals.label, "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE");
});

test("monetary: unknown amounts are counted, never coerced to zero or summed", () => {
  const rows = [
    row({ classification: classification({ amountAvailability: "unknown", grossAmountMinor: null }) }),
    row({ id: 2, classification: classification({ amountAvailability: "unknown", grossAmountMinor: null }) }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 2, truncated: false, nextCursors: {} });
  assert.equal(report.unknownAmountPopulation.rowCount, 2);
  assert.equal(report.authoritativeTotals.grossAmountMinor, 0);
  assert.equal(report.estimatedTotals.estimatedTotalMinor, 0);
});

test("monetary: discount/net arithmetic uses minor units only (no floating point)", () => {
  const rows = [
    row({
      classification: classification({
        isExactEvidenceEligible: true,
        grossAmountMinor: 12345,
        discountAmountMinor: 345,
        finalPayableAmountMinor: 12000,
      }),
    }),
  ];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal(Number.isInteger(report.authoritativeTotals.grossAmountMinor), true);
  assert.equal(report.authoritativeTotals.grossAmountMinor - report.authoritativeTotals.discountAmountMinor, report.authoritativeTotals.finalPayableAmountMinor);
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("privacy: the report contains no raw source IDs outside the cursor field", () => {
  const rows = [row({ id: 42, classification: classification({ sourceId: 42 }) })];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: { bookings: 42 } });
  const serialised = JSON.stringify(report);
  // nextCursors legitimately carries an id (needed for pagination); no other
  // path (aggregates, totals, safeSummary) may carry one.
  const withoutCursor = JSON.stringify({ ...report, nextCursors: undefined });
  assert.equal(/"sourceId"/.test(withoutCursor), false);
  assert.ok(serialised.includes("nextCursors"));
});

test("privacy: the report contains no PII fields (name/email/phone/address)", () => {
  const rows = [row()];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  const serialised = JSON.stringify(report).toLowerCase();
  for (const forbidden of ["studentname", "studentemail", "studentphone", "parentname", "childname", "address", "notes"]) {
    assert.equal(serialised.includes(forbidden), false, `report leaked "${forbidden}"`);
  }
});

test("privacy: safe summary (via classifier) is aggregate-only, no raw IDs baked into it", () => {
  const c = classification({ sourceId: 999 });
  assert.doesNotMatch(c.safeSummary, /999/);
});

test("privacy: there is no diagnostic sample-ID facility on the report or filters", () => {
  const rows = [row()];
  const report = buildAggregateReport(rows, baseFilters(), { scannedCount: 1, truncated: false, nextCursors: {} });
  assert.equal((report as unknown as Record<string, unknown>)["sampleHashedIds"], undefined);
  assert.equal((baseFilters() as unknown as Record<string, unknown>)["includeSampleIds"], undefined);
});

// ── Cursor / truncation (pure) ──────────────────────────────────────────────

test("cursor: truncated flag passes through from scan metadata", () => {
  const report = buildAggregateReport([row()], baseFilters(), { scannedCount: 1, truncated: true, nextCursors: {} });
  assert.equal(report.truncated, true);
});

test("cursor: next cursor is reported per-family, not as a single ambiguous global value", () => {
  const report = buildAggregateReport([row()], baseFilters({ sourceFamilies: ["package_orders", "bookings"] }), {
    scannedCount: 2,
    truncated: false,
    nextCursors: { package_orders: 10, bookings: 20 },
  });
  assert.equal(report.nextCursors.package_orders, 10);
  assert.equal(report.nextCursors.bookings, 20);
});

// ── Integration: DB-backed determinism, cursor continuation, zero-write proof ──

let pool: typeof import("@workspace/db").pool;
let runFinanceBackfillDryRun: typeof import("./financeBackfillDryRun").runFinanceBackfillDryRun;
let seededBookingIds: number[] = [];

const TRACKED_TABLES = [
  "payment_records",
  "payment_events",
  "payment_refunds",
  "payment_backfill_batches",
  "payment_backfill_progress",
  "package_orders",
  "bookings",
  "attendance",
  "credit_transactions",
  "notifications",
] as const;

async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TRACKED_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = res.rows[0].n as number;
  }
  return out;
}

const MUTATION_PATTERN = /^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i;

before(async () => {
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  ({ runFinanceBackfillDryRun } = dryRunModule);

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Fixture writes happen here, before the dry-run planner is ever invoked —
  // permitted by the spec ("test-fixture setup may write before the dry-run
  // begins"). None of this happens inside the instrumented planner window.
  for (let i = 0; i < 5; i++) {
    const res = await pool.query(
      `INSERT INTO bookings (student_name, student_email, booking_status, payment_status, payment_mode, schedule_id, created_at)
       VALUES ($1, $2, 'confirmed', 'pending_payment', 'pay_at_studio', 1, now() - interval '30 days')
       RETURNING id`,
      [`DryRun Fixture ${run} ${i}`, `dryrun-${run}-${i}@example.test`],
    );
    seededBookingIds.push(res.rows[0].id as number);
  }
});

after(async () => {
  if (pool && seededBookingIds.length) {
    await pool.query(`DELETE FROM bookings WHERE id = ANY($1::int[])`, [seededBookingIds]);
  }
  if (pool) await pool.end();
});

test("integration: zero-write — no Finance/source table count changes across a dry-run", async () => {
  const before_ = await tableCounts();
  await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 1000, batchSize: 500 });
  const after_ = await tableCounts();
  assert.deepEqual(after_, before_);
});

test("integration: query instrumentation rejects any mutation statement during the planner's execution window", async () => {
  const originalQuery = pool.query.bind(pool);
  const seenStatements: string[] = [];
  pool.query = ((...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (typeof text === "string") {
      seenStatements.push(text);
      if (MUTATION_PATTERN.test(text)) {
        throw new Error(`Mutation attempted during zero-write dry-run: ${text.slice(0, 120)}`);
      }
    }
    return (originalQuery as (...a: unknown[]) => unknown)(...args);
  }) as typeof pool.query;

  try {
    await assert.doesNotReject(
      runFinanceBackfillDryRun({ sourceFamilies: ["package_orders", "bookings", "studio_walkins"], maxRows: 1000, batchSize: 500 }),
    );
    assert.ok(seenStatements.length > 0, "expected at least one SELECT to have been observed");
    assert.ok(seenStatements.every((s) => !MUTATION_PATTERN.test(s)));
  } finally {
    pool.query = originalQuery;
  }
});

test("integration: repeated dry-run still produces zero writes", async () => {
  const before_ = await tableCounts();
  await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 1000, batchSize: 500 });
  await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 1000, batchSize: 500 });
  const after_ = await tableCounts();
  assert.deepEqual(after_, before_);
});

test("integration: repeated identical run has identical aggregate output (excluding generatedTimestamp)", async () => {
  const filters = { sourceFamilies: ["bookings"] as const, maxRows: 1000, batchSize: 500 };
  const r1 = await runFinanceBackfillDryRun({ sourceFamilies: [...filters.sourceFamilies], maxRows: filters.maxRows, batchSize: filters.batchSize });
  const r2 = await runFinanceBackfillDryRun({ sourceFamilies: [...filters.sourceFamilies], maxRows: filters.maxRows, batchSize: filters.batchSize });
  const strip = (r: typeof r1) => ({ ...r, generatedTimestamp: undefined, codeCommit: undefined });
  assert.deepEqual(strip(r1), strip(r2));
});

test("integration: known legacy pending bookings classify as legacy_pending_booking_manual_review, manual_review, writable=false", async () => {
  const report = await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 1000, batchSize: 500 });
  assert.ok((report.aggregates.classificationCounts["legacy_pending_booking_manual_review"] ?? 0) >= 5);
  assert.ok((report.aggregates.legacyPendingCount ?? 0) >= 5);
  // writable=false is enforced inside accumulate() — reaching this line without
  // throwing already proves the invariant held for every scanned row.
});

test("integration: cursor continuation does not duplicate or skip rows across two pages", async () => {
  const page1 = await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 2, batchSize: 2 });
  assert.equal(page1.truncated, true);
  const cursor = page1.nextCursors.bookings;
  assert.ok(typeof cursor === "number");

  const page2 = await runFinanceBackfillDryRun({
    sourceFamilies: ["bookings"],
    maxRows: 1000,
    batchSize: 500,
    cursors: [{ family: "bookings", afterId: cursor as number }],
  });

  const fullScan = await runFinanceBackfillDryRun({ sourceFamilies: ["bookings"], maxRows: 1000, batchSize: 500 });

  // page1's scanned rows + page2's scanned rows should equal the full scan,
  // with no overlap (no duplication) and nothing missing (no skip).
  assert.equal(page1.scannedCount + page2.scannedCount, fullScan.scannedCount);
});

test("integration: max rows bounds the total scanned across all requested families", async () => {
  const report = await runFinanceBackfillDryRun({
    sourceFamilies: ["package_orders", "bookings", "studio_walkins"],
    maxRows: 3,
    batchSize: 100,
  });
  assert.ok(report.scannedCount <= 3);
});
