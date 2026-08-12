/**
 * Finance Overview — /finance
 *
 * Presents the SAME numbers the Dashboard already computes, but classified so a
 * recorded amount is never displayed adjacent to an estimated one as if they
 * were the same kind of fact. Sections are, in order:
 *
 *   1. Recorded Amounts        — stored historical amounts (exact)
 *   2. Operational Estimates   — re-derived from current pricing (not receipts)
 *   3. Refund Exposure         — approved/processing, not yet paid out
 *   4. Payment Method Classification — admin-recorded tags, not settlements
 *   5. Hybrid Indicators       — blended, explicitly marked as such
 *   6. Limitations & Warnings
 *
 * The Dashboard's own cards are untouched by Phase 1; this page adds clarity
 * beside them rather than replacing them.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Receipt,
  RotateCcw,
  Tag,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { fetchFinanceOverview, formatEgp } from "./financeApi";
import { EstimateWarningBadge, FinanceLimitationsPanel } from "./finance-badges";

const CYAN = "#00B6D7";
const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const PURPLE = "#8A5CFF";
const MUTED = "#8A9AB0";

/**
 * Overview stat card. `note` is not decoration — it is where each figure states
 * what it does and does not prove, so a card can never be read bare.
 */
function FinanceStatCard({
  title,
  value,
  icon: Icon,
  accent,
  note,
  testId,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  accent: string;
  note: string;
  testId?: string;
}) {
  return (
    <article
      className="premium-card group relative min-h-36 overflow-hidden rounded-lg border p-5"
      style={{ ["--card-accent" as string]: accent }}
      data-testid={testId}
    >
      <div className="relative z-10 flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
            style={{ background: `${accent}12`, borderColor: `${accent}28` }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: accent }} />
          </div>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-foreground sm:text-3xl">{value}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
        </div>
      </div>
    </article>
  );
}

function SectionHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_#00B6D7]" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {badge}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CardSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="premium-card min-h-36 rounded-lg border p-5">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
          <Skeleton className="mt-10 h-8 w-24" />
        </div>
      ))}
    </>
  );
}

