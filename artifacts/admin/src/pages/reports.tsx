import { useState, useMemo } from "react";
import {
  useGetDashboard,
  useGetAttendanceStats,
  useListPackageOrders,
  useListAttendance,
} from "@workspace/api-client-react";
import type { PackageOrder, Attendance } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  CreditCard,
  ScanLine,
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  TrendingUp,
  ShoppingBag,
  BarChart3,
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
const PURPLE = "#8A5CFF";

const CARD_BG     = "hsl(196 28% 8%)";
const CARD_BORDER = "hsl(203 30% 14%)";

const TOOLTIP_STYLE = {
  background: "hsl(196 28% 10%)",
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
};

// ─── Shared components ────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5 flex flex-col gap-3 group transition-all duration-200 hover:border-opacity-60"
      style={{ background: CARD_BG, borderColor: CARD_BORDER }}
    >
      <div
        className="absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-10 blur-xl group-hover:opacity-20 transition-opacity"
        style={{ background: accent }}
      />
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

function SkeletonCard() {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: CARD_BG, borderColor: CARD_BORDER }}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" style={{ background: CARD_BORDER }} />
        <Skeleton className="h-8 w-8 rounded-lg" style={{ background: CARD_BORDER }} />
      </div>
      <Skeleton className="h-8 w-16" style={{ background: CARD_BORDER }} />
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [attendancePeriod, setAttendancePeriod] = useState<"daily" | "monthly" | "yearly">("monthly");

  const { data: dashboard, isLoading: dashLoading } = useGetDashboard();
  const { data: attendanceStats } = useGetAttendanceStats({ period: attendancePeriod });
  const { data: rawOrders = [] } = useListPackageOrders();
  const { data: rawAttendance = [] } = useListAttendance();

  const orders = rawOrders as PackageOrder[];
  const attendance = rawAttendance as Attendance[];

  // ── Package computed stats ─────────────────────────────────────────────────
  const pkgStats = useMemo(() => {
    const active      = orders.filter((o) => o.status === "active").length;
    const pending     = orders.filter((o) => o.status === "pendingPayment").length;
    const fullyUsed   = orders.filter((o) => o.status === "fullyUsed").length;
    const expired     = orders.filter((o) => o.status === "expired").length;
    const cancelled   = orders.filter((o) => o.status === "cancelled").length;
    const total       = orders.length;
    const creditsIssued = orders.reduce((s, o) => s + o.totalCredits, 0);
    const creditsUsed   = orders.reduce((s, o) => s + (o.totalCredits - o.remainingCredits), 0);
    const creditsRemaining = orders.reduce((s, o) => s + o.remainingCredits, 0);
    return { active, pending, fullyUsed, expired, cancelled, total, creditsIssued, creditsUsed, creditsRemaining };
  }, [orders]);

  // ── Attendance computed stats ──────────────────────────────────────────────
  const attStats = useMemo(() => {
    const checkedIn = attendance.filter((a) => !a.status || a.status === "checked_in").length;
    const late      = attendance.filter((a) => a.status === "late").length;
    const absent    = attendance.filter((a) => a.status === "absent").length;
    const cancelled = attendance.filter((a) => a.status === "cancelled").length;
    const total     = attendance.length;
    const creditDeductions = attendance.filter((a) => a.creditDeducted).length;
    return { checkedIn, late, absent, cancelled, total, creditDeductions };
  }, [attendance]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const attendanceTrendData = (attendanceStats?.data ?? []).map((d) => ({
    name: d.label,
    count: d.count,
  }));

  const pkgStatusPieData = [
    { name: "Active",       value: pkgStats.active,    fill: GREEN },
    { name: "Pending",      value: pkgStats.pending,   fill: AMBER },
    { name: "Fully Used",   value: pkgStats.fullyUsed, fill: CYAN  },
    { name: "Expired",      value: pkgStats.expired,   fill: RED   },
    { name: "Cancelled",    value: pkgStats.cancelled, fill: GRAY  },
  ].filter((d) => d.value > 0);

  const attStatusBarData = [
    { name: "Checked In", count: attStats.checkedIn, fill: GREEN },
    { name: "Late",        count: attStats.late,      fill: AMBER },
    { name: "Absent",      count: attStats.absent,    fill: RED   },
    { name: "Cancelled",   count: attStats.cancelled, fill: GRAY  },
  ];

  const PERIOD_OPTIONS: { label: string; value: "daily" | "monthly" | "yearly" }[] = [
    { label: "Daily",   value: "daily"   },
    { label: "Monthly", value: "monthly" },
    { label: "Yearly",  value: "yearly"  },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Reports</h1>
          <p className="text-sm mt-1" style={{ color: "#8A9AB0" }}>
            Studio-wide statistics across packages, credits, and attendance.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border p-1" style={{ borderColor: CARD_BORDER, background: CARD_BG }}>
          <BarChart3 className="h-4 w-4 ml-1" style={{ color: CYAN }} />
        </div>
      </div>

      {/* ── Section: Studio overview ── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: `${CYAN}80` }}>
          Studio Overview
        </p>
        {dashLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Students"     value={dashboard?.totalStudents ?? 0}     icon={Users}      accent={CYAN}  />
            <StatCard title="Active Classes"      value={dashboard?.activeClasses ?? 0}      icon={ScanLine}   accent={CYAN}  />
            <StatCard title="Active Instructors"  value={dashboard?.activeInstructors ?? 0}  icon={TrendingUp} accent={PURPLE} />
            <StatCard title="Total Bookings"      value={dashboard?.totalBookings ?? 0}      icon={ShoppingBag} accent={GREEN} />
          </div>
        )}
      </div>

      {/* ── Section: Package stats ── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: `${CYAN}80` }}>
          Package Orders
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard title="Total Orders"       value={pkgStats.total}           icon={ShoppingBag}  accent={CYAN}   />
          <StatCard title="Active Packages"    value={pkgStats.active}          icon={CheckCircle2} accent={GREEN}  />
          <StatCard title="Pending Payment"    value={pkgStats.pending}         icon={Clock}        accent={AMBER}  />
          <StatCard title="Credits Issued"     value={pkgStats.creditsIssued}   icon={CreditCard}   accent={CYAN}   sub="total" />
          <StatCard title="Credits Used"       value={pkgStats.creditsUsed}     icon={CreditCard}   accent={RED}    sub="consumed" />
          <StatCard title="Credits Remaining"  value={pkgStats.creditsRemaining} icon={CreditCard}  accent={GREEN}  sub="available" />
        </div>
      </div>

      {/* ── Section: Package status distribution ── */}
      {pkgStatusPieData.length > 0 && (
        <ChartCard title="Package Status Distribution">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pkgStatusPieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
              >
                {pkgStatusPieData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} opacity={0.9} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend
                formatter={(value) => (
                  <span style={{ color: "#8A9AB0", fontSize: "11px" }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Section: Attendance stats ── */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: `${CYAN}80` }}>
          Attendance
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard title="Total Check-Ins"    value={attStats.total}           icon={ScanLine}     accent={CYAN}   />
          <StatCard title="Checked In"         value={attStats.checkedIn}       icon={CheckCircle2} accent={GREEN}  />
          <StatCard title="Late Arrivals"      value={attStats.late}            icon={Clock}        accent={AMBER}  />
          <StatCard title="Absent"             value={attStats.absent}          icon={XCircle}      accent={RED}    />
          <StatCard title="Cancelled"          value={attStats.cancelled}       icon={Ban}          accent={GRAY}   />
          <StatCard title="Credit Deductions"  value={attStats.creditDeductions} icon={CreditCard}  accent={CYAN}   sub="sessions" />
        </div>
      </div>

      {/* ── Attendance by status bar chart ── */}
      <ChartCard title="Attendance by Status">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={attStatusBarData} barCategoryGap="40%">
            <XAxis
              dataKey="name"
              tick={{ fill: "#8A9AB0", fontSize: 11 }}
              axisLine={{ stroke: CARD_BORDER }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#8A9AB0", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {attStatusBarData.map((entry, idx) => (
                <Cell key={idx} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ── Attendance trend ── */}
      <ChartCard title="Attendance Trend">
        <div className="flex items-center gap-2 mb-4">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAttendancePeriod(opt.value)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all"
              style={
                attendancePeriod === opt.value
                  ? { background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}40` }
                  : { background: "transparent", color: "#8A9AB0", border: "1px solid hsl(203 25% 16%)" }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        {attendanceTrendData.length === 0 ? (
          <p className="text-center text-sm py-8" style={{ color: "#4E6070" }}>No data for this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={attendanceTrendData} barCategoryGap="30%">
              <XAxis
                dataKey="name"
                tick={{ fill: "#8A9AB0", fontSize: 11 }}
                axisLine={{ stroke: CARD_BORDER }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#8A9AB0", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
