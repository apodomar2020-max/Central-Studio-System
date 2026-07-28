/**
 * Finance Phase 2D-1B — zero-write historical backfill dry-run planner.
 *
 * Pure read + report: queries package_orders / bookings / attendance
 * (studio walk-ins), runs each row through financeBackfillClassifier.ts (the
 * ONE canonical classifier — this module contains no classification logic of
 * its own), and returns deterministic, aggregate-only reports. This module
 * contains NO import of any INSERT/UPDATE/DELETE helper and creates no
 * payment_backfill_batches row — batch persistence is explicitly Phase
 * 2D-1C/2D-2 scope. No CLI, no writer, no Admin UI.
 *
 * Output safety: the report is aggregate-only by construction — there is no
 * field, sample, or diagnostic facility anywhere in this module that carries
 * a name, email, phone, or other PII into the returned report. Source IDs are
 * used internally to build opaque per-family cursors in `pageInfo`. The
 * deprecated numeric `nextCursors` mirror remains for one transition release
 * so already-deployed operator tooling is not broken.
 *
 * Cursor semantics: package_orders, bookings, and attendance are three
 * unrelated integer ID spaces. There is no meaningful global ordering across
 * them, so this planner returns one cursor PER FAMILY (`nextCursors`)
 * instead of a single cross-family cursor. Each family is queried with a
 * stable `ORDER BY id ASC` and, when resuming, `id > cursor` — never
 * OFFSET-based pagination, so concurrent inserts elsewhere in the table
 * cannot shift already-returned rows out from under a later page.
 *
 * This module does not itself open a transaction — by default `db` is used,
 * so each family's SELECT is an independent statement (a dry-run spanning
 * multiple families is not atomic across them). A caller that needs a real
 * Postgres read-only transaction (see the CLI in ../cli/) can pass a `tx`
 * from `db.transaction()` as the second argument to
 * `runFinanceBackfillDryRun`/`fetchExistingRecords` instead of the default.
 */
