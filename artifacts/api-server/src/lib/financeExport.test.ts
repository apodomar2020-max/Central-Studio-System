/**
 * Finance Phase 1 — export and overview-classification tests.
 *
 * Pure layers only (no @workspace/db import, no pool).
 *
 * The export is the highest-risk Finance surface: a spreadsheet leaves the
 * system, gets re-saved as CSV, gets summed by someone who never read the UI
 * caveats. So these tests pin the two things that would cause real financial
 * misstatement — an unknown amount exporting as 0, and an unsanitized formula
 * cell — plus the mandatory limitation text.
 */
import assert from "node:assert/strict";
import test from "node:test";

const loadExport = () => import("./financeExport");
const loadModel = () => import("./financeReadModel");
const loadMath = () => import("./financialAggregateMath");
const loadContract = () => import("@workspace/api-zod");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function unknownAmountPackageEvent(overrides: Record<string, unknown> = {}) {
  const { mapPackagePurchase } = await loadModel();
  return mapPackagePurchase({
    id: 12, status: "active", packageId: null, packageName: "Mystery Pack",
    studentId: 55, studentName: "Nour Hassan", studentEmail: "nour@example.com",
    studentPhone: "+20 100 000 0000",
    currentCatalogPriceEgp: null, // unresolvable → unknown, not zero
    activatedAt: "2026-06-01T10:00:00.000Z", createdAt: "2026-05-30T09:00:00.000Z",
    ...overrides,
  } as never);
}

async function creditEvent() {
  const { mapCreditTransaction } = await loadModel();
  return mapCreditTransaction({
    id: 300, packageOrderId: 12, studentId: 55, type: "attendance_deduction",
    delta: -1, balanceBefore: 8, balanceAfter: 7, referenceId: 610,
    referenceType: "attendance", createdAt: "2026-06-10T18:00:00.000Z",
    createdBy: "mobile:check-in", packageName: "8-Class Pack", packageId: 3,
    studentName: "Nour Hassan", studentEmail: "nour@example.com", studentPhone: null,
  } as never);
}

async function balletPaymentEvent(overrides: Record<string, unknown> = {}) {
  const { mapBalletPayment } = await loadModel();
  return mapBalletPayment({
    id: 41, applicationId: 8, packageOrderId: null, amountEgp: 3000, status: "paid",
    paymentMethod: "kashier", paidAt: "2026-06-02T12:00:00.000Z", refundedAt: null,
    createdAt: "2026-06-01T12:00:00.000Z", parentStudentId: 70,
    parentName: "Mona Adel", parentEmail: "mona@example.com", parentPhone: "+20 111 111 1111",
    childId: 12, childName: "Layla Adel",
    ...overrides,
  } as never);
}

// ─── Unknown amounts must never export as zero ────────────────────────────────

test("an unknown amount exports blank in every monetary column — never 0", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const row = buildFinanceExportRow(await unknownAmountPackageEvent());

  const monetaryColumns = [
    "amountEgp", "grossAmountEgp", "discountAmountEgp",
    "requestedRefundAmountEgp", "approvedRefundAmountEgp", "refundedAmountEgp",
    "netAmountEgp",
  ];
  for (const column of monetaryColumns) {
    assert.equal(row[column], "", `${column} must be blank for an unknown amount`);
    assert.notEqual(row[column], 0, `${column} must never export as 0`);
    assert.notEqual(row[column], "0");
  }
  // A human-readable marker still tells the reader why the cells are empty.
  assert.equal(row["amountAvailability"], "Unknown");
  assert.equal(row["amountSource"], "unavailable");
  assert.equal(row["reliability"], "Unknown Amount");
});

test("a real zero amount still exports as 0, distinct from unknown", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const row = buildFinanceExportRow(await unknownAmountPackageEvent({ currentCatalogPriceEgp: 0 }));
  assert.equal(row["amountEgp"], 0);
  assert.equal(row["amountAvailability"], "estimated");
});

