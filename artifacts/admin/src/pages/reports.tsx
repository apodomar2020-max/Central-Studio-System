import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Users,
  UserPlus,
  ScanLine,
  CheckCircle2,
  Clock,
  XCircle,
  ShoppingBag,
  Package,
  BarChart3,
  FileSpreadsheet,
  FileText,
  CalendarRange,
  AlertCircle,
  Loader2,
  TrendingUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ─── Design tokens ────────────────────────────────────────────────────────────
const CYAN  = "#00B6D7";
const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const RED   = "#EF4444";
const GRAY  = "#6B7280";

const CARD_BG     = "hsl(var(--card))";
const CARD_BORDER = "hsl(var(--border))";
const MUTED_TEXT  = "hsl(var(--muted-foreground))";
const SUBTLE_TEXT = "hsl(var(--muted-foreground) / 0.68)";
const CHART_CURSOR = "hsl(var(--accent) / 0.55)";

const TOOLTIP_STYLE = {
  background: "hsl(var(--popover))",
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: "8px",
  color: "hsl(var(--popover-foreground))",
  fontSize: "12px",
};

// ─── API base / headers (admin reports endpoints) ──────────────────────────────
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const API_KEY  = (import.meta.env.VITE_API_KEY  as string | undefined) ?? "";
function adminHeaders(token: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...(token ? { "x-admin-token": token } : {}),
  };
}

interface ReportColumn { key: string; label: string }
interface ReportResponse {
  entity: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, number | string>;
  filters: { from?: string; to?: string; status?: string; entity: string };
}

interface ChartPoint {
  name: string;
  count: number;
}
interface ClassPerformanceRow {
  classId: number;
  className: string;
  instructor: string;
  totalBookings: number;
  totalAttendance: number;
  attendanceRate: number;
  noShowCount: number;
  cancellationCount: number;
}
interface AnalyticsResponse {
  filters: { from: string; to: string; bucket: "day" | "week" | "month" };
  executive: {
    totalBookings: number;
    confirmedBookings: number;
    attendedClasses: number;
    newStudents: number;
    newParents: number;
    balletApplications: number;
    packageOrders: number;
  };
  classPerformance: {
    rows: ClassPerformanceRow[];
    top: ClassPerformanceRow[];
    lowest: ClassPerformanceRow[];
    minimumLowestSampleSize: number;
  };
  attendance: {
    trend: ChartPoint[];
    breakdown: ChartPoint[];
  };
  bookings: {
    trend: ChartPoint[];
    statusDistribution: ChartPoint[];
  };
  growth: {
    newStudents: { current: number; previous: number; changePct: number | null };
    newParents: { current: number; previous: number; changePct: number | null };
    trend: ChartPoint[];
  };
  packages: {
    orders: number;
    creditsIssued: number;
    creditsUsed: number;
    creditsRemaining: number;
    usageRate: number;
    trend: ChartPoint[];
  };
  ballet: {
    submitted: number;
    approved: number;
    pending: number;
    rejected: number;
    activeBalletStudents: number;
  };
}

// ─── Date range ─────────────────────────────────────────────────────────────
type Preset = "today" | "week" | "month" | "custom";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}
function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}
function computeRange(preset: Preset, from: string, to: string): { from: Date; to: Date } {
  switch (preset) {
    case "today": return { from: startOfToday(), to: endOfToday() };
    case "week":  return { from: startOfWeek(),  to: endOfToday() };
    case "month": return { from: startOfMonth(), to: endOfToday() };
    case "custom": {
      const f = from ? new Date(`${from}T00:00:00`) : new Date(0);
      const t = to ? new Date(`${to}T23:59:59.999`) : endOfToday();
      return { from: f, to: t };
    }
  }
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// ─── Shared components ────────────────────────────────────────────────────────
function StatCard({
  title, value, sub, icon: Icon, accent,
}: { title: string; value: string | number; sub?: string; icon: React.ElementType; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border p-5 flex flex-col gap-3" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: MUTED_TEXT }}>{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${accent}18` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-foreground">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {sub && <span className="text-xs" style={{ color: accent }}>{sub}</span>}
      </div>
    </div>
  );
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <p className="text-sm font-semibold text-foreground mb-4">{title}</p>
      {children}
    </div>
  );
}
function EmptyState({ message }: { message: string }) {
  return <p className="text-center text-sm py-8" style={{ color: SUBTLE_TEXT }}>{message}</p>;
}
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {sub && <p className="text-sm mt-1" style={{ color: MUTED_TEXT }}>{sub}</p>}
    </div>
  );
}
function formatPercent(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}
function formatChange(value: number | null): string {
  if (value == null) return "new";
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : ""}${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}
function chartHasData(data: ChartPoint[]): boolean {
  return data.some((d) => d.count > 0);
}

