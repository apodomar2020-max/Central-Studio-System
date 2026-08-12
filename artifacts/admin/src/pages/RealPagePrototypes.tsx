import { useMemo, useState, type ElementType } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  Ticket,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DASHBOARD_KPIS = [
  { label: "Today's bookings", value: "128", note: "+14 since 12:00", icon: Ticket, tone: "cyan" },
  { label: "Today's classes", value: "24", note: "9 currently active", icon: CalendarDays, tone: "amber" },
  { label: "Today's check-ins", value: "96", note: "74% of bookings", icon: ScanLine, tone: "green" },
];

const STUDIO_METRICS = [
  ["Total users", "1,248"], ["Students", "842"], ["Parents", "611"], ["Active classes", "46"], ["Active instructors", "32"],
];

const BOOKING_METRICS = [
  ["Total bookings", "8,462", "cyan"], ["Confirmed", "6,814", "green"], ["Completed / attended", "5,992", "green"],
  ["Cancelled", "428", "red"], ["Pending payments", "186", "amber"], ["Refunded", "74", "muted"],
];

const OPERATIONS_METRICS = [
  ["Total check-ins", "6,274"], ["Upcoming classes", "86"], ["Active packages", "734"],
  ["Pending package orders", "29"], ["Missed attendance", "41"],
];

const BALLET_METRICS = [
  ["Pending cancellations", "12", "amber"], ["Active enrollments", "318", "green"], ["Withdrawn", "27", "muted"],
  ["Refunds under review", "8", "amber"], ["Full refunds", "19", "red"], ["Partial refunds", "14", "cyan"],
];

const ATTENDANCE_ROWS = [
  { payer: "Salma Hassan", email: "salma@central.test", participant: "Layla Hassan", relation: "Child", className: "Ballet Foundation", source: "Booking", settlement: "package credit", status: "Checked in", time: "14:32" },
  { payer: "Nour Ahmed", email: "nour@central.test", participant: "Nour Ahmed", relation: "Myself", className: "Contemporary Flow", source: "Walk-in", settlement: "pay at studio", status: "Late", time: "14:18" },
  { payer: "Mariam Fathy", email: "mariam@central.test", participant: "Omar Fathy", relation: "Child", className: "Hip-Hop Juniors", source: "Booking", settlement: "package credit", status: "Checked in", time: "14:06" },
  { payer: "Karim Adel", email: "karim@central.test", participant: "Karim Adel", relation: "Myself", className: "Jazz Beginners", source: "Booking", settlement: "single class", status: "Absent", time: "13:52" },
  { payer: "Dina Samir", email: "dina@central.test", participant: "Youssef Samir", relation: "Child", className: "Ballet Foundation", source: "Walk-in", settlement: "pay at studio", status: "Checked in", time: "13:41" },
];

function TinyIcon({ icon: Icon }: { icon: ElementType }) {
  return <span className="rpp-tiny-icon"><Icon size={14} /></span>;
}

function DashboardKpi({ item }: { item: (typeof DASHBOARD_KPIS)[number] }) {
  return <article className={cn("rpp-hero-kpi", `tone-${item.tone}`)}>
    <div><span>{item.label}</span><TinyIcon icon={item.icon} /></div>
    <strong>{item.value}</strong>
    <small>{item.note}</small>
  </article>;
}

