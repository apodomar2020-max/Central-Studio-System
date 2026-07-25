/**
 * financeExport — "Unified Finance Activity Export" row builder.
 *
 * Consumes the SAME normalized read model as GET /api/finance/transactions, so
 * preview, XLSX and PDF are identical by construction. It performs no queries
 * and derives no amounts of its own.
 *
 * Two hard rules encoded here:
 *   • An unknown amount exports BLANK (or the literal "Unknown" where a
 *     human-readable marker is clearer) — never 0. Exporting 0 for "we don't
 *     know" is the single most dangerous thing a finance export can do.
 *   • Every text cell passes through sanitizeCellText() (Security Phase H) —
 *     customer names, emails, package names and provider references are all
 *     attacker-influenced and must not become spreadsheet formulas.
 */
import {
  FINANCE_EXPORT_ESTIMATE_WARNING,
  FINANCE_EXPORT_KASHIER_WARNING,
  FINANCE_EXPORT_TITLE,
  type UnifiedFinanceTransaction,
} from "@workspace/api-zod";
import {
  FINANCE_EVENT_NATURE_LABELS,
  FINANCE_EVENT_TYPE_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_RELIABILITY_LABELS,
} from "./financeReadModel";
import { sanitizeCellText } from "./exportSanitizer";

export { FINANCE_EXPORT_TITLE };

/** Warnings printed inside every exported file, before any data. */
export const FINANCE_EXPORT_WARNINGS: readonly string[] = [
  FINANCE_EXPORT_ESTIMATE_WARNING,
  FINANCE_EXPORT_KASHIER_WARNING,
];

export interface FinanceExportColumn {
  key: string;
  label: string;
}

/** Column order is part of the contract — exports are diffed by finance staff. */
export const FINANCE_EXPORT_COLUMNS: readonly FinanceExportColumn[] = [
  { key: "eventId", label: "Event ID" },
  { key: "eventType", label: "Event Type" },
  { key: "eventNature", label: "Event Nature" },
  { key: "occurredAt", label: "Occurred At" },
  { key: "customer", label: "Customer" },
  { key: "participant", label: "Participant" },
  { key: "source", label: "Source" },
  { key: "sourceId", label: "Source ID" },
  { key: "amountEgp", label: "Amount EGP" },
  { key: "grossAmountEgp", label: "Gross Amount EGP" },
  { key: "discountAmountEgp", label: "Discount Amount EGP" },
  { key: "requestedRefundAmountEgp", label: "Requested Refund Amount EGP" },
  { key: "approvedRefundAmountEgp", label: "Approved Refund Amount EGP" },
  { key: "refundedAmountEgp", label: "Refunded Amount EGP" },
  { key: "netAmountEgp", label: "Net Amount EGP" },
  { key: "creditUnitDelta", label: "Credit Unit Delta" },
  { key: "paymentStatus", label: "Payment Status" },
  { key: "refundStatus", label: "Refund Status" },
  { key: "rawSourceStatus", label: "Raw Source Status" },
  { key: "rawPaymentMethod", label: "Raw Payment Method" },
  { key: "amountAvailability", label: "Amount Availability" },
  { key: "amountSource", label: "Amount Source" },
  { key: "reliability", label: "Reliability" },
  { key: "reliabilityExplanation", label: "Reliability Explanation" },
  { key: "providerReference", label: "Provider Reference" },
];

/**
 * Monetary cell. Blank when null so a spreadsheet SUM skips it entirely —
 * `0` would be silently added, and "Unknown" would break numeric columns.
 */
function moneyCell(value: number | null): number | "" {
  return value == null ? "" : value;
}

/**
 * Non-monetary text cell: sanitized, or an em dash for absent values.
 *
 * Emptiness is judged on the trimmed value, but the ORIGINAL value is what
 * reaches sanitizeCellText — trimming first would strip a leading tab or
 * carriage return instead of escaping it, quietly stepping around the
 * Security Phase H guard. reports.ts sanitizes untrimmed values for the same
 * reason.
 */
