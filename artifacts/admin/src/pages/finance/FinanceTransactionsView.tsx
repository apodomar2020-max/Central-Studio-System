/**
 * FinanceTransactionsView — the ONE unified transactions surface.
 *
 * Every Finance list page renders this component; the source-filtered pages
 * (Package Payments, Class & Walk-in, Ballet Finance, Refunds, Discounts) just
 * pass a `lockedFamilies` scope. There is deliberately no second copy of the
 * query, table, filter, pagination, or detail-drawer logic anywhere.
 *
 * READ-ONLY by construction: the only row actions are "View details" (opens the
 * drawer) and "Open source record" (deep-links to the operational page that owns
 * the record). No confirm/approve/cancel/refund/mark-paid/edit control exists
 * here — those all remain in their existing operational pages in Phase 1.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ExternalLink,
  Eye,
  Receipt,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  FINANCE_AMOUNT_AVAILABILITIES,
  FINANCE_AMOUNT_AVAILABILITY_LABELS,
  FINANCE_EVENT_NATURES,
  FINANCE_EVENT_TYPES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_STATUSES,
  FINANCE_REFUND_STATUSES,
  FINANCE_RELIABILITY_BADGES,
  FINANCE_RELIABILITY_LABELS,
  FINANCE_EVENT_NATURE_LABELS,
  FINANCE_EVENT_TYPE_LABELS,
  type FinanceSourceFamily,
  type FinanceEventNature,
  type UnifiedFinanceTransaction,
} from "@workspace/api-zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { TablePagination } from "@/components/shared/table-pagination";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  EMPTY_FINANCE_FILTERS,
  fetchFinanceTransactions,
  FinanceRequestError,
  formatCreditUnits,
  formatEgp,
  formatFinanceDate,
  formatFinanceDateTime,
  hasActiveFinanceFilters,
  humanizeFinanceToken,
  type FinanceFilterState,
} from "./financeApi";
import {
  EventTypeBadge,
  FinanceAmountCell,
  ReliabilityBadge,
  paymentMethodLabel,
} from "./finance-badges";

const PAGE_SIZE = 25;

/** Which filter controls a page offers. Scoped pages hide irrelevant ones. */
export interface FinanceFilterVisibility {
  eventType?: boolean;
  eventNature?: boolean;
  paymentMethod?: boolean;
  paymentStatus?: boolean;
  refundStatus?: boolean;
  reliability?: boolean;
  amountAvailability?: boolean;
}

const ALL_FILTERS: FinanceFilterVisibility = {
  eventType: true,
  eventNature: true,
  paymentMethod: true,
  paymentStatus: true,
  refundStatus: true,
  reliability: true,
  amountAvailability: true,
};

export interface FinanceTransactionsViewProps {
  /** Fixed family scope for a source-filtered page. Omit for all-sources. */
  lockedFamilies?: FinanceSourceFamily[];
  /** Restrict the event-type dropdown to the ones this page can show. */
  allowedEventTypes?: readonly UnifiedFinanceTransaction["eventType"][];
  /** Restrict event-nature choices to those valid for this page. */
  allowedEventNatures?: readonly FinanceEventNature[];
  filters?: FinanceFilterVisibility;
  /** Distinguishes react-query cache entries between scoped pages. */
  queryKey: string;
  emptyMessage?: string;
}

