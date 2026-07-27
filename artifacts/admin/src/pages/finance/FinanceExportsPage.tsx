/**
 * Reports & Exports — /finance/exports
 *
 * The Unified Finance Activity Export. Deliberately NOT called a ledger: the
 * system has no unified immutable monetary ledger, and naming the file one would
 * be a false claim about the data inside it.
 *
 * The export hits the same endpoint, with the same filters and the same
 * permission scoping, as the transactions table — so a downloaded file can never
 * contain a row the admin could not already see on screen. Format buttons are
 * additionally gated on the existing report export permissions, which is what
 * the backend enforces too.
 *
 * Limitations are shown BEFORE the download controls, and are also written into
 * the exported files themselves, because a spreadsheet outlives the screen it
 * was downloaded from.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Loader2, Search, SlidersHorizontal } from "lucide-react";
import {
  FINANCE_EVENT_TYPES,
  FINANCE_EVENT_TYPE_LABELS,
  FINANCE_EXPORT_ESTIMATE_WARNING,
  FINANCE_EXPORT_KASHIER_WARNING,
  FINANCE_EXPORT_TITLE,
  FINANCE_SOURCE_FAMILY_LABELS,
} from "@workspace/api-zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import {
  downloadFinanceExport,
  EMPTY_FINANCE_FILTERS,
  fetchFinanceTransactions,
  hasActiveFinanceFilters,
  type FinanceFilterState,
} from "./financeApi";
import { FinanceLimitationsPanel } from "./finance-badges";

/**
 * The two mandatory export caveats, plus the structural facts that make them
 * necessary. The first two strings come from the shared contract so the page and
 * the file cannot drift apart.
 */
const EXPORT_LIMITATIONS: readonly string[] = [
  FINANCE_EXPORT_ESTIMATE_WARNING,
  FINANCE_EXPORT_KASHIER_WARNING,
  "Package activation does not prove payment collection; package events are exported with no payment status.",
  "Unknown amounts are exported blank, never as zero. Do not fill them in.",
  "Credit events export session units in the Credit Unit Delta column and leave every EGP column blank.",
  "Only completed refunds represent cash that left the studio; requested and approved amounts are exposure.",
  "Exports are capped at 5,000 rows. If the cap is reached the file says so — narrow the filters for a complete export.",
];

export default function FinanceExportsPage() {
  const { token, can } = useAdminAuth();
  const [filters, setFilters] = useState<FinanceFilterState>(EMPTY_FINANCE_FILTERS);
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Formats are the ones the backend actually implements (xlsx | pdf), each
  // gated on the existing reports permission the API checks for that format.
  // Finance Roles & Permissions integration: exports require finance.exports
  // (a user with only finance.view can read Finance pages but must not
  // download exports). Both formats share the same single permission.
  const canExport = can("finance", "exports");
  const canExportExcel = canExport;
  const canExportPdf = canExport;

  /**
   * A tiny preview request (one row) serves two purposes: it confirms the
   * current filters match something before a download, and its `total` tells
   * the admin how many rows the file will contain — after permission filtering.
   */
  const previewQuery = useQuery({
    queryKey: ["finance-export-preview", filters],
    queryFn: () => fetchFinanceTransactions(token, filters, 1, 1),
  });

  const matchingRows = previewQuery.data?.total ?? 0;
  const visibleFamilies = previewQuery.data?.visibleFamilies ?? [];

  async function handleExport(format: "xlsx" | "pdf") {
    setExportingFormat(format);
    setExportError(null);
    try {
      await downloadFinanceExport(token, filters, format);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExportingFormat(null);
    }
  }

  function clearFilters() {
    setFilters(EMPTY_FINANCE_FILTERS);
    setExportError(null);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & Exports"
        description={`${FINANCE_EXPORT_TITLE} — normalized financial activity across every source you can view.`}
        mode="general"
      />

      {/* Limitations come BEFORE the export controls, deliberately. */}
      <FinanceLimitationsPanel
        warnings={EXPORT_LIMITATIONS}
        title="Read before exporting"
      />

      {/* Filters — same dimensions as the Transactions page. */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Export filters</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Search customer, email, phone, or event ID…"
              className="pl-9"
              data-testid="input-finance-export-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
              className="h-9 w-[150px]"
              data-testid="input-finance-export-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
              className="h-9 w-[150px]"
              data-testid="input-finance-export-to"
            />
            <Select
              value={filters.eventTypes[0] ?? "all"}
              onValueChange={(value) =>
                setFilters((prev) => ({ ...prev, eventTypes: value === "all" ? [] : [value] }))
              }
            >
              <SelectTrigger className="h-9 w-full sm:w-56" data-testid="select-finance-export-event-type">
                <SelectValue placeholder="All event types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {FINANCE_EVENT_TYPES.map((eventType) => (
                  <SelectItem key={eventType} value={eventType}>
                    {FINANCE_EVENT_TYPE_LABELS[eventType]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFinanceFilters(filters) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={clearFilters}
                data-testid="button-finance-export-clear"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Scope — what the file will actually contain for THIS admin. */}
      <div className="rounded-md border bg-card p-4">
        <p className="text-sm font-medium text-foreground">Export scope</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {previewQuery.isLoading
            ? "Checking how many events match…"
            : previewQuery.isError
              ? "Could not determine the export scope."
              : `${matchingRows.toLocaleString()} matching financial event${matchingRows === 1 ? "" : "s"}.`}
        </p>
        {visibleFamilies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="finance-export-families">
            {visibleFamilies.map((family) => (
              <Badge key={family} variant="outline" className="border-border/70 bg-muted/40 text-xs">
                {FINANCE_SOURCE_FAMILY_LABELS[family]}
              </Badge>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Only sources you have permission to view are included. The export applies the same
          permission filtering as the transactions table.
        </p>
      </div>

      {/* Download controls */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <p className="text-sm font-medium text-foreground">Download</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={!canExportExcel || exportingFormat != null || matchingRows === 0}
            onClick={() => handleExport("xlsx")}
            title={
              !canExportExcel
                ? "Requires the Reports → Export Excel permission"
                : matchingRows === 0
                  ? "No matching events to export"
                  : "Download .xlsx"
            }
            data-testid="button-finance-export-xlsx"
          >
            {exportingFormat === "xlsx"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4" />}
            {exportingFormat === "xlsx" ? "Exporting…" : "Export Excel"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={!canExportPdf || exportingFormat != null || matchingRows === 0}
            onClick={() => handleExport("pdf")}
            title={
              !canExportPdf
                ? "Requires the Reports → Export PDF permission"
                : matchingRows === 0
                  ? "No matching events to export"
                  : "Download .pdf"
            }
            data-testid="button-finance-export-pdf"
          >
            {exportingFormat === "pdf"
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileText className="h-4 w-4" />}
            {exportingFormat === "pdf" ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
        {!canExportExcel && !canExportPdf && (
          <p className="text-xs text-muted-foreground" data-testid="finance-export-no-permission">
            You do not have permission to export reports in any format.
          </p>
        )}
        {exportError && (
          <p className="text-xs text-destructive" data-testid="finance-export-error">{exportError}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Both formats contain the same normalized rows and the same limitation notes. Phase 1
          provides no tax report, no settlement report, and no cash-drawer report.
        </p>
      </div>
    </div>
  );
}