function SectionHeading({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return <header className="rpp-section-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div>{meta && <small>{meta}</small>}</header>;
}

export function DashboardRealPrototype() {
  const [attendancePeriod, setAttendancePeriod] = useState("6 months");
  const attendanceBars = attendancePeriod === "7 days" ? [36, 52, 45, 74, 62, 88, 79] : attendancePeriod === "3 years" ? [48, 69, 91] : [42, 58, 51, 72, 66, 86];
  return <div className="rpp-dashboard" aria-label="Operations Dashboard prototype">
    <section className="rpp-live-band">
      <div className="rpp-live-copy"><span><i /> Live today</span><p>Cairo operational activity</p><small>Last refreshed 14:42:18 Cairo</small></div>
      <div className="rpp-hero-kpis">{DASHBOARD_KPIS.map((item) => <DashboardKpi key={item.label} item={item} />)}</div>
    </section>

    <section className="rpp-dashboard-grid">
      <article className="rpp-panel rpp-studio-overview">
        <SectionHeading eyebrow="Studio overview" title="People & programming" meta="Live totals" />
        <div className="rpp-number-grid">{STUDIO_METRICS.map(([label, value], index) => <div key={label} className={index === 0 ? "is-featured" : ""}><span>{label}</span><strong>{value}</strong><small>{index === 0 ? "Across all accounts" : "Active records"}</small></div>)}</div>
      </article>

      <article className="rpp-panel rpp-booking-panel">
        <SectionHeading eyebrow="Booking performance" title="Lifecycle workload" meta="All-time operational view" />
        <div className="rpp-booking-content"><div className="rpp-donut" aria-label="Booking status mix"><div><strong>8.4k</strong><span>bookings</span></div></div><div className="rpp-status-metrics">{BOOKING_METRICS.map(([label, value, tone]) => <div key={label}><i className={`is-${tone}`} /><span>{label}</span><strong>{value}</strong></div>)}</div></div>
      </article>

      <article className="rpp-panel rpp-attendance-chart">
        <SectionHeading eyebrow="Operational pulse" title="Attendance over time" meta="Check-ins by period" />
        <div className="rpp-period-tabs" role="tablist" aria-label="Attendance period">{["7 days", "6 months", "3 years"].map((period) => <button key={period} type="button" role="tab" aria-selected={attendancePeriod === period} onClick={() => setAttendancePeriod(period)}>{period}</button>)}</div>
        <div className="rpp-bar-chart" aria-label={`${attendancePeriod} attendance chart`}>{attendanceBars.map((height, index) => <div key={`${attendancePeriod}-${index}`}><i style={{ height: `${height}%` }} /><span>{attendancePeriod === "7 days" ? ["W", "T", "F", "S", "S", "M", "T"][index] : attendancePeriod === "3 years" ? ["24", "25", "26"][index] : ["Mar", "Apr", "May", "Jun", "Jul", "Aug"][index]}</span></div>)}</div>
      </article>

      <article className="rpp-panel rpp-operations-panel">
        <SectionHeading eyebrow="Attendance & packages" title="Operational readiness" meta="Current workload" />
        <div className="rpp-readiness"><strong>92.6%</strong><span>Operational readiness</span><div><i /></div><small>Across active classes and packages</small></div>
        <div className="rpp-compact-list">{OPERATIONS_METRICS.map(([label, value], index) => <div key={label}><span>{label}</span><strong className={index === 4 ? "is-alert" : ""}>{value}</strong></div>)}</div>
      </article>
    </section>

    <section className="rpp-panel rpp-ballet-strip">
      <SectionHeading eyebrow="Ballet cancellation & refunds" title="Enrollment lifecycle indicators" meta="Review workflow" />
      <div>{BALLET_METRICS.map(([label, value, tone]) => <article key={label}><i className={`is-${tone}`} /><span>{label}</span><strong>{value}</strong></article>)}</div>
    </section>

    <section className="rpp-panel rpp-activity-strip">
      <SectionHeading eyebrow="Recent activity" title="Live studio operations" meta="Today" />
      <div>{[
        ["14:42", "Ballet Foundation check-in completed", "Attendance"], ["14:36", "Package order #PO-2048 confirmed", "Packages"],
        ["14:28", "Class capacity warning reviewed", "Schedules"], ["14:18", "Walk-in payment recorded", "Finance"],
      ].map(([time, event, source]) => <article key={time}><time>{time}</time><span><strong>{event}</strong><small>{source}</small></span><ArrowUpRight size={14} /></article>)}</div>
    </section>
  </div>;
}

function AttendanceStatus({ status }: { status: string }) {
  const icon = status === "Checked in" ? CheckCircle2 : status === "Late" ? Clock3 : XCircle;
  const Icon = icon;
  return <span className={cn("rpp-attendance-status", `is-${status.toLowerCase().replace(" ", "-")}`)}><Icon size={12} />{status}</span>;
}

export function AttendanceRealPrototype() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedRow, setSelectedRow] = useState(0);
  const [selectedSession, setSelectedSession] = useState("Ballet Foundation");
  const [checkInMode, setCheckInMode] = useState("Checked in");
  const visibleRows = useMemo(() => statusFilter === "All" ? ATTENDANCE_ROWS : ATTENDANCE_ROWS.filter((row) => row.status === statusFilter), [statusFilter]);
  return <div className="rpp-attendance" aria-label="Attendance and Check-In prototype">
    <section className="rpp-session-band">
      <div><span>Live attendance session</span><h2>Tuesday, 12 August</h2><small>New Cairo · Cairo time 14:42</small></div>
      <label><span>Class / session</span><select aria-label="Class or session" value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}><option>Ballet Foundation</option><option>Contemporary Flow</option><option>Hip-Hop Juniors</option></select></label>
      <div className="rpp-session-counts"><div><strong>18</strong><span>Booked</span></div><div><strong>14</strong><span>Checked in</span></div><div><strong>2</strong><span>Late</span></div><div><strong>2</strong><span>Remaining</span></div></div>
    </section>

    <div className="rpp-attendance-layout">
      <aside className="rpp-checkin-stack">
        <section className="rpp-panel rpp-checkin-card">
          <SectionHeading eyebrow="Student check-in" title="Find a participant" meta="Manual entry" />
          <label className="rpp-search-field"><Search size={15} /><input aria-label="Find student" placeholder="Email, parent phone, or child name" /></label>
          <button className="rpp-scan-button" type="button"><QrCode size={17} /> Scan QR code</button>
          <div className="rpp-or"><span>or continue manually</span></div>
          <div className="rpp-student-result"><i>LH</i><span><strong>Layla Hassan</strong><small>Salma Hassan · Ballet Foundation</small></span><Check size={14} /></div>
          <div className="rpp-checkin-options" role="group" aria-label="Attendance status">{["Checked in", "Late", "Absent"].map((status) => <button key={status} type="button" aria-pressed={checkInMode === status} onClick={() => setCheckInMode(status)}>{status === "Checked in" ? <CheckCircle2 /> : status === "Late" ? <Clock3 /> : <XCircle />}{status}</button>)}</div>
          <div className="rpp-package-choice"><CreditCard size={15} /><span><strong>Foundation 12-class pack</strong><small>7 credits remaining</small></span><span className="rpp-radio is-selected" /></div>
          <button className="rpp-confirm-button" type="button"><Check size={15} /> Record {checkInMode}</button>
        </section>

        <section className="rpp-panel rpp-overview-card">
          <SectionHeading eyebrow="Attendance overview" title="Last 7 days" meta="126 check-ins" />
          <div className="rpp-mini-bars">{[42, 58, 48, 76, 69, 91, 82].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
          <div className="rpp-overview-metrics"><span><strong>126</strong>Total check-ins</span><span><strong>842</strong>Total logged</span><span><strong>31</strong>Peak activity</span></div>
        </section>
      </aside>

      <section className="rpp-panel rpp-roster-panel">
        <header className="rpp-roster-head"><div><span>Attendance log</span><h2>{selectedSession}</h2><small>Recent check-ins and attendance exceptions</small></div><div className="rpp-filter-tabs" role="tablist" aria-label="Attendance status filter">{["All", "Checked in", "Late", "Absent"].map((status) => <button key={status} type="button" role="tab" aria-selected={statusFilter === status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div></header>
        <div className="rpp-roster-table" role="table" aria-label="Recent check-ins">
          <div className="rpp-roster-row rpp-roster-labels" role="row"><span>Payer / participant</span><span>Class</span><span>Source</span><span>Status</span><span>Time</span></div>
          {visibleRows.map((row) => { const rowIndex = ATTENDANCE_ROWS.indexOf(row); return <button type="button" role="row" aria-selected={selectedRow === rowIndex} className={cn("rpp-roster-row", selectedRow === rowIndex && "is-selected")} key={row.email} onClick={() => setSelectedRow(rowIndex)}>
            <span><i>{row.participant.split(" ").map((part) => part[0]).join("")}</i><span><strong>{row.participant}</strong><small>{row.payer} · {row.relation}</small></span></span><span>{row.className}</span><span><strong>{row.source}</strong><small>{row.settlement}</small></span><span><AttendanceStatus status={row.status} /></span><time>{row.time}</time>
          </button>; })}
        </div>
        <footer className="rpp-roster-footer"><span>Showing {visibleRows.length} of 842 check-ins</span><div><button type="button" aria-label="Previous attendance page">‹</button><button type="button" aria-current="page">1</button><button type="button" aria-label="Next attendance page">›</button></div></footer>
        <aside className="rpp-selected-attendee"><div><span>Selected participant</span><strong>{ATTENDANCE_ROWS[selectedRow].participant}</strong><small>{ATTENDANCE_ROWS[selectedRow].email}</small></div><div><span>Today’s class</span><strong>{ATTENDANCE_ROWS[selectedRow].className}</strong><small>{ATTENDANCE_ROWS[selectedRow].source} · {ATTENDANCE_ROWS[selectedRow].settlement}</small></div><AttendanceStatus status={ATTENDANCE_ROWS[selectedRow].status} /><button type="button">Open attendance record <ArrowUpRight size={13} /></button></aside>
      </section>
    </div>
  </div>;
}
