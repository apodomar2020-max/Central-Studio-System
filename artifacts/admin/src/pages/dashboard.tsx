import { useState, type CSSProperties, type PointerEvent } from "react";
import {
  useGetDashboard,
  useGetAnalytics,
  useGetAttendanceStats,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminTheme } from "@/contexts/AdminThemeContext";
import {
  Users,
  Ticket,
  CalendarDays,
  UserSquare2,
  Clock,
  ScanLine,
  ShoppingBag,
  CheckCircle2,
  XCircle,
  PackageCheck,
  UserRound,
  CalendarClock,
  AlertTriangle,
  RotateCcw,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
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

type InteractiveStyle = CSSProperties & {
  "--pointer-x"?: string;
  "--pointer-y"?: string;
  "--card-accent"?: string;
};

const CYAN = "#00B6D7";
const PURPLE = "#8A5CFF";
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

function updateCardLight(event: PointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
  event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
}

function StatCard({ title, value, icon: Icon, accent, note }: StatCardProps) {
  return (
    <article
      className="premium-card group relative min-h-36 overflow-hidden rounded-lg border p-5"
      style={{ "--card-accent": accent } as InteractiveStyle}
      onPointerMove={updateCardLight}
    >
      <div className="relative z-10 flex h-full flex-col justify-between gap-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-300 group-hover:scale-105"
            style={{ background: `${accent}12`, borderColor: `${accent}28` }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: accent }} />
          </div>
        </div>
        <div>
          <p className="text-3xl font-semibold text-foreground">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {note && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>}
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="premium-card min-h-36 rounded-lg border p-5">
      <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-9 w-9 rounded-lg" /></div>
      <Skeleton className="mt-10 h-8 w-20" />
    </div>
  );
}

