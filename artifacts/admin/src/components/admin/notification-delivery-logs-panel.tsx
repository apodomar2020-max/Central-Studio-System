/**
 * Notification Delivery panel — System → Logs → Notification Delivery tab
 * (Wave 5).
 *
 * Operational, read-only visibility into Push delivery outcomes for
 * system/automation notifications (bookings, reminders, attendance, Ballet
 * lifecycle, package events, …). Manual Admin campaign deliveries are also
 * visible here for completeness, always clearly labeled Source = Manual
 * Admin — this is observation only (System Logs = observe); campaign
 * create/edit/send/archive stays exclusively in Marketing → Manual Push
 * Notifications (Marketing = operate). Never a second campaign-management
 * surface, never a merged table with Admin Activity Logs — different
 * domains (who changed what in Admin vs. operational Push delivery
 * outcomes).
 *
 * GET /api/admin/logs/notification-delivery, gated by auditLogs.view AND
 * notifications.view (see the route file's doc comment for why both).
 * Admin-only endpoint — same raw-fetch + x-admin-token convention as the
 * Admin Activity panel and Marketing's own notification campaign lib, not
 * part of the generated OpenAPI client.
 *
 * Never renders a raw push token, unregister secret/hash, or provider
 * request body — the API itself never returns them (see
 * lib/notificationDeliveryLogs.ts on the server), so there is nothing here
 * to accidentally leak even by a future careless edit to this file.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Inbox, Search } from "lucide-react";
import { TablePagination } from "@/components/shared/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useAdminAuth } from "@/contexts/AdminAuthContext";

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ─── Types (mirror the server's explicit safe response shape) ────────────────

interface DeliveryRow {
  id: string;
  when: string;
  notificationId: number;
  title: string;
  type: string | null;
  source: string | null;
  relatedEntityType: string | null;
  relatedEntityId: number | null;
  recipient: { studentId: number; name: string | null; email: string | null } | null;
  status: string;
  platform: string | null;
  provider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  campaign: { id: number; title: string } | null;
}

interface ListMetrics {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  noDeliveryRecord: number;
  successRate: number | null;
}

interface ListResponse {
  data: DeliveryRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  metrics: ListMetrics;
}

interface FilterOptions {
  types: string[];
  relatedEntityTypes: string[];
}

interface DeliveryDetail {
  notification: { id: number; title: string; body: string; type: string | null; source: string | null; createdAt: string; sentAt: string | null };
  recipient: { studentId: number; name: string | null; email: string | null } | null;
  delivery: {
    id: number | null; status: string; platform: string | null; provider: string | null; channel: string | null;
    deviceRecordId: number | null; providerMessageId: string | null; errorCode: string | null; errorMessage: string | null;
    sentAt: string | null; createdAt: string | null;
  };
  context: { relatedEntityType: string | null; relatedEntityId: number | null };
  campaign: { id: number; title: string } | null;
}

// ─── Static option sets ────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "automation", label: "Automation" },
  { value: "manual_admin", label: "Manual Admin" },
  { value: "legacy", label: "Legacy / Unclassified" },
] as const;

const STATUS_OPTIONS = [
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "queued", label: "Queued" },
  { value: "no_delivery_record", label: "No delivery record" },
] as const;

const PLATFORM_OPTIONS = ["ios", "android", "web", "unknown"] as const;

// The task's own documented safe error-code vocabulary — a Select over a
// known-safe allowlist, not a free-text field that could echo something
// unsanitized back into the UI.
const ERROR_CODE_OPTIONS = [
  "no_active_device",
  "push_disabled",
  "DeviceNotRegistered",
  "MessageRateExceeded",
  "InvalidCredentials",
  "expo_request_failed",
  "MessageTooBig",
] as const;

const RELATED_ENTITY_LABELS: Record<string, string> = {
  booking: "Booking",
  package_order: "Package Order",
  ballet_application: "Ballet Application",
  ballet_enrollment_cancellation_request: "Ballet Cancellation Request",
  ballet_refund: "Ballet Refund",
  attendance: "Attendance",
  notification_campaign: "Manual Campaign",
};

function relatedEntityLabel(type: string | null): string | null {
  if (!type) return null;
  return RELATED_ENTITY_LABELS[type] ?? type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const SOURCE_BADGE_CLASS: Record<string, string> = {
  manual_admin: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  system:       "bg-slate-500/15 text-slate-300 border-slate-500/30",
  automation:   "bg-purple-500/15 text-purple-400 border-purple-500/30",
};
const SOURCE_LABELS: Record<string, string> = {
  manual_admin: "Manual Admin",
  system: "System",
  automation: "Automation",
};

function SourceBadge({ source }: { source: string | null }) {
  if (!source) {
    return <Badge variant="outline" className="bg-gray-500/15 text-gray-400 border-gray-500/30">Legacy</Badge>;
  }
  return (
    <Badge variant="outline" className={SOURCE_BADGE_CLASS[source] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}>
      {SOURCE_LABELS[source] ?? source}
    </Badge>
  );
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  sent:               "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed:             "bg-red-500/15 text-red-400 border-red-500/30",
  skipped:            "bg-amber-500/15 text-amber-400 border-amber-500/30",
  queued:             "bg-blue-500/15 text-blue-400 border-blue-500/30",
  no_delivery_record: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};
const STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  queued: "Queued",
  no_delivery_record: "No delivery record",
};

// Status is always shown as a labeled badge (text, not color alone) so it
// stays readable without relying on color perception.
function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[status] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
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

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function recipientLabel(recipient: DeliveryRow["recipient"] | DeliveryDetail["recipient"]): { name: string; sub: string | null } {
  if (!recipient) return { name: "Broadcast / no recipient", sub: null };
  if (!recipient.name && !recipient.email) {
    // FK present but the student row itself no longer exists (deleted
    // account) — never break the row, show an explicit, honest fallback.
    return { name: "Former / unavailable account", sub: `Account #${recipient.studentId}` };
  }
  return { name: recipient.name ?? `Account #${recipient.studentId}`, sub: recipient.email };
}

const PAGE_SIZE = 25;

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export function NotificationDeliveryLogsPanel() {
  const { token } = useAdminAuth();

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [platform, setPlatform] = useState("");
  const [relatedEntityType, setRelatedEntityType] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [search, source, status, type, platform, relatedEntityType, errorCode, from, to]);

  const listQuery = useQuery<ListResponse>({
    queryKey: ["notification-delivery-logs", page, search, source, status, type, platform, relatedEntityType, errorCode, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(search ? { search } : {}),
        ...(source ? { source } : {}),
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(platform ? { platform } : {}),
        ...(relatedEntityType ? { relatedEntityType } : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const res = await fetch(`${API_BASE}/api/admin/logs/notification-delivery?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load notification delivery logs");
      return res.json();
    },
  });

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["notification-delivery-filter-options"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/logs/notification-delivery/filter-options`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load filter options");
      return res.json();
    },
  });

  const detailQuery = useQuery<DeliveryDetail>({
    queryKey: ["notification-delivery-log-detail", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/logs/notification-delivery/${encodeURIComponent(selectedId!)}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load delivery log detail");
      return res.json();
    },
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = listQuery.data?.totalPages ?? 0;
  const metrics = listQuery.data?.metrics;

  const hasActiveFilters = Boolean(
    search || source || status || type || platform || relatedEntityType || errorCode || from || to,
  );

  function clearFilters() {
    setSearchInput("");
    setSource("");
    setStatus("");
    setType("");
    setPlatform("");
    setRelatedEntityType("");
    setErrorCode("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* Compact operational metrics for the current filtered view — not an analytics dashboard, just five numbers from the same query. */}
      {metrics && total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Delivery attempts" value={String(metrics.total)} />
          <MetricCard label="Sent" value={String(metrics.sent)} />
          <MetricCard label="Failed" value={String(metrics.failed)} />
          <MetricCard label="Skipped" value={String(metrics.skipped)} />
          <MetricCard label="Success rate" value={metrics.successRate == null ? "—" : `${metrics.successRate}%`} />
        </div>
      )}

      {/* Filters — wrap-safe, mirrors the Admin Activity panel's pattern */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search title, recipient, notification ID…"
            className="pl-9"
            aria-label="Search notification delivery logs"
            data-testid="input-delivery-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={source || "all"} onValueChange={(v) => setSource(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter by source" data-testid="select-delivery-source">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by delivery status" data-testid="select-delivery-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filterOptions && filterOptions.types.length > 0 && (
            <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by notification type" data-testid="select-delivery-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {filterOptions.types.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={platform || "all"} onValueChange={(v) => setPlatform(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-36" aria-label="Filter by platform" data-testid="select-delivery-platform">
              <SelectValue placeholder="All platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {PLATFORM_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filterOptions && filterOptions.relatedEntityTypes.length > 0 && (
            <Select value={relatedEntityType || "all"} onValueChange={(v) => setRelatedEntityType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by related entity" data-testid="select-delivery-related-entity">
                <SelectValue placeholder="All related entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All related entities</SelectItem>
                {filterOptions.relatedEntityTypes.map((option) => (
                  <SelectItem key={option} value={option}>{relatedEntityLabel(option)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={errorCode || "all"} onValueChange={(v) => setErrorCode(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by error code" data-testid="select-delivery-error-code">
              <SelectValue placeholder="All error codes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All error codes</SelectItem>
              {ERROR_CODE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-[150px]"
              aria-label="From date"
              data-testid="input-delivery-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-[150px]"
              aria-label="To date"
              data-testid="input-delivery-to"
            />
          </div>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table — scrolls within its own container at narrow widths, never the page */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Notification</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Platform / Provider</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Related entity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : listQuery.isError ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-destructive">
                  <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
                  Failed to load notification delivery logs.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  <Inbox className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  {hasActiveFilters ? "No delivery logs match the current filters." : "No notification deliveries recorded yet."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const recipient = recipientLabel(row.recipient);
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedId(row.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open delivery log entry ${row.id}`}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                    data-testid={`row-delivery-${row.id}`}
                  >
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatTime(row.when)}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate text-sm font-medium text-foreground">{row.title}</div>
                      <div className="text-xs text-muted-foreground">{row.type ?? "—"}</div>
                      {row.campaign && (
                        <div className="text-xs text-muted-foreground">Campaign: {row.campaign.title}</div>
                      )}
                    </TableCell>
                    <TableCell><SourceBadge source={row.source} /></TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-foreground">{recipient.name}</div>
                      {recipient.sub && <div className="text-xs text-muted-foreground">{recipient.sub}</div>}
                    </TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.platform ?? "—"}{row.provider ? ` · ${row.provider}` : ""}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {row.errorCode ? (
                        <>
                          <div className="truncate text-sm text-foreground">{row.errorCode}</div>
                          {row.errorMessage && (
                            <div className="truncate text-xs text-muted-foreground">{row.errorMessage}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.relatedEntityType ? (
                        <>
                          {relatedEntityLabel(row.relatedEntityType)}
                          {row.relatedEntityId != null && <span> #{row.relatedEntityId}</span>}
                        </>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
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
          isLoading={listQuery.isLoading}
          itemLabel="delivery log entries"
          onPageChange={setPage}
        />
      )}

      {/* Details drawer */}
      <Sheet open={selectedId != null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="admin2-audit-sheet flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle>Delivery log {selectedId}</SheetTitle>
            <SheetDescription>
              {detailQuery.data ? detailQuery.data.notification.title : "Notification delivery detail"}
            </SheetDescription>
          </SheetHeader>
          {detailQuery.isLoading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">Loading detail…</div>
          ) : detailQuery.isError ? (
            <div className="px-5 py-10 text-center text-sm text-destructive">Failed to load delivery detail.</div>
          ) : detailQuery.data ? (
            <div className="space-y-5 px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notification</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{detailQuery.data.notification.title}</p>
                  <p className="text-xs text-muted-foreground">
                    #{detailQuery.data.notification.id} · {detailQuery.data.notification.type ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatTime(detailQuery.data.notification.createdAt)}
                    {detailQuery.data.notification.sentAt && ` · Sent ${formatTime(detailQuery.data.notification.sentAt)}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
                  <div className="mt-1"><SourceBadge source={detailQuery.data.notification.source} /></div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipient</p>
                  {(() => {
                    const recipient = recipientLabel(detailQuery.data.recipient);
                    return (
                      <>
                        <p className="mt-1 text-sm font-medium text-foreground">{recipient.name}</p>
                        {recipient.sub && <p className="text-xs text-muted-foreground">{recipient.sub}</p>}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivery status</p>
                  <div className="mt-1"><StatusBadge status={detailQuery.data.delivery.status} /></div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform / Provider</p>
                  <p className="mt-1 text-sm text-foreground">
                    {detailQuery.data.delivery.platform ?? "—"}
                    {detailQuery.data.delivery.provider ? ` · ${detailQuery.data.delivery.provider}` : ""}
                  </p>
                  {detailQuery.data.delivery.deviceRecordId != null && (
                    <p className="text-xs text-muted-foreground">Device record #{detailQuery.data.delivery.deviceRecordId}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attempt time</p>
                  <p className="mt-1 text-sm text-foreground">
                    {detailQuery.data.delivery.sentAt
                      ? formatTime(detailQuery.data.delivery.sentAt)
                      : detailQuery.data.delivery.createdAt
                        ? formatTime(detailQuery.data.delivery.createdAt)
                        : "No attempt recorded"}
                  </p>
                </div>
                {detailQuery.data.delivery.errorCode && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Failure / skip reason</p>
                    <p className="mt-1 text-sm text-foreground">{detailQuery.data.delivery.errorCode}</p>
                    {detailQuery.data.delivery.errorMessage && (
                      <p className="text-xs text-muted-foreground">{detailQuery.data.delivery.errorMessage}</p>
                    )}
                  </div>
                )}
                {detailQuery.data.delivery.providerMessageId && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Provider message ID</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{detailQuery.data.delivery.providerMessageId}</p>
                  </div>
                )}
                {detailQuery.data.context.relatedEntityType && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Related entity</p>
                    <p className="mt-1 text-sm text-foreground">
                      {relatedEntityLabel(detailQuery.data.context.relatedEntityType)}
                      {detailQuery.data.context.relatedEntityId != null && ` #${detailQuery.data.context.relatedEntityId}`}
                    </p>
                  </div>
                )}
              </div>
              {detailQuery.data.campaign && (
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual campaign</p>
                  <p className="mt-1 text-sm text-foreground">{detailQuery.data.campaign.title}</p>
                  <Link href="/notifications" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                    Open Manual Push Notifications →
                  </Link>
                </div>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