/** Single-select dropdown backed by an array filter (the API accepts CSV). */
function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  testId,
  width = "w-full sm:w-48",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  testId: string;
  width?: string;
}) {
  return (
    <Select
      value={value[0] ?? "all"}
      onValueChange={(next) => onChange(next === "all" ? [] : [next])}
    >
      <SelectTrigger className={`h-9 ${width}`} data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

/** Label/value pair in the detail drawer. */
function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Read-only detail drawer. Shows the normalized view, the raw source values it
 * was derived from, and the amount-quality reasoning — deliberately including
 * the raw status/method so an admin can always audit the normalization.
 */
function TransactionDetail({ transaction }: { transaction: UnifiedFinanceTransaction }) {
  const { amounts, credit, customer, references, scheduleContext, actor, reliability } = transaction;
  const isCredit = transaction.amountAvailability === "not_applicable";

  return (
    <div className="space-y-6 px-5 py-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <EventTypeBadge eventType={transaction.eventType} />
          <Badge variant="outline" className="border-border/70 bg-background">
            {FINANCE_EVENT_NATURE_LABELS[transaction.eventNature]}
          </Badge>
          <ReliabilityBadge badge={reliability.badge} explanation={reliability.explanation} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{reliability.explanation}</p>
      </div>

      <DetailSection title="Amount">
        {isCredit ? (
          <>
            <DetailField label="Credit Units" value={formatCreditUnits(credit.unitDelta)} />
            <DetailField
              label="Balance"
              value={
                credit.balanceBefore == null && credit.balanceAfter == null
                  ? "—"
                  : `${credit.balanceBefore ?? "—"} → ${credit.balanceAfter ?? "—"}`
              }
            />
            <DetailField label="Monetary Value" value="Not applicable — session credits are not money" />
          </>
        ) : (
          <>
            <DetailField label="Amount" value={formatEgp(amounts.amountEgp)} />
            <DetailField label="Gross" value={formatEgp(amounts.grossAmountEgp)} />
            {amounts.discountAmountEgp != null && (
              <DetailField label="Discount" value={formatEgp(amounts.discountAmountEgp)} />
            )}
            <DetailField label="Net" value={formatEgp(amounts.netAmountEgp)} />
          </>
        )}
        <DetailField
          label="Amount Quality"
          value={FINANCE_AMOUNT_AVAILABILITY_LABELS[transaction.amountAvailability]}
        />
        <DetailField label="Amount Source" value={humanizeFinanceToken(transaction.amountSource)} />
      </DetailSection>

      {/* Refund amounts are separate fields on purpose: a requested or approved
          amount is exposure, not cash that has left the studio. */}
      {(amounts.requestedRefundAmountEgp != null ||
        amounts.approvedRefundAmountEgp != null ||
        amounts.refundedAmountEgp != null) && (
        <DetailSection title="Refund Amounts">
          <DetailField label="Requested" value={formatEgp(amounts.requestedRefundAmountEgp)} />
          <DetailField label="Approved" value={formatEgp(amounts.approvedRefundAmountEgp)} />
          <DetailField
            label="Completed (paid out)"
            value={
              amounts.refundedAmountEgp == null
                ? "Not yet paid out"
                : formatEgp(amounts.refundedAmountEgp)
            }
          />
        </DetailSection>
      )}

      <DetailSection title="Status & Method">
        <DetailField
          label="Payment Status"
          value={
            transaction.paymentStatus == null
              ? "Not applicable for this event type"
              : humanizeFinanceToken(transaction.paymentStatus)
          }
        />
        <DetailField
          label="Refund Status"
          value={transaction.refundStatus == null ? "—" : humanizeFinanceToken(transaction.refundStatus)}
        />
        <DetailField
          label="Payment Method"
          value={paymentMethodLabel(transaction.normalizedPaymentMethod)}
        />
        <DetailField
          label="Provider Reference"
          value={transaction.providerReference ?? "None recorded"}
        />
      </DetailSection>

      {/* The verbatim source values, so normalization can always be audited. */}
      <DetailSection title="Raw Source Values">
        <DetailField label="Source Table" value={transaction.sourceTable} />
        <DetailField label="Source ID" value={`#${transaction.sourceId}`} />
        <DetailField label="Raw Status" value={transaction.rawSourceStatus ?? "—"} />
        <DetailField label="Raw Payment Method" value={transaction.rawPaymentMethod ?? "—"} />
      </DetailSection>

      <DetailSection title="Customer & Participant">
        <DetailField label="Account / Payer" value={customer.name ?? "—"} />
        <DetailField label="Email" value={customer.email ?? "—"} />
        <DetailField label="Phone" value={customer.phone ?? "—"} />
        <DetailField
          label="Participant"
          value={
            customer.participantScope === "child"
              ? `${customer.childName ?? "Child"} (child)`
              : customer.participantScope === "self"
                ? `${customer.name ?? "Account owner"} (self)`
                : "Not recorded"
          }
        />
      </DetailSection>

      <DetailSection title="Timeline">
        <DetailField label="Occurred At" value={formatFinanceDateTime(transaction.occurredAt)} />
        <DetailField
          label="Paid At"
          value={transaction.paidAt ? formatFinanceDateTime(transaction.paidAt) : "No payment timestamp recorded"}
        />
        <DetailField
          label="Refunded At"
          value={transaction.refundedAt ? formatFinanceDateTime(transaction.refundedAt) : "—"}
        />
        <DetailField
          label="Recorded By"
          value={actor?.adminEmail ?? (actor?.adminId != null ? `Admin #${actor.adminId}` : "Not recorded")}
        />
      </DetailSection>

      {scheduleContext && (
        <DetailSection title="Class Context">
          <DetailField label="Class" value={scheduleContext.classTitle ?? "—"} />
          <DetailField
            label="Occurrence"
            value={formatFinanceDate(scheduleContext.occurrenceDate)}
          />
          <DetailField
            label="Schedule"
            value={scheduleContext.scheduleId != null ? `#${scheduleContext.scheduleId}` : "—"}
          />
        </DetailSection>
      )}

      <DetailSection title="Related Records">
        {references.packageOrderId != null && (
          <DetailField label="Package Order" value={`#${references.packageOrderId}`} />
        )}
        {references.packageName && <DetailField label="Package" value={references.packageName} />}
        {references.bookingId != null && (
          <DetailField label="Booking" value={`#${references.bookingId}`} />
        )}
        {references.attendanceId != null && (
          <DetailField label="Attendance" value={`#${references.attendanceId}`} />
        )}
        {references.balletApplicationId != null && (
          <DetailField label="Ballet Application" value={`#${references.balletApplicationId}`} />
        )}
        {references.balletPaymentId != null && (
          <DetailField label="Ballet Payment" value={`#${references.balletPaymentId}`} />
        )}
        {references.balletRefundId != null && (
          <DetailField label="Ballet Refund" value={`#${references.balletRefundId}`} />
        )}
        {references.promotionRedemptionId != null && (
          <DetailField label="Promotion Redemption" value={`#${references.promotionRedemptionId}`} />
        )}
        {references.creditTransactionId != null && (
          <DetailField label="Credit Transaction" value={`#${references.creditTransactionId}`} />
        )}
      </DetailSection>

      {/* The only action in the drawer: navigate to the page that owns the
          record. Finance itself never mutates. */}
      {transaction.sourceDeepLink && (
        <div className="border-t pt-4">
          <Button asChild variant="outline" className="gap-2">
            <Link href={transaction.sourceDeepLink} data-testid="link-finance-source-record">
              <ExternalLink className="h-4 w-4" />
              Open source record
            </Link>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Finance is read-only. Payment, refund, and activation actions stay on their
            existing operational pages.
          </p>
        </div>
      )}
    </div>
  );
}

export function FinanceTransactionsView({
  lockedFamilies,
  allowedEventTypes,
  allowedEventNatures,
  filters: filterVisibility = ALL_FILTERS,
  queryKey,
  emptyMessage = "No financial events match the current filters.",
}: FinanceTransactionsViewProps) {
  const { token } = useAdminAuth();

  const [state, setState] = useState<FinanceFilterState>(EMPTY_FINANCE_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<UnifiedFinanceTransaction | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveFilters = useMemo<FinanceFilterState>(
    () => ({ ...state, search: debouncedSearch }),
    [state, debouncedSearch],
  );

  // Any filter change resets to page 1 — otherwise a narrower result set can
  // leave the user on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [effectiveFilters]);

  const transactionsQuery = useQuery({
    queryKey: ["finance-transactions", queryKey, effectiveFilters, page, lockedFamilies],
    queryFn: () =>
      fetchFinanceTransactions(token, effectiveFilters, page, PAGE_SIZE, lockedFamilies),
  });

  const rows = transactionsQuery.data?.data ?? [];
  const total = transactionsQuery.data?.total ?? 0;
  const totalPages = transactionsQuery.data?.totalPages ?? 0;
  const activeFilters = hasActiveFinanceFilters(effectiveFilters);

  const eventTypeOptions = (allowedEventTypes ?? FINANCE_EVENT_TYPES).map((type) => ({
    value: type,
    label: FINANCE_EVENT_TYPE_LABELS[type],
  }));

  const isForbidden =
    transactionsQuery.error instanceof FinanceRequestError &&
    transactionsQuery.error.status === 403;

  function clearFilters() {
    setState(EMPTY_FINANCE_FILTERS);
    setSearchInput("");
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filters — wrap-safe, matching the Logs page layout */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search customer, email, phone, or event ID (e.g. bp:41)…"
              className="pl-9"
              data-testid="input-finance-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={state.from}
              max={state.to || undefined}
              onChange={(event) => setState((prev) => ({ ...prev, from: event.target.value }))}
              className="h-9 w-[150px]"
              data-testid="input-finance-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={state.to}
              min={state.from || undefined}
              onChange={(event) => setState((prev) => ({ ...prev, to: event.target.value }))}
              className="h-9 w-[150px]"
              data-testid="input-finance-to"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => setShowAdvanced((prev) => !prev)}
              data-testid="button-finance-advanced-filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </Button>
            {activeFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={clearFilters}
                data-testid="button-finance-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {showAdvanced && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {filterVisibility.eventType && (
              <FilterSelect
                value={state.eventTypes}
                onChange={(next) => setState((prev) => ({ ...prev, eventTypes: next }))}
                placeholder="All event types"
                options={eventTypeOptions}
                testId="select-finance-event-type"
              />
            )}
            {filterVisibility.eventNature && (
              <FilterSelect
                value={state.eventNatures}
                onChange={(next) => setState((prev) => ({ ...prev, eventNatures: next }))}
                placeholder="All natures"
                options={(allowedEventNatures ?? FINANCE_EVENT_NATURES).map((nature) => ({
                  value: nature,
                  label: FINANCE_EVENT_NATURE_LABELS[nature],
                }))}
                testId="select-finance-event-nature"
              />
            )}
            {filterVisibility.paymentMethod && (
              <FilterSelect
                value={state.paymentMethods}
                onChange={(next) => setState((prev) => ({ ...prev, paymentMethods: next }))}
                placeholder="All methods"
                options={FINANCE_PAYMENT_METHODS.map((method) => ({
                  value: method,
                  label: FINANCE_PAYMENT_METHOD_LABELS[method],
                }))}
                testId="select-finance-payment-method"
              />
            )}
            {filterVisibility.paymentStatus && (
              <FilterSelect
                value={state.paymentStatuses}
                onChange={(next) => setState((prev) => ({ ...prev, paymentStatuses: next }))}
                placeholder="All payment statuses"
                options={FINANCE_PAYMENT_STATUSES.map((status) => ({
                  value: status,
                  label: humanizeFinanceToken(status),
                }))}
                testId="select-finance-payment-status"
              />
            )}
            {filterVisibility.refundStatus && (
              <FilterSelect
                value={state.refundStatuses}
                onChange={(next) => setState((prev) => ({ ...prev, refundStatuses: next }))}
                placeholder="All refund statuses"
                options={FINANCE_REFUND_STATUSES.map((status) => ({
                  value: status,
                  label: humanizeFinanceToken(status),
                }))}
                testId="select-finance-refund-status"
              />
            )}
            {filterVisibility.reliability && (
              <FilterSelect
                value={state.reliability}
                onChange={(next) => setState((prev) => ({ ...prev, reliability: next }))}
                placeholder="All reliability"
                options={FINANCE_RELIABILITY_BADGES.map((badge) => ({
                  value: badge,
                  label: FINANCE_RELIABILITY_LABELS[badge],
                }))}
                testId="select-finance-reliability"
              />
            )}
            {filterVisibility.amountAvailability && (
              <FilterSelect
                value={state.amountAvailability}
                onChange={(next) => setState((prev) => ({ ...prev, amountAvailability: next }))}
                placeholder="All amount quality"
                options={FINANCE_AMOUNT_AVAILABILITIES.map((availability) => ({
                  value: availability,
                  label: FINANCE_AMOUNT_AVAILABILITY_LABELS[availability],
                }))}
                testId="select-finance-amount-availability"
              />
            )}
          </div>
        )}
      </div>

      {/* Table — horizontally scrollable so the wide finance row never forces
          the page body to scroll sideways on mobile. */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Event ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer / Participant</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reliability</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactionsQuery.isLoading ? (
              // Skeleton rows keep column widths stable while loading.
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`} data-testid="row-finance-skeleton">
                  {Array.from({ length: 10 }).map((__, cell) => (
                    <TableCell key={`skeleton-cell-${cell}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : transactionsQuery.isError ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-sm text-destructive" data-testid="finance-error">
                  {isForbidden
                    ? "You do not have permission to view any financial event sources."
                    : "Failed to load financial events."}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-12 text-center text-muted-foreground" data-testid="finance-empty">
                  <Receipt className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  {activeFilters ? "No financial events match the current filters." : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((transaction) => (
                <TableRow key={transaction.id} data-testid={`row-finance-${transaction.id}`}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatFinanceDate(transaction.occurredAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {transaction.id}
                  </TableCell>
                  <TableCell><EventTypeBadge eventType={transaction.eventType} /></TableCell>
                  <TableCell>
                    <div className="max-w-[180px] truncate text-sm font-medium text-foreground">
                      {transaction.customer.name ?? "—"}
                    </div>
                    {transaction.customer.childName && (
                      <div className="max-w-[180px] truncate text-xs text-muted-foreground">
                        {transaction.customer.childName} (child)
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {transaction.sourceTable}
                    <div className="text-xs opacity-70">#{transaction.sourceId}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {paymentMethodLabel(transaction.normalizedPaymentMethod)}
                  </TableCell>
                  <TableCell><FinanceAmountCell transaction={transaction} /></TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {transaction.refundStatus
                      ? humanizeFinanceToken(transaction.refundStatus)
                      : transaction.paymentStatus
                        ? humanizeFinanceToken(transaction.paymentStatus)
                        : "—"}
                  </TableCell>
                  <TableCell>
                    <ReliabilityBadge
                      badge={transaction.reliability.badge}
                      explanation={transaction.reliability.explanation}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        onClick={() => setSelected(transaction)}
                        title="View details"
                        data-testid={`button-finance-details-${transaction.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {transaction.sourceDeepLink && (
                        <Button asChild variant="ghost" size="sm" className="h-8 px-2" title="Open source record">
                          <Link
                            href={transaction.sourceDeepLink}
                            data-testid={`link-finance-source-${transaction.id}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > 0 && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          isLoading={transactionsQuery.isLoading}
          itemLabel="financial events"
          onPageChange={setPage}
        />
      )}

      <Sheet open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle>{selected ? `Event ${selected.id}` : "Event"}</SheetTitle>
            <SheetDescription>
              {selected
                ? `${FINANCE_EVENT_TYPE_LABELS[selected.eventType]} · ${formatFinanceDateTime(selected.occurredAt)}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {selected && <TransactionDetail transaction={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