function ChartCard({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <article className="premium-panel rounded-lg border p-6 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="mb-6">
        <p className="text-[10px] font-semibold uppercase text-primary">{eyebrow}</p>
        <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </article>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_12px_#00B6D7]" />
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
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
  const { theme } = useAdminTheme();
  const [attendancePeriod, setAttendancePeriod] = useState<"daily" | "monthly" | "yearly">("monthly");

  const dashboardQuery = useGetDashboard();
  const analyticsQuery = useGetAnalytics();
  const attendanceQuery = useGetAttendanceStats({ period: attendancePeriod });

  const dashboard = dashboardQuery.data;
  const analytics = analyticsQuery.data;
  const attendanceStats = attendanceQuery.data;
  const isLoading = dashboardQuery.isLoading;

  // Theme toggle + refresh moved to the global TopBar (Phase 1).
  // "Last refreshed" now tracks the query cache, so the TopBar refresh
  // (refetchQueries type:"active") keeps this label accurate too.
  const lastRefreshed = new Date(dashboardQuery.dataUpdatedAt || Date.now());

  const bookingChartData = (analytics?.bookingsByStatus ?? []).map((item) => ({
    name: item.status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    value: item.count,
    fill: STATUS_COLORS[item.status] ?? MUTED,
  }));
  const attendanceChartData = (attendanceStats?.data ?? []).map((item) => ({
    name: item.label,
    count: item.count,
  }));

  const studioOverview: StatCardProps[] = [
    { title: "Total Users", value: dashboard?.totalUsers ?? 0, icon: Users, accent: CYAN },
    { title: "Students", value: dashboard?.totalStudents ?? 0, icon: UserSquare2, accent: PURPLE },
    { title: "Parents", value: dashboard?.totalParents ?? 0, icon: UserRound, accent: AMBER },
    { title: "Active Classes", value: dashboard?.activeClasses ?? 0, icon: CalendarDays, accent: GREEN },
    { title: "Active Instructors", value: dashboard?.activeInstructors ?? 0, icon: Users, accent: CYAN },
  ];

  const bookingMetrics: StatCardProps[] = [
    { title: "Total Bookings", value: dashboard?.totalBookings ?? 0, icon: Ticket, accent: CYAN },
    { title: "Confirmed", value: dashboard?.confirmedBookings ?? 0, icon: CheckCircle2, accent: GREEN },
    { title: "Completed / Attended", value: dashboard?.completedBookings ?? 0, icon: ScanLine, accent: PURPLE },
    { title: "Cancelled", value: dashboard?.cancelledBookings ?? 0, icon: XCircle, accent: RED },
    { title: "Pending Payments", value: dashboard?.pendingPayments ?? 0, icon: Clock, accent: AMBER },
    { title: "Refunded", value: dashboard?.refundedBookings ?? 0, icon: RotateCcw, accent: CYAN },
  ];

  const operationsMetrics: StatCardProps[] = [
    { title: "Total Check-ins", value: dashboard?.totalCheckIns ?? 0, icon: ScanLine, accent: CYAN },
    { title: "Upcoming Classes", value: dashboard?.upcomingClasses ?? 0, icon: CalendarClock, accent: PURPLE, note: "Next 7 Cairo days" },
    { title: "Active Packages", value: dashboard?.activePackages ?? 0, icon: PackageCheck, accent: GREEN },
    { title: "Pending Package Orders", value: dashboard?.pendingPackageOrders ?? 0, icon: ShoppingBag, accent: AMBER },
    { title: "Missed Attendance", value: dashboard?.missedAttendance ?? 0, icon: AlertTriangle, accent: RED },
  ];

  const balletLifecycleMetrics: StatCardProps[] = [
    { title: "Pending Cancellation Requests", value: dashboard?.pendingCancellationRequests ?? 0, icon: AlertTriangle, accent: AMBER },
    { title: "Active Ballet Enrollments", value: dashboard?.activeBalletEnrollments ?? 0, icon: CheckCircle2, accent: GREEN },
    { title: "Withdrawn Ballet Enrollments", value: dashboard?.withdrawnBalletEnrollments ?? 0, icon: XCircle, accent: MUTED },
    { title: "Refunds Under Review", value: dashboard?.refundsUnderReview ?? 0, icon: FileText, accent: PURPLE },
    { title: "Completed Full Refunds", value: dashboard?.completedFullRefunds ?? 0, icon: RotateCcw, accent: RED },
    { title: "Completed Partial Refunds", value: dashboard?.completedPartialRefunds ?? 0, icon: RotateCcw, accent: CYAN },
  ];

  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--popover-border))",
    borderRadius: "8px",
    color: "hsl(var(--popover-foreground))",
    boxShadow: "0 16px 40px rgba(0,0,0,.16)",
    fontSize: "12px",
  };
  const chartText = theme === "night" ? "#64748B" : MUTED;
  const chartGrid = theme === "night" ? "#E2E8F0" : "rgba(138,154,176,.12)";

  return (
    <div className="dashboard-canvas space-y-8 pb-12 sm:space-y-12">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">Operations Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Central Studio live operational overview</p>
          <p key={lastRefreshed.getTime()} className="refresh-time mt-1.5 text-xs text-muted-foreground">
            Last refreshed {formatRefreshTime(lastRefreshed)} Cairo
          </p>
        </div>
      </header>

      <section className="space-y-5">
        <SectionHeader title="Live Today" description="Cairo-day operational activity." />
        <div className="grid gap-4 sm:grid-cols-3">
            {isLoading ? [...Array(3)].map((_, index) => <SkeletonCard key={index} />) : [
              { title: "Today's Bookings", value: dashboard?.todayBookings ?? 0, icon: Ticket, accent: CYAN },
              { title: "Today's Classes", value: dashboard?.todayClasses ?? 0, icon: CalendarDays, accent: AMBER },
              { title: "Today's Check-ins", value: dashboard?.todayCheckIns ?? 0, icon: ScanLine, accent: GREEN },
            ].map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader title="Ballet Cancellation & Refunds" description="Enrollment lifecycle and refund-ledger workflow indicators." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {isLoading ? [...Array(6)].map((_, index) => <SkeletonCard key={index} />) : balletLifecycleMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader title="Studio Overview" description="The people and programming keeping the studio moving." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {isLoading ? [...Array(5)].map((_, index) => <SkeletonCard key={index} />) : studioOverview.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader title="Booking Performance" description="Live lifecycle and payment workload, separate from date-ranged reporting." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {isLoading ? [...Array(6)].map((_, index) => <SkeletonCard key={index} />) : bookingMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader title="Operational Pulse" description="Booking mix and attendance movement at a glance." />
        <div className="grid gap-6 xl:grid-cols-[.85fr_1.45fr]">
          <ChartCard title="Bookings by Status" eyebrow="Lifecycle">
            {analyticsQuery.isLoading ? (
              <div className="flex h-72 items-center justify-center"><Skeleton className="h-48 w-48 rounded-full" /></div>
            ) : bookingChartData.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">No booking data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={bookingChartData} cx="50%" cy="45%" innerRadius={65} outerRadius={98} paddingAngle={4} dataKey="value" stroke="none">
                    {bookingChartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value) => <span style={{ color: chartText, fontSize: 11 }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Attendance Over Time" eyebrow="Attendance">
            <div className="mb-5 flex flex-wrap justify-end gap-1 rounded-lg">
              {(["daily", "monthly", "yearly"] as const).map((period) => (
                <button
                  key={period}
                  onClick={() => setAttendancePeriod(period)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${attendancePeriod === period ? "bg-primary text-primary-foreground shadow-[0_0_16px_rgba(0,182,215,.2)]" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                >
                  {period === "daily" ? "7 Days" : period === "monthly" ? "6 Months" : "3 Years"}
                </button>
              ))}
            </div>
            {attendanceChartData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No attendance data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={attendanceChartData} barSize={34} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={chartGrid} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: chartText, fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: chartText, fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: theme === "night" ? "rgba(15,23,42,.04)" : "rgba(255,255,255,.03)" }} />
                  <Bar dataKey="count" radius={[7, 7, 2, 2]} fill={CYAN} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader title="Attendance & Packages" description="Current capacity, package activity, and operational exceptions." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {isLoading ? [...Array(5)].map((_, index) => <SkeletonCard key={index} />) : operationsMetrics.map((metric) => <StatCard key={metric.title} {...metric} />)}
        </div>
      </section>

      {(dashboardQuery.isError || analyticsQuery.isError || attendanceQuery.isError) && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          Some dashboard data could not be refreshed. Existing values remain visible.
        </div>
      )}

      <div className="flex justify-end text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-3.5 w-3.5 text-primary" /> Live Studio data</span>
      </div>
    </div>
  );
}