test("credit events export unit deltas and leave every EGP column blank", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const row = buildFinanceExportRow(await creditEvent());

  assert.equal(row["creditUnitDelta"], -1);
  assert.equal(row["amountEgp"], "");
  assert.equal(row["netAmountEgp"], "");
  assert.equal(row["grossAmountEgp"], "");
  assert.equal(row["eventNature"], "Service Credit");
  assert.equal(row["reliability"], "Service Credit Unit");
  // not_applicable is distinct from Unknown: the event simply is not monetary.
  assert.equal(row["amountAvailability"], "not_applicable");
});

test("monetary events leave the credit unit column blank", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const row = buildFinanceExportRow(await balletPaymentEvent());
  assert.equal(row["creditUnitDelta"], "");
  assert.equal(row["amountEgp"], 3000);
});

// ─── Formula-injection sanitization ───────────────────────────────────────────

test("dangerous text values are neutralized through sanitizeCellText", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const { sanitizeCellText } = await import("./exportSanitizer");

  const hostile = "=HYPERLINK(\"http://evil\",\"click\")";
  const row = buildFinanceExportRow(
    await balletPaymentEvent({ parentName: hostile, childName: `@${hostile}` }),
  );

  // The sanitizer's contract: prefix with an apostrophe so the cell is literal.
  assert.equal(row["customer"], sanitizeCellText(hostile));
  assert.ok(String(row["customer"]).startsWith("'="), "formula prefix must be escaped");
  assert.ok(String(row["participant"]).startsWith("'@"));
  // The raw value must not survive anywhere in the row.
  assert.ok(!Object.values(row).includes(hostile));
});

test("no export cell can begin with a character a spreadsheet treats as a formula", async () => {
  const { buildFinanceExportRow } = await loadExport();

  // The property that matters, stated independently of how it is achieved:
  // `=`, `+`, `-`, `@`, tab and CR get escaped by sanitizeCellText, while
  // leading whitespace is already removed during normalization. Either way the
  // emitted cell must not start with a formula trigger.
  const DANGEROUS_FIRST_CHAR = /^[=+\-@\t\r]/;

  for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
    const payload = `${prefix}cmd|' /C calc'!A1`;
    const row = buildFinanceExportRow(
      await balletPaymentEvent({ parentName: payload, childName: payload }),
    );

    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== "string") continue;
      assert.doesNotMatch(
        value,
        DANGEROUS_FIRST_CHAR,
        `${column} begins with a formula trigger for input ${JSON.stringify(prefix)}`,
      );
    }
    // And the raw payload must never survive verbatim in any cell.
    assert.ok(
      !Object.values(row).includes(payload),
      `raw payload leaked for prefix ${JSON.stringify(prefix)}`,
    );
  }
});

test("printable formula prefixes are escaped with the sanitizer's apostrophe marker", async () => {
  const { buildFinanceExportRow } = await loadExport();

  // For the prefixes that survive normalization, the escape must be the
  // repository-standard apostrophe rather than deletion of the character.
  for (const prefix of ["=", "+", "@"]) {
    const row = buildFinanceExportRow(
      await balletPaymentEvent({ parentName: `${prefix}cmd|' /C calc'!A1` }),
    );
    assert.equal(
      String(row["customer"]).slice(0, 2),
      `'${prefix}`,
      `prefix ${prefix} must be apostrophe-escaped, not stripped`,
    );
  }
});

test("a phone-like value is left readable rather than quote-prefixed", async () => {
  const { buildFinanceExportRow } = await loadExport();
  // The sanitizer deliberately exempts purely numeric +/- strings so exported
  // phone columns stay usable; Finance must not regress that behaviour.
  const row = buildFinanceExportRow(await balletPaymentEvent({ parentName: "+20 100 000 0000" }));
  assert.equal(row["customer"], "+20 100 000 0000");
});

test("provider reference is sanitized and absent references render as an em dash", async () => {
  const { buildFinanceExportRow } = await loadExport();
  const withNone = buildFinanceExportRow(await balletPaymentEvent());
  // ballet_payments has no provider transaction column — notes are not one.
  assert.equal(withNone["providerReference"], "—");
});

