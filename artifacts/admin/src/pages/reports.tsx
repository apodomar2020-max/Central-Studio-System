import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetAttendanceStats,
  useListPackageOrders,
  useListAttendance,
  useListBookings,
  useListStudents,
} from "@workspace/api-client-react";
import type { PackageOrder, Attendance, Booking, Student } from "@workspace/api-client-react";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Ban,
  ShoppingBag,
  BarChart3,
  FileSpreadsheet,
  FileText,
  CalendarRange,
  AlertCircle,
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

const CARD_BG     = "hsl(196 28% 8%)";
const CARD_BORDER = "hsl(203 30% 14%)";

const TOOLTIP_STYLE = {
  background: "hsl(196 28% 10%)",
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: "8px",
  color: "#fff",
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
        <p className="text-sm font-medium" style={{ color: "#8A9AB0" }}>{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${accent}18` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-white">
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
      <p className="text-sm font-semibold text-white mb-4">{title}</p>
      {children}
    </div>
  );
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
    { value: "submitted", label: "Submitted" },
    { value: "pendingAssessment", label: "Pending assessment" },
    { value: "accepted", label: "Accepted" },
    { value: "rejected", label: "Rejected" },
    { value: "needsFollowUp", label: "Needs follow-up" },
    { value: "assignedToLevel", label: "Assigned to level" },
    { value: "activeBallet", label: "Active ballet" },
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
  const { token } = useAdminAuth();

  const [tab, setTab] = useState<"overview" | "export">("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [attendancePeriod, setAttendancePeriod] = useState<"daily" | "monthly" | "yearly">("monthly");

  const [entity, setEntity] = useState<Entity>("bookings");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Data for Overview analytics (existing list APIs, client-side) ───────────
  const { data: rawBookings = [] } = useListBookings();
  const { data: rawStudents = [] } = useListStudents();
  const { data: rawAttendance = [] } = useListAttendance();
  const { data: rawOrders = [] } = useListPackageOrders();
  const { data: attendanceStats } = useGetAttendanceStats({ period: attendancePeriod });

  const bookings = rawBookings as Booking[];
  const students = rawStudents as Student[];
  const attendance = rawAttendance as Attendance[];
  const orders = rawOrders as PackageOrder[];

  // ── Date range (shared by Overview + Export Center) ─────────────────────────
  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const inRange = useMemo(() => {
    return (s?: string | null): boolean => {
      if (!s) return false;
      const d = new Date(s);
      return !Number.isNaN(d.getTime()) && d >= range.from && d <= range.to;
    };
  }, [range]);

  // YYYY-MM-DD params for the backend (presets → derived; custom → as typed).
  const { fromParam, toParam } = useMemo(() => {
    if (preset === "custom") return { fromParam: customFrom || undefined, toParam: customTo || undefined };
    return { fromParam: ymd(range.from), toParam: ymd(range.to) };
  }, [preset, customFrom, customTo, range]);

  // ── Overview: date-ranged metrics (NOT the Dashboard KPI cards) ─────────────
  const overview = useMemo(() => {
    const newUsers = students.filter((s) => inRange(s.joinedAt)).length;
    const newParents = students.filter((s) => s.accountType === "parent" && inRange(s.joinedAt)).length;
    const bookingsInRange = bookings.filter((b) => inRange(b.bookedAt ?? b.createdAt));
    const attInRange = attendance.filter((a) => inRange(a.checkedInAt ?? a.createdAt));

    const att = {
      total: attInRange.length,
      checkedIn: attInRange.filter((a) => !a.status || a.status === "checked_in").length,
      late: attInRange.filter((a) => a.status === "late").length,
      absent: attInRange.filter((a) => a.status === "absent").length,
      cancelled: attInRange.filter((a) => a.status === "cancelled").length,
    };

    const byClass = new Map<string, number>();
    for (const b of bookingsInRange) {
      const name = b.classTitle ?? b.displayTitle ?? "Unlabelled";
      byClass.set(name, (byClass.get(name) ?? 0) + 1);
    }
    const topClasses = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { newUsers, newParents, bookingsInRange: bookingsInRange.length, att, topClasses };
  }, [students, bookings, attendance, inRange]);

  const attStatusBarData = [
    { name: "Checked In", count: overview.att.checkedIn, fill: GREEN },
    { name: "Late",        count: overview.att.late,      fill: AMBER },
    { name: "Absent",      count: overview.att.absent,    fill: RED   },
    { name: "Cancelled",   count: overview.att.cancelled, fill: GRAY  },
  ];
  const attendanceTrendData = (attendanceStats?.data ?? []).map((d) => ({ name: d.label, count: d.count }));

  const pkgPieData = useMemo(() => {
    const inR = orders.filter((o) => inRange(o.createdAt));
    const by = (st: string) => inR.filter((o) => o.status === st).length;
    return [
      { name: "Active",     value: by("active"),         fill: GREEN },
      { name: "Pending",    value: by("pendingPayment"), fill: AMBER },
      { name: "Fully Used", value: by("fullyUsed"),      fill: CYAN  },
      { name: "Expired",    value: by("expired"),        fill: RED   },
      { name: "Cancelled",  value: by("cancelled"),      fill: GRAY  },
    ].filter((d) => d.value > 0);
  }, [orders, inRange]);

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

  function handleEntityChange(value: string) {
    setEntity(value as Entity);
    setStatusFilter("all");
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Reports</h1>
          <p className="text-sm mt-1" style={{ color: "#8A9AB0" }}>
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
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Date Range</span>
        </div>
        <div className="flex items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={
                preset === p.value
                  ? { background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}40` }
                  : { background: "transparent", color: "#8A9AB0", border: "1px solid hsl(203 25% 16%)" }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-[150px]" />
            <span className="text-xs" style={{ color: "#4E6070" }}>to</span>
            <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
        )}
      </div>

      {/* ── Segmented control ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "overview" | "export")} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview / Analytics</TabsTrigger>
          <TabsTrigger value="export">Export Center</TabsTrigger>
        </TabsList>

        {/* ───────────── OVERVIEW ───────────── */}
        <TabsContent value="overview" className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="New Users"   value={overview.newUsers}        icon={UserPlus}    accent={CYAN}  sub="in range" />
            <StatCard title="New Parents" value={overview.newParents}      icon={Users}       accent={GREEN} sub="in range" />
            <StatCard title="Bookings"    value={overview.bookingsInRange} icon={ShoppingBag} accent={AMBER} sub="in range" />
            <StatCard title="Check-Ins"   value={overview.att.total}       icon={ScanLine}    accent={CYAN}  sub="in range" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Checked In" value={overview.att.checkedIn} icon={CheckCircle2} accent={GREEN} />
            <StatCard title="Late"       value={overview.att.late}      icon={Clock}        accent={AMBER} />
            <StatCard title="Absent"     value={overview.att.absent}    icon={XCircle}      accent={RED}   />
            <StatCard title="Cancelled"  value={overview.att.cancelled} icon={Ban}          accent={GRAY}  />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Attendance by Status (range)">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={attStatusBarData} barCategoryGap="40%">
                  <XAxis dataKey="name" tick={{ fill: "#8A9AB0", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                  <YAxis tick={{ fill: "#8A9AB0", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {attStatusBarData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {pkgPieData.length > 0 && (
              <ChartCard title="Package Status (range)">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pkgPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                      {pkgPieData.map((entry, idx) => <Cell key={idx} fill={entry.fill} opacity={0.9} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend formatter={(value) => <span style={{ color: "#8A9AB0", fontSize: "11px" }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          <ChartCard title="Most Active Classes (by bookings, range)">
            {overview.topClasses.length === 0 ? (
              <p className="text-center text-sm py-6" style={{ color: "#4E6070" }}>No bookings in this range.</p>
            ) : (
              <div className="space-y-2">
                {overview.topClasses.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="text-white">{name}</span>
                    <span style={{ color: CYAN }}>{count} booking{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard title="Attendance Trend">
            <div className="flex items-center gap-2 mb-4">
              {(["daily", "monthly", "yearly"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setAttendancePeriod(opt)}
                  className="px-3 py-1 rounded-md text-xs font-medium capitalize transition-all"
                  style={
                    attendancePeriod === opt
                      ? { background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}40` }
                      : { background: "transparent", color: "#8A9AB0", border: "1px solid hsl(203 25% 16%)" }
                  }
                >
                  {opt}
                </button>
              ))}
            </div>
            {attendanceTrendData.length === 0 ? (
              <p className="text-center text-sm py-8" style={{ color: "#4E6070" }}>No data for this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={attendanceTrendData} barCategoryGap="30%">
                  <XAxis dataKey="name" tick={{ fill: "#8A9AB0", fontSize: 11 }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                  <YAxis tick={{ fill: "#8A9AB0", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </TabsContent>

        {/* ───────────── EXPORT CENTER ───────────── */}
        <TabsContent value="export" className="space-y-4">
          {/* Controls */}
          <div className="rounded-xl border p-4 flex flex-wrap items-end gap-4" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Report</label>
              <Select value={entity} onValueChange={handleEntityChange}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#8A9AB0" }}>Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter} disabled={STATUS_OPTIONS[entity].length <= 1}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS[entity].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1" />

            {/* Export buttons — disabled placeholders (Phase 3/4) */}
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" disabled title="Coming soon" className="gap-1.5">
                <FileText className="h-4 w-4" /> Export PDF
              </Button>
              <Button variant="outline" size="sm" disabled title="Coming soon" className="gap-1.5">
                <FileSpreadsheet className="h-4 w-4" /> Export Excel
              </Button>
              <Badge variant="secondary" className="self-center">Coming next</Badge>
            </div>
          </div>

          <p className="text-xs" style={{ color: "#8A9AB0" }}>
            Preview is served by the secure admin reports API with the date range &amp; status above. PDF &amp; Excel export will generate exactly what you see here — that work lands in the next phase.
          </p>

          {/* Summary cards from backend summary */}
          {summaryEntries.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {summaryEntries.map(([key, val]) => (
                <div key={key} className="rounded-lg border px-3 py-2.5" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: "#8A9AB0" }}>{humanize(key)}</p>
                  <p className="text-xl font-bold text-white">{typeof val === "number" ? val.toLocaleString() : String(val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Preview table (backend columns + rows) */}
          <div className="rounded-xl border overflow-hidden" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: CARD_BORDER }}>
              <span className="text-sm font-semibold text-white">Preview</span>
              <span className="text-xs" style={{ color: "#8A9AB0" }}>
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
              <div className="px-4 py-2 text-xs border-t" style={{ color: "#8A9AB0", borderColor: CARD_BORDER }}>
                Showing first {report.rows.length} of {report.summary.total}. Export (next phase) will include all rows.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
