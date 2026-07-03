/**
 * Admin Activity Logs — /logs (System → Logs), Phase 7B.
 *
 * Paginated, filterable feed of admin_activity_logs served by
 * GET /api/admin/logs (gated by auditLogs.view). Admin-only endpoint —
 * intentionally NOT in the generated API client; raw fetch with the standard
 * x-admin-token header pattern (same as Ballet Applications / System Users).
 *
 * Row click opens a details Sheet with actor, request metadata, and the
 * redacted before/after JSON payloads.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileClock, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
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
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogRow {
  id: number;
  actorId: number | null;
  actorName: string;
  actorEmail: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ListResponse {
  data: LogRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AdminOption {
  id: number;
  fullName: string;
  username: string;
}

// ─── Filter option sets (pilot scope; extend as modules are onboarded) ───────

const ACTION_OPTIONS = ["create", "update", "delete", "activate", "deactivate"] as const;
const MODULE_OPTIONS = ["adminUsers", "roles"] as const;
const ENTITY_TYPE_OPTIONS = ["system_user", "role"] as const;
const PAGE_SIZE = 25;

const ACTION_BADGE_CLASS: Record<string, string> = {
  create:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  update:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  delete:     "bg-red-500/15 text-red-400 border-red-500/30",
  activate:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  deactivate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge variant="outline" className={ACTION_BADGE_CLASS[action] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}>
      {action}
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function JsonPanel({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const { token, can } = useAdminAuth();
  // Actor dropdown needs the admin user list — only offered when permitted.
  const canListAdmins = can("adminUsers", "view");

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [action, setAction] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LogRow | null>(null);

  // Any filter change resets pagination to page 1.
  useEffect(() => {
    setPage(1);
  }, [search, action, moduleKey, entityType, actorId, from, to]);

  const logsQuery = useQuery<ListResponse>({
    queryKey: ["admin-activity-logs", page, search, action, moduleKey, entityType, actorId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(search ? { search } : {}),
        ...(action ? { action } : {}),
        ...(moduleKey ? { module: moduleKey } : {}),
        ...(entityType ? { entityType } : {}),
        ...(actorId ? { actorId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const res = await fetch(`${API_BASE}/api/admin/logs?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load activity logs");
      return res.json();
    },
  });

  const { data: admins = [] } = useQuery<AdminOption[]>({
    queryKey: ["admin-system-users"],
    enabled: canListAdmins,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load admins");
      return res.json();
    },
  });

  const rows = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = logsQuery.data?.totalPages ?? 0;

  const hasActiveFilters = Boolean(search || action || moduleKey || entityType || actorId || from || to);

  function clearFilters() {
    setSearchInput("");
    setAction("");
    setModuleKey("");
    setEntityType("");
    setActorId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logs"
        description="Admin activity history — who changed what, when, and from where."
        mode="general"
      />

      {/* Filters — wrap-safe per Phase 5 patterns */}
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search summary, entity, or admin…"
            className="pl-9"
            data-testid="input-logs-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={action || "all"} onValueChange={(v) => setAction(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-36" data-testid="select-logs-action">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTION_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleKey || "all"} onValueChange={(v) => setModuleKey(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-40" data-testid="select-logs-module">
              <SelectValue placeholder="All modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {MODULE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityType || "all"} onValueChange={(v) => setEntityType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-full sm:w-40" data-testid="select-logs-entity-type">
              <SelectValue placeholder="All entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {ENTITY_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canListAdmins && admins.length > 0 && (
            <Select value={actorId || "all"} onValueChange={(v) => setActorId(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-full sm:w-44" data-testid="select-logs-actor">
                <SelectValue placeholder="All admins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All admins</SelectItem>
                {admins.map((admin) => (
                  <SelectItem key={admin.id} value={String(admin.id)}>{admin.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 w-[150px]"
              data-testid="input-logs-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 w-[150px]"
              data-testid="input-logs-to"
            />
          </div>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : logsQuery.isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-destructive">
                  Failed to load activity logs.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  <FileClock className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  {hasActiveFilters ? "No log entries match the current filters." : "No activity logged yet."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelected(row)}
                  data-testid={`row-log-${row.id}`}
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-foreground">{row.actorName}</div>
                    <div className="text-xs text-muted-foreground">{row.actorEmail}</div>
                  </TableCell>
                  <TableCell><ActionBadge action={row.action} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.module}</TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">{row.entityType}</div>
                    {row.entityLabel && (
                      <div className="max-w-[160px] truncate text-xs text-muted-foreground">{row.entityLabel}</div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[320px] truncate text-sm text-muted-foreground">{row.summary}</TableCell>
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
          isLoading={logsQuery.isLoading}
          itemLabel="log entries"
          onPageChange={setPage}
        />
      )}

      {/* Details drawer */}
      <Sheet open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle>Log entry #{selected?.id}</SheetTitle>
            <SheetDescription>
              {selected ? `${formatTime(selected.createdAt)} — ${selected.summary}` : ""}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actor</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{selected.actorName}</p>
                  <p className="text-xs text-muted-foreground">{selected.actorEmail}</p>
                  {selected.actorId != null && (
                    <p className="text-xs text-muted-foreground">Admin #{selected.actorId}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action</p>
                  <div className="mt-1"><ActionBadge action={selected.action} /></div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.module} · {selected.entityType}
                    {selected.entityId ? ` #${selected.entityId}` : ""}
                  </p>
                  {selected.entityLabel && (
                    <p className="text-xs text-muted-foreground">{selected.entityLabel}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">IP Address</p>
                  <p className="mt-1 text-sm text-foreground">{selected.ipAddress ?? "—"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">User Agent</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{selected.userAgent ?? "—"}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <JsonPanel title="Before" value={selected.before} />
                <JsonPanel title="After" value={selected.after} />
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