// ─── Limitations, columns and summary ─────────────────────────────────────────

test("export limitation warnings are present and use the mandated wording", async () => {
  const { FINANCE_EXPORT_WARNINGS } = await loadExport();
  const { FINANCE_EXPORT_ESTIMATE_WARNING, FINANCE_EXPORT_KASHIER_WARNING } = await loadContract();

  assert.ok(FINANCE_EXPORT_WARNINGS.includes(FINANCE_EXPORT_ESTIMATE_WARNING));
  assert.ok(FINANCE_EXPORT_WARNINGS.includes(FINANCE_EXPORT_KASHIER_WARNING));
  assert.match(FINANCE_EXPORT_ESTIMATE_WARNING, /must not be treated as historically verified/i);
  assert.match(FINANCE_EXPORT_KASHIER_WARNING, /provider settlement is not verified/i);
});

test("the export is named Unified Finance Activity Export and nothing misleading", async () => {
  const { FINANCE_EXPORT_TITLE } = await loadExport();
  assert.equal(FINANCE_EXPORT_TITLE, "Unified Finance Activity Export");
  assert.doesNotMatch(FINANCE_EXPORT_TITLE, /ledger|audited/i);
});

test("no Finance-authored text uses forbidden financial vocabulary", async () => {
  const { FINANCE_EXPORT_WARNINGS, FINANCE_EXPORT_TITLE } = await loadExport();
  const { FINANCE_RELIABILITY_EXPLANATIONS, FINANCE_RELIABILITY_LABELS, FINANCE_EVENT_TYPE_LABELS } = await loadModel();
  const { FINANCE_ESTIMATE_WARNING, FINANCE_KASHIER_WARNING } = await loadContract();

  const forbidden = /verified cash|verified gateway receipt|full financial ledger|bank-settled revenue/i;
  const allText = [
    FINANCE_EXPORT_TITLE,
    ...FINANCE_EXPORT_WARNINGS,
    FINANCE_ESTIMATE_WARNING,
    FINANCE_KASHIER_WARNING,
    ...Object.values(FINANCE_RELIABILITY_EXPLANATIONS),
    ...Object.values(FINANCE_RELIABILITY_LABELS),
    ...Object.values(FINANCE_EVENT_TYPE_LABELS),
  ];
  for (const text of allText) assert.doesNotMatch(text, forbidden, `forbidden wording in: ${text}`);
});

test("every required export column is present, in a stable order", async () => {
  const { FINANCE_EXPORT_COLUMNS } = await loadExport();
  const labels = FINANCE_EXPORT_COLUMNS.map((column) => column.label);

  const required = [
    "Event ID", "Event Type", "Event Nature", "Occurred At", "Customer", "Participant",
    "Source", "Source ID", "Amount EGP", "Gross Amount EGP", "Discount Amount EGP",
    "Requested Refund Amount EGP", "Approved Refund Amount EGP", "Refunded Amount EGP",
    "Net Amount EGP", "Credit Unit Delta", "Payment Status", "Refund Status",
    "Raw Source Status", "Raw Payment Method", "Amount Availability", "Amount Source",
    "Reliability", "Reliability Explanation", "Provider Reference",
  ];
  for (const label of required) assert.ok(labels.includes(label), `missing column: ${label}`);
  assert.equal(labels[0], "Event ID");
  assert.equal(labels.at(-1), "Provider Reference");
});

test("every export row exposes exactly the declared column keys", async () => {
  const { buildFinanceExportRows, FINANCE_EXPORT_COLUMNS } = await loadExport();
  const rows = buildFinanceExportRows([
    await balletPaymentEvent(),
    await creditEvent(),
    await unknownAmountPackageEvent(),
  ]);

  for (const row of rows) {
    for (const column of FINANCE_EXPORT_COLUMNS) {
      assert.ok(column.key in row, `row is missing ${column.key}`);
    }
  }
});

