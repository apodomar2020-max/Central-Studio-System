/**
 * Ballet Students — current active ballet_level_assignments roster.
 *
 * Data Tables Enhancement: search/filter/sort are server-aware (applied
 * before pagination on GET /admin/ballet/students) so returned rows/total/
 * totalPages always represent the same matching dataset — never a filter
 * applied only to the current page. Payment/subscription filters resolve
 * matching applicationIds server-side before pagination (see adminBallet.ts).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Eye } from "lucide-react";
import { TableToolbar } from "@/components/admin/table-toolbar";
import { TablePagination } from "@/components/shared/table-pagination";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchAllPages } from "@/lib/fetchAllPages";

interface StudentRow {
  assignmentId: number;
  applicationId: number;
  studentName: string;
  parentName: string;
  parentPhone: string;
  age: number | null;
  dateJoined: string | null;
  levelId: number | null;
  levelName: string | null;
  groupId: number | null;
  groupName: string | null;
  paymentStatus: string | null;
  subscriptionStatus: "pending" | "active" | "renewed" | "expired";
  subscriptionDisplayStatus: string;
  subscriptionStartDate: string | null;
  subscriptionExpiresAt: string | null;
  daysRemaining: number | null;
}

interface ListResponse {
  data: StudentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface BalletLevel { id: number; name: string; isActive: boolean; }
interface BalletGroup { id: number; name: string; levelId: number; isActive: boolean; }
interface RefListResponse<T> { data: T[]; total: number; page: number; limit: number; totalPages: number; }

const API_BASE = import.meta.env.VITE_API_URL as string | undefined ?? "";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined ?? "";
const LIMIT = 20;
const CATALOG_LIMIT = 100;

const PAYMENT_STATUSES = ["pending", "paid", "rejected", "refunded"] as const;
type PaymentStatusFilter = "all" | (typeof PAYMENT_STATUSES)[number];
const SUBSCRIPTION_STATUSES = ["pending", "active", "renewed", "expired"] as const;
type SubscriptionStatusFilter = "all" | (typeof SUBSCRIPTION_STATUSES)[number];
type SortOption = "dateJoined" | "dateJoined-asc" | "name" | "name-desc";

const SORT_LABELS: Record<SortOption, string> = {
  dateJoined: "Date joined (newest)",
  "dateJoined-asc": "Date joined (oldest)",
  name: "Name (A–Z)",
  "name-desc": "Name (Z–A)",
};

function makeHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

function SubscriptionBadge({ student }: { student: StudentRow }) {
  const className = student.subscriptionStatus === "expired"
    ? "bg-red-500/15 text-red-400 border-red-500/30"
    : student.subscriptionStatus === "renewed"
      ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
      : student.subscriptionStatus === "active"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{student.subscriptionDisplayStatus}</Badge>;
}

function PaymentBadge({ status }: { status: string | null }) {
  if (!status) return <span className="italic text-muted-foreground">—</span>;
  const className = status === "paid"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : status === "rejected"
      ? "bg-red-500/15 text-red-400 border-red-500/30"
      : status === "refunded"
        ? "bg-slate-500/15 text-slate-400 border-slate-500/30"
        : "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
  return <Badge variant="outline" className={className}>{status.replace(/^./, (c) => c.toUpperCase())}</Badge>;
}

export default function BalletStudentsPage() {
  const { token } = useAdminAuth();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [levelFilter, setLevelFilter] = useState<number | "all">("all");
  const [groupFilter, setGroupFilter] = useState<number | "all">("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatusFilter>("all");
  const [subscriptionStatusFilter, setSubscriptionStatusFilter] = useState<SubscriptionStatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("dateJoined");

  // Any control that changes what the server returns must reset to page 1 —
  // otherwise a filter narrowing the result set can strand the view on a
  // page number beyond the new totalPages.
  const withPageReset = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const onSearchChange = (value: string) => { setSearch(value); setPage(1); };
  const onLevelChange = withPageReset(setLevelFilter);
  const onGroupChange = withPageReset(setGroupFilter);
  const onPaymentStatusChange = withPageReset(setPaymentStatusFilter);
  const onSubscriptionStatusChange = withPageReset(setSubscriptionStatusFilter);
  const onSortChange = withPageReset(setSort);

  const activeFilterCount = [
    levelFilter !== "all", groupFilter !== "all", paymentStatusFilter !== "all", subscriptionStatusFilter !== "all",
  ].filter(Boolean).length;
  const hasActiveControls = activeFilterCount > 0 || sort !== "dateJoined" || search.length > 0;
  const clearControls = () => {
    setSearch(""); setLevelFilter("all"); setGroupFilter("all");
    setPaymentStatusFilter("all"); setSubscriptionStatusFilter("all"); setSort("dateJoined");
    setPage(1);
  };

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["ballet-students", page, debouncedSearch, levelFilter, groupFilter, paymentStatusFilter, subscriptionStatusFilter, sort, token],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (levelFilter !== "all") params.set("levelId", String(levelFilter));
      if (groupFilter !== "all") params.set("groupId", String(groupFilter));
      if (paymentStatusFilter !== "all") params.set("paymentStatus", paymentStatusFilter);
      if (subscriptionStatusFilter !== "all") params.set("subscriptionStatus", subscriptionStatusFilter);
      const res = await fetch(`${API_BASE}/api/admin/ballet/students?${params}`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load students");
      return res.json();
    },
  });

  // Reference lists for filter option labels — levels are already unpaginated
  // (confirmed safe); groups exceed the single-page cap today, so every page
  // is fetched to keep the Level/Group filters complete, not just the first 100.
  const { data: levels = [] } = useQuery({
    queryKey: ["ballet-levels-ref", token],
    queryFn: async (): Promise<BalletLevel[]> => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/levels`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load levels");
      const json = await res.json();
      return json.levels ?? [];
    },
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["ballet-groups-ref", token],
    queryFn: () => fetchAllPages<BalletGroup>(async (p) => {
      const res = await fetch(`${API_BASE}/api/admin/ballet/groups?page=${p}&limit=${CATALOG_LIMIT}`, { headers: makeHeaders(token) });
      if (!res.ok) throw new Error("Failed to load groups");
      return res.json() as Promise<RefListResponse<BalletGroup>>;
    }),
  });
  const activeLevels = levels.filter((l) => l.isActive);
  const groupsForLevelFilter = levelFilter === "all" ? groups.filter((g) => g.isActive) : groups.filter((g) => g.isActive && g.levelId === levelFilter);

  const dash = <span className="italic text-muted-foreground">—</span>;

  return (
    <div className="admin2-ballet-page admin2-ballet-people space-y-6">
      <TableToolbar
        searchValue={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search students by name, parent name, or phone"
        searchTestId="input-ballet-student-search"
        activeFilterCount={activeFilterCount}
        onClear={hasActiveControls ? clearControls : undefined}
        activeSortLabel={sort !== "dateJoined" ? SORT_LABELS[sort] : undefined}
        filtersContent={
          <>
            {activeLevels.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Level</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={levelFilter === "all"} className={levelFilter === "all" ? "is-selected" : undefined} onClick={() => onLevelChange("all")}>All</Button>
                  {activeLevels.map((l) => (
                    <Button key={l.id} type="button" variant="outline" size="compact" aria-pressed={levelFilter === l.id} className={levelFilter === l.id ? "is-selected" : undefined} onClick={() => onLevelChange(l.id)}>
                      {l.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {groupsForLevelFilter.length > 0 && (
              <div className="admin2-table-toolbar-panel-group">
                <span>Group</span>
                <div className="admin2-filter-pills">
                  <Button type="button" variant="outline" size="compact" aria-pressed={groupFilter === "all"} className={groupFilter === "all" ? "is-selected" : undefined} onClick={() => onGroupChange("all")}>All</Button>
                  {groupsForLevelFilter.map((g) => (
                    <Button key={g.id} type="button" variant="outline" size="compact" aria-pressed={groupFilter === g.id} className={groupFilter === g.id ? "is-selected" : undefined} onClick={() => onGroupChange(g.id)}>
                      {g.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="admin2-table-toolbar-panel-group">
              <span>Payment status</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={paymentStatusFilter === "all"} className={paymentStatusFilter === "all" ? "is-selected" : undefined} onClick={() => onPaymentStatusChange("all")}>All</Button>
                {PAYMENT_STATUSES.map((value) => (
                  <Button key={value} type="button" variant="outline" size="compact" aria-pressed={paymentStatusFilter === value} className={paymentStatusFilter === value ? "is-selected" : undefined} onClick={() => onPaymentStatusChange(value)}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="admin2-table-toolbar-panel-group">
              <span>Subscription</span>
              <div className="admin2-filter-pills">
                <Button type="button" variant="outline" size="compact" aria-pressed={subscriptionStatusFilter === "all"} className={subscriptionStatusFilter === "all" ? "is-selected" : undefined} onClick={() => onSubscriptionStatusChange("all")}>All</Button>
                {SUBSCRIPTION_STATUSES.map((value) => (
                  <Button key={value} type="button" variant="outline" size="compact" aria-pressed={subscriptionStatusFilter === value} className={subscriptionStatusFilter === value ? "is-selected" : undefined} onClick={() => onSubscriptionStatusChange(value)}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </>
        }
        sortContent={
          <div className="admin2-table-toolbar-panel-group">
            <span>Sort by</span>
            <div className="admin2-filter-pills">
              {(Object.keys(SORT_LABELS) as SortOption[]).map((value) => (
                <Button key={value} type="button" variant="outline" size="compact" aria-pressed={sort === value} className={sort === value ? "is-selected" : undefined} onClick={() => onSortChange(value)}>
                  {SORT_LABELS[value]}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student Name</TableHead>
              <TableHead>Parent Name</TableHead>
              <TableHead>Parent Phone</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Date Joined</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Days</TableHead>
              <TableHead className="w-16 text-right">View</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center text-destructive text-sm">Failed to load students.</TableCell></TableRow>
            ) : data?.data.length === 0 ? (
              <TableRow><TableCell colSpan={13} className="py-10 text-center text-muted-foreground text-sm">{hasActiveControls ? "No students match your search or filters." : "No active ballet students yet."}</TableCell></TableRow>
            ) : (
              data?.data.map((s) => (
                <TableRow
                  key={s.assignmentId}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => navigate(`/ballet/students/${s.assignmentId}`)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open Ballet student file for ${s.studentName}`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/ballet/students/${s.assignmentId}`);
                    }
                  }}
                >
                  <TableCell className="font-medium">{s.studentName}</TableCell>
                  <TableCell>{s.parentName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.parentPhone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.age ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.dateJoined ? new Date(s.dateJoined).toLocaleDateString() : dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.levelName ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.groupName ?? dash}</TableCell>
                  <TableCell><PaymentBadge status={s.paymentStatus} /></TableCell>
                  <TableCell><SubscriptionBadge student={s} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.subscriptionStartDate ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.subscriptionExpiresAt ?? dash}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.daysRemaining != null ? s.daysRemaining : dash}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`View student ${s.assignmentId}`} onClick={(e) => { e.stopPropagation(); navigate(`/ballet/students/${s.assignmentId}`); }}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.total > 0 && (
        <TablePagination page={page} totalPages={data.totalPages} total={data.total} pageSize={LIMIT} isLoading={isLoading} itemLabel="students" onPageChange={setPage} />
      )}
    </div>
  );
}
import "./admin2-ballet.css";
