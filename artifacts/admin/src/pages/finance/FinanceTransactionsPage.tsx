/**
 * Transactions — /finance/transactions
 *
 * The monetary feed: every payment, refund, discount or operational receivable
 * the current admin may view, in one stable newest-first ordering. Service-unit
 * credit movements stay in their operational ledger and never enter this page.
 *
 * Read-only, like every Finance page.
 */
import { PageHeader } from "@/components/layout/page-header";
import { FinanceTransactionsView } from "./FinanceTransactionsView";
import { FinanceLimitationsPanel } from "./finance-badges";

/**
 * Cross-source monetary caveats. The per-row Reliability badge distinguishes
 * stored amounts from operational estimates without mixing in service units.
 */
const MIXED_SOURCE_CAVEATS: readonly string[] = [
  "This feed mixes event kinds with different reliability. Check the Reliability column on every row before using a figure.",
  "Generic Studio amounts are operational estimates derived from current catalog pricing. They are not historically snapshotted payment amounts.",
  "Kashier values represent admin-recorded payment methods. Provider settlement is not verified by the current system.",
  "Package-credit issuance, consumption, restoration, and adjustments are service-unit ledger movements and are excluded from this monetary feed.",
  "Only sources you have permission to view are included, and totals are calculated after that filtering.",
];

export default function FinanceTransactionsPage() {
  return (
    <div className="admin2-finance-page admin2-finance-ledger space-y-5">
      <PageHeader
        title="Transactions"
        description="Monetary payments, receivables, refunds, and discounts across Studio and Ballet. Read-only."
        mode="general"
      >
        <FinanceLimitationsPanel warnings={MIXED_SOURCE_CAVEATS} title="Reading this feed" />
      </PageHeader>
      <FinanceTransactionsView
        queryKey="all"
        allowedEventTypes={[
          "package_purchase",
          "single_class_payment",
          "studio_walkin_payment",
          "ballet_payment",
          "ballet_refund",
          "promotion_discount",
        ]}
        allowedEventNatures={["cash_inflow", "cash_outflow", "operational_estimate", "discount"]}
        emptyMessage="No monetary events recorded yet."
      />
    </div>
  );
}
import "./admin2-finance.css";