test("the export summary counts availabilities separately and never sums them into one total", async () => {
  const { buildFinanceExportSummary } = await loadExport();
  const summary = buildFinanceExportSummary([
    await balletPaymentEvent(),          // exact
    await creditEvent(),                 // not_applicable
    await unknownAmountPackageEvent(),   // unknown
  ]);

  assert.equal(summary["totalEvents"], 3);
  assert.equal(summary["exactAmountEvents"], 1);
  assert.equal(summary["unknownAmountEvents"], 1);
  assert.equal(summary["serviceCreditEvents"], 1);
  assert.equal(summary["estimatedAmountEvents"], 0);
  // No key may present a single blended monetary total.
  for (const key of Object.keys(summary)) {
    assert.doesNotMatch(key, /^total(Amount|Revenue|Egp)/i, `summary must not blend money: ${key}`);
  }
  assert.match(String(summary["note"]), /not summed into one total/i);
});

// ─── Aggregate / overview classification ──────────────────────────────────────

test("hybrid indicators match the existing aggregate math exactly", async () => {
  const { buildFinancialAggregates } = await loadMath();
  const aggregates = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 1200,
    grossGenericPackageRevenueEgp: 4800,
    grossBalletRevenueEgp: 9000,
    completedLedgerRefundsEgp: 2500,
    pendingLedgerRefundExposureEgp: 1500,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 6000,
    balletOnlineRevenueEgp: 2000,
    balletLegacyBankTransferRevenueEgp: 1000,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  // Finance reuses these values verbatim — it must not recompute them.
  assert.equal(aggregates.totalGrossRevenueEgp, 1200 + 4800 + 9000);
  assert.equal(aggregates.totalNetRevenueEgp, 1200 + 4800 + (9000 - 2500));
  // Recorded vs estimated stay addressable separately.
  assert.equal(aggregates.grossBalletRevenueEgp, 9000);
  assert.equal(aggregates.grossGenericBookingRevenueEgp + aggregates.grossGenericPackageRevenueEgp, 6000);
});

test("pending refund exposure never enters completed refund totals", async () => {
  const { buildFinancialAggregates } = await loadMath();
  const aggregates = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 5000,
    completedLedgerRefundsEgp: 0,
    // Approved/processing only — nothing paid out yet.
    pendingLedgerRefundExposureEgp: 4000,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 5000,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(aggregates.balletCompletedRefundsEgp, 0);
  assert.equal(aggregates.balletPendingRefundExposureEgp, 4000);
  // Net revenue must ignore exposure entirely.
  assert.equal(aggregates.balletNetRevenueEgp, 5000);
});

test("Ballet-linked package orders are excluded from generic package totals", async () => {
  const { shouldExcludePackageOrderLinkedToBalletPayment } = await loadMath();
  // The same anti-double-counting rule Finance's package query reuses, for
  // every Ballet payment status.
  for (const status of ["pending", "paid", "refunded", "rejected", null, undefined]) {
    assert.equal(shouldExcludePackageOrderLinkedToBalletPayment(status), true);
  }
});

test("overview limitation flags state plainly that no unified ledger exists", async () => {
  const { FINANCE_ESTIMATE_WARNING, FINANCE_KASHIER_WARNING } = await loadContract();
  // These two strings are contractual: the API, the UI and the exports all
  // render the same text, so a reader cannot get a caveat-free version.
  assert.match(FINANCE_ESTIMATE_WARNING, /operational estimates derived from current catalog pricing/i);
  assert.match(FINANCE_ESTIMATE_WARNING, /not historically snapshotted payment amounts/i);
  assert.match(FINANCE_KASHIER_WARNING, /admin-recorded payment methods/i);
});

// ─── Timestamp handling ───────────────────────────────────────────────────────

test("timestamps export as UTC minutes and absent timestamps as an em dash", async () => {
  const { buildFinanceExportRow } = await loadExport();

  const paid = buildFinanceExportRow(await balletPaymentEvent());
  assert.equal(paid["occurredAt"], "2026-06-02 12:00");

  const unknownTimestamp = buildFinanceExportRow(
    await balletPaymentEvent({ paidAt: null, createdAt: "not-a-date" }),
  );
  assert.equal(unknownTimestamp["occurredAt"], "—");
});