import {
  and,
  asc,
  gt,
  gte,
  inArray,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import {
  db,
  packageOrdersTable,
  bookingsTable,
  attendanceTable,
  paymentRecordsTable,
} from "@workspace/db";
import {
  classifyPackageOrder,
  classifyBooking,
  classifyStudioWalkinAttendance,
  CLASSIFIER_VERSION,
  SOURCE_FAMILIES,
  ELIGIBILITY_CLASSES,
  PACKAGE_ORDER_CLASSIFICATION_CODES,
  BOOKING_CLASSIFICATION_CODES,
  STUDIO_WALKIN_CLASSIFICATION_CODES,
  type FinanceBackfillClassification,
  type FinanceBackfillClassificationCode,
  type SourceFamily,
  type EligibilityClass,
  type PaymentRecordSummaryInput,
  type BookingClassifyInput,
} from "./financeBackfillClassifier";
import { resolveCodeCommit } from "./codeCommit";
import {
  normalizeFinanceBackfillPageInfo,
  type FinanceBackfillPageInfo,
  type LegacyFinanceBackfillCursorMap,
} from "./financeBackfillPagination";

export type { SourceFamily, EligibilityClass, FinanceBackfillClassificationCode };
export { SOURCE_FAMILIES, CLASSIFIER_VERSION };

/**
 * The minimal drizzle query-builder surface the planner needs. `db` and a
 * `db.transaction()` callback's `tx` both satisfy this shape, so a caller
 * (e.g. the CLI) can wrap a dry-run in a real Postgres read-only
 * transaction by passing `tx` here instead of the default shared `db`.
 */
export type DbLike = Pick<typeof db, "select">;

export const DRY_RUN_REPORT_SCHEMA_VERSION = "2d1b.1.1.0";

/** Every classification code the classifier can ever produce, for filter validation. */
const ALL_CLASSIFICATION_CODES: readonly string[] = [
  ...PACKAGE_ORDER_CLASSIFICATION_CODES,
  ...BOOKING_CLASSIFICATION_CODES,
  ...STUDIO_WALKIN_CLASSIFICATION_CODES,
];

/** Hard safety bounds. Neither of these has a silent unbounded fallback. */
export const MAX_ROWS_LIMIT = 5000;
export const MAX_BATCH_SIZE = 1000;

export interface FamilyCursor {
  family: SourceFamily;
  /** Resume strictly after this source-table row id (id > afterId). */
  afterId: number;
}

export interface DryRunFilters {
  /** Required, non-empty. No default — an empty/omitted scope is rejected. */
  sourceFamilies: SourceFamily[];
  /**
   * Optional filter on the classifier's own `operationalSourceStatus` string
   * (the source row's raw status/bookingStatus, echoed post-classification —
   * not re-derived here). Freeform: source-row status vocab differs per
   * family and is not itself part of the classifier's typed contract, so
   * this is validated only for shape (non-empty trimmed strings), not against
   * a fixed enum.
   */
  operationalStatuses?: string[];
  createdAfter?: string;
  createdBefore?: string;
  /** Per-family resume cursors. Omit a family to scan it from the start. */
  cursors?: FamilyCursor[];
  /** Required, positive integer, bounded by MAX_ROWS_LIMIT. Caps total rows scanned this call, across all families. */
  maxRows: number;
  /** Required, positive integer, bounded by MAX_BATCH_SIZE. Per-family page size. */
  batchSize: number;
  classificationCodes?: FinanceBackfillClassificationCode[];
  eligibilityClasses?: EligibilityClass[];
}

export interface DryRunAggregates {
  sourceFamilyCounts: Record<string, number>;
  sourceKindCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  eligibilityCounts: Record<string, number>;
  evidenceClassCounts: Record<string, number>;
  amountAvailabilityCounts: Record<string, number>;
  amountReliabilityCounts: Record<string, number>;
  discountReliabilityCounts: Record<string, number>;
  paymentStatusReliabilityCounts: Record<string, number>;
  paymentMethodReliabilityCounts: Record<string, number>;
  timestampReliabilityCounts: Record<string, number>;
  actorReliabilityCounts: Record<string, number>;
  reasonCodeCounts: Record<string, number>;
  warningCodeCounts: Record<string, number>;

  alreadyCanonicalCount: number;
  automaticExactCount: number;
  manualReviewCount: number;
  excludedCount: number;
  corruptCount: number;
  estimatedOnlyCount: number;
  unknownAmountCount: number;
  legacyPendingCount: number;
  multipleRecordCount: number;
  mismatchedRecordCount: number;
}

/** Only exact, source-backed amounts may ever contribute here. */
export interface AuthoritativeMonetaryTotals {
  grossAmountMinor: number;
  discountAmountMinor: number;
  finalPayableAmountMinor: number;
  rowCount: number;
  currency: "EGP";
  label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY";
}

/** Current-operational-price estimates. Never authoritative, never summed into Finance revenue. */
export interface EstimatedAnalyticalTotals {
  estimatedTotalMinor: number;
  estimatedRowCount: number;
  currency: "EGP";
  label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE";
}

/** Counts only — an unknown amount is never coerced to 0. */
export interface UnknownAmountPopulation {
  rowCount: number;
  label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO";
}

export interface DryRunReport {
  reportSchemaVersion: string;
  classifierVersion: string;
  codeCommit: string;
  generatedTimestamp: string;
  appliedFilters: DryRunFilters;

  scannedCount: number;
  classifiedCount: number;
  /** @deprecated Use pageInfo.hasNextPage. Kept for one release for existing tooling. */
  truncated: boolean;
  /** @deprecated Raw numeric boundaries; use opaque pageInfo.nextCursors. */
  nextCursors: Partial<LegacyFinanceBackfillCursorMap>;
  pageInfo: FinanceBackfillPageInfo;

  aggregates: DryRunAggregates;
  authoritativeTotals: AuthoritativeMonetaryTotals;
  estimatedTotals: EstimatedAnalyticalTotals;
  unknownAmountPopulation: UnknownAmountPopulation;
}

// ── Filter validation ───────────────────────────────────────────────────────

export function validateDryRunFilters(filters: DryRunFilters): void {
  if (!Array.isArray(filters.sourceFamilies) || filters.sourceFamilies.length === 0) {
    throw new Error("sourceFamilies is required and must be a non-empty array");
  }
  for (const family of filters.sourceFamilies) {
    if (!(SOURCE_FAMILIES as readonly string[]).includes(family)) {
      throw new Error(`unsupported source family: ${String(family)}`);
    }
  }

  if (!Number.isInteger(filters.maxRows) || filters.maxRows <= 0) {
    throw new Error("maxRows is required and must be a positive integer");
  }
  if (filters.maxRows > MAX_ROWS_LIMIT) {
    throw new Error(`maxRows exceeds the maximum allowed value of ${MAX_ROWS_LIMIT}`);
  }

  if (!Number.isInteger(filters.batchSize) || filters.batchSize <= 0) {
    throw new Error("batchSize is required and must be a positive integer");
  }
  if (filters.batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize exceeds the maximum allowed value of ${MAX_BATCH_SIZE}`);
  }

  if (filters.createdAfter != null && Number.isNaN(Date.parse(filters.createdAfter))) {
    throw new Error("createdAfter is not a valid date string");
  }
  if (filters.createdBefore != null && Number.isNaN(Date.parse(filters.createdBefore))) {
    throw new Error("createdBefore is not a valid date string");
  }
  if (
    filters.createdAfter != null &&
    filters.createdBefore != null &&
    Date.parse(filters.createdAfter) > Date.parse(filters.createdBefore)
  ) {
    throw new Error("createdAfter must not be later than createdBefore");
  }

  if (filters.classificationCodes) {
    for (const code of filters.classificationCodes) {
      if (!ALL_CLASSIFICATION_CODES.includes(code)) {
        throw new Error(`unsupported classification code: ${String(code)}`);
      }
    }
  }
  if (filters.eligibilityClasses) {
    for (const eligibility of filters.eligibilityClasses) {
      if (!(ELIGIBILITY_CLASSES as readonly string[]).includes(eligibility)) {
        throw new Error(`unsupported eligibility class: ${String(eligibility)}`);
      }
    }
  }
  if (filters.operationalStatuses) {
    for (const status of filters.operationalStatuses) {
      if (typeof status !== "string" || status.trim().length === 0) {
        throw new Error("operationalStatuses entries must be non-empty strings");
      }
    }
  }

  if (filters.cursors) {
    for (const cursor of filters.cursors) {
      if (!(SOURCE_FAMILIES as readonly string[]).includes(cursor.family)) {
        throw new Error(`unsupported cursor family: ${String(cursor.family)}`);
      }
      if (!filters.sourceFamilies.includes(cursor.family)) {
        throw new Error(`cursor family "${cursor.family}" is not included in sourceFamilies`);
      }
      if (!Number.isInteger(cursor.afterId) || cursor.afterId < 0) {
        throw new Error(`invalid cursor afterId for family "${cursor.family}"`);
      }
    }
  }
}

function emptyAggregates(): DryRunAggregates {
  return {
    sourceFamilyCounts: {},
    sourceKindCounts: {},
    classificationCounts: {},
    eligibilityCounts: {},
    evidenceClassCounts: {},
    amountAvailabilityCounts: {},
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
    manualReviewCount: 0,
    excludedCount: 0,
    corruptCount: 0,
    estimatedOnlyCount: 0,
    unknownAmountCount: 0,
    legacyPendingCount: 0,
    multipleRecordCount: 0,
    mismatchedRecordCount: 0,
  };
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function accumulate(agg: DryRunAggregates, c: FinanceBackfillClassification): void {
  // Defense in depth: this phase must never treat any result as writable,
  // regardless of source family or classification code.
  if (c.writable !== false) {
    throw new Error("invariant violated: Phase 2D-1B classification result must never be writable");
  }

  bump(agg.sourceFamilyCounts, c.sourceFamily);
  bump(agg.sourceKindCounts, c.sourceKind);
  bump(agg.classificationCounts, c.classificationCode);
  bump(agg.eligibilityCounts, c.eligibility);
  bump(agg.evidenceClassCounts, c.evidenceClass);
  bump(agg.amountAvailabilityCounts, c.amountAvailability);
  bump(agg.amountReliabilityCounts, c.amountTier);
  bump(agg.discountReliabilityCounts, c.discountTier);
  bump(agg.paymentStatusReliabilityCounts, c.paymentStatusTier);
  bump(agg.paymentMethodReliabilityCounts, c.paymentMethodEvidenceClass);
  bump(agg.timestampReliabilityCounts, c.paidTimestampEvidenceClass);
  bump(agg.actorReliabilityCounts, c.actorEvidenceClass);
  for (const code of c.reasonCodes) bump(agg.reasonCodeCounts, code);
  for (const code of c.warningCodes) bump(agg.warningCodeCounts, code);

  if (c.eligibility === "already_canonical") agg.alreadyCanonicalCount += 1;
  if (c.eligibility === "automatic_exact") agg.automaticExactCount += 1;
  if (c.eligibility === "manual_review") agg.manualReviewCount += 1;
  if (c.eligibility === "excluded") agg.excludedCount += 1;
  if (c.eligibility === "corrupt") agg.corruptCount += 1;
  if (c.amountAvailability === "estimated_backfill") agg.estimatedOnlyCount += 1;
  if (c.amountAvailability === "unknown") agg.unknownAmountCount += 1;
  if (
    c.classificationCode === "legacy_pending_booking_manual_review" ||
    c.classificationCode === "legacy_pending_package_manual_review"
  ) {
    agg.legacyPendingCount += 1;
  }
  if (c.classificationCode === "multiple_finance_records_corrupt") agg.multipleRecordCount += 1;
  if (c.classificationCode === "mismatched_finance_record_corrupt") agg.mismatchedRecordCount += 1;
}

function passesResultFilters(c: FinanceBackfillClassification, filters: DryRunFilters): boolean {
  if (filters.classificationCodes && !filters.classificationCodes.includes(c.classificationCode)) return false;
  if (filters.eligibilityClasses && !filters.eligibilityClasses.includes(c.eligibility)) return false;
  if (filters.operationalStatuses && !filters.operationalStatuses.includes(c.operationalSourceStatus)) return false;
  return true;
}

async function fetchExistingRecords(
  executor: DbLike,
  packageOrderIds: number[],
  bookingIds: number[],
): Promise<PaymentRecordSummaryInput[]> {
  const clauses: SQL[] = [];
  if (packageOrderIds.length > 0) clauses.push(inArray(paymentRecordsTable.packageOrderId, packageOrderIds));
  if (bookingIds.length > 0) clauses.push(inArray(paymentRecordsTable.bookingId, bookingIds));
  if (clauses.length === 0) return [];
  const whereClause = clauses.length === 1 ? clauses[0] : or(...clauses);
  const rows = await executor
    .select({
      id: paymentRecordsTable.id,
      flowType: paymentRecordsTable.flowType,
      packageOrderId: paymentRecordsTable.packageOrderId,
      bookingId: paymentRecordsTable.bookingId,
      status: paymentRecordsTable.status,
    })
    .from(paymentRecordsTable)
    .where(whereClause);
  return rows;
}

function cursorFor(filters: DryRunFilters, family: SourceFamily): number | undefined {
  return filters.cursors?.find((c) => c.family === family)?.afterId;
}

export interface ClassifiedRow {
  family: SourceFamily;
  id: number;
  classification: FinanceBackfillClassification;
}

export interface AggregateReportInput {
  scannedCount: number;
  truncated: boolean;
  nextCursors: Partial<Record<SourceFamily, number | null>>;
}

/**
 * Pure aggregation: takes already-classified rows (already-fetched from the
 * DB, already run through the canonical classifier) and the filters that
 * were applied, and builds the report body. Contains no database access, no
 * classification logic of its own, and no time-varying state other than
 * whatever the caller passes in — fully unit-testable without Postgres.
 */
export function buildAggregateReport(
  rows: ClassifiedRow[],
  filters: DryRunFilters,
  meta: AggregateReportInput,
): Omit<DryRunReport, "codeCommit" | "generatedTimestamp"> {
  const { pageInfo, legacyNextCursors } = normalizeFinanceBackfillPageInfo(meta.nextCursors);
  const aggregates = emptyAggregates();
  let classifiedCount = 0;
  let authoritativeGross = 0;
  let authoritativeDiscount = 0;
  let authoritativeFinal = 0;
  let authoritativeRowCount = 0;
  let estimatedTotalMinor = 0;
  let estimatedRowCount = 0;
  let unknownAmountRowCount = 0;

  for (const { classification } of rows) {
    if (!passesResultFilters(classification, filters)) continue;
    classifiedCount += 1;
    accumulate(aggregates, classification);

    if (classification.isExactEvidenceEligible) {
      authoritativeGross += classification.grossAmountMinor ?? 0;
      authoritativeDiscount += classification.discountAmountMinor ?? 0;
      authoritativeFinal += classification.finalPayableAmountMinor ?? 0;
      authoritativeRowCount += 1;
    }
    if (classification.amountAvailability === "estimated_backfill" && classification.currentPriceEstimateMinor != null) {
      estimatedTotalMinor += classification.currentPriceEstimateMinor;
      estimatedRowCount += 1;
    }
    if (classification.amountAvailability === "unknown") {
      unknownAmountRowCount += 1;
    }
  }

  return {
    reportSchemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    appliedFilters: filters,
    scannedCount: meta.scannedCount,
    classifiedCount,
    truncated: pageInfo.hasNextPage,
    nextCursors: legacyNextCursors,
    pageInfo,
    aggregates,
    authoritativeTotals: {
      grossAmountMinor: authoritativeGross,
      discountAmountMinor: authoritativeDiscount,
      finalPayableAmountMinor: authoritativeFinal,
      rowCount: authoritativeRowCount,
      currency: "EGP",
      label: "AUTHORITATIVE_EXACT_EVIDENCE_ONLY",
    },
    estimatedTotals: {
      estimatedTotalMinor,
      estimatedRowCount,
      currency: "EGP",
      label: "NON_AUTHORITATIVE_ESTIMATE_EXCLUDED_FROM_FINANCE_REVENUE",
    },
    unknownAmountPopulation: {
      rowCount: unknownAmountRowCount,
      label: "UNKNOWN_NEVER_SUBSTITUTED_AS_ZERO",
    },
  };
}

/**
 * Runs the zero-write dry-run scan. Never issues an INSERT/UPDATE/DELETE/DDL.
 * Never creates a payment_backfill_batches or payment_backfill_progress row.
 * Throws (does not silently no-op) on any invalid or unbounded filter input.
 */
export async function runFinanceBackfillDryRun(filters: DryRunFilters, executor: DbLike = db): Promise<DryRunReport> {
  validateDryRunFilters(filters);

  const classifiedRows: ClassifiedRow[] = [];
  let scannedCount = 0;
  const nextCursors: Partial<Record<SourceFamily, number | null>> = {};

  // Fixed canonical processing order regardless of the caller's array order,
  // so identical filters always scan families in the same sequence and
  // consume the shared `remaining` budget identically.
  const familiesToScan = SOURCE_FAMILIES.filter((f) => filters.sourceFamilies.includes(f));
  let remaining = filters.maxRows;

  function considerRow(family: SourceFamily, id: number, classification: FinanceBackfillClassification): void {
    scannedCount += 1;
    nextCursors[family] = id;
    classifiedRows.push({ family, id, classification });
  }

  function recordPageBoundary(
    family: SourceFamily,
    rows: Array<{ id: number }>,
    pageRows: Array<{ id: number }>,
    afterId: number | undefined,
  ): void {
    if (rows.length > pageRows.length) {
      nextCursors[family] = pageRows.at(-1)?.id ?? afterId ?? 0;
    } else {
      nextCursors[family] = null;
    }
  }

  for (const family of familiesToScan) {
    const pageSize = Math.min(remaining, filters.batchSize);
    const afterId = cursorFor(filters, family);

    if (family === "package_orders") {
      const conditions = [];
      if (afterId != null) conditions.push(gt(packageOrdersTable.id, afterId));
      if (filters.createdAfter) conditions.push(gte(packageOrdersTable.createdAt, filters.createdAfter));
      if (filters.createdBefore) conditions.push(lte(packageOrdersTable.createdAt, filters.createdBefore));

      const rows = await executor
        .select()
        .from(packageOrdersTable)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(packageOrdersTable.id))
        .limit(Math.max(1, pageSize + 1));

      const pageRows = rows.slice(0, pageSize);
      recordPageBoundary(family, rows, pageRows, afterId);

      const existing = await fetchExistingRecords(executor, pageRows.map((r) => r.id), []);
      for (const row of pageRows) {
        if (remaining <= 0) break;
        const classification = classifyPackageOrder(
          { id: row.id, status: row.status, activatedAt: row.activatedAt, createdAt: row.createdAt, packageId: row.packageId },
          existing.filter((e) => e.packageOrderId === row.id),
          // No catalog price lookup wired in Phase 2D-1 — always unknown_amount
          // rather than inventing a number.
          null,
        );
        considerRow(family, row.id, classification);
        remaining -= 1;
      }
    }

    if (family === "bookings") {
      const conditions = [];
      if (afterId != null) conditions.push(gt(bookingsTable.id, afterId));
      if (filters.createdAfter) conditions.push(gte(bookingsTable.createdAt, filters.createdAfter));
      if (filters.createdBefore) conditions.push(lte(bookingsTable.createdAt, filters.createdBefore));

      const rows = await executor
        .select()
        .from(bookingsTable)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(bookingsTable.id))
        .limit(Math.max(1, pageSize + 1));

      const pageRows = rows.slice(0, pageSize);
      recordPageBoundary(family, rows, pageRows, afterId);

      // A booking is "studio-walk-in linked" iff it already has a
      // payment_records row with flowType 'studio_walkin' — the only
      // reliable, generic signal this schema exposes.
      const existing = await fetchExistingRecords(executor, [], pageRows.map((r) => r.id));

      for (const row of pageRows) {
        if (remaining <= 0) break;
        const own = existing.filter((e) => e.bookingId === row.id);
        const isStudioWalkinLinked = own.some((e) => e.flowType === "studio_walkin");
        const input: BookingClassifyInput = {
          id: row.id,
          bookingStatus: row.bookingStatus,
          paymentStatus: row.paymentStatus,
          paymentMode: row.paymentMode,
          scheduleId: row.scheduleId,
          classId: row.classId,
          balletScheduleId: row.balletScheduleId,
          createdAt: row.createdAt,
          isStudioWalkinLinked,
        };
        const classification = classifyBooking(input, own, null);
        considerRow(family, row.id, classification);
        remaining -= 1;
      }
    }

    if (family === "studio_walkins") {
      const conditions = [];
      if (afterId != null) conditions.push(gt(attendanceTable.id, afterId));
      if (filters.createdAfter) conditions.push(gte(attendanceTable.checkedInAt, filters.createdAfter));
      if (filters.createdBefore) conditions.push(lte(attendanceTable.checkedInAt, filters.createdBefore));

      const rows = await executor
        .select()
        .from(attendanceTable)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(attendanceTable.id))
        .limit(Math.max(1, pageSize + 1));

      const pageRows = rows.slice(0, pageSize);
      recordPageBoundary(family, rows, pageRows, afterId);

      const bookingIds = pageRows.map((r) => r.bookingId).filter((id): id is number => id != null);
      const linkedBookings = bookingIds.length
        ? await executor.select().from(bookingsTable).where(inArray(bookingsTable.id, bookingIds))
        : [];
      const existing = await fetchExistingRecords(executor, [], bookingIds);

      for (const row of pageRows) {
        if (remaining <= 0) break;
        const linkedBooking = linkedBookings.find((b) => b.id === row.bookingId) ?? null;
        const classification = classifyStudioWalkinAttendance(
          { id: row.id, bookingId: row.bookingId, creditDeducted: row.creditDeducted, status: row.status, checkedInAt: row.checkedInAt },
          linkedBooking
            ? {
                id: linkedBooking.id,
                bookingStatus: linkedBooking.bookingStatus,
                paymentStatus: linkedBooking.paymentStatus,
                paymentMode: linkedBooking.paymentMode,
                scheduleId: linkedBooking.scheduleId,
                classId: linkedBooking.classId,
                balletScheduleId: linkedBooking.balletScheduleId,
                createdAt: linkedBooking.createdAt,
                isStudioWalkinLinked: false,
              }
            : null,
          existing,
        );
        considerRow(family, row.id, classification);
        remaining -= 1;
      }
    }
  }

  const reportBody = buildAggregateReport(classifiedRows, filters, {
    scannedCount,
    truncated: Object.values(nextCursors).some((cursor) => cursor != null),
    nextCursors,
  });
  return {
    ...reportBody,
    codeCommit: await resolveCodeCommit(),
    generatedTimestamp: new Date().toISOString(),
  };
}