function textCell(value: string | null | undefined): string {
  if (value == null || value.trim().length === 0) return "—";
  return sanitizeCellText(value);
}

/** ISO instant → "YYYY-MM-DD HH:MM" UTC; invalid/absent → em dash. */
function timestampCell(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * One export row. Every value is either a number (safe) or already sanitized
 * text, so downstream writers never need to re-sanitize.
 */
export function buildFinanceExportRow(
  transaction: UnifiedFinanceTransaction,
): Record<string, string | number> {
  const { amounts, credit, reliability, customer } = transaction;

  return {
    eventId: sanitizeCellText(transaction.id),
    eventType: FINANCE_EVENT_TYPE_LABELS[transaction.eventType],
    eventNature: FINANCE_EVENT_NATURE_LABELS[transaction.eventNature],
    occurredAt: timestampCell(transaction.occurredAt),
    customer: textCell(customer.name),
    // For a child participant the child is the participant; otherwise the
    // account owner attends in person.
    participant: textCell(customer.childName ?? customer.name),
    source: transaction.sourceTable,
    sourceId: transaction.sourceId,
    amountEgp: moneyCell(amounts.amountEgp),
    grossAmountEgp: moneyCell(amounts.grossAmountEgp),
    discountAmountEgp: moneyCell(amounts.discountAmountEgp),
    requestedRefundAmountEgp: moneyCell(amounts.requestedRefundAmountEgp),
    approvedRefundAmountEgp: moneyCell(amounts.approvedRefundAmountEgp),
    refundedAmountEgp: moneyCell(amounts.refundedAmountEgp),
    netAmountEgp: moneyCell(amounts.netAmountEgp),
    // Credit events export UNITS here and leave every EGP column blank, so a
    // session credit can never be mistaken for money.
    creditUnitDelta: credit.unitDelta == null ? "" : credit.unitDelta,
    paymentStatus: transaction.paymentStatus ?? "—",
    refundStatus: transaction.refundStatus ?? "—",
    rawSourceStatus: textCell(transaction.rawSourceStatus),
    rawPaymentMethod: textCell(transaction.rawPaymentMethod),
    // "Unknown" (not blank, not 0) is the human-readable marker for a row whose
    // monetary columns are deliberately empty.
    amountAvailability:
      transaction.amountAvailability === "unknown" ? "Unknown" : transaction.amountAvailability,
    amountSource: transaction.amountSource,
    reliability: FINANCE_RELIABILITY_LABELS[reliability.badge],
    reliabilityExplanation: sanitizeCellText(reliability.explanation),
    providerReference: textCell(transaction.providerReference),
  };
}

export function buildFinanceExportRows(
  transactions: readonly UnifiedFinanceTransaction[],
): Record<string, string | number>[] {
  return transactions.map(buildFinanceExportRow);
}

/**
 * Counts only, and only of things the read model already decided. No amount is
 * summed across mixed availabilities: recorded, estimated and credit events are
 * counted separately so the summary block cannot imply a single total.
 */
export function buildFinanceExportSummary(
  transactions: readonly UnifiedFinanceTransaction[],
): Record<string, string | number> {
  const byAvailability = (target: UnifiedFinanceTransaction["amountAvailability"]) =>
    transactions.filter((transaction) => transaction.amountAvailability === target).length;

  return {
    totalEvents: transactions.length,
    exactAmountEvents: byAvailability("exact"),
    estimatedAmountEvents: byAvailability("estimated"),
    unknownAmountEvents: byAvailability("unknown"),
    serviceCreditEvents: byAvailability("not_applicable"),
    note: sanitizeCellText(
      "Counts only. Recorded, estimated and service-credit events are intentionally not summed into one total.",
    ),
  };
}

/** Normalized payment-method label, exported for UI reuse. */
export { FINANCE_PAYMENT_METHOD_LABELS };
