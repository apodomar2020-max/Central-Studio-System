import { useState } from "react";
import { useGetDashboard, useGetAnalytics, useGetAttendanceStats, useListPackageOrders } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Ticket,
  CalendarDays,
  Mic2,
  Tag,
  ClipboardList,
  UserSquare2,
  Clock,
  TrendingUp,
  Star,
  Megaphone,
  ScanLine,
  ShoppingBag,
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
  suffix?: string;
};

function StatCard({ title, value, icon: Icon, accent, suffix }: StatCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5 flex flex-col gap-3 transition-all duration-200 hover:border-opacity-60 group"
      style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}
    >
      <div
        className="absolute -top-6 -right-6 h-20 w-20 rounded-full opacity-10 blur-xl transition-opacity group-hover:opacity-20"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "#8A9AB0" }}>{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${accent}18` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tight text-white">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {suffix && <span className="text-sm font-medium" style={{ color: accent }}>{suffix}</span>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" style={{ background: "hsl(203 30% 14%)" }} />
        <Skeleton className="h-8 w-8 rounded-lg" style={{ background: "hsl(203 30% 14%)" }} />
      </div>
      <Skeleton className="h-8 w-16" style={{ background: "hsl(203 30% 14%)" }} />
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}
    >
      <p className="text-sm font-semibold text-white mb-4">{title}</p>
      {children}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  confirmed: "#00B6D7",
  completed: "#22C55E",
  cancelled: "#EF4444",
  accepted: "#22C55E",
  rejected: "#EF4444",
};

const STUDIO_CYAN = "#00B6D7";
const STAGE_PURPLE = "#8A5CFF";
const AMBER = "#F59E0B";
const GREEN = "#22C55E";

const customTooltipStyle = {
  background: "hsl(196 28% 10%)",
  border: "1px solid hsl(203 30% 16%)",
  borderRadius: "8px",
  color: "#fff",
  fontSize: "12px",
};

export default function Dashboard() {
  const [attendancePeriod, setAttendancePeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const { data: dashboard, isLoading } = useGetDashboard();
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalytics();
  const { data: attendanceStats } = useGetAttendanceStats({ period: attendancePeriod });
  const { data: packageOrders = [] } = useListPackageOrders();

  const studioStats: StatCardProps[] = [
    { title: "Total Students", value: dashboard?.totalStudents ?? 0, icon: UserSquare2, accent: STUDIO_CYAN },
    { title: "Active Classes", value: dashboard?.activeClasses ?? 0, icon: CalendarDays, accent: STUDIO_CYAN },
    { title: "Active Instructors", value: dashboard?.activeInstructors ?? 0, icon: Users, accent: STUDIO_CYAN },
    { title: "Total Bookings", value: dashboard?.totalBookings ?? 0, icon: Ticket, accent: STUDIO_CYAN },
    { title: "Pending Bookings", value: dashboard?.pendingBookings ?? 0, icon: Clock, accent: AMBER },
    { title: "Total Offers", value: dashboard?.totalOffers ?? 0, icon: Tag, accent: GREEN },
  ];

  const stageStats: StatCardProps[] = [
    { title: "Active Opportunities", value: dashboard?.activeOpportunities ?? 0, icon: Mic2, accent: STAGE_PURPLE },
    { title: "Pending Applications", value: dashboard?.pendingApplications ?? 0, icon: ClipboardList, accent: STAGE_PURPLE },
    { title: "Active Dancers", value: analytics?.totalDancers ?? 0, icon: Star, accent: STAGE_PURPLE },
    { title: "Total Campaigns", value: analytics?.totalCampaigns ?? 0, icon: Megaphone, accent: STUDIO_CYAN },
  ];

  const bookingChartData = (analytics?.bookingsByStatus ?? []).map((b) => ({
    name: b.status.charAt(0).toUpperCase() + b.status.slice(1),
    value: b.count,
    fill: STATUS_COLORS[b.status] ?? "#8A9AB0",
  }));

  const applicationChartData = (analytics?.applicationsByStatus ?? []).map((a) => ({
    name: a.status.charAt(0).toUpperCase() + a.status.slice(1),
    count: a.count,
    fill: STATUS_COLORS[a.status] ?? "#8A9AB0",
  }));

  const noBookings = !analyticsLoading && bookingChartData.length === 0;
  const noApplications = !analyticsLoading && applicationChartData.length === 0;

  const pendingOrdersCount = (packageOrders as { status: string }[]).filter((o) => o.status === "pendingPayment").length;
  const activeOrdersCount = (packageOrders as { status: string }[]).filter((o) => o.status === "active").length;
  const totalCheckIns = attendanceStats?.total ?? 0;
  const attendanceChartData = (attendanceStats?.data ?? []).map((d) => ({ name: d.label, count: d.count }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Operations Dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: "#8A9AB0" }}>Central Studio & Stage — live overview</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: STUDIO_CYAN }} />
          <span className="text-xs" style={{ color: "#8A9AB0" }}>Live</span>
        </div>
      </div>

      {/* Revenue banner */}
      <div
        className="relative overflow-hidden rounded-xl p-6"
        style={{
          background: "linear-gradient(135deg, #00B6D720 0%, #0E1619 40%, #8A5CFF18 100%)",
          border: "1px solid hsl(203 30% 16%)",
        }}
      >
        <div className="absolute -bottom-8 -right-8 h-32 w-32 rounded-full blur-2xl opacity-20" style={{ background: STUDIO_CYAN }} />
        <div className="absolute -top-8 right-24 h-24 w-24 rounded-full blur-2xl opacity-15" style={{ background: STAGE_PURPLE }} />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${STUDIO_CYAN}20` }}>
            <TrendingUp className="h-5 w-5" style={{ color: STUDIO_CYAN }} />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "#8A9AB0" }}>Total Revenue</p>
            <div className="text-3xl font-bold text-white mt-1">
              {isLoading ? (
                <Skeleton className="h-8 w-32" style={{ background: "hsl(203 30% 16%)" }} />
              ) : (
                <><span style={{ color: STUDIO_CYAN }}>EGP </span>{(dashboard?.totalRevenue ?? 0).toLocaleString()}</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Studio stats */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STUDIO_CYAN }} />
          <h2 className="text-xs font-semibold tracking-widest uppercase" style={{ color: `${STUDIO_CYAN}99` }}>Studio</h2>
        </div>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {studioStats.map((stat) => <StatCard key={stat.title} {...stat} />)}
          </div>
        )}
      </div>

      {/* Stage stats */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_PURPLE }} />
          <h2 className="text-xs font-semibold tracking-widest uppercase" style={{ color: `${STAGE_PURPLE}99` }}>Stage</h2>
        </div>
        {isLoading || analyticsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stageStats.map((stat) => <StatCard key={stat.title} {...stat} />)}
          </div>
        )}
      </div>

      {/* Charts section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#8A9AB0" }} />
          <h2 className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#8A9AB050" }}>Analytics</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">

          {/* Bookings by status — Pie */}
          <ChartCard title="Bookings by Status">
            {analyticsLoading ? (
              <div className="h-52 flex items-center justify-center">
                <Skeleton className="h-40 w-40 rounded-full" style={{ background: "hsl(203 30% 14%)" }} />
              </div>
            ) : noBookings ? (
              <div className="h-52 flex items-center justify-center">
                <p className="text-sm" style={{ color: "#4E6070" }}>No booking data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={bookingChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {bookingChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={customTooltipStyle}
                    formatter={(value: number, name: string) => [value, name]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ color: "#8A9AB0", fontSize: "11px" }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Applications funnel — Bar */}
          <ChartCard title="Applications by Status">
            {analyticsLoading ? (
              <div className="h-52 flex items-end justify-around px-4 gap-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="flex-1 rounded-t-lg" style={{ height: `${(i + 1) * 40}px`, background: "hsl(203 30% 14%)" }} />
                ))}
              </div>
            ) : noApplications ? (
              <div className="h-52 flex items-center justify-center">
                <p className="text-sm" style={{ color: "#4E6070" }}>No application data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={applicationChartData} barSize={36}>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8A9AB0", fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#4E6070", fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={customTooltipStyle}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {applicationChartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Quick org breakdown — Studio Classes per Instructor */}
          <ChartCard title="Studio at a Glance">
            <div className="space-y-3">
              {[
                { label: "Students", value: dashboard?.totalStudents ?? 0, total: Math.max(dashboard?.totalStudents ?? 0, 1), color: STUDIO_CYAN },
                { label: "Active Classes", value: dashboard?.activeClasses ?? 0, total: Math.max(dashboard?.activeClasses ?? 0, 1), color: STUDIO_CYAN },
                { label: "Instructors", value: dashboard?.activeInstructors ?? 0, total: Math.max(dashboard?.activeInstructors ?? 0, 1), color: STUDIO_CYAN },
                { label: "Bookings", value: dashboard?.totalBookings ?? 0, total: Math.max(dashboard?.totalBookings ?? 0, 1), color: AMBER },
                { label: "Pending", value: dashboard?.pendingBookings ?? 0, total: Math.max(dashboard?.totalBookings ?? 1, 1), color: AMBER },
                { label: "Offers", value: dashboard?.totalOffers ?? 0, total: Math.max(dashboard?.totalOffers ?? 0, 1), color: GREEN },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="text-xs w-28 flex-shrink-0" style={{ color: "#8A9AB0" }}>{item.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "hsl(203 30% 12%)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.round((item.value / item.total) * 100)}%`,
                        background: item.color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <span className="text-xs font-semibold w-8 text-right text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          {/* Stage overview */}
          <ChartCard title="Stage at a Glance">
            <div className="space-y-3">
              {[
                { label: "Opportunities", value: dashboard?.activeOpportunities ?? 0, color: STAGE_PURPLE },
                { label: "Applications", value: (analytics?.applicationsByStatus ?? []).reduce((a, b) => a + b.count, 0), color: STAGE_PURPLE },
                { label: "Accepted", value: (analytics?.applicationsByStatus ?? []).find((a) => a.status === "accepted")?.count ?? 0, color: GREEN },
                { label: "Pending", value: dashboard?.pendingApplications ?? 0, color: AMBER },
                { label: "Dancers", value: analytics?.totalDancers ?? 0, color: STAGE_PURPLE },
                { label: "Campaigns", value: analytics?.totalCampaigns ?? 0, color: STUDIO_CYAN },
              ].map((item) => {
                const max = Math.max(
                  (analytics?.applicationsByStatus ?? []).reduce((a, b) => a + b.count, 0),
                  dashboard?.activeOpportunities ?? 0,
                  analytics?.totalDancers ?? 0,
                  1
                );
                return (
                  <div key={item.label} className="flex items-center gap-3">
                    <span className="text-xs w-28 flex-shrink-0" style={{ color: "#8A9AB0" }}>{item.label}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "hsl(203 30% 12%)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.round((item.value / max) * 100)}%`,
                          background: item.color,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span className="text-xs font-semibold w-8 text-right text-white">{item.value}</span>
                  </div>
                );
              })}
            </div>
          </ChartCard>

        </div>
      </div>

      {/* Attendance & Package Orders */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STUDIO_CYAN }} />
          <h2 className="text-xs font-semibold tracking-widest uppercase" style={{ color: `${STUDIO_CYAN}99` }}>Attendance & Packages</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          <StatCard
            title={`Total Check-Ins (${attendancePeriod === "daily" ? "7 days" : attendancePeriod === "monthly" ? "6 months" : "3 years"})`}
            value={totalCheckIns}
            icon={ScanLine}
            accent={STUDIO_CYAN}
          />
          <StatCard title="Pending Package Orders" value={pendingOrdersCount} icon={ShoppingBag} accent={AMBER} />
          <StatCard title="Active Packages" value={activeOrdersCount} icon={ShoppingBag} accent={GREEN} />
        </div>

        {/* Attendance chart with period selector */}
        <div
          className="rounded-xl border p-5"
          style={{ background: "hsl(196 28% 8%)", borderColor: "hsl(203 30% 14%)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white">Attendance Over Time</p>
            <div className="flex gap-1">
              {(["daily", "monthly", "yearly"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setAttendancePeriod(p)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all"
                  style={
                    attendancePeriod === p
                      ? { background: STUDIO_CYAN, color: "#000" }
                      : { background: "hsl(203 30% 14%)", color: "#8A9AB0" }
                  }
                >
                  {p === "daily" ? "7 Days" : p === "monthly" ? "6 Mo" : "3 Yr"}
                </button>
              ))}
            </div>
          </div>
          {attendanceChartData.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm" style={{ color: "#4E6070" }}>No attendance data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={attendanceChartData} barSize={32}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#4E6070", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#4E6070", fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={customTooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill={STUDIO_CYAN} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

    </div>
  );
}
