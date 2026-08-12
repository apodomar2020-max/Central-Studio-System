/**
 * Ballet Applications List — /ballet/applications
 *
 * Displays all submitted ballet assessment applications with:
 *  - Status filter tabs (All / Pending / Accepted / Rejected / Needs Follow-up / Cancelled)
 *  - Search (parent name, phone, email, child name, assigned level name)
 *  - Level filter dropdown (Phase 4A — visible with ballet.levels view perm)
 *  - Server-side pagination
 *  - Click a row to open the detail page
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, ChevronLeft, ChevronRight, Pencil } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApplicationStatus =
  | "pending"
  | "accepted"
  | "needsFollowUp"
  | "assignedToLevel"
  | "active"
  | "rejected"
  | "cancelled"
  | "withdrawn";

interface ApplicationRow {
  id: number;
  childName: string;
  parentName: string;
  parentPhone: string;
  assessmentDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  levelName?: string | null;
  paymentStatus?: string | null;
  subscription?: {
    subscriptionStatus: "pending" | "active" | "renewed" | "expired";
    subscriptionDisplayStatus: string;
    subscriptionExpiresAt: string | null;
    daysRemaining: number | null;
  } | null;
}

interface BalletLevel {
  id: number;
  name: string;
  isActive: boolean;
}

interface ListResponse {
  data: ApplicationRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Status badge config ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:           { label: "Pending",            className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  active:            { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled:         { label: "Cancelled",           className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  withdrawn:         { label: "Withdrawn",           className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

// Payment status badge (A1) — the current (most recently updated) payment
// row's status, or an em-dash when no payment has been recorded yet.
const PAYMENT_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pending",  className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  paid:     { label: "Paid",     className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  refunded: { label: "Refunded", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

function PaymentStatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const cfg = PAYMENT_STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

function SubscriptionBadge({ subscription }: { subscription?: ApplicationRow["subscription"] }) {
  if (!subscription) return <Badge variant="outline" className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Pending Payment</Badge>;
  const className =
    subscription.subscriptionStatus === "expired" ? "bg-red-500/15 text-red-400 border-red-500/30"
    : subscription.subscriptionStatus === "renewed" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
    : subscription.subscriptionStatus === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <div className="space-y-1"><Badge variant="outline" className={className}>{subscription.subscriptionDisplayStatus}</Badge>{subscription.subscriptionExpiresAt && <div className="text-xs text-muted-foreground">{subscription.subscriptionExpiresAt}{subscription.daysRemaining != null ? ` · ${subscription.daysRemaining}d` : ""}</div>}</div>;
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTER_TABS: { label: string; value: string }[] = [
  { label: "All",               value: "" },
  { label: "Pending",           value: "pending" },
  { label: "Accepted",          value: "accepted" },
  { label: "Rejected",          value: "rejected" },
  { label: "Needs Follow-up",   value: "needsFollowUp" },
  { label: "Cancelled",         value: "cancelled" },
  { label: "Withdrawn",         value: "withdrawn" },
];

const SUBSCRIPTION_FILTERS = [
  { label: "All subscriptions", value: "all" },
  { label: "Pending Payment", value: "pending" },
  { label: "Active Subscription", value: "active" },
  { label: "Expiring Soon", value: "expiringSoon" },
  { label: "Expired", value: "expired" },
  { label: "Renewed", value: "renewed" },
];

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY  = import.meta.env.VITE_API_KEY  as string | undefined ?? "";

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export default function ApplicationsPage() {
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();

  const [activeStatus, setActiveStatus] = useState("");
  const [search, setSearch]             = useState("");
  const [searchInput, setSearchInput]   = useState("");
  const [levelId, setLevelId]           = useState("");
  const [subscriptionFilter, setSubscriptionFilter] = useState("");
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(25);

  // The levels list endpoint requires ballet.levels view — hide the filter
  // (not the page) for admins without it.
  const canFilterByLevel = can("ballet.levels", "view");

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["ballet-applications", page, pageSize, activeStatus, search, levelId, subscriptionFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page:  String(page),
        limit: String(pageSize),
        ...(activeStatus ? { status: activeStatus } : {}),
        ...(search ? { search } : {}),
        ...(levelId ? { levelId } : {}),
        ...(subscriptionFilter ? { subscription: subscriptionFilter } : {}),
      });
      const res = await fetch(`${API_BASE}/api/admin/ballet/applications?${params}`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load applications");
      return res.json();
    },
  });

  const { data: levelsData } = useQuery<{ levels: BalletLevel[] }>({
    queryKey: ["ballet-levels"],
    enabled: canFilterByLevel,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/levels`, {
        headers: makeHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load levels");
      return res.json();
    },
  });
  const levels = levelsData?.levels ?? [];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function handleTabChange(value: string) {
    setActiveStatus(value);
    setPage(1);
  }

  function handleLevelChange(value: string) {
    setLevelId(value === "all" ? "" : value);
    setPage(1);
  }

  function handlePageSizeChange(value: string) {
    setPageSize(parseInt(value, 10));
    setPage(1);
  }

  function handleSubscriptionFilterChange(value: string) {
    setSubscriptionFilter(value === "all" ? "" : value);
    setPage(1);
  }

  return (
    <div className="admin2-ballet-page admin2-ballet-queue space-y-6">
      <PageHeader
        title="Ballet Applications"
        description="Review and manage assessment applications"
        mode="stage"
      />

      {/* Filters row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              aria-pressed={activeStatus === tab.value}
              className={[
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                activeStatus === tab.value
                  ? "bg-[#00B6D6] text-black"
                  : "text-[#8A9AB0] hover:text-white hover:bg-white/5",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Level filter + search */}
        <form onSubmit={handleSearch} className="flex w-full flex-wrap gap-2 sm:w-auto">
          {canFilterByLevel && levels.length > 0 && (
            <Select value={levelId || "all"} onValueChange={handleLevelChange}>
              <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-level-filter">
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {levels.map((level) => (
                  <SelectItem key={level.id} value={String(level.id)}>
                    {level.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={subscriptionFilter || "all"} onValueChange={handleSubscriptionFilterChange}>
            <SelectTrigger className="h-8 w-44 text-sm" data-testid="select-subscription-filter">
              <SelectValue placeholder="All subscriptions" />
            </SelectTrigger>
            <SelectContent>
              {SUBSCRIPTION_FILTERS.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>{filter.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 w-full h-8 text-sm sm:w-56"
              placeholder="Name, phone, email, level…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-8">Search</Button>
          {search && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Child</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Assessment Date</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Last Update</TableHead>
              <TableHead className="w-16 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-destructive text-sm">
                  Failed to load applications.
                </TableCell>
              </TableRow>
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-muted-foreground text-sm">
                  {search || levelId || activeStatus || subscriptionFilter
                    ? "No applications match the current search/filters."
                    : "No applications found."}
                </TableCell>
              </TableRow>
            ) : (
              data?.data.map((app) => (
                <TableRow
                  key={app.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/ballet/applications/${app.id}`)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open application ${app.id} for ${app.childName}`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/ballet/applications/${app.id}`);
                    }
                  }}
                >
                  <TableCell className="text-muted-foreground text-xs">{app.id}</TableCell>
                  <TableCell className="font-medium">{app.childName}</TableCell>
                  <TableCell>{app.parentName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{app.parentPhone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {app.assessmentDate ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {app.levelName ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={app.status} /></TableCell>
                  <TableCell><PaymentStatusBadge status={app.paymentStatus} /></TableCell>
                  <TableCell><SubscriptionBadge subscription={app.subscription} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(app.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {app.updatedAt ? new Date(app.updatedAt).toLocaleDateString() : <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Edit application ${app.id}`}
                      onClick={(e) => { e.stopPropagation(); navigate(`/ballet/applications/${app.id}`); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {data.total === 0
              ? "Showing 0 of 0"
              : `Showing ${((data.page - 1) * data.limit) + 1}–${Math.min(data.page * data.limit, data.total)} of ${data.total}`}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">Rows</span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <span className="flex items-center px-2 text-xs">
              Page {data.page} of {Math.max(data.totalPages, 1)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page >= data.totalPages || isLoading || data.totalPages === 0}
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
import "./admin2-ballet.css";
