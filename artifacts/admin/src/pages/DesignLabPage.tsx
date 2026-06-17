/**
 * 🔬 Design Lab — /design-lab
 *
 * Visual component preview for the Central Studio Admin Portal.
 * DEV-ONLY: not linked from the sidebar in production.
 *
 * Sections:
 *  1. Buttons
 *  2. Inputs
 *  3. Status Badges
 *  4. Ballet Card States (mock)
 *  5. Application Status Cards
 *  6. Booking Rows / Table
 *  7. Modals / Dialogs
 *  8. Sidebar Items
 *  9. Page Headers
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import {
  LayoutDashboard, Users, CalendarDays, Ticket, Bell,
  Loader2, Plus, Search, CheckCircle2, XCircle, Clock,
  AlertTriangle, Info, Music2, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const BALLET_COLOR = "#00B6D6";

const NAV_SECTIONS = [
  "Buttons", "Inputs", "Badges", "Ballet Cards",
  "App Status", "Table", "Modal", "Sidebar Items", "Page Headers",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-border" />
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground px-2">
          {title}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-3">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function CodeHint({ text }: { text: string }) {
  return (
    <code className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
      {text}
    </code>
  );
}

// ─── Status badge config (mirrors ApplicationsPage) ──────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  submitted:         { label: "Submitted",          className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  pendingAssessment: { label: "Pending Assessment", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  accepted:          { label: "Accepted",           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  rejected:          { label: "Rejected",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  needsFollowUp:     { label: "Needs Follow-up",    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  assignedToLevel:   { label: "Assigned to Level",  className: "bg-[#00B6D6]/15 text-[#00B6D6] border-[#00B6D6]/30" },
  activeBallet:      { label: "Active",             className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

// ─── Ballet Card (mock — no image dependency) ─────────────────────────────────

const BALLET_PILLS = ["Professional Instructors", "Level Assessment", "Performance Opportunities"];

const BALLET_CARD_STATES: Array<{ label: string; status: string | null }> = [
  { label: "Apply Mode (no application)", status: null },
  { label: "Under Review", status: "submitted" },
  { label: "Assessment Scheduled", status: "pendingAssessment" },
  { label: "Needs Follow-up", status: "needsFollowUp" },
  { label: "Accepted", status: "accepted" },
  { label: "Level Assigned", status: "assignedToLevel" },
  { label: "Active Ballet", status: "activeBallet" },
  { label: "Rejected", status: "rejected" },
  { label: "Cancelled", status: "cancelled" },
];

const STATUS_BADGE_LABELS: Record<string, string> = {
  submitted: "UNDER REVIEW", pendingAssessment: "SCHEDULED", needsFollowUp: "FOLLOW-UP",
  accepted: "ACCEPTED", assignedToLevel: "LEVEL ASSIGNED", activeBallet: "ACTIVE",
  rejected: "NOT ACCEPTED", cancelled: "CANCELLED",
};

const DETAIL_MODE_STATUSES = new Set([
  "submitted", "pendingAssessment", "needsFollowUp",
  "accepted", "assignedToLevel", "activeBallet",
]);

function BalletCardMock({ status }: { status: string | null }) {
  const isDetailMode = status !== null && DETAIL_MODE_STATUSES.has(status);
  const ctaLabel = isDetailMode ? "View Details" : "Apply for Assessment";

  return (
    <div
      className="relative rounded-[18px] overflow-hidden min-h-[140px] flex"
      style={{ background: "linear-gradient(135deg, #071418 0%, #0D2030 100%)" }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-[rgba(4,14,22,0.78)]" />

      {/* Status badge */}
      {status && (
        <div
          className="absolute top-2.5 right-3 px-2 py-0.5 rounded-md text-[8px] font-bold tracking-wider"
          style={{
            backgroundColor: "rgba(0,182,214,0.18)",
            border: "1px solid rgba(0,182,214,0.4)",
            color: BALLET_COLOR,
          }}
        >
          {STATUS_BADGE_LABELS[status] ?? status.toUpperCase()}
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 flex items-center p-4 gap-4 flex-1">
        {/* Left */}
        <div className="flex-1 space-y-1.5">
          {/* Icon circle */}
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center mb-2"
            style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
          >
            <Music2 className="h-4 w-4 text-white" />
          </div>
          <p className="text-base font-bold text-white">Ballet Program</p>
          <p className="text-[11px] text-white/60 leading-relaxed">
            Classical Ballet Program<br />For ages 4–12 years
          </p>
          <div className="flex flex-wrap gap-1 mt-2">
            {BALLET_PILLS.map((pill) => (
              <span
                key={pill}
                className="text-[9px] text-white/80 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="flex-shrink-0">
          <div
            className="rounded-xl px-3 py-2.5 text-center text-[11px] font-bold leading-tight min-w-[80px] max-w-[100px]"
            style={{ backgroundColor: "#FFFFFF", color: BALLET_COLOR }}
          >
            {ctaLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Application status card (mirrors ApplicationDetailPage step cards) ────────

function AppStatusCard({
  step,
  status,
  label,
  isActive,
  isDone,
}: {
  step: number;
  status: string;
  label: string;
  isActive: boolean;
  isDone: boolean;
}) {
  return (
    <div
      className="rounded-lg border p-4 flex gap-3 items-start"
      style={{
        borderColor: isActive ? `${BALLET_COLOR}40` : "hsl(203 25% 14%)",
        backgroundColor: isActive ? `${BALLET_COLOR}08` : "hsl(204 46% 5%)",
      }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
        style={{
          backgroundColor: isDone ? "#22C55E22" : isActive ? `${BALLET_COLOR}22` : "#ffffff10",
          color: isDone ? "#22C55E" : isActive ? BALLET_COLOR : "#6B7280",
        }}
      >
        {isDone ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>
      <div>
        <p className={cn("text-sm font-semibold", isActive ? "text-white" : "text-muted-foreground")}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{status}</p>
      </div>
    </div>
  );
}

// ─── Sidebar item replica ─────────────────────────────────────────────────────

function SidebarItemPreview({
  icon: Icon,
  name,
  active,
  accent,
}: {
  icon: React.ElementType;
  name: string;
  active?: boolean;
  accent: "studio" | "stage" | "general";
}) {
  const accentColor =
    accent === "studio" ? "#00B6D7" : accent === "stage" ? "#00B6D6" : "#9CA3AF";

  return (
    <div
      className={cn(
        "flex items-center px-3 py-2 text-sm font-medium rounded-r-lg cursor-default transition-all ml-0 pl-3",
        active ? "border-l-2" : "border-l-2 border-transparent text-[#8A9AB0]"
      )}
      style={
        active
          ? {
              backgroundColor: `${accentColor}18`,
              borderColor: accentColor,
              color: accentColor,
            }
          : {}
      }
    >
      <Icon
        className="mr-3 h-[18px] w-[18px] flex-shrink-0"
        style={{ color: active ? accentColor : "#4E6070" }}
      />
      {name}
    </div>
  );
}

// ─── Sample table data ─────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  { id: 42, childName: "Layla Hassan", parentName: "Sara Hassan", phone: "+20 100 123 4567", slot: "Thu 9 Jan · 10:00 AM", status: "pendingAssessment" },
  { id: 41, childName: "Nour Ahmed", parentName: "Mona Ahmed", phone: "+20 101 987 6543", slot: "Thu 9 Jan · 11:00 AM", status: "accepted" },
  { id: 40, childName: "Adam Karim", parentName: "Karim Ali", phone: "+20 112 555 0001", slot: null, status: "submitted" },
  { id: 39, childName: "Lina Mostafa", parentName: "Dina Mostafa", phone: "+20 100 777 2222", slot: "Mon 6 Jan · 9:00 AM", status: "rejected" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DesignLabPage() {
  const [activeSection, setActiveSection] = useState("Buttons");
  const [inputVal, setInputVal] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(id.toLowerCase().replace(/ /g, "-"))
      ?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="space-y-10 pb-20">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00B6D6]" />
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[#00B6D655]">
              DEV ONLY
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">🔬 Design Lab</h1>
          <p className="mt-0.5 text-sm text-[#8A9AB0]">
            Live component preview for the Central Studio Admin Portal.
            Not linked from the sidebar — navigate directly to{" "}
            <code className="text-xs font-mono text-[#00B6D6]">/design-lab</code>
          </p>
        </div>
      </div>

      {/* Sticky nav */}
      <div className="sticky top-0 z-20 -mx-8 px-8 py-2 bg-background/90 backdrop-blur border-b border-border flex gap-1 flex-wrap">
        {NAV_SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => scrollTo(s)}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-colors",
              activeSection === s
                ? "bg-[#00B6D6] text-black"
                : "text-[#8A9AB0] hover:text-white hover:bg-white/5"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── 1. Buttons ─────────────────────────────────────────────────────── */}
      <Section id="buttons" title="Buttons">
        <Row label="Variants">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="Sizes">
          <Button size="lg">Large</Button>
          <Button size="default">Default</Button>
          <Button size="sm">Small</Button>
          <Button size="icon"><Plus className="h-4 w-4" /></Button>
        </Row>
        <Row label="States">
          <Button disabled>Disabled</Button>
          <Button disabled><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</Button>
        </Row>
        <Row label="Teal (Ballet accent) · text-black for contrast">
          <Button className="bg-[#00B6D6] hover:bg-[#0097B2] text-black gap-2">
            <Plus className="h-4 w-4" />New Assessment Date
          </Button>
          <Button className="bg-[#00B6D6] hover:bg-[#0097B2] text-black" disabled>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…
          </Button>
        </Row>
        <div className="text-xs text-muted-foreground px-1">
          File: <CodeHint text="artifacts/admin/src/components/ui/button.tsx" />
        </div>
      </Section>

      {/* ── 2. Inputs ──────────────────────────────────────────────────────── */}
      <Section id="inputs" title="Inputs">
        <Row label="Text input states">
          <div className="w-56">
            <Input placeholder="Default placeholder" />
          </div>
          <div className="w-56">
            <Input value="Filled value" onChange={() => {}} />
          </div>
          <div className="w-56">
            <Input disabled placeholder="Disabled" />
          </div>
        </Row>
        <Row label="With label + search icon">
          <div className="w-64 space-y-1.5">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">Parent Name</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search…" value={inputVal} onChange={(e) => setInputVal(e.target.value)} />
            </div>
          </div>
        </Row>
        <Row label="Dark card bg (used in dialogs)">
          <div className="w-56">
            <Input className="bg-[#1A2535] border-border text-white" placeholder="Dark input" />
          </div>
        </Row>
        <Row label="Textarea">
          <div className="w-full max-w-md">
            <Textarea
              placeholder="Assessment instructions shown to parents…"
              rows={3}
              className="bg-[#1A2535] border-border text-white resize-none"
            />
          </div>
        </Row>
        <Row label="Segmented time select (Assessment Dates form)">
          {(["Hour", "Minute", "AM/PM"] as const).map((label, i) => (
            <div key={label} className="w-24">
              <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
              <select
                defaultValue={["9", "00", "AM"][i]}
                className="w-full rounded-md border border-border bg-[#1A2535] px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#00B6D6]"
              >
                {label === "Hour" && ["1","2","3","4","5","6","7","8","9","10","11","12"].map(v => <option key={v}>{v}</option>)}
                {label === "Minute" && ["00","15","30","45"].map(v => <option key={v}>{v}</option>)}
                {label === "AM/PM" && ["AM","PM"].map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          ))}
        </Row>
        <div className="text-xs text-muted-foreground px-1">
          File: <CodeHint text="artifacts/admin/src/components/ui/input.tsx" />
          {" · "}
          <CodeHint text="AssessmentSlotsPage.tsx → TimeSelect" />
        </div>
      </Section>

      {/* ── 3. Badges ──────────────────────────────────────────────────────── */}
      <Section id="badges" title="Badges">
        <Row label="Application status badges">
          {Object.keys(STATUS_CONFIG).map((s) => <StatusBadge key={s} status={s} />)}
        </Row>
        <Row label="shadcn Badge variants">
          <Badge>Default</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </Row>
        <Row label="Semantic colours (used in levels, bookings, etc.)">
          <Badge className="bg-green-500/20 text-green-400">Active</Badge>
          <Badge className="bg-amber-500/20 text-amber-400">Few Seats</Badge>
          <Badge className="bg-red-500/20 text-red-400">Full</Badge>
          <Badge className="bg-blue-500/20 text-blue-400">Info</Badge>
          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
        </Row>
        <div className="text-xs text-muted-foreground px-1">
          File: <CodeHint text="artifacts/admin/src/components/ui/badge.tsx" />
          {" · "}
          <CodeHint text="ApplicationsPage.tsx → STATUS_CONFIG" />
        </div>
      </Section>

      {/* ── 4. Ballet Card States ──────────────────────────────────────────── */}
      <Section id="ballet-cards" title="Ballet Cards">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          All 9 states of the ballet card. Top-right badge only appears when an application exists.
          {" "}File: <CodeHint text="artifacts/central/app/(tabs)/classes.tsx" />
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {BALLET_CARD_STATES.map(({ label, status }) => (
            <div key={label} className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</p>
              <BalletCardMock status={status} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── 5. Application Status Cards ────────────────────────────────────── */}
      <Section id="app-status" title="App Status">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          Step cards used in the ApplicationDetailPage workflow.
          File: <CodeHint text="artifacts/admin/src/pages/ballet/ApplicationDetailPage.tsx" />
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <AppStatusCard step={1} status="Submitted" label="Application Submitted" isActive={false} isDone={true} />
          <AppStatusCard step={2} status="Pending Assessment" label="Assessment Scheduled" isActive={true} isDone={false} />
          <AppStatusCard step={3} status="Under Review" label="Result Pending" isActive={false} isDone={false} />
          <AppStatusCard step={4} status="Accepted → Level Assigned" label="Active Student" isActive={false} isDone={false} />
        </div>

        {/* Alert row */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-3 mt-2">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-3">Alert / Info strips</p>
          <div className="flex items-center gap-3 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/10 px-4 py-3 text-green-400">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">Application accepted — child is now active.</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">Application rejected.</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">Follow-up required from parent.</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-blue-400">
            <Info className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">Assessment scheduled for Thursday 10:00 AM.</span>
          </div>
        </div>
      </Section>

      {/* ── 6. Table ───────────────────────────────────────────────────────── */}
      <Section id="table" title="Table">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          Standard applications table. File: <CodeHint text="artifacts/admin/src/pages/ballet/ApplicationsPage.tsx" />
        </p>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Child</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Selected Slot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_ROWS.map((row) => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="text-muted-foreground text-xs">{row.id}</TableCell>
                  <TableCell className="font-medium">{row.childName}</TableCell>
                  <TableCell>{row.parentName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.phone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.slot ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date("2025-01-08").toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="text-xs text-muted-foreground px-1 mt-1">
          File: <CodeHint text="artifacts/admin/src/components/ui/table.tsx" />
        </div>
      </Section>

      {/* ── 7. Modal / Dialog ──────────────────────────────────────────────── */}
      <Section id="modal" title="Modal">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          Standard dialogs used throughout the admin. File: <CodeHint text="artifacts/admin/src/components/ui/dialog.tsx" />
        </p>
        <Row label="Dialog triggers">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#00B6D6] hover:bg-[#0097B2] text-black gap-2">
                <Plus className="h-4 w-4" /> New Assessment Date
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0F1923] border-border text-white max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white">New Assessment Date</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Date <span className="text-red-400">*</span></Label>
                  <Input type="date" className="bg-[#1A2535] border-border text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Start Time</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["Hour", "Minute", "AM/PM"] as const).map((lbl, i) => (
                      <div key={lbl}>
                        <p className="text-[10px] text-muted-foreground mb-1">{lbl}</p>
                        <select
                          defaultValue={["9", "00", "AM"][i]}
                          className="w-full rounded-md border border-border bg-[#1A2535] px-2 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#00B6D6]"
                        >
                          {lbl === "Hour" && ["1","2","3","4","5","6","7","8","9","10","11","12"].map(v => <option key={v}>{v}</option>)}
                          {lbl === "Minute" && ["00","15","30","45"].map(v => <option key={v}>{v}</option>)}
                          {lbl === "AM/PM" && ["AM","PM"].map(v => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Capacity</Label>
                  <Input type="number" defaultValue="10" className="bg-[#1A2535] border-border text-white" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-border text-muted-foreground hover:text-white">
                  Cancel
                </Button>
                <Button className="bg-[#00B6D6] hover:bg-[#0097B2] text-black">Create Date</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">Delete action</Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0F1923] border-border text-white max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-white">Are you sure?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground py-2">
                This action cannot be undone.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} className="border-border text-muted-foreground hover:text-white">
                  Cancel
                </Button>
                <Button variant="destructive">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
      </Section>

      {/* ── 8. Sidebar Items ───────────────────────────────────────────────── */}
      <Section id="sidebar-items" title="Sidebar Items">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          NavItem component in all accent modes. File: <CodeHint text="artifacts/admin/src/components/layout/sidebar.tsx" />
        </p>
        <div className="grid grid-cols-3 gap-4">
          {/* Studio accent */}
          <div className="rounded-lg border border-border overflow-hidden" style={{ background: "hsl(204 46% 3%)" }}>
            <p className="text-[9px] uppercase tracking-widest text-[#00B6D755] font-semibold px-3 py-2">Studio</p>
            {[
              { icon: LayoutDashboard, name: "Dashboard" },
              { icon: Users, name: "Instructors" },
              { icon: CalendarDays, name: "Classes" },
              { icon: Ticket, name: "Bookings" },
            ].map((item, i) => (
              <SidebarItemPreview key={item.name} icon={item.icon} name={item.name} active={i === 0} accent="studio" />
            ))}
          </div>

          {/* Stage (Ballet) accent */}
          <div className="rounded-lg border border-border overflow-hidden" style={{ background: "hsl(204 46% 3%)" }}>
            <p className="text-[9px] uppercase tracking-widest text-[#00B6D655] font-semibold px-3 py-2">Stage (Ballet)</p>
            {[
              { icon: Music2, name: "Applications" },
              { icon: CalendarDays, name: "Assessment Dates" },
              { icon: Bell, name: "Pricing & Settings" },
            ].map((item, i) => (
              <SidebarItemPreview key={item.name} icon={item.icon} name={item.name} active={i === 1} accent="stage" />
            ))}
          </div>

          {/* General accent */}
          <div className="rounded-lg border border-border overflow-hidden" style={{ background: "hsl(204 46% 3%)" }}>
            <p className="text-[9px] uppercase tracking-widest text-[#9CA3AF55] font-semibold px-3 py-2">General</p>
            {[
              { icon: Bell, name: "Notifications" },
              { icon: Users, name: "System Users" },
            ].map((item, i) => (
              <SidebarItemPreview key={item.name} icon={item.icon} name={item.name} active={i === 0} accent="general" />
            ))}
          </div>
        </div>
      </Section>

      {/* ── 9. Page Headers ────────────────────────────────────────────────── */}
      <Section id="page-headers" title="Page Headers">
        <p className="text-xs text-muted-foreground px-1 -mt-2 mb-2">
          PageHeader component modes. File: <CodeHint text="artifacts/admin/src/components/layout/page-header.tsx" />
        </p>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-3">mode="studio"</p>
            <PageHeader title="Ballet Applications" description="Review and manage assessment applications" mode="studio" />
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-3">mode="stage"</p>
            <PageHeader title="Assessment Dates" description="Manage available assessment date slots" mode="stage" />
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-3">mode="general"</p>
            <PageHeader title="System Users" description="Manage admin accounts" mode="general" />
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div className="border-t border-border pt-6 text-center text-xs text-muted-foreground">
        🔬 Central Studio Design Lab — navigate to{" "}
        <code className="font-mono text-[#00B6D6]">/design-lab</code> · not linked in sidebar
      </div>
    </div>
  );
}
