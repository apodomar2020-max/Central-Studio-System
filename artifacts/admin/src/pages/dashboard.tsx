import { useState } from "react";
import {
  useGetDashboard,
  useGetAnalytics,
  useGetAttendanceStats,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import {
  Users,
  Ticket,
  CalendarDays,
  UserSquare2,
  Clock,
  TrendingUp,
  ScanLine,
  ShoppingBag,
  RefreshCw,
  Moon,
  Sun,
  CheckCircle2,
  XCircle,
  CircleDollarSign,
  PackageCheck,
  UserRound,
  CalendarClock,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type StatCardProps = {
  title: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
  note?: string;
};

const CYAN = "#00B6D7";
const GREEN = "#22C55E";
const AMBER = "#F59E0B";
const RED = "#EF4444";
const MUTED = "#8A9AB0";

const STATUS_COLORS: Record<string, string> = {
  pending: AMBER,
  confirmed: CYAN,
  attended: GREEN,
  completed: GREEN,
  cancelled: RED,
  rejected: RED,
  noShow: "#F97316",
  no_show: "#F97316",
};

const customTooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--popover-border))",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
};

function StatCard({ title, value, icon: Icon, accent, note }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${accent}18` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{typeof value === "number" ? value.toLocaleString() : value}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-8" /></div>
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="mb-4 text-sm font-semibold text-white">{title}</p>
      {children}
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function formatRefreshTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function Dashboard() {
  const { theme, toggleTheme } = useAdminTheme();
  const [attendancePeriod, setAttendancePeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());

  const dashboardQuery = useGetDashboard();
  const analyticsQuery = useGetAnalytics();
  const attendanceQuery = useGetAttendanceStats({ period: attendancePeriod });

  const dashboard = dashboardQuery.data;
  const analytics = analyticsQuery.data;
  const attendanceStats = attendanceQuery.data;
  const isLoading = dashboardQuery.isLoading;

  async function refreshDashboard() {
    setIsRefreshing(true);
    try {
      await Promise.all([
        dashboardQuery.refetch(),
        analyticsQuery.refetch(),
        attendanceQuery.refetch(),
      ]);
      setLastRefreshed(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }

  const bookingChartData = (analytics?.bookingsByStatus ?? []).map((item) => ({
    name: item.status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    value: item.count,
    fill: STATUS_COLORS[item.status] ?? MUTED,
  }));
  const attendanceChartData = (attendanceStats?.data ?? []).map((item) => ({
    name: item.label,
    count: item.count,
  }));

  const topMetrics: StatCardProps[] = [
    {
      title: "Total Revenue",
      value: dashboard?.revenueTrackingComplete ? `EGP ${(dashboard.totalRevenue ?? 0).toLocaleString()}` : "Not configured",
      icon: CircleDollarSign,
      accent: GREEN,
      note: dashboard?.revenueTrackingComplete ? "Paid classes + activated packages" : "Revenue tracking not fully configured",
    },
    { title: "Today's Bookings", value: dashboard?.todayBookings ?? 0, icon: Ticket, accent: CYAN },
    { title: "Today's Classes", value: dashboard?.todayClasses ?? 0, icon: CalendarDays, accent: AMBER },
    { title: "Today's Check-ins", value: dashboard?.todayCheckIns ?? 0, icon: ScanLine, accent: GREEN },
  ];

  const studioOverview: StatCardProps[] = [
    { title: "Total Users", value: dashboard?.totalUsers ?? 0, icon: Users, accent: CYAN },
    { title: "Students", value: dashboard?.totalStudents ?? 0, icon: UserSquare2, accent: CYAN },
    { title: "Parents", value: dashboard?.totalParents ?? 0, icon: UserRound, accent: AMBER },
    { title: "Active Classes", value: dashboard?.activeClasses ?? 0, icon: CalendarDays, accent: GREEN },
    { title: "Active Instructors", value: dashboard?.activeInstructors ?? 0, icon: Users, accent: GREEN },
  ];

  const bookingMetrics: StatCardProps[] = [
    { title: "Total Bookings", value: dashboard?.totalBookings ?? 0, icon: Ticket, accent: CYAN },
    { title: "Confirmed", value: dashboard?.confirmedBookings ?? 0, icon: CheckCircle2, accent: GREEN },
    { title: "Completed / Attended", value: dashboard?.completedBookings ?? 0, icon: ScanLine, accent: GREEN },
    { title: "Cancelled", value: dashboard?.cancelledBookings ?? 0, icon: XCircle, accent: RED },
    { title: "Pending Payments", value: dashboard?.pendingPayments ?? 0, icon: Clock, accent: AMBER },
    { title: "Refunded", value: dashboard?.refundedBookings ?? 0, icon: RotateCcw, accent: CYAN },
  ];

  const operationsMetrics: StatCardProps[] = [
    { title: "Total Check-ins", value: dashboard?.totalCheckIns ?? 0, icon: ScanLine, accent: CYAN },
    { title: "Upcoming Classes", value: dashboard?.upcomingClasses ?? 0, icon: CalendarClock, accent: AMBER, note: "Next 7 Cairo days" },
    { title: "Active Packages", value: dashboard?.activePackages ?? 0, icon: PackageCheck, accent: GREEN },
    { title: "Pending Package Orders", value: dashboard?.pendingPackageOrders ?? 0, icon: ShoppingBag, accent: AMBER },
    { title: "Missed Attendance", value: dashboard?.missedAttendance ?? 0, icon: AlertTriangle, accent: RED },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Operations Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: GREEN }} />
              Live
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Central Studio live operational overview</p>
          <p className="mt-1 text-xs text-muted-foreground">Last refreshed {formatRefreshTime(lastRefreshed)} Cairo</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleTheme} className="gap-2" title={`Switch to ${theme === "dark" ? "Night" : "Dark"} mode`}>
            {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {theme === "dark" ? "Night" : "Dark"}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshDashboard} disabled={isRefreshing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </header>

      <section className="space-y-4">
        <SectionHeader title="Live Today" description="Current Cairo-day activity and recorded operational revenue." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading ? [...Array(4)].map((_, index) => <SkeletonCard key={index} />) : topMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Studio Overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {isLoading ? [...Array(5)].map((_, index) => <SkeletonCard key={index} />) : studioOverview.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Booking Performance" description="Live lifecycle and payment workload, without date-ranged report analysis." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading ? [...Array(6)].map((_, index) => <SkeletonCard key={index} />) : bookingMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
        <ChartCard title="Bookings by Status">
          {analyticsQuery.isLoading ? (
            <div className="flex h-56 items-center justify-center"><Skeleton className="h-40 w-40 rounded-full" /></div>
          ) : bookingChartData.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No booking data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={bookingChartData} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={3} dataKey="value">
                  {bookingChartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Pie>
                <Tooltip contentStyle={customTooltipStyle} />
                <Legend iconType="circle" iconSize={8} formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      <section className="space-y-4">
        <SectionHeader title="Attendance & Packages" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {isLoading ? [...Array(5)].map((_, index) => <SkeletonCard key={index} />) : operationsMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
        <ChartCard title="Attendance Over Time">
          <div className="mb-4 flex justify-end gap-1">
            {(["daily", "monthly", "yearly"] as const).map((period) => (
              <button
                key={period}
                onClick={() => setAttendancePeriod(period)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={attendancePeriod === period ? { background: CYAN, color: "#001014" } : { background: "hsl(var(--secondary))", color: MUTED }}
              >
                {period === "daily" ? "7 Days" : period === "monthly" ? "6 Months" : "3 Years"}
              </button>
            ))}
          </div>
          {attendanceChartData.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No attendance data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={attendanceChartData} barSize={32}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: MUTED, fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: MUTED, fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="count" radius={[5, 5, 0, 0]} fill={CYAN} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      {(dashboardQuery.isError || analyticsQuery.isError || attendanceQuery.isError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          Some dashboard data could not be refreshed. Existing values remain visible.
        </div>
      )}
    </div>
  );
}