// ─── Export Center entity config ───────────────────────────────────────────────
type Entity = "bookings" | "users" | "parents" | "ballet" | "attendance";

const ENTITY_OPTIONS: { value: Entity; label: string }[] = [
  { value: "bookings",   label: "Bookings" },
  { value: "users",      label: "Users" },
  { value: "parents",    label: "Parents" },
  { value: "ballet",     label: "Ballet Applications" },
  { value: "attendance", label: "Attendance" },
];

const STATUS_OPTIONS: Record<Entity, { value: string; label: string }[]> = {
  bookings: [
    { value: "all", label: "All statuses" },
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "attended", label: "Attended" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "rejected", label: "Rejected" },
    { value: "noShow", label: "No-show" },
  ],
  users: [
    { value: "all", label: "All accounts" },
    { value: "student", label: "Students" },
    { value: "parent", label: "Parents" },
  ],
  parents: [{ value: "all", label: "All parents" }],
  ballet: [
    { value: "all", label: "All statuses" },
    { value: "pending", label: "Pending" },
    { value: "accepted", label: "Accepted" },
    { value: "needsFollowUp", label: "Needs follow-up" },
    { value: "assignedToLevel", label: "Assigned to level" },
    { value: "active", label: "Active" },
    { value: "rejected", label: "Rejected" },
    { value: "cancelled", label: "Cancelled" },
  ],
  attendance: [
    { value: "all", label: "All statuses" },
    { value: "checked_in", label: "Checked in" },
    { value: "late", label: "Late" },
    { value: "absent", label: "Absent" },
    { value: "cancelled", label: "Cancelled" },
  ],
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { token, can } = useAdminAuth();
  const canAnalytics = can("reports", "analytics");
  const canExportExcel = can("reports", "exportExcel");
  const canExportPdf = can("reports", "exportPdf");

  const [tab, setTab] = useState<"overview" | "export">(canAnalytics ? "overview" : "export");
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [entity, setEntity] = useState<Entity>("bookings");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Date range (shared by Overview + Export Center) ─────────────────────────
  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  // YYYY-MM-DD params for the backend (presets → derived; custom → as typed).
  const { fromParam, toParam } = useMemo(() => {
    if (preset === "custom") return { fromParam: customFrom || undefined, toParam: customTo || undefined };
    return { fromParam: ymd(range.from), toParam: ymd(range.to) };
  }, [preset, customFrom, customTo, range]);

  // ── Overview analytics: centralized backend report data ─────────────────────
  const analyticsQuery = useQuery<AnalyticsResponse>({
    queryKey: ["report-analytics", fromParam, toParam],
    enabled: tab === "overview",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromParam) params.set("from", fromParam);
      if (toParam) params.set("to", toParam);
      const res = await fetch(`${API_BASE}/api/reports/analytics?${params.toString()}`, {
        headers: adminHeaders(token),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e?.error ?? "Failed to load analytics");
      }
      return res.json();
    },
  });
  const analytics = analyticsQuery.data;
  const attendanceBreakdownData = analytics?.attendance.breakdown.map((d) => ({
    ...d,
    fill: d.name === "Checked In" ? GREEN : d.name === "Late" ? AMBER : d.name === "Absent" ? RED : GRAY,
  })) ?? [];
  const bookingStatusData = analytics?.bookings.statusDistribution.map((d) => ({
    ...d,
    fill: d.name === "Confirmed" || d.name === "Completed" ? GREEN : d.name === "Pending" ? AMBER : d.name === "Refunded" ? CYAN : RED,
  })) ?? [];

  // ── Export Center: backend report endpoint (admin-only) ─────────────────────
  const reportQuery = useQuery<ReportResponse>({
    queryKey: ["report", entity, fromParam, toParam, statusFilter],
    enabled: tab === "export",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromParam) params.set("from", fromParam);
      if (toParam) params.set("to", toParam);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "1000");
      const res = await fetch(`${API_BASE}/api/reports/${entity}?${params.toString()}`, {
        headers: adminHeaders(token),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e?.error ?? `Failed to load ${entity} report`);
      }
      return res.json();
    },
  });
  const report = reportQuery.data;
  const summaryEntries = report ? Object.entries(report.summary) : [];

  // ── Exports: same endpoint/filters as the preview, with format=xlsx|pdf ──────
  const [exportingFormat, setExportingFormat] = useState<"xlsx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport(format: "xlsx" | "pdf") {
    setExportingFormat(format);
    setExportError(null);
    try {
      const params = new URLSearchParams();
      if (fromParam) params.set("from", fromParam);
      if (toParam) params.set("to", toParam);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "1000");
      params.set("format", format);
      const res = await fetch(`${API_BASE}/api/reports/${entity}?${params.toString()}`, {
        headers: adminHeaders(token),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e?.error ?? `Failed to export ${entity} report`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${entity}-report-${ymd(new Date())}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error)?.message ?? "Export failed.");
    } finally {
      setExportingFormat(null);
    }
  }

  function handleEntityChange(value: string) {
    setEntity(value as Entity);
    setStatusFilter("all");
    setExportError(null);
  }

  const PRESETS: { label: string; value: Preset }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "Custom", value: "custom" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Reports</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Date-ranged analytics and data exports across the studio.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border p-1.5" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
          <BarChart3 className="h-4 w-4" style={{ color: CYAN }} />
        </div>
      </div>

      {/* ── Shared date-range filter ── */}
      <div className="rounded-xl border p-4 flex flex-wrap items-center gap-3" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4" style={{ color: CYAN }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Date Range</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={
                preset === p.value
                  ? { background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}40` }
                  : { background: "transparent", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-[150px]" />
            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground) / 0.68)" }}>to</span>
            <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
        )}
      </div>

      {/* ── Segmented control ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "export")} className="space-y-6">
        <TabsList>
          {canAnalytics && <TabsTrigger value="overview">Overview / Analytics</TabsTrigger>}
          <TabsTrigger value="export">Export Center</TabsTrigger>
        </TabsList>

        {/* ───────────── OVERVIEW ───────────── */}
        <TabsContent value="overview" className="space-y-8">
          {analyticsQuery.isLoading ? (
            <div className="rounded-xl border p-8 text-center text-sm" style={{ background: CARD_BG, borderColor: CARD_BORDER, color: "hsl(var(--muted-foreground))" }}>
              Loading analytics...
            </div>
          ) : analyticsQuery.isError ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border p-8 text-sm" style={{ background: CARD_BG, borderColor: CARD_BORDER, color: RED }}>
              <AlertCircle className="h-4 w-4" />
              {(analyticsQuery.error as Error)?.message ?? "Failed to load analytics."}
            </div>
          ) : analytics ? (
            <>
              <section className="space-y-4">
                <SectionHeader title="Executive Summary" sub="Date-ranged business signals, separate from live Dashboard operations." />
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                  <StatCard title="Total Bookings" value={analytics.executive.totalBookings} icon={ShoppingBag} accent={CYAN} />
                  <StatCard title="Confirmed" value={analytics.executive.confirmedBookings} icon={CheckCircle2} accent={GREEN} />
                  <StatCard title="Attended" value={analytics.executive.attendedClasses} icon={ScanLine} accent={CYAN} />
                  <StatCard title="New Students" value={analytics.executive.newStudents} icon={UserPlus} accent={AMBER} />
                  <StatCard title="New Parents" value={analytics.executive.newParents} icon={Users} accent={GREEN} />
                  <StatCard title="Ballet Apps" value={analytics.executive.balletApplications} icon={BarChart3} accent={RED} />
                  <StatCard title="Package Orders" value={analytics.executive.packageOrders} icon={Package} accent={CYAN} />
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeader title="Class Performance" sub="Attendance rate is attended bookings divided by total bookings." />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title="Top Performing Classes">
                    {analytics.classPerformance.top.length === 0 ? (
                      <EmptyState message="No class bookings in this range." />
                    ) : (
                      <div className="space-y-3">
                        {analytics.classPerformance.top.map((row) => (
                          <div key={`top-${row.classId}-${row.className}`} className="rounded-lg border px-3 py-2" style={{ borderColor: CARD_BORDER }}>
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{row.className}</p>
                                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{row.instructor}</p>
                              </div>
                              <span className="text-sm font-semibold" style={{ color: GREEN }}>{formatPercent(row.attendanceRate)}</span>
                            </div>
                            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {row.totalAttendance} attended / {row.totalBookings} bookings
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </ChartCard>

                  <ChartCard title="Lowest Performing Classes">
                    {analytics.classPerformance.lowest.length === 0 ? (
                      <EmptyState message={`No classes with ${analytics.classPerformance.minimumLowestSampleSize}+ bookings in this range.`} />
                    ) : (
                      <div className="space-y-3">
                        {analytics.classPerformance.lowest.map((row) => (
                          <div key={`low-${row.classId}-${row.className}`} className="rounded-lg border px-3 py-2" style={{ borderColor: CARD_BORDER }}>
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{row.className}</p>
                                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{row.instructor}</p>
                              </div>
                              <span className="text-sm font-semibold" style={{ color: AMBER }}>{formatPercent(row.attendanceRate)}</span>
                            </div>
                            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {row.noShowCount} no-show / {row.cancellationCount} cancelled
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </ChartCard>
                </div>

                <div className="rounded-xl border overflow-hidden" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Class</TableHead>
                        <TableHead>Instructor</TableHead>
                        <TableHead>Total Bookings</TableHead>
                        <TableHead>Total Attendance</TableHead>
                        <TableHead>Attendance Rate</TableHead>
                        <TableHead>No Shows</TableHead>
                        <TableHead>Cancelled</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.classPerformance.rows.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No class performance data for this range.</TableCell></TableRow>
                      ) : (
                        analytics.classPerformance.rows.slice(0, 12).map((row) => (
                          <TableRow key={`class-${row.classId}-${row.className}`}>
                            <TableCell className="font-medium text-foreground">{row.className}</TableCell>
                            <TableCell>{row.instructor}</TableCell>
                            <TableCell>{row.totalBookings}</TableCell>
                            <TableCell>{row.totalAttendance}</TableCell>
                            <TableCell>{formatPercent(row.attendanceRate)}</TableCell>
                            <TableCell>{row.noShowCount}</TableCell>
                            <TableCell>{row.cancellationCount}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeader title="Attendance Analytics" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title={`Attendance Trend (${analytics.filters.bucket})`}>
                    {!chartHasData(analytics.attendance.trend) ? (
                      <EmptyState message="No attendance data for this range." />
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={analytics.attendance.trend} barCategoryGap="30%">
                          <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                          <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_CURSOR }} />
                          <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} opacity={0.85} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>

                  <ChartCard title="Attendance Breakdown">
                    {!chartHasData(attendanceBreakdownData) ? (
                      <EmptyState message="No attendance statuses in this range." />
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={attendanceBreakdownData} barCategoryGap="40%">
                          <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                          <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_CURSOR }} />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                            {attendanceBreakdownData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeader title="Booking Analytics" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartCard title={`Bookings Over Time (${analytics.filters.bucket})`}>
                    {!chartHasData(analytics.bookings.trend) ? (
                      <EmptyState message="No bookings in this range." />
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={analytics.bookings.trend} barCategoryGap="30%">
                          <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                          <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_CURSOR }} />
                          <Bar dataKey="count" fill={AMBER} radius={[4, 4, 0, 0]} opacity={0.85} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>

                  <ChartCard title="Booking Status Distribution">
                    {!chartHasData(bookingStatusData) ? (
                      <EmptyState message="No booking statuses in this range." />
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={bookingStatusData.filter((d) => d.count > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={82} paddingAngle={3} dataKey="count">
                            {bookingStatusData.filter((d) => d.count > 0).map((entry, idx) => <Cell key={idx} fill={entry.fill} opacity={0.9} />)}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Legend formatter={(value) => <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "11px" }}>{value}</span>} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                </div>
              </section>

              <section className="space-y-4">
                <SectionHeader title="User Growth" sub="Current period compared with the immediately preceding period." />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <StatCard title="New Students" value={analytics.growth.newStudents.current} icon={UserPlus} accent={CYAN} sub={formatChange(analytics.growth.newStudents.changePct)} />
                  <StatCard title="New Parents" value={analytics.growth.newParents.current} icon={Users} accent={GREEN} sub={formatChange(analytics.growth.newParents.changePct)} />
                  <StatCard title="Previous Period Users" value={analytics.growth.newStudents.previous + analytics.growth.newParents.previous} icon={TrendingUp} accent={AMBER} />
                </div>
                <ChartCard title={`User Growth Trend (${analytics.filters.bucket})`}>
                  {!chartHasData(analytics.growth.trend) ? (
                    <EmptyState message="No new users in this range." />
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={analytics.growth.trend} barCategoryGap="30%">
                        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_CURSOR }} />
                        <Bar dataKey="count" fill={GREEN} radius={[4, 4, 0, 0]} opacity={0.85} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </section>

              <section className="space-y-4">
                <SectionHeader title="Package Analytics" />
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <StatCard title="Package Orders" value={analytics.packages.orders} icon={Package} accent={CYAN} />
                  <StatCard title="Credits Issued" value={analytics.packages.creditsIssued} icon={CheckCircle2} accent={GREEN} />
                  <StatCard title="Credits Used" value={analytics.packages.creditsUsed} icon={ScanLine} accent={AMBER} />
                  <StatCard title="Remaining" value={analytics.packages.creditsRemaining} icon={Clock} accent={CYAN} />
                  <StatCard title="Usage Rate" value={formatPercent(analytics.packages.usageRate)} icon={TrendingUp} accent={GREEN} />
                </div>
                <ChartCard title={`Package Orders Trend (${analytics.filters.bucket})`}>
                  {!chartHasData(analytics.packages.trend) ? (
                    <EmptyState message="No package orders in this range." />
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={analytics.packages.trend} barCategoryGap="30%">
                        <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                        <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: CHART_CURSOR }} />
                        <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} opacity={0.85} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </section>

              <section className="space-y-4">
                <SectionHeader title="Ballet Analytics" sub="Focused application status snapshot only." />
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <StatCard title="Submitted" value={analytics.ballet.submitted} icon={FileText} accent={CYAN} />
                  <StatCard title="Approved" value={analytics.ballet.approved} icon={CheckCircle2} accent={GREEN} />
                  <StatCard title="Pending" value={analytics.ballet.pending} icon={Clock} accent={AMBER} />
                  <StatCard title="Rejected" value={analytics.ballet.rejected} icon={XCircle} accent={RED} />
                  <StatCard title="Active Ballet" value={analytics.ballet.activeBalletStudents} icon={Users} accent={GREEN} />
                </div>
              </section>
            </>
          ) : (
            <EmptyState message="No analytics available." />
          )}
        </TabsContent>

        {/* ───────────── EXPORT CENTER ───────────── */}
        <TabsContent value="export" className="space-y-4">
          {/* Controls */}
          <div className="rounded-xl border p-4 flex flex-wrap items-end gap-4" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Report</label>
              <Select value={entity} onValueChange={handleEntityChange}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter} disabled={STATUS_OPTIONS[entity].length <= 1}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS[entity].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1" />

            {/* Export buttons — gated by reports.exportPdf / reports.exportExcel */}
            <div className="flex items-end gap-2">
              {canExportPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleExport("pdf")}
                  disabled={exportingFormat !== null || reportQuery.isLoading || !report}
                  title={!report ? "Load a preview first" : "Download .pdf"}
                >
                  {exportingFormat === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {exportingFormat === "pdf" ? "Exporting…" : "Export PDF"}
                </Button>
              )}
              {canExportExcel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleExport("xlsx")}
                  disabled={exportingFormat !== null || reportQuery.isLoading || !report}
                  title={!report ? "Load a preview first" : "Download .xlsx"}
                >
                  {exportingFormat === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  {exportingFormat === "xlsx" ? "Exporting…" : "Export Excel"}
                </Button>
              )}
            </div>
          </div>

          {exportError && (
            <div className="flex items-center gap-2 text-xs" style={{ color: RED }}>
              <AlertCircle className="h-3.5 w-3.5" />
              {exportError}
            </div>
          )}

          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            Preview, Excel &amp; PDF exports are all served by the secure admin reports API with the date range &amp; status above — every format matches exactly what you see here.
          </p>

          {/* Summary cards from backend summary */}
          {summaryEntries.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {summaryEntries.map(([key, val]) => (
                <div key={key} className="rounded-lg border px-3 py-2.5" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{humanize(key)}</p>
                  <p className="text-xl font-bold text-foreground">{typeof val === "number" ? val.toLocaleString() : String(val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Preview table (backend columns + rows) */}
          <div className="rounded-xl border overflow-hidden" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: CARD_BORDER }}>
              <span className="text-sm font-semibold text-foreground">Preview</span>
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                {report ? `${report.rows.length} row${report.rows.length !== 1 ? "s" : ""}` : ""}
              </span>
            </div>

            {reportQuery.isError ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: RED }}>
                <AlertCircle className="h-4 w-4" />
                {(reportQuery.error as Error)?.message ?? "Failed to load report."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {(report?.columns ?? []).map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportQuery.isLoading || !report ? (
                    <TableRow><TableCell colSpan={Math.max(report?.columns.length ?? 1, 1)} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : report.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={report.columns.length} className="text-center py-8 text-muted-foreground">No records match the selected range and filters.</TableCell></TableRow>
                  ) : (
                    report.rows.map((row, i) => (
                      <TableRow key={i}>
                        {report.columns.map((c) => <TableCell key={c.key}>{String(row[c.key] ?? "—")}</TableCell>)}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}

            {report && typeof report.summary.total === "number" && report.summary.total > report.rows.length && (
              <div className="px-4 py-2 text-xs border-t" style={{ color: "hsl(var(--muted-foreground))", borderColor: CARD_BORDER }}>
                Showing first {report.rows.length} of {report.summary.total}. Excel export uses the same rows and filters shown in this preview.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