export default function FinanceOverviewPage() {
  const { token, can } = useAdminAuth();

  const overviewQuery = useQuery({
    queryKey: ["finance-overview"],
    queryFn: () => fetchFinanceOverview(token),
  });

  const overview = overviewQuery.data;
  const isLoading = overviewQuery.isLoading;

  return (
    <div className="admin2-finance-page admin2-finance-overview space-y-8">
      <PageHeader
        title="Finance Overview"
        description="Classified financial visibility across Studio, Ballet, credits, and discounts. Read-only."
        mode="general"
      >
        <Button asChild variant="outline" className="gap-2 self-start">
          <Link href="/finance/transactions" data-testid="link-finance-transactions">
            View all transactions
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </PageHeader>

      {overviewQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid="finance-overview-error">
          Failed to load the finance overview.
        </div>
      ) : null}

      {/* Caveats appear ABOVE the numbers, never below them. */}
      {overview && <FinanceLimitationsPanel warnings={overview.warnings} />}

      {/* ── 1. Recorded amounts ─────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          title="Recorded Amounts"
          description="Amounts stored on the source record at the time of the event. These are exact."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? <CardSkeletons count={4} /> : overview ? (
            <>
              <FinanceStatCard
                title="Recorded Ballet Gross Amount"
                value={formatEgp(overview.recorded.balletGrossRecordedEgp)}
                icon={CircleDollarSign}
                accent={GREEN}
                note="Stored Ballet package payments and assessment fees with payment timestamps."
                testId="card-ballet-gross"
              />
              <FinanceStatCard
                title="Recorded Ballet Assessment Fees"
                value={formatEgp(overview.recorded.balletAssessmentFeesRecordedEgp)}
                icon={Receipt}
                accent={GREEN}
                note="Paid assessment fees with a positive amount snapshotted on the application."
                testId="card-ballet-assessment-fees"
              />
              <FinanceStatCard
                title="Recorded Ballet Net Amount"
                value={formatEgp(overview.recorded.balletNetRecordedEgp)}
                icon={TrendingUp}
                accent={GREEN}
                note="Recorded gross less refunds that actually completed."
                testId="card-ballet-net"
              />
              <FinanceStatCard
                title="Completed Recorded Refunds"
                value={formatEgp(overview.recorded.balletCompletedRefundsEgp)}
                icon={RotateCcw}
                accent={RED}
                note="Refunds whose payout completed. Pending refunds are excluded."
                testId="card-completed-refunds"
              />
              <FinanceStatCard
                title="Recorded Discounts Granted"
                value={
                  overview.recorded.discountsRecordedEgp == null
                    ? "Not available"
                    : formatEgp(overview.recorded.discountsRecordedEgp)
                }
                icon={Tag}
                accent={PURPLE}
                note={
                  overview.recorded.discountsRecordedEgp == null
                    ? "Requires Promotions view permission."
                    : "Stored discount amounts. A discount is not cash in or cash out."
                }
                testId="card-discounts"
              />
            </>
          ) : null}
        </div>
      </section>

      {/* ── 2. Operational estimates ────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          title="Operational Estimates"
          description="No historical amount was ever stored for generic Studio activity. These figures are re-derived from current catalog pricing and change if prices change."
          badge={<EstimateWarningBadge label="Estimated — not receipts" />}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? <CardSkeletons count={3} /> : overview ? (
            <>
              <FinanceStatCard
                title="Generic Package Operational Estimate"
                value={formatEgp(overview.estimated.genericPackageOperationalEstimateEgp)}
                icon={Wallet}
                accent={AMBER}
                note="Activated generic packages priced at today's catalog price. Activation does not prove collection."
                testId="card-package-estimate"
              />
              <FinanceStatCard
                title="Generic Single-Class Operational Estimate"
                value={formatEgp(overview.estimated.genericSingleClassOperationalEstimateEgp)}
                icon={Receipt}
                accent={AMBER}
                note="Paid single-class bookings and walk-ins priced at today's schedule or global price."
                testId="card-single-class-estimate"
              />
              <FinanceStatCard
                title="Total Operational Estimate"
                value={formatEgp(overview.estimated.genericOperationalEstimateEgp)}
                icon={AlertTriangle}
                accent={AMBER}
                note="Packages plus single classes. Estimated throughout — never treat as verified revenue."
                testId="card-total-estimate"
              />
            </>
          ) : null}
        </div>
      </section>

      {/* ── 3. Refund exposure ──────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          title="Refund Exposure"
          description="Approved or processing refunds that have not been paid out yet. Deliberately kept out of completed refund totals."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? <CardSkeletons count={1} /> : overview ? (
            <FinanceStatCard
              title="Approved Refund Exposure"
              value={formatEgp(overview.recorded.approvedRefundExposureEgp)}
              icon={AlertTriangle}
              accent={RED}
              note="Money owed but not yet paid out. Not included in completed refunds or net revenue."
              testId="card-refund-exposure"
            />
          ) : null}
        </div>
      </section>

      {/* ── 4. Payment method classification ───────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          title="Payment Method Classification"
          description="How Ballet payments were classified by an administrator. These are recorded tags, not confirmations from a bank or payment provider."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? <CardSkeletons count={3} /> : overview ? (
            <>
              <FinanceStatCard
                title="Admin-Recorded In-Person Payments"
                value={formatEgp(overview.recorded.balletInPersonRecordedEgp)}
                icon={Banknote}
                accent={GREEN}
                note="Recorded as collected in person. Not reconciled through a cash drawer."
                testId="card-method-in-person"
              />
              <FinanceStatCard
                title="Admin-Recorded Kashier Payments"
                value={formatEgp(overview.recorded.balletKashierAdminRecordedEgp)}
                icon={CreditCard}
                accent={AMBER}
                note="Method recorded as Kashier. Provider settlement is not verified by the current system."
                testId="card-method-kashier"
              />
              <FinanceStatCard
                title="Legacy Bank Transfers"
                value={formatEgp(overview.recorded.balletLegacyBankTransferEgp)}
                icon={Landmark}
                accent={MUTED}
                note="Legacy historical classification, retained for display only."
                testId="card-method-bank-transfer"
              />
            </>
          ) : null}
        </div>
      </section>

      {/* ── 5. Hybrid indicators ───────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          title="Hybrid Indicators"
          description="These blend exact recorded Ballet amounts with estimated generic amounts. They match the existing Dashboard totals and are indicators only — not audited revenue."
          badge={<EstimateWarningBadge label="Hybrid — mixed quality" />}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {isLoading ? <CardSkeletons count={2} /> : overview ? (
            <>
              <FinanceStatCard
                title="Hybrid Gross Indicator"
                value={formatEgp(overview.hybrid.totalGrossHybridIndicatorEgp)}
                icon={CircleDollarSign}
                accent={CYAN}
                note="Recorded Ballet gross plus generic operational estimates. Mixed reliability."
                testId="card-hybrid-gross"
              />
              <FinanceStatCard
                title="Hybrid Net Indicator"
                value={formatEgp(overview.hybrid.totalNetHybridIndicatorEgp)}
                icon={TrendingUp}
                accent={CYAN}
                note="Hybrid gross less completed Ballet refunds. Mixed reliability."
                testId="card-hybrid-net"
              />
            </>
          ) : null}
        </div>
      </section>

      {/* ── 6. Structural limitations ──────────────────────────────────── */}
      {overview && (
        <section className="space-y-4">
          <SectionHeader
            title="Known Limitations"
            description="Structural facts about what the current system does and does not record."
          />
          <div className="rounded-md border bg-card p-4" data-testid="finance-structural-limitations">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                • Generic Studio payments do not store a historical amount
                {overview.limitations.genericHistoricalAmountsStored ? "" : " — amounts are re-derived from current pricing."}
              </li>
              <li>
                • Payment gateway settlement is not verified
                {overview.limitations.gatewaySettlementVerified ? "" : " — Kashier values are admin-recorded classifications."}
              </li>
              <li>
                • There is no unified immutable monetary ledger
                {overview.limitations.unifiedMonetaryLedgerAvailable ? "" : " — Finance normalizes several separate operational tables."}
              </li>
              <li>
                • Package credits are session units, not money, and are never converted to EGP.
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* Read-only reminder: where the actions actually live. */}
      <section className="rounded-md border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">Finance is read-only</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Payment confirmation, refunds, package activation, and promotion management remain on
          their existing operational pages. Use the deep links on each transaction to act on a record.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {can("packageOrders", "view") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/package-orders">Package Orders</Link>
            </Button>
          )}
          {can("bookings", "view") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/bookings">Bookings</Link>
            </Button>
          )}
          {can("attendance", "view") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/attendance">Attendance</Link>
            </Button>
          )}
          {/* Destination pages (/ballet/payments, /ballet/refunds) are gated by
              finance.view (nav-config.ts, App.tsx ROUTE_PERMS) — matching that
              here, like every other shortcut in this list, instead of the
              unrelated ballet.payments.view permission (which is the real,
              separate per-family scoping permission for ballet rows in the
              unified Finance Transactions/Export feed below, not a gate on
              these standalone pages). Reaching this section already requires
              finance.view, so this is always true here — kept explicit and
              consistent with the pattern above rather than assumed. */}
          {can("finance", "view") && (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/ballet/payments">Ballet Payments</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/ballet/refunds">Ballet Refunds</Link>
              </Button>
            </>
          )}
          {can("promotions", "view") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/promotions">Promotions</Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
import "./admin2-finance.css";
