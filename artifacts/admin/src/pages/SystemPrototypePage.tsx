import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import {
  Activity, ArrowLeft, ArrowUpRight, Check, ChevronDown, Landmark, LayoutDashboard,
  ListFilter, Megaphone, Moon, MoreHorizontal, Plus, RotateCw, ScanLine, Search, Settings2,
  ShieldCheck, Smartphone, Sun, Users, Warehouse,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { BallerinaIcon } from "@/components/icons/ballerina-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AttendanceRealPrototype, DashboardRealPrototype } from "./RealPagePrototypes";
import "./design-lab.css";
import "./reference-prototype.css";
import "./system-prototype.css";
import "./real-page-prototypes.css";

type Archetype = "analytics" | "registry" | "queue" | "detail" | "ledger" | "settings";
type Destination = { label: string; title?: string; archetype: Archetype; action?: string; localTabs?: string[] };
type ModuleDefinition = { icon: ElementType; primary: Destination[] };

const MODULES: Record<string, ModuleDefinition> = {
  Dashboard: { icon: LayoutDashboard, primary: [
    { label: "Overview", archetype: "analytics", action: "View report" }, { label: "Bookings", archetype: "queue", action: "Create booking" },
    { label: "Calendar", archetype: "registry", action: "Add event" }, { label: "Students", archetype: "registry", action: "Add student" },
    { label: "Packages", archetype: "registry", action: "Add package" },
  ] },
  Studio: { icon: Warehouse, primary: [
    { label: "Calendar", archetype: "registry", action: "Add event" }, { label: "Branches", archetype: "registry", action: "Add branch" },
    { label: "Instructors", archetype: "registry", action: "Add instructor" }, { label: "Classes", archetype: "registry", action: "Add class" },
    { label: "Schedules", archetype: "registry", action: "Add schedule" }, { label: "Packages", archetype: "registry", action: "Add package" },
  ] },
  Ballet: { icon: BallerinaIcon, primary: [
    { label: "Applications", title: "Ballet Applications", archetype: "queue", action: "New application" },
    { label: "Students", title: "Ballet Students", archetype: "registry", action: "Assign student" },
    { label: "Levels", title: "Ballet Levels", archetype: "registry", action: "Add level" },
    { label: "Instructors", title: "Ballet Instructors", archetype: "registry", action: "Add instructor" },
    { label: "Classes", title: "Ballet Classes", archetype: "registry", action: "Add class" },
    { label: "Schedules", title: "Ballet Schedules", archetype: "registry", action: "Add schedule" },
    { label: "Groups", title: "Ballet Groups", archetype: "registry", action: "Add group" },
    { label: "Packages", title: "Ballet Packages", archetype: "registry", action: "Add package" },
    { label: "Payments", title: "Ballet Payments", archetype: "ledger", action: "Export" },
    { label: "Cancellations", title: "Ballet Cancellation Requests", archetype: "queue", action: "Review requests" },
    { label: "Refunds", title: "Ballet Refunds", archetype: "ledger", action: "Review refund" },
    { label: "Performances", title: "Performance Opportunities", archetype: "queue", action: "Add opportunity" },
    { label: "Settings", title: "Ballet Settings", archetype: "settings", action: "Save changes", localTabs: ["Overview", "Home Card", "Contact", "Requirements", "FAQ", "Categories"] },
  ] },
  Marketing: { icon: Megaphone, primary: [
    { label: "Promotions", archetype: "registry", action: "Create promotion" }, { label: "Notifications", archetype: "queue", action: "New notification" },
    { label: "WhatsApp", title: "WhatsApp Campaigns", archetype: "analytics", action: "Create campaign" }, { label: "Feedback", archetype: "queue", action: "Export feedback" },
  ] },
  Finance: { icon: Landmark, primary: [
    { label: "Overview", title: "Finance Overview", archetype: "analytics", action: "Export report" },
    { label: "Transactions", archetype: "ledger", action: "Export ledger" }, { label: "Package Payments", archetype: "ledger", action: "Export" },
    { label: "Class Payments", title: "Class & Walk-in", archetype: "ledger", action: "Record payment" },
    { label: "Ballet Finance", archetype: "ledger", action: "Export" },
    { label: "Refunds & Corrections", archetype: "ledger", action: "Review refund" },
    { label: "Discounts", archetype: "ledger", action: "Add discount" }, { label: "Reports & Exports", archetype: "analytics", action: "Create export" },
  ] },
  People: { icon: Users, primary: [
    { label: "Students", archetype: "registry", action: "Add student" }, { label: "Parents", archetype: "registry", action: "Add parent" },
    { label: "Package Orders", archetype: "queue", action: "Export orders" }, { label: "Reports", archetype: "analytics", action: "Create report" },
  ] },
  System: { icon: ShieldCheck, primary: [
    { label: "Users", title: "System Users", archetype: "registry", action: "Add user" }, { label: "Roles", archetype: "registry", action: "Add role" },
    { label: "Logs", archetype: "ledger", action: "Export logs" },
  ] },
  App: { icon: Smartphone, primary: [
    { label: "Hero Slides", archetype: "settings", action: "Add slide" },
    { label: "Content", title: "App Content", archetype: "settings", action: "Save content" },
    { label: "FAQ", title: "App FAQ", archetype: "settings", action: "Add FAQ" },
    { label: "FAQ Categories", archetype: "settings", action: "Add category" },
    { label: "Contact", title: "Contact Links", archetype: "settings", action: "Add contact" },
  ] },
  Settings: { icon: Settings2, primary: [
    { label: "Pricing", title: "Class Pricing", archetype: "settings", action: "Save pricing" },
    { label: "Capacity", title: "Class Capacity", archetype: "settings", action: "Save capacity" },
    { label: "Reminders", title: "Class Reminders", archetype: "settings", action: "Save reminders" },
    { label: "Background Music", archetype: "settings", action: "Save music" },
    { label: "Dance Types", archetype: "settings", action: "Add dance type" },
  ] },
  Attendance: { icon: ScanLine, primary: [
    { label: "Attendance", archetype: "analytics", action: "Start check-in" },
  ] },
};

const MAIN_MODULES = ["Dashboard", "Studio", "Ballet", "Marketing", "Finance", "People", "System", "App"];
const MOCK_ROWS = [
  ["Layla Hassan", "Ballet Foundation", "Active", "11 Aug · 14:32"], ["Nour Ahmed", "Contemporary Flow", "Pending", "11 Aug · 13:08"],
  ["Adam Karim", "Hip-Hop Juniors", "Active", "10 Aug · 19:41"], ["Lina Mostafa", "Ballet Level 2", "Review", "10 Aug · 17:16"],
  ["Youssef Samir", "Jazz Beginners", "Inactive", "09 Aug · 10:22"],
];

function IconButton({ label, icon: Icon }: { label: string; icon: ElementType }) {
  return <button className="rf-icon-button" type="button" aria-label={label}><Icon size={15} strokeWidth={1.8} /></button>;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function MetricBand({ finance = false }: { finance?: boolean }) {
  const values = finance ? [["Gross collected", "EGP 284,930", "+12.4%"], ["Pending settlement", "EGP 18,420", "24 records"], ["Refund exposure", "EGP 6,815", "8 reviews"]] : [["Active records", "1,248", "+8.4%"], ["Pending review", "34", "12 today"], ["Completion rate", "92.6%", "+3.1%"]];
  return <section className="sys-metric-band">{values.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}<div className="sys-mini-signal"><i /><i /><i /><i /><i /></div></section>;
}

function CommandStrip({ title }: { title: string }) {
  return <div className="sys-command-strip"><span>Active filters <b>3</b></span><button type="button">All branches <ChevronDown size={11} /></button><button type="button">All statuses <ChevronDown size={11} /></button><button type="button">This month <ChevronDown size={11} /></button><label><Search size={13} /><input aria-label={`Search ${title}`} placeholder={`Search ${title.toLowerCase()}`} /></label></div>;
}

function LocalTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (tab: string) => void }) {
  return <div className="sys-local-tabs" role="tablist" aria-label="Local workspace navigation">{tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => onChange(tab)}>{tab}</button>)}</div>;
}

