/**
 * Source-filtered Finance pages.
 *
 * All five are thin configurations of the ONE shared <FinanceTransactionsView />
 * — a locked family scope, a page header, and the filter controls that are
 * actually meaningful for that scope. There is deliberately no duplicated query,
 * table, pagination, or drawer logic here; that was the whole point of making
 * the view configurable.
 *
 * The family lock is also a correctness boundary, not just a convenience: the
 * backend intersects the requested families with the caller's permissions, so a
 * scoped page can never widen itself and an admin without the underlying read
 * permission simply gets an empty, permission-filtered result.
 *
 * Every page is READ-ONLY. Mutations stay on the operational pages these pages
 * link back to (Package Orders, Bookings, Attendance, Ballet Payments, Ballet
 * Refunds, Promotions).
 */
import type { FinanceEventType, FinanceSourceFamily } from "@workspace/api-zod";
import { PageHeader } from "@/components/layout/page-header";
import {
  FinanceTransactionsView,
  type FinanceFilterVisibility,
} from "./FinanceTransactionsView";
import { FinanceLimitationsPanel } from "./finance-badges";

/**
 * Shared shell so every scoped page gets the same header/caveat/table rhythm.
 * `caveats` is the page-level version of the Overview's warning panel: the
 * scope-specific reason its numbers must not be over-trusted.
 */
