/**
 * Transactions — /finance/transactions
 *
 * The unfiltered unified feed: every financial event source the current admin is
 * permitted to view, in one stable newest-first ordering. No family lock, so the
 * backend's own permission intersection is the only scope.
 *
 * Read-only, like every Finance page.
 */
import { PageHeader } from "@/components/layout/page-header";
import { FinanceTransactionsView } from "./FinanceTransactionsView";
import { FinanceLimitationsPanel } from "./finance-badges";

/**
 * Cross-source caveats. The unified feed mixes exact, estimated and
 * non-monetary events in one table, so the reader needs to know that up front —
 * the per-row Reliability badge then says which is which.
 */
const MIXED_SOURCE_CAVEATS: readonly string[] = [
  "This feed mixes event kinds with different reliability. Check the Reliability column on every row before using a figure.",
  "Generic Studio amounts are operational estimates derived from current catalog pricing. They are not historically snapshotted payment amounts.",
  "Kashier values represent admin-recorded payment methods. Provider settlement is not verified by the current system.",
  "Credit events show session units, not money, and are never converted to EGP.",
  "Only sources you have permission to view are included, and totals are calculated after that filtering.",
];

export default function FinanceTransactionsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Transactions"
        description="Every normalized financial event across Studio, Ballet, credits, and discounts. Read-only."
        mode="general"
      />
      <FinanceLimitationsPanel warnings={MIXED_SOURCE_CAVEATS} title="Reading this feed" />
      <FinanceTransactionsView
        queryKey="all"
        emptyMessage="No financial events recorded yet."
      />
    </div>
  );
}
