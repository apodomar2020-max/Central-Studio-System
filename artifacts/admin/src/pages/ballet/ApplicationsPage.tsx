/**
 * Ballet Applications List — /ballet/applications
 *
 * Displays all submitted ballet assessment applications with:
 *  - Status filter tabs (All / submitted / pendingAssessment / accepted / rejected / needsFollowUp)
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
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApplicationStatus =
  | "submitted"
  | "pendingAssessment"
  | "accepted"
  | "rejected"
  | "needsFollowUp"
  | "assignedToLevel"
  | "activeBallet";

interface ApplicationRow {
  id: number;
  childName: string;
  parentName: string;
  parentPhone: string;
  slotLabel: string | null;
  status: string;
  createdAt: string;
  levelName?: string | null;
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
  submitted:         { label: "Submitted",          className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  pendingAssessment: { label: "Pending Assessment", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  activeBallet:      { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTER_TABS: { label: string; value: string }[] = [
  { label: "All",               value: "" },
  { label: "Submitted",         value: "submitted" },
  { label: "Pending",           value: "pendingAssessment" },
  { label: "Accepted",          value: "accepted" },
  { label: "Rejected",          value: "rejected" },
  { label: "Needs Follow-up",   value: "needsFollowUp" },
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

const LIMIT = 20;

export default function ApplicationsPage() {
  const { token, can } = useAdminAuth();
  const [, navigate] = useLocation();

  const [activeStatus, setActiveStatus] = useState("");
  const [search, setSearch]             = useState("");
  const [searchInput, setSearchInput]   = useState("");
  const [levelId, setLevelId]           = useState("");
  const [page, setPage]                 = useState(1);

  // The levels list endpoint requires ballet.levels view — hide the filter
  // (not the page) for admins without it.
  const canFilterByLevel = can("ballet.levels", "view");

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["ballet-applications", page, activeStatus, search, levelId],
    queryFn: async () => {
      const params = new URLSearchParams({
        page:  String(page),
        limit: String(LIMIT),
        ...(activeStatus ? { status: activeStatus } : {}),
        ...(search ? { search } : {}),
        ...(levelId ? { levelId } : {}),
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

  return (
    <div className="space-y-6">
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
        <form onSubmit={handleSearch} className="flex gap-2">
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
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 w-56 h-8 text-sm"
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
              <TableHead>Selected Slot</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-destructive text-sm">
                  Failed to load applications.
                </TableCell>
              </TableRow>
            ) : data?.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground text-sm">
                  {search || levelId || activeStatus
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
                >
                  <TableCell className="text-muted-foreground text-xs">{app.id}</TableCell>
                  <TableCell className="font-medium">{app.childName}</TableCell>
                  <TableCell>{app.parentName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{app.parentPhone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {app.slotLabel ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {app.levelName ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={app.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(app.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, data.total)} of {data.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center px-2 text-xs">
              {page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