function FinanceScopedPage({
  title,
  description,
  caveats,
  caveatTitle,
  queryKey,
  lockedFamilies,
  allowedEventTypes,
  filters,
  emptyMessage,
}: {
  title: string;
  description: string;
  caveats?: string[];
  caveatTitle?: string;
  queryKey: string;
  lockedFamilies: FinanceSourceFamily[];
  allowedEventTypes?: readonly FinanceEventType[];
  filters?: FinanceFilterVisibility;
  emptyMessage?: string;
}) {
  return (
    <div className="admin2-finance-page admin2-finance-ledger space-y-5">
      <PageHeader title={title} description={description} mode="general" />
      {caveats && caveats.length > 0 && (
        <FinanceLimitationsPanel warnings={caveats} title={caveatTitle ?? "What these figures mean"} />
      )}
      <FinanceTransactionsView
        queryKey={queryKey}
        lockedFamilies={lockedFamilies}
        allowedEventTypes={allowedEventTypes}
        filters={filters}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

// ─── Package Payments — /finance/packages ─────────────────────────────────────

/**
 * Package purchase/payment lifecycle only. Credit issuance and consumption are
 * operational service-unit movements and remain in package credit history.
 *
 * Package purchases carry no payment status at all (an active order does not
 * prove collection), so the payment-status and refund-status filters are hidden
 * rather than offered as controls that would silently empty the table.
 */
export function FinancePackagesPage() {
  return (
    <FinanceScopedPage
      title="Package Payments"
      description="Generic package purchase and payment lifecycle events. Read-only."
      caveatTitle="What these figures mean"
      caveats={[
        "Package activation implies operational approval, but payment collection is not independently recorded — package purchase events carry no payment status.",
        "Amounts are the CURRENT catalog price, not a historically stored payment amount. A later price change alters these figures retroactively.",
        "Credit issuance, consumption, restoration, and adjustments remain available in operational package/student credit history and are excluded here.",
        "Package orders attached to a Ballet payment are excluded here to avoid double-counting them against Ballet receipts.",
      ]}
      queryKey="packages"
      lockedFamilies={["package_purchases"]}
      allowedEventTypes={["package_purchase"]}
      filters={{ eventType: true, reliability: true, amountAvailability: true }}
      emptyMessage="No package purchase events recorded yet."
    />
  );
}

// ─── Class & Walk-in — /finance/class-payments ────────────────────────────────

/**
 * Generic single-class payments and studio walk-ins.
 *
 * Both come from `bookings` and neither stores a historical amount, so every
 * figure on this page is an estimate. Package-credit bookings are excluded by
 * the backend entirely — their economics live in the credit ledger, so showing
 * them here too would double-count one class.
 */
export function FinanceClassPaymentsPage() {
  return (
    <FinanceScopedPage
      title="Class & Walk-in"
      description="Generic single-class payments and studio walk-ins recorded at the door. Read-only."
      caveatTitle="What these figures mean"
      caveats={[
        "Bookings do not store a historical payment amount. Every amount here is derived from the current schedule price, or the global single-class price setting when the schedule has none.",
        "No booking column records when money was taken, so no payment timestamp is shown. An attendance check-in time is never treated as a payment time.",
        "Walk-ins are identified only from the server-written check-in audit record — never from editable booking notes.",
        "Package-credit bookings are not payments and do not appear here; their deductions remain in operational package/student credit history.",
      ]}
      queryKey="class-payments"
      lockedFamilies={["class_payments", "walkin_payments"]}
      allowedEventTypes={["single_class_payment", "studio_walkin_payment"]}
      filters={{
        eventType: true,
        paymentMethod: true,
        paymentStatus: true,
        reliability: true,
        amountAvailability: true,
      }}
      emptyMessage="No single-class or walk-in payment events recorded yet."
    />
  );
}

// ─── Ballet Finance — /finance/ballet ─────────────────────────────────────────

/**
 * Ballet payments — the only Studio events with a stored historical amount, and
 * therefore the only ones marked exact. "Exact" describes the amount only, never
 * settlement.
 */
export function FinanceBalletPage() {
  return (
    <FinanceScopedPage
      title="Ballet Finance"
      description="Ballet payment register entries with stored historical amounts. Read-only."
      caveatTitle="What these figures mean"
      caveats={[
        "Ballet payment amounts are stored on the record, so they are exact as registered amounts.",
        "Kashier values represent admin-recorded payment methods. Provider settlement is not verified by the current system.",
        "In-person payments are administrator-recorded collections and are not reconciled through a cash drawer.",
        "Bank Transfer is a legacy historical classification, retained for display only.",
        "Payment confirmation remains on the Ballet Payments page — Finance does not confirm payments.",
      ]}
      queryKey="ballet"
      lockedFamilies={["ballet_payments"]}
      allowedEventTypes={["ballet_payment"]}
      filters={{
        paymentMethod: true,
        paymentStatus: true,
        reliability: true,
        amountAvailability: true,
      }}
      emptyMessage="No Ballet payment events recorded yet."
    />
  );
}

// ─── Refunds & Cancellations — /finance/refunds ───────────────────────────────

/**
 * Ballet and package refund lifecycles. Requested, approved and completed amounts stay in
 * separate columns in the detail drawer precisely so a pending refund can be
 * seen as exposure without ever being counted as cash that left the studio.
 */
export function FinanceRefundsPage() {
  return (
    <FinanceScopedPage
      title="Refunds & Cancellations"
      description="Package and Ballet refund register entries across the full refund lifecycle. Read-only."
      caveatTitle="What these figures mean"
      caveats={[
        "Only a completed refund (status refunded, with a processed timestamp and a positive amount) represents cash that actually left the studio.",
        "Requested and approved amounts are stored exactly as recorded but are exposure, not completed payouts — they are never added to completed refund totals.",
        "A provider reference is shown only when the refund record carries a real transaction reference. Administrator notes are never treated as one.",
        "Refund approval and completion remain on Package Orders or the Ballet Refunds page — Finance does not approve or process refunds.",
      ]}
      queryKey="refunds"
      lockedFamilies={["ballet_refunds", "package_refunds"]}
      allowedEventTypes={["ballet_refund", "package_refund"]}
      filters={{ refundStatus: true, paymentMethod: true, reliability: true }}
      emptyMessage="No refund events recorded yet."
    />
  );
}

// ─── Discounts — /finance/discounts ───────────────────────────────────────────

/**
 * Promotion redemptions. A discount is exact (the amount was stored at
 * redemption) but is neither cash in nor cash out, so it is reported entirely
 * separately from every revenue and refund figure.
 */
export function FinanceDiscountsPage() {
  return (
    <FinanceScopedPage
      title="Discounts"
      description="Promotion redemptions with the discount amount stored at redemption time. Read-only."
      caveatTitle="What these figures mean"
      caveats={[
        "Discount amounts are stored when the promotion is redeemed, so they are exact.",
        "A discount is not cash received and not cash paid out. It is never added to revenue or refund totals.",
        "Promotion configuration remains on the Promotions page — Finance does not create or edit promotions.",
      ]}
      queryKey="discounts"
      lockedFamilies={["discounts"]}
      allowedEventTypes={["promotion_discount"]}
      filters={{ reliability: true, amountAvailability: true }}
      emptyMessage="No promotion redemptions recorded yet."
    />
  );
}
import "./admin2-finance.css";
