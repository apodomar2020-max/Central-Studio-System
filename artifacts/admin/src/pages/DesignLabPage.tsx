import { useMemo, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  Filter,
  LayoutDashboard,
  ListFilter,
  Loader2,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  WalletCards,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./design-lab.css";

type LabTheme = "dark" | "light";
type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const SECTION_LINKS = [
  ["foundations", "Foundations"],
  ["shell", "Mock shell"],
  ["components", "Components"],
  ["table", "Data table"],
  ["workspace", "Master/detail"],
  ["analytics", "Analytics"],
  ["overlays", "Overlays"],
  ["feedback", "Feedback"],
] as const;

const SWATCHES = [
  ["Canvas deepest", "var(--a2-canvas-deepest)", "#03070A"],
  ["Canvas base", "var(--a2-canvas-base)", "#071014"],
  ["Canvas elevated", "var(--a2-canvas-elevated)", "#0B161B"],
  ["Surface 1", "var(--a2-surface-1)", "#0D191E"],
  ["Surface 2", "var(--a2-surface-2)", "#122128"],
  ["Raised", "var(--a2-raised)", "#1C3039"],
  ["Cyan primary", "var(--a2-cyan)", "#00B6D7"],
  ["Cyan soft", "var(--a2-cyan-soft)", "12% cyan"],
  ["Success", "var(--a2-success)", "Semantic"],
  ["Warning", "var(--a2-warning)", "Semantic"],
  ["Danger", "var(--a2-danger)", "Semantic"],
  ["Light workspace", "var(--a2-workspace)", "Cool paper"],
] as const;

const TYPOGRAPHY_ROLES = [
  ["Display", "Performance Control Surface", "40px / Anton", "40px", "400"],
  ["Page title", "Bookings Operations", "32px / Archivo fallback", "32px", "720"],
  ["Section title", "Today’s operating rhythm", "24px / Archivo fallback", "24px", "700"],
  ["Panel title", "Active booking details", "16px / Archivo fallback", "16px", "680"],
  ["KPI value large", "1,248", "32px / Archivo fallback", "32px", "760"],
  ["KPI value compact", "94.2%", "22px / Archivo fallback", "22px", "740"],
  ["Body", "Operational context with calm, readable density.", "14px", "14px", "500"],
  ["Small body", "Secondary context and concise guidance.", "12px", "12px", "500"],
  ["Label", "PARTICIPANT", "11px uppercase", "11px", "700"],
  ["Metadata", "Last synchronized 2 minutes ago", "11px", "11px", "500"],
  ["Timestamp mono", "11 AUG 2026 · 14:32", "Space Mono fallback", "11px", "500"],
  ["Table header", "LAST ACTIVITY", "10px uppercase", "10px", "760"],
] as const;

const NAV_ITEMS: Array<[string, ElementType]> = [
  ["Overview", LayoutDashboard],
  ["Attendance", ScanLine],
  ["Schedule", CalendarDays],
  ["Bookings", WalletCards],
  ["Students", Users],
  ["Marketing", MessageSquareText],
  ["Finance", CircleDollarSign],
  ["System", ShieldCheck],
];

const STUDENTS = [
  { id: 1, initials: "LH", name: "Layla Hassan", email: "layla.h@example.com", classes: "Ballet Foundation", package: "12 Class Pass", status: "Active", activity: "11 AUG · 14:32" },
  { id: 2, initials: "NA", name: "Nour Ahmed", email: "nour.a@example.com", classes: "Contemporary", package: "Drop-in", status: "Pending", activity: "11 AUG · 13:08" },
  { id: 3, initials: "AK", name: "Adam Karim", email: "adam.k@example.com", classes: "Hip-Hop Juniors", package: "8 Class Pass", status: "Active", activity: "10 AUG · 19:41" },
  { id: 4, initials: "LM", name: "Lina Mostafa", email: "lina.m@example.com", classes: "Ballet Level 2", package: "Monthly Ballet", status: "Review", activity: "10 AUG · 17:16" },
  { id: 5, initials: "YS", name: "Youssef Samir", email: "youssef.s@example.com", classes: "Jazz Beginners", package: "Expired", status: "Inactive", activity: "09 AUG · 10:22" },
] as const;

const BOOKINGS = [
  { id: 1, initials: "LH", name: "Layla Hassan", className: "Ballet Foundation", time: "Today · 17:00", status: "Confirmed", payment: "Paid", instructor: "Mariam Adel", branch: "Maadi · Studio A" },
  { id: 2, initials: "NA", name: "Nour Ahmed", className: "Contemporary Flow", time: "Today · 18:30", status: "Pending", payment: "Cash due", instructor: "Omar Nasser", branch: "New Cairo · Room 2" },
  { id: 3, initials: "AK", name: "Adam Karim", className: "Hip-Hop Juniors", time: "Tomorrow · 16:00", status: "Waitlist", payment: "Credit held", instructor: "Tarek Ali", branch: "Maadi · Studio B" },
  { id: 4, initials: "LM", name: "Lina Mostafa", className: "Ballet Level 2", time: "Tomorrow · 19:00", status: "Confirmed", payment: "Paid", instructor: "Mariam Adel", branch: "New Cairo · Studio 1" },
] as const;

const CHART_DATA = [
  { label: "Sun", bookings: 68 },
  { label: "Mon", bookings: 92 },
  { label: "Tue", bookings: 84 },
  { label: "Wed", bookings: 118 },
  { label: "Thu", bookings: 104 },
  { label: "Fri", bookings: 132 },
  { label: "Sat", bookings: 126 },
] as const;

function Section({ id, eyebrow, title, description, children }: { id: string; eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="a2-section">
      <div className="a2-section-head">
        <div><div className="a2-eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function LabButton({ tone = "default", compact = false, iconOnly = false, className, children, ...props }: React.ComponentProps<typeof Button> & { tone?: "default" | "primary" | "secondary" | "ghost" | "danger" | "selected" | "dangerGhost"; compact?: boolean; iconOnly?: boolean }) {
  const variant = tone === "primary" ? "default" : tone === "danger" ? "destructive" : tone === "ghost" || tone === "dangerGhost" ? "ghost" : tone === "selected" ? "export" : "secondary";
  return (
    <Button
      variant={variant}
      size={iconOnly ? "iconSm" : compact ? "compact" : "default"}
      className={cn(tone === "dangerGhost" && "text-destructive hover:text-destructive", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

function Status({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  const colors: Record<StatusTone, string> = {
    success: "var(--a2-success)", warning: "var(--a2-warning)", danger: "var(--a2-danger)", info: "var(--a2-info)", neutral: "var(--a2-text-3)",
  };
  return <span className="a2-status" style={{ "--status-color": colors[tone] } as CSSProperties}>{label}</span>;
}

function KpiCard({ label, value, meta, positive = false }: { label: string; value: string; meta: string; positive?: boolean }) {
  return (
    <div className="a2-card a2-kpi">
      <div className="a2-kpi-label">{label}</div>
      <div className="a2-kpi-value">{value}</div>
      <div className="a2-kpi-meta"><Activity size={12} aria-hidden="true" /><strong>{positive ? "+8.4%" : "Live"}</strong><span>{meta}</span></div>
    </div>
  );
}

function Field({ label, help, error, children }: { label: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <div className="a2-field">
      <Label>{label}</Label>
      {children}
      {help && <p className="a2-field-help">{help}</p>}
      {error && <p className="a2-field-error" role="alert">{error}</p>}
    </div>
  );
}

function MockShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [context, setContext] = useState("Today");
  return (
    <div className="a2-shell-preview">
      <div className={cn("a2-shell-frame", collapsed && "a2-shell-collapsed")}>
        <aside className="a2-shell-rail" aria-label="Mock global navigation">
          <div className="a2-rail-brand"><div className="a2-brand-mark"><Activity size={17} /></div><span>Central Studio</span></div>
          <nav className="a2-nav-stack">
            {NAV_ITEMS.map(([label, Icon]) => <button key={label} className={cn("a2-nav-item", label === "Bookings" && "a2-nav-item-active")}><Icon size={16} /><span>{label}</span></button>)}
          </nav>
          <div className="a2-rail-footer"><button className="a2-nav-item" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand mock navigation" : "Collapse mock navigation"}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}<span>Collapse</span></button></div>
        </aside>
        <div className="a2-shell-main">
          <header className="a2-shell-top">
            <div className="a2-context-nav" aria-label="Mock contextual navigation">
              {["Today", "Queue", "Calendar", "Insights"].map((item) => <button key={item} className={context === item ? "active" : ""} onClick={() => setContext(item)}>{item}</button>)}
            </div>
            <div className="a2-inline">
              <LabButton tone="ghost" iconOnly aria-label="Search"><Search size={15} /></LabButton>
              <LabButton tone="ghost" iconOnly aria-label="Notifications"><Bell size={15} /></LabButton>
              <div className="a2-avatar" aria-label="Admin profile">AO</div>
            </div>
          </header>
          <main className="a2-shell-content">
            <div className="a2-shell-title">
              <div><div className="a2-eyebrow">Operations / Bookings</div><h3>Bookings Control</h3><p>High-signal activity across the studio day.</p></div>
              <LabButton tone="primary"><Plus size={14} /> New booking</LabButton>
            </div>
            <div className="a2-grid-4">
              <KpiCard label="Today’s bookings" value="128" meta="vs last Tuesday" positive />
              <KpiCard label="Checked in" value="74" meta="58% complete" />
              <KpiCard label="Pending payment" value="12" meta="requires attention" />
              <KpiCard label="Available capacity" value="86" meta="across 14 classes" />
            </div>
            <div className="a2-card" style={{ marginTop: 16 }}>
              <div className="a2-inline" style={{ justifyContent: "space-between" }}><strong style={{ fontSize: 12 }}>Operational pulse</strong><span className="a2-mono" style={{ color: "var(--a2-text-3)", fontSize: 9 }}>LIVE · 14:32</span></div>
              <div className="a2-progress-track" style={{ marginTop: 20 }}><div className="a2-progress-fill" style={{ width: "72%" }} /></div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function ComponentGallery() {
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [filter, setFilter] = useState("All");
  return (
    <div className="a2-grid-2">
      <div className="a2-panel">
        <div className="a2-eyebrow">Buttons and icon actions</div>
        <div className="a2-cluster" style={{ marginTop: 18 }}>
          <LabButton tone="primary"><Plus size={14} /> Primary</LabButton>
          <LabButton tone="secondary">Secondary</LabButton>
          <LabButton tone="ghost">Ghost</LabButton>
          <LabButton tone="danger"><Trash2 size={14} /> Destructive</LabButton>
          <LabButton compact>Compact</LabButton>
          <LabButton tone="selected"><Download size={14} /> Export <ArrowRight size={14} /></LabButton>
          <LabButton disabled>Disabled</LabButton>
          <LabButton disabled><Loader2 className="animate-spin" size={14} /> Loading</LabButton>
        </div>
        <div className="a2-cluster" style={{ marginTop: 18 }}>
          <LabButton iconOnly aria-label="Default settings"><Settings2 size={15} /></LabButton>
          <LabButton tone="selected" iconOnly aria-label="Selected notifications"><Bell size={15} /></LabButton>
          <LabButton iconOnly disabled aria-label="Disabled refresh"><RefreshCw size={15} /></LabButton>
          <LabButton tone="dangerGhost" iconOnly aria-label="Delete item"><Trash2 size={15} /></LabButton>
          <LabButton tone="secondary" iconOnly aria-label="More actions"><MoreHorizontal size={15} /></LabButton>
        </div>
      </div>

      <div className="a2-panel">
        <div className="a2-eyebrow">Forms and controls</div>
        <div className="a2-grid-2" style={{ marginTop: 18 }}>
          <Field label="Student name" help="Search by name, email, or mobile."><Input className="a2-input" placeholder="Start typing…" /></Field>
          <Field label="Search"><div className="a2-search"><Search size={14} /><Input className="a2-input" placeholder="Search records" /></div></Field>
          <Field label="Class"><Select defaultValue="ballet"><SelectTrigger className="a2-input"><SelectValue /></SelectTrigger><SelectContent className="admin2-overlay a2-menu"><SelectItem value="ballet">Ballet Foundation</SelectItem><SelectItem value="contemporary">Contemporary Flow</SelectItem></SelectContent></Select></Field>
          <Field label="Session date"><Input type="date" className="a2-input" defaultValue="2026-08-11" /></Field>
          <Field label="Email" error="Enter a valid email address."><Input className="a2-input a2-input-error" defaultValue="layla@" aria-invalid="true" /></Field>
          <Field label="Disabled"><Input className="a2-input" disabled value="Locked by policy" readOnly /></Field>
        </div>
        <Field label="Operational note" help="Visible only in this static preview."><Textarea className="a2-textarea" placeholder="Add concise context…" /></Field>
        <div className="a2-cluster" style={{ marginTop: 16 }}>
          <label className="a2-inline" style={{ color: "var(--a2-text-2)", fontSize: 11 }}><Checkbox checked={checked} onCheckedChange={(value) => setChecked(Boolean(value))} /> Include children</label>
          <label className="a2-inline" style={{ color: "var(--a2-text-2)", fontSize: 11 }}><Switch checked={enabled} onCheckedChange={setEnabled} /> Capacity alerts</label>
        </div>
      </div>

      <div className="a2-panel">
        <div className="a2-eyebrow">Filters and tabs</div>
        <div className="a2-pill-row" style={{ marginTop: 18 }}>
          {["All", "Confirmed", "Pending", "Waitlist"].map((item, index) => <button key={item} className={cn("a2-pill", filter === item && "a2-pill-selected")} onClick={() => setFilter(item)}>{item}<span className="a2-pill-count">{[128, 96, 18, 14][index]}</span></button>)}
          <button className="a2-pill"><Filter size={12} /> More filters</button>
          <button className="a2-pill"><CalendarDays size={12} /> Aug 11–17</button>
        </div>
        <Tabs defaultValue="queue" style={{ marginTop: 22 }}>
          <TabsList className="h-auto rounded-full border border-[var(--a2-border-subtle)] bg-[var(--a2-sunken)] p-1">
            <TabsTrigger value="queue" className="rounded-full text-xs data-[state=active]:bg-[var(--a2-cyan)] data-[state=active]:text-black">Queue</TabsTrigger>
            <TabsTrigger value="capacity" className="rounded-full text-xs data-[state=active]:bg-[var(--a2-cyan)] data-[state=active]:text-black">Capacity</TabsTrigger>
            <TabsTrigger value="history" className="rounded-full text-xs data-[state=active]:bg-[var(--a2-cyan)] data-[state=active]:text-black">History</TabsTrigger>
          </TabsList>
          <TabsContent value="queue" className="text-xs text-[var(--a2-text-2)]">Standard dark contextual tabs with local state only.</TabsContent>
          <TabsContent value="capacity" className="text-xs text-[var(--a2-text-2)]">Capacity preview selected.</TabsContent>
          <TabsContent value="history" className="text-xs text-[var(--a2-text-2)]">History preview selected.</TabsContent>
        </Tabs>
      </div>

      <div className="a2-panel">
        <div className="a2-eyebrow">Cards and badges</div>
        <div className="a2-grid-2" style={{ marginTop: 18 }}>
          <div className="a2-card"><strong style={{ fontSize: 12 }}>Basic surface</strong><p className="a2-field-help" style={{ marginTop: 8 }}>Quiet containment through surface contrast.</p></div>
          <button className="a2-card" style={{ color: "inherit", textAlign: "left", transition: "transform var(--a2-motion-fast)" }}><strong style={{ fontSize: 12 }}>Interactive card</strong><p className="a2-field-help" style={{ marginTop: 8 }}>Keyboard-focusable and restrained.</p></button>
          <div className="a2-card" style={{ borderColor: "var(--a2-border-brand)", background: "var(--a2-cyan-soft)" }}><div className="a2-eyebrow">Spotlight</div><strong style={{ display: "block", marginTop: 10 }}>Next class in 24 min</strong></div>
          <div className="a2-card"><div className="a2-inline" style={{ justifyContent: "space-between" }}><div><div className="a2-kpi-label">Occupancy</div><div style={{ marginTop: 8, fontSize: 22, fontWeight: 750 }}>82%</div></div><Activity color="var(--a2-cyan)" /></div></div>
        </div>
        <div className="a2-cluster" style={{ marginTop: 18 }}>
          <Status label="Active" tone="success" /><Status label="Inactive" /><Status label="Pending" tone="warning" /><Status label="Success" tone="success" /><Status label="Warning" tone="warning" /><Status label="Rejected" tone="danger" /><Status label="Information" tone="info" />
        </div>
      </div>
    </div>
  );
}

function DataTablePreview() {
  const [selected, setSelected] = useState(1);
  const [mode, setMode] = useState<"data" | "loading" | "empty">("data");
  return (
    <div className="a2-table-shell">
      <div className="a2-table-toolbar">
        <div className="a2-search" style={{ width: "min(320px, 100%)" }}><Search size={14} /><Input className="a2-input" placeholder="Search students" /></div>
        <div className="a2-cluster">
          <div className="a2-pill-row">{(["data", "loading", "empty"] as const).map((item) => <button key={item} className={cn("a2-pill", mode === item && "a2-pill-selected")} onClick={() => setMode(item)}>{item}</button>)}</div>
          <LabButton tone="secondary" compact><ListFilter size={13} /> Filters</LabButton>
          <LabButton tone="primary" compact><Plus size={13} /> Add student</LabButton>
        </div>
      </div>
      <div className="a2-table-scroll">
        <table className="a2-table">
          <thead><tr><th>Student</th><th>Classes</th><th>Package</th><th>Status</th><th>Last activity</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {mode === "data" && STUDENTS.map((row) => (
              <tr
                key={row.id}
                className={selected === row.id ? "selected" : ""}
                onClick={() => setSelected(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(row.id);
                  }
                }}
                tabIndex={0}
                aria-selected={selected === row.id}
              >
                <td><div className="a2-table-person"><div className="a2-avatar">{row.initials}</div><div><strong>{row.name}</strong><small>{row.email}</small></div></div></td>
                <td>{row.classes}</td><td>{row.package}</td>
                <td><Status label={row.status} tone={row.status === "Active" ? "success" : row.status === "Inactive" ? "neutral" : "warning"} /></td>
                <td className="a2-mono">{row.activity}</td>
                <td><Tooltip><TooltipTrigger asChild><LabButton tone="ghost" iconOnly compact aria-label={`View ${row.name}`} onClick={(event) => event.stopPropagation()}><Eye size={14} /></LabButton></TooltipTrigger><TooltipContent className="admin2-overlay a2-tooltip">View student</TooltipContent></Tooltip></td>
              </tr>
            ))}
            {mode === "loading" && Array.from({ length: 5 }).map((_, index) => <tr key={index}><td colSpan={6}><div className="a2-skeleton" style={{ width: `${72 - index * 5}%` }} /></td></tr>)}
            {mode === "empty" && <tr><td colSpan={6}><div style={{ display: "grid", placeItems: "center", gap: 10, padding: 32, textAlign: "center" }}><Users size={24} color="var(--a2-text-3)" /><strong style={{ color: "var(--a2-text-1)" }}>No students match these filters</strong><span style={{ color: "var(--a2-text-3)", fontSize: 10 }}>Clear the selected filters or try another search.</span></div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="a2-table-footer"><span>Showing 1–5 of 248 students</span><div className="a2-inline"><LabButton compact tone="secondary" iconOnly aria-label="Previous page" disabled><ChevronLeft size={13} /></LabButton><LabButton compact tone="selected">1</LabButton><LabButton compact tone="secondary">2</LabButton><LabButton compact tone="secondary">3</LabButton><LabButton compact tone="secondary" iconOnly aria-label="Next page"><ChevronRight size={13} /></LabButton></div></div>
    </div>
  );
}

function MasterDetailWorkspace() {
  const [selectedId, setSelectedId] = useState(1);
  const selected = BOOKINGS.find((item) => item.id === selectedId) ?? BOOKINGS[0];
  return (
    <div className="a2-light-sample">
      <div className="a2-inline" style={{ justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap" }}>
        <div><div style={{ color: "#008ca7", fontSize: 9, fontWeight: 800, letterSpacing: ".12em" }}>BOOKINGS OPERATIONS</div><h3 style={{ marginTop: 5, fontSize: 24, letterSpacing: "-.035em" }}>Today’s booking queue</h3></div>
        <div className="a2-light-tabs">{["All", "Pending", "Waitlist"].map((item, index) => <button key={item} className={index === 0 ? "active" : ""}>{item}</button>)}</div>
      </div>
      <div className="a2-workspace">
        <div className="a2-workspace-toolbar"><div className="a2-search" style={{ width: "min(300px, 100%)" }}><Search size={14} /><input className="a2-input" placeholder="Find a booking" /></div><div className="a2-inline"><button className="a2-pill" style={{ color: "#50656c", background: "#fff" }}><Filter size={12} /> 3 filters</button><button className="a2-pill" style={{ color: "#50656c", background: "#fff" }}><CalendarDays size={12} /> Today</button></div></div>
        <div className="a2-master-detail">
          <div className="a2-master-list">{BOOKINGS.map((booking) => <button key={booking.id} className={cn("a2-master-item", selectedId === booking.id && "selected")} onClick={() => setSelectedId(booking.id)}><div className="a2-avatar">{booking.initials}</div><div><strong>{booking.name}</strong><small>{booking.className} · {booking.time}</small></div><span style={{ color: booking.status === "Confirmed" ? "#178d5c" : "#a06a0e", fontSize: 9, fontWeight: 750 }}>{booking.status}</span></button>)}</div>
          <aside className="a2-detail">
            <div className="a2-detail-head"><div className="a2-inline"><div className="a2-avatar">{selected.initials}</div><div><strong style={{ display: "block", fontSize: 15 }}>{selected.name}</strong><span className="a2-mono" style={{ color: "#71858c", fontSize: 9 }}>BK-2026-08{selected.id.toString().padStart(2, "0")}</span></div></div><Status label={selected.status} tone={selected.status === "Confirmed" ? "success" : "warning"} /></div>
            <div className="a2-detail-grid">
              {["Class", selected.className, "Instructor", selected.instructor, "Date & time", selected.time, "Branch", selected.branch, "Payment", selected.payment, "Participant", selected.name].reduce<Array<[string, string]>>((rows, item, index, source) => { if (index % 2 === 0) rows.push([item, source[index + 1]]); return rows; }, []).map(([label, value]) => <div className="a2-detail-field" key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <div className="a2-cluster" style={{ marginTop: 22 }}><LabButton tone="primary" compact><Check size={13} /> Check in</LabButton><LabButton tone="secondary" compact><Pencil size={13} /> Edit</LabButton><LabButton tone="ghost" compact><MessageSquareText size={13} /> Message</LabButton></div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPreview() {
  return (
    <div className="a2-grid-2">
      <div className="a2-panel">
        <div className="a2-inline" style={{ justifyContent: "space-between" }}><div><div className="a2-eyebrow">Seven-day signal</div><h3 style={{ marginTop: 5, fontSize: 18 }}>Booking movement</h3></div><Status label="Healthy" tone="success" /></div>
        <div className="a2-chart" style={{ marginTop: 18 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={[...CHART_DATA]}><defs><linearGradient id="bookingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00B6D7" stopOpacity={0.34} /><stop offset="100%" stopColor="#00B6D7" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="rgba(190,225,235,.08)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#71848c", fontSize: 10 }} /><YAxis hide /><ChartTooltip contentStyle={{ background: "#0d191e", border: "1px solid rgba(190,225,235,.14)", borderRadius: 12, fontSize: 10 }} /><Area type="monotone" dataKey="bookings" stroke="#00B6D7" strokeWidth={2} fill="url(#bookingFill)" /></AreaChart></ResponsiveContainer></div>
      </div>
      <div className="a2-panel">
        <div className="a2-eyebrow">Class progress</div>
        <div style={{ marginTop: 18 }}><div className="a2-inline" style={{ justifyContent: "space-between", fontSize: 11 }}><strong>Today’s attendance</strong><span className="a2-mono" style={{ color: "var(--a2-text-3)" }}>74 / 102</span></div><div className="a2-progress-track" style={{ marginTop: 12 }}><div className="a2-progress-fill" style={{ width: "72.5%" }} /></div></div>
        <div className="a2-grid-2" style={{ marginTop: 22 }}><div className="a2-card"><div className="a2-kpi-label">Active instructors</div><div className="a2-kpi-value" style={{ fontSize: 24 }}>18</div><div className="a2-avatar-stack" style={{ marginTop: 14 }}>{["MA", "ON", "TA", "+15"].map((value) => <div className="a2-avatar" key={value}>{value}</div>)}</div></div><div className="a2-card"><div className="a2-kpi-label">Next transition</div><div style={{ display: "flex", gap: 12, marginTop: 17 }}><Clock3 color="var(--a2-cyan)" size={20} /><div><strong style={{ display: "block", fontSize: 12 }}>Studio A turnover</strong><span style={{ color: "var(--a2-text-3)", fontSize: 9 }}>in 24 minutes</span></div></div></div></div>
        <div className="a2-role-list" style={{ marginTop: 18 }}>{[["14:10", "Ballet Foundation checked in", "success"], ["14:18", "Payment review queued", "warning"], ["14:32", "Capacity recalculated", "info"]].map(([time, text, tone]) => <div className="a2-inline" key={time} style={{ padding: "8px 0", borderBottom: "1px solid var(--a2-border-subtle)" }}><Status label={time} tone={tone as StatusTone} /><span style={{ color: "var(--a2-text-2)", fontSize: 10 }}>{text}</span></div>)}</div>
      </div>
    </div>
  );
}

function OverlayGallery() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="a2-panel"><div className="a2-cluster">
      <Dialog><DialogTrigger asChild><LabButton tone="primary"><Plus size={14} /> Standard dialog</LabButton></DialogTrigger><DialogContent className="admin2-overlay a2-dialog"><DialogHeader><DialogTitle>Create booking note</DialogTitle><DialogDescription>Static preview. Saving changes only local Lab state.</DialogDescription></DialogHeader><div className="a2-dialog-section"><Field label="Participant"><Input className="a2-input" defaultValue="Layla Hassan" /></Field><Field label="Note"><Textarea className="a2-textarea" placeholder="Add context for the front desk…" /></Field></div><DialogFooter><DialogClose asChild><LabButton tone="secondary">Cancel</LabButton></DialogClose><LabButton tone="primary" onClick={() => setSaved(true)}>{saved ? <Check size={14} /> : null}{saved ? "Saved locally" : "Save note"}</LabButton></DialogFooter></DialogContent></Dialog>

      <Dialog><DialogTrigger asChild><LabButton tone="secondary">Long form</LabButton></DialogTrigger><DialogContent className="admin2-overlay a2-dialog a2-dialog-wide max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>New operational record</DialogTitle><DialogDescription>Long-form scrolling and responsive footer treatment.</DialogDescription></DialogHeader><div className="a2-grid-2">{["Student name", "Contact", "Class", "Instructor", "Branch", "Room", "Date", "Start time"].map((label) => <Field key={label} label={label}><Input className="a2-input" placeholder={label} /></Field>)}</div><Field label="Internal notes"><Textarea className="a2-textarea" /></Field><DialogFooter><DialogClose asChild><LabButton tone="secondary">Cancel</LabButton></DialogClose><LabButton tone="primary">Create record</LabButton></DialogFooter></DialogContent></Dialog>

      <AlertDialog><AlertDialogTrigger asChild><LabButton tone="danger"><Trash2 size={14} /> Confirmation</LabButton></AlertDialogTrigger><AlertDialogContent className="admin2-overlay a2-dialog"><AlertDialogHeader><AlertDialogTitle>Remove this mock booking?</AlertDialogTitle><AlertDialogDescription>This demonstrates a destructive confirmation. No record exists and no data is changed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="a2-button a2-button-secondary">Keep booking</AlertDialogCancel><AlertDialogAction className="a2-button a2-button-danger">Remove mock</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <Sheet><SheetTrigger asChild><LabButton tone="secondary"><Eye size={14} /> Detail sheet</LabButton></SheetTrigger><SheetContent className="admin2-overlay a2-sheet"><SheetHeader><SheetTitle>Booking detail</SheetTitle><SheetDescription>Contextual detail without leaving the queue.</SheetDescription></SheetHeader><div className="a2-sheet-content"><div className="a2-card"><Status label="Confirmed" tone="success" /><h3 style={{ marginTop: 14 }}>Ballet Foundation</h3><p className="a2-field-help" style={{ marginTop: 6 }}>Layla Hassan · Today at 17:00</p></div>{["Instructor · Mariam Adel", "Maadi · Studio A", "Package credit · Reserved", "Payment · Paid"].map((item) => <div className="a2-card" key={item} style={{ fontSize: 11 }}>{item}</div>)}</div></SheetContent></Sheet>

      <DropdownMenu><DropdownMenuTrigger asChild><LabButton tone="secondary"><MoreHorizontal size={14} /> Dropdown <ChevronDown size={13} /></LabButton></DropdownMenuTrigger><DropdownMenuContent className="admin2-overlay a2-menu"><DropdownMenuLabel>Record actions</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem><Eye /> View details</DropdownMenuItem><DropdownMenuItem><Pencil /> Edit record</DropdownMenuItem><DropdownMenuItem><Download /> Export</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-[var(--a2-danger)]"><Trash2 /> Remove</DropdownMenuItem></DropdownMenuContent></DropdownMenu>

      <Tooltip><TooltipTrigger asChild><LabButton tone="ghost" iconOnly aria-label="Refresh preview"><RefreshCw size={15} /></LabButton></TooltipTrigger><TooltipContent className="admin2-overlay a2-tooltip">Refresh preview</TooltipContent></Tooltip>
    </div></div>
  );
}

function FeedbackGallery() {
  const feedback = [
    [Loader2, "Loading", "Fetching the latest operational state.", "var(--a2-info)"],
    [Users, "Empty", "No records match the current filters.", "var(--a2-text-3)"],
    [AlertTriangle, "Warning", "Three bookings need payment review.", "var(--a2-warning)"],
    [XCircle, "Error", "The preview could not be refreshed.", "var(--a2-danger)"],
    [CheckCircle2, "Success", "All check-ins have been reconciled.", "var(--a2-success)"],
    [WifiOff, "Connection status", "Showing the most recent local snapshot.", "var(--a2-info)"],
  ] as const;
  return <div className="a2-feedback-grid">{feedback.map(([Icon, title, copy, color], index) => <div className="a2-feedback" key={title} style={{ "--feedback-color": color } as CSSProperties}><div className="a2-feedback-icon"><Icon size={16} className={index === 0 ? "animate-spin" : ""} /></div><strong>{title}</strong><p>{copy}</p>{index === 0 && <div className="a2-skeleton" style={{ marginTop: 12, width: "76%" }} />}</div>)}</div>;
}

export default function DesignLabPage() {
  const [theme, setTheme] = useState<LabTheme>("dark");
  const [viewport, setViewport] = useState("Wide");
  const viewportWidth = useMemo(() => ({ Wide: "100%", Laptop: "1180px", Tablet: "820px", Narrow: "420px" })[viewport] ?? "100%", [viewport]);

  return (
    <div className="admin2-lab" data-lab-theme={theme}>
      <header className="a2-lab-topbar">
        <div className="a2-lab-brand"><div className="a2-brand-mark"><Activity size={18} /></div><div><strong>Central Studio Admin 2.0</strong><small>Local UI Lab · Vite development only</small></div></div>
        <nav className="a2-lab-nav" aria-label="Design Lab sections">{SECTION_LINKS.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
        <div className="a2-inline">
          <LabButton tone="secondary" compact onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")} aria-label={`Switch Lab to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? "Light preview" : "Dark preview"}</LabButton>
        </div>
      </header>

      <main className="a2-lab-main">
        <section className="a2-hero">
          <div className="a2-hero-copy"><div className="a2-eyebrow">Central Studio Admin 2.0</div><h1 className="a2-display">PERFORMANCE<br />CONTROL SURFACE</h1><p>A development-only visual system for high-density studio operations: deep stage atmosphere, cyan interaction, precise controls, generous workspaces, and calm operational hierarchy.</p></div>
          <aside className="a2-token-overview"><div><Status label="Static fixtures only" tone="success" /><h2 style={{ marginTop: 22, fontSize: 22, letterSpacing: "-.03em" }}>Foundation status</h2><p style={{ marginTop: 8, color: "var(--a2-text-2)", fontSize: 12, lineHeight: 1.6 }}>Scoped tokens are active only beneath this Lab root. Production primitives and pages are untouched.</p></div><div className="a2-mono">PRIMARY&nbsp;&nbsp;#00B6D7<br />GRID&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;4PX<br />MOTION&nbsp;&nbsp;&nbsp;140 / 220 / 340MS<br />FONTS&nbsp;&nbsp;&nbsp;&nbsp;FALLBACK RENDERING<br />DATA&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;LOCAL REACT STATE</div></aside>
        </section>

        <Section id="foundations" eyebrow="01 · Foundation" title="One system, deliberate hierarchy" description="Tokens are semantic, scoped, and reusable. The Lab demonstrates both a dark stage and a cool-paper operational workspace without changing production root values.">
          <div className="a2-panel"><div className="a2-swatch-grid">{SWATCHES.map(([name, value, note]) => <div className="a2-swatch" key={name}><div className="a2-swatch-color" style={{ "--swatch": value } as CSSProperties} /><div className="a2-swatch-copy"><strong>{name}</strong><code>{note}</code></div></div>)}</div></div>
          <div className="a2-grid-2" style={{ marginTop: 16 }}>
          <div className="a2-panel"><div className="a2-eyebrow">Typography roles</div><p className="a2-field-help" style={{ marginTop: 8 }}>Anton is packaged locally for display roles. Archivo and Space Mono continue to use the existing project fallback stacks.</p><div className="a2-role-list" style={{ marginTop: 16 }}>{TYPOGRAPHY_ROLES.map(([name, sample, meta, size, weight]) => <div className="a2-role-row" key={name}><span className="a2-role-name">{name}</span><span className={name.includes("mono") ? "a2-role-sample a2-mono" : "a2-role-sample"} style={{ "--role-size": size, "--role-weight": weight } as CSSProperties}>{sample}</span><span className="a2-role-meta">{meta}</span></div>)}</div></div>
            <div className="a2-panel"><div className="a2-eyebrow">4px spacing grid</div>{[["Micro", 4], ["Control gap", 8], ["Field gap", 12], ["Card padding", 16], ["Panel padding", 24], ["Section gap", 32], ["Page gutter", 40], ["Major gap", 48]].map(([label, value]) => <div className="a2-scale-row" key={label}><span className="a2-scale-label">{label} · {value}px</span><span className="a2-scale-bar" style={{ "--scale": `${Number(value) * 3}px` } as CSSProperties} /></div>)}<div className="a2-eyebrow" style={{ marginTop: 26 }}>Radius roles</div><div className="a2-grid-3" style={{ marginTop: 14 }}>{[["Control", 12], ["Card", 18], ["Workspace", 32]].map(([label, value]) => <div key={label}><div className="a2-radius-sample" style={{ "--sample-radius": `${value}px` } as CSSProperties} /><div className="a2-scale-label" style={{ marginTop: 7 }}>{label} · {value}px</div></div>)}</div></div>
          </div>
        </Section>

        <Section id="shell" eyebrow="02 · Shell concept" title="Global rail, contextual pills" description="A visual-only shell prototype. It preserves the future concept of broad global navigation in a slim rail and compact contextual navigation near the work surface."><MockShell /></Section>

        <Section id="components" eyebrow="03 · Component gallery" title="Dense controls with confident states" description="Working local interactions demonstrate default, hover, focus-visible, selected, active, disabled, loading, and semantic states using existing Radix/shadcn foundations."><ComponentGallery /></Section>

        <Section id="table" eyebrow="04 · Data surface" title="A table built for operations" description="Static representative student data validates density, row selection, metadata, status, accessible icon actions, horizontal scrolling, pagination, loading, and empty states."><DataTablePreview /></Section>

        <Section id="workspace" eyebrow="05 · Flagship composition" title="Bookings master/detail workspace" description="The key target archetype: KPIs and command controls feeding a large cool-paper workspace with a dense queue and dark contextual detail panel.">
          <div className="a2-grid-4" style={{ marginBottom: 16 }}><KpiCard label="Open bookings" value="128" meta="vs last Tuesday" positive /><KpiCard label="Pending review" value="18" meta="14% of queue" /><KpiCard label="Waitlist" value="14" meta="across 6 classes" /><KpiCard label="Payment ready" value="96" meta="75% confirmed" /></div><MasterDetailWorkspace />
        </Section>

        <Section id="analytics" eyebrow="06 · Command center" title="Signal without spectacle" description="Existing Recharts powers one restrained static chart. Progress, avatar stacks, and activity markers complete the visual language without adding analytics behavior."><AnalyticsPreview /></Section>

        <Section id="overlays" eyebrow="07 · Overlay system" title="Layer four: focused decisions" description="Dialogs, a long form, destructive confirmation, detail sheet, dropdown, and tooltip all use the existing accessible Radix/shadcn primitives."><OverlayGallery /></Section>

        <Section id="feedback" eyebrow="08 · Feedback states" title="Calm, canonical system responses" description="Every state includes text and icon cues so meaning never depends on color alone. Motion is restrained and disabled under reduced-motion preferences."><FeedbackGallery /></Section>

        <section className="a2-section"><div className="a2-section-head"><div><div className="a2-eyebrow">09 · Responsive inspection</div><h2>Preview width controls</h2></div><p>Use these controls with browser resizing to inspect wide desktop, laptop, tablet, and narrow behavior. Tables scroll and master/detail stacks.</p></div><div className="a2-panel"><div className="a2-pill-row">{["Wide", "Laptop", "Tablet", "Narrow"].map((item) => <button key={item} className={cn("a2-pill", viewport === item && "a2-pill-selected")} onClick={() => setViewport(item)}>{item}</button>)}</div><div style={{ width: viewportWidth, maxWidth: "100%", margin: "18px auto 0", transition: "width var(--a2-motion-slow)" }}><div className="a2-card"><div className="a2-inline" style={{ justifyContent: "space-between", flexWrap: "wrap" }}><div><div className="a2-eyebrow">{viewport} viewport frame</div><strong style={{ display: "block", marginTop: 8 }}>Standard content uses readable composition.</strong></div><div className="a2-cluster"><LabButton tone="secondary" compact><Menu size={13} /> Navigation</LabButton><LabButton tone="primary" compact><Plus size={13} /> Action</LabButton></div></div></div></div></div></section>

        <footer className="a2-footer"><span>Central Studio Admin 2.0 · Local UI Lab</span><span className="a2-mono">/design-lab · DEV ONLY · STATIC MOCK DATA</span></footer>
      </main>
    </div>
  );
}