function RegistryArchetype({ title, onStudentDetail }: { title: string; onStudentDetail?: () => void }) {
  return <><MetricBand /><CommandStrip title={title} /><section className="sys-paper sys-registry"><div className="sys-paper-head"><div><span>Master data</span><h2>{title} registry</h2></div><span>5 of 248 records</span></div><div className="sys-table"><div className="sys-table-row sys-table-head"><span>Name</span><span>Assignment</span><span>Status</span><span>Last activity</span><span /></div>{MOCK_ROWS.map((row, index) => <div className={cn("sys-table-row", index === 1 && "is-selected")} key={row[0]}><span><i>{row[0].split(" ").map((part) => part[0]).join("")}</i><b>{row[0]}</b></span><span>{row[1]}</span><span><em>{row[2]}</em></span><span>{row[3]}</span><button type="button" aria-label={`View ${row[0]}`} onClick={onStudentDetail && index === 0 ? onStudentDetail : undefined}>{onStudentDetail && index === 0 ? "Open profile" : <MoreHorizontal size={14} />}</button></div>)}</div></section></>;
}

function QueueArchetype({ title }: { title: string }) {
  const [selected, setSelected] = useState(1);
  return <><MetricBand /><CommandStrip title={title} /><section className="sys-paper sys-master-detail"><div className="sys-queue"><div className="sys-paper-head"><div><span>Operations queue</span><h2>{title}</h2></div><span>Live · 14:32</span></div>{MOCK_ROWS.map((row, index) => <button key={row[0]} type="button" className={cn("sys-queue-row", selected === index && "is-selected")} onClick={() => setSelected(index)} aria-pressed={selected === index}><i>{row[0].split(" ").map((part) => part[0]).join("")}</i><span><strong>{row[0]}</strong><small>#{427010 + index} · {row[1]}</small></span><em>{row[2]}</em></button>)}</div><article className="sys-dark-detail"><div className="sys-detail-heading"><div><span>Selected record</span><strong>#{427010 + selected}</strong></div><div><span>Participant</span><strong>{MOCK_ROWS[selected][0]}</strong></div></div><div className="sys-detail-grid"><div><span>Program</span><strong>{MOCK_ROWS[selected][1]}</strong></div><div><span>Status</span><strong>{MOCK_ROWS[selected][2]}</strong></div><div><span>Branch</span><strong>New Cairo</strong></div><div><span>Updated</span><strong>{MOCK_ROWS[selected][3]}</strong></div></div><div className="sys-detail-actions"><button type="button">Message</button><button type="button">Edit</button><button className="is-primary" type="button"><Check size={13} />Review record</button></div></article></section></>;
}

function LedgerArchetype({ title, localTabs, activeTab, onTab }: { title: string; localTabs?: string[]; activeTab: string; onTab: (tab: string) => void }) {
  return <>{localTabs && <LocalTabs tabs={localTabs} active={activeTab} onChange={onTab} />}<MetricBand finance /><CommandStrip title={title} /><section className="sys-paper sys-ledger"><div className="sys-paper-head"><div><span>Financial ledger</span><h2>{activeTab || title}</h2></div><strong>EGP 284,930.00</strong></div><div className="sys-ledger-grid sys-ledger-head"><span>Reference</span><span>Source</span><span>Amount</span><span>Status</span><span>Recorded</span></div>{[["TX-80421","Package order","EGP 5,400","Settled","11 Aug · 14:22"],["TX-80420","Class booking","EGP 650","Pending","11 Aug · 13:48"],["TX-80419","Ballet renewal","EGP 8,900","Settled","11 Aug · 12:16"],["TX-80418","Walk-in","EGP 750","Review","11 Aug · 11:42"],["TX-80417","Refund","− EGP 1,200","Reconciled","10 Aug · 19:05"]].map((row,index)=><div className={cn("sys-ledger-grid",index===1&&"is-selected")} key={row[0]}>{row.map((cell,i)=><span key={cell} className={i===2?"is-amount":""}>{cell}</span>)}</div>)}</section></>;
}

function AnalyticsArchetype({ title }: { title: string }) {
  return <><div className="sys-analytics-top"><MetricBand /><article><span>Operational readiness</span><strong>94.2%</strong><div><i style={{width:"72%"}} /></div><small>Across 14 active workstreams</small></article></div><section className="sys-analytics-grid"><article className="sys-chart-panel"><div><span>Seven-day signal</span><h2>{title} movement</h2></div><div className="sys-chart"><i style={{height:"32%"}}/><i style={{height:"48%"}}/><i style={{height:"40%"}}/><i style={{height:"70%"}}/><i style={{height:"58%"}}/><i style={{height:"82%"}}/><i style={{height:"76%"}}/></div></article><article className="sys-paper sys-activity-panel"><div className="sys-paper-head"><div><span>Live activity</span><h2>Operational pulse</h2></div><span>Today</span></div>{["Ballet Foundation checked in","Package payment reconciled","New student profile created","Capacity warning reviewed"].map((item,index)=><div className="sys-activity-row" key={item}><b>{["14:10","14:18","14:32","14:44"][index]}</b><span>{item}</span><ArrowUpRight size={13}/></div>)}</article></section></>;
}

function SettingsArchetype({ title, localTabs, activeTab, onTab }: { title: string; localTabs?: string[]; activeTab: string; onTab: (tab: string) => void }) {
  const tabs = localTabs ?? ["Overview", "Configuration", "History"];
  return <><LocalTabs tabs={tabs} active={activeTab || tabs[0]} onChange={onTab} /><section className="sys-paper sys-settings-workspace"><aside><span>Workspace</span><h2>{activeTab || title}</h2>{["General", "Content", "Visibility", "Publishing"].map((item,index)=><button key={item} type="button" className={index===0?"is-selected":""}>{item}</button>)}</aside><div className="sys-settings-form"><div className="sys-form-head"><div><span>Configuration</span><h2>{title}</h2></div><span>Local preview only</span></div><label>Display title<input defaultValue={title} /></label><label>Operational description<textarea defaultValue={`Manage ${title.toLowerCase()} settings for Central Studio.`} /></label><div className="sys-toggle-row"><div><strong>Active in Admin</strong><small>Show this configuration in the future workspace.</small></div><button type="button" aria-pressed="true"><i /></button></div><div className="sys-form-actions"><button type="button">Discard</button><button type="button" className="is-primary">Save locally</button></div></div></section></>;
}

function DetailArchetype({ activeTab, onTab, onBack }: { activeTab: string; onTab: (tab: string) => void; onBack: () => void }) {
  const tabs = ["Overview", "Bookings", "Attendance", "Packages & Credits", "Timeline"];
  return <><section className="sys-identity-band"><button type="button" onClick={onBack}><ArrowLeft size={14}/>Students</button><i>LH</i><div><span>Student profile</span><h2>Layla Hassan</h2><small>ST-2026-0148 · Active since September 2024</small></div><div><span>Available credits</span><strong>7</strong></div><div><span>Attendance</span><strong>94%</strong></div><div><span>Bookings</span><strong>36</strong></div></section><LocalTabs tabs={tabs} active={activeTab} onChange={onTab}/><section className="sys-paper sys-detail-workspace"><article><span>{activeTab}</span><h2>{activeTab === "Overview" ? "Student at a glance" : `${activeTab} workspace`}</h2><p>Static future-state preview for Layla Hassan. This panel demonstrates how deep profile navigation remains inside the same product shell.</p><div className="sys-profile-grid"><div><span>Primary program</span><strong>Ballet Foundation</strong></div><div><span>Home branch</span><strong>New Cairo</strong></div><div><span>Parent contact</span><strong>Salma Hassan</strong></div><div><span>Last activity</span><strong>Today · 14:32</strong></div></div></article><aside><span>Recent timeline</span>{["Checked in to Ballet Foundation","Used one package credit","Booking confirmed","Profile contact updated"].map((item,index)=><div key={item}><b>{["14:32","13:48","Yesterday","08 Aug"][index]}</b><span>{item}</span></div>)}</aside></section></>;
}

export default function SystemPrototypePage({ navigationMode = "top" }: { navigationMode?: "top" | "hybrid" }) {
  const hybrid = navigationMode === "hybrid";
  const [activeModule, setActiveModule] = useState("Dashboard");
  const [activeMajorModule, setActiveMajorModule] = useState("Dashboard");
  const [activePage, setActivePage] = useState("Overview");
  const [activeLocalTab, setActiveLocalTab] = useState("");
  const [studentDetail, setStudentDetail] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark");
  const [refreshTick, setRefreshTick] = useState(0);
  const activePageRef = useRef<HTMLButtonElement>(null);
  const activeTrackRef = useRef<HTMLDivElement>(null);
  const [trackEdges, setTrackEdges] = useState({ start: false, end: false });
  const reduceMotion = usePrefersReducedMotion();
  const definition = MODULES[activeModule];
  const current = definition.primary.find((item) => item.label === activePage) ?? definition.primary[0];
  const title = studentDetail
    ? "Layla Hassan"
    : hybrid && activeModule === "Dashboard" && activePage === "Overview"
      ? "Operations Dashboard"
      : hybrid && activeModule === "Attendance"
        ? "Attendance & Check-In"
        : (current.title ?? current.label);
  const resolvedLocalTab = activeLocalTab || current.localTabs?.[0] || "";

  useEffect(() => { activePageRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" }); }, [activeModule, activePage]);

  const updateTrackEdges = useCallback(() => {
    const track = activeTrackRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const trackRect = track.getBoundingClientRect();
    let startCover = 0;
    let endCover = 0;
    Array.from(track.children).forEach((child) => {
      const rect = child.getBoundingClientRect();
      if (rect.left < trackRect.left - 1 && rect.right > trackRect.left + 1) startCover = Math.max(startCover, Math.ceil(rect.right - trackRect.left));
      if (rect.right > trackRect.right + 1 && rect.left < trackRect.right - 1) endCover = Math.max(endCover, Math.ceil(trackRect.right - rect.left));
    });
    track.style.setProperty("--sys-start-cover", `${startCover}px`);
    track.style.setProperty("--sys-end-cover", `${endCover}px`);
    setTrackEdges({ start: track.scrollLeft > 2, end: track.scrollLeft < maxScroll - 2 });
  }, []);

  useEffect(() => {
    const track = activeTrackRef.current;
    if (!track) return;
    updateTrackEdges();
    const observer = new ResizeObserver(updateTrackEdges);
    observer.observe(track);
    track.addEventListener("scroll", updateTrackEdges, { passive: true });
    return () => { observer.disconnect(); track.removeEventListener("scroll", updateTrackEdges); };
  }, [activeModule, activePage, updateTrackEdges]);

  const selectModule = (next: string) => { if (MAIN_MODULES.includes(next)) setActiveMajorModule(next); setActiveModule(next); setActivePage(MODULES[next].primary[0].label); setActiveLocalTab(""); setStudentDetail(false); };
  const selectDestination = (next: Destination) => { setActivePage(next.label); setActiveLocalTab(next.localTabs?.[0] ?? ""); setStudentDetail(false); };
  const content = useMemo(() => {
    if (hybrid && activeModule === "Dashboard" && activePage === "Overview") return <DashboardRealPrototype />;
    if (hybrid && activeModule === "Attendance") return <AttendanceRealPrototype />;
    if (studentDetail) return <DetailArchetype activeTab={resolvedLocalTab || "Overview"} onTab={setActiveLocalTab} onBack={() => { setStudentDetail(false); setActiveLocalTab(""); }} />;
    if (current.archetype === "registry") return <RegistryArchetype title={title} onStudentDetail={activeModule === "People" && activePage === "Students" ? () => { setStudentDetail(true); setActiveLocalTab("Overview"); } : undefined} />;
    if (current.archetype === "queue") return <QueueArchetype title={title} />;
    if (current.archetype === "ledger") return <LedgerArchetype title={title} localTabs={current.localTabs} activeTab={resolvedLocalTab} onTab={setActiveLocalTab} />;
    if (current.archetype === "settings") return <SettingsArchetype title={title} localTabs={current.localTabs} activeTab={resolvedLocalTab} onTab={setActiveLocalTab} />;
    return <AnalyticsArchetype title={title} />;
  }, [activeModule, activePage, current, hybrid, resolvedLocalTab, studentDetail, title]);

  const renderExpandedModule = (moduleName: string) => {
    const moduleDefinition = MODULES[moduleName];
    const ModuleIcon = moduleDefinition.icon;
    return <motion.div className="sys-expanded-module" key={moduleName} layoutId={`system-module-${moduleName}`} layout="size" initial={hybrid && !reduceMotion ? { opacity: 0, x: 6 } : false} animate={{ opacity: 1, x: 0 }} exit={hybrid && !reduceMotion ? { opacity: 0, x: -4 } : undefined} transition={{ duration: reduceMotion ? 0 : .19, ease: [.22, 1, .36, 1], layout: { duration: reduceMotion ? 0 : .21, ease: [.22, 1, .36, 1] } }}>
      <button className="sys-expanded-identity" type="button" onClick={() => selectModule(moduleName)} aria-label={`${moduleName} module active`} aria-current="true"><ModuleIcon /><span>{moduleName}</span></button>
      <div ref={activeTrackRef} className={cn("sys-active-track", trackEdges.start && "can-scroll-start", trackEdges.end && "can-scroll-end")} aria-label={`${moduleName} pages`} tabIndex={0}>
        {moduleDefinition.primary.map((item) => { const selected = activePage === item.label && !studentDetail; return <button ref={activePage === item.label ? activePageRef : undefined} key={item.label} type="button" className={selected ? "is-selected" : ""} onClick={() => selectDestination(item)} aria-pressed={selected}>{selected && <motion.span className="sys-active-page-indicator" layoutId="system-active-page" transition={{ layout: { duration: reduceMotion ? 0 : .19, ease: [.22, 1, .36, 1] } }} />}<span className="sys-page-label">{item.label}</span></button>; })}
      </div>
    </motion.div>;
  };

  const utilities = <div className="rf-utilities"><button className={cn("rf-icon-button", activeModule === "Attendance" && "is-active")} type="button" aria-label="Open Attendance workspace" onClick={() => selectModule("Attendance")}><ScanLine size={15}/></button><button className="rf-icon-button" type="button" aria-label="Refresh preview" onClick={() => setRefreshTick((tick) => tick + 1)}><RotateCw key={refreshTick} className={refreshTick ? "sys-refresh-spin" : ""} size={15}/></button><button className={cn("rf-icon-button", previewTheme === "light" && "is-active")} type="button" aria-label={`Use ${previewTheme === "dark" ? "light" : "dark"} preview theme`} aria-pressed={previewTheme === "light"} onClick={() => setPreviewTheme((theme) => theme === "dark" ? "light" : "dark")}>{previewTheme === "dark" ? <Moon size={15}/> : <Sun size={15}/>}</button><button className={cn("rf-icon-button", activeModule === "Settings" && "is-active")} type="button" aria-label="Open Settings navigation" onClick={() => selectModule("Settings")}><Settings2 size={15}/></button><button className="rf-profile" type="button" aria-label="Open admin profile"><span>AO</span></button></div>;

  const rail = hybrid && <aside className="sys-hybrid-rail" aria-label="Central Studio global navigation">
    <span className="rf-brand-mark sys-rail-brand" aria-hidden="true"><Activity size={18}/></span>
    <nav className="sys-rail-modules" aria-label="Global modules">
      {MAIN_MODULES.map((moduleName) => { const ModuleIcon = MODULES[moduleName].icon; const selected = activeMajorModule === moduleName; return <Tooltip key={moduleName}><TooltipTrigger asChild><motion.button type="button" className={cn("sys-rail-module", selected && "is-selected")} aria-label={`Open ${moduleName} module`} aria-current={selected ? "page" : undefined} onClick={() => selectModule(moduleName)} whileTap={reduceMotion ? undefined : { scale: .98 }}>{selected && <motion.span className="sys-rail-indicator" layoutId="system-rail-active" transition={{ layout: { duration: reduceMotion ? 0 : .2, ease: [.22, 1, .36, 1] } }}/>}<ModuleIcon/></motion.button></TooltipTrigger><TooltipContent side="right">{moduleName}</TooltipContent></Tooltip>; })}
    </nav>
    <span className="sys-rail-version">2.0</span>
  </aside>;

  return <div className={cn("admin2-lab admin2-reference system-prototype", hybrid && "sys-hybrid-shell")}>{rail}<main className="rf-frame">
    <header className="rf-header">
      <div className="rf-brand">{!hybrid && <span className="rf-brand-mark"><Activity size={18}/></span>}<span><strong>Central Studio</strong><small>{hybrid ? "Hybrid navigation experiment" : "Admin 2.0 prototype"}</small></span></div>
      <LayoutGroup id={hybrid ? "hybrid-navigation" : "system-navigation"}><nav className={cn("sys-dynamic-nav", hybrid && "sys-contextual-nav")} aria-label={hybrid ? `${activeModule} contextual pages` : "Central Studio modules"}>
        {hybrid ? <AnimatePresence mode="wait">{renderExpandedModule(activeModule)}</AnimatePresence> : <>{MAIN_MODULES.map((moduleName) => {
          if (activeModule === moduleName) return renderExpandedModule(moduleName);
          const ModuleIcon = MODULES[moduleName].icon;
          return <Tooltip key={moduleName}><TooltipTrigger asChild><motion.button layoutId={`system-module-${moduleName}`} transition={{ layout: { duration: reduceMotion ? 0 : .21, ease: [.22, 1, .36, 1] } }} className="sys-inactive-module" type="button" onClick={() => selectModule(moduleName)} aria-label={`Open ${moduleName} module`}><ModuleIcon /></motion.button></TooltipTrigger><TooltipContent>{moduleName}</TooltipContent></Tooltip>;
        })}{(activeModule === "Settings" || activeModule === "Attendance") && renderExpandedModule(activeModule)}</>}
      </nav></LayoutGroup>
      {utilities}
    </header>

    <section className="rf-titlebar"><div className="rf-title-group"><IconButton label="Back" icon={ArrowLeft}/><div className="sys-title-copy"><span>{activeModule}{studentDetail?" / Students":""}</span><h1>{title}</h1></div></div><div className="rf-title-actions"><IconButton label="Filter current page" icon={ListFilter}/><IconButton label="More page actions" icon={MoreHorizontal}/><button className="rf-primary-button" type="button"><Plus size={14}/>{studentDetail?"Add note":current.action??"Create"}</button></div></section>
    <AnimatePresence mode="wait" initial={false}><motion.div className="sys-content" key={`${activeModule}-${activePage}-${activeLocalTab}-${studentDetail?"detail":"page"}`} initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }} transition={{ duration: reduceMotion ? 0 : .19, ease: [.22, 1, .36, 1] }}>{content}</motion.div></AnimatePresence>
  </main></div>;
}
