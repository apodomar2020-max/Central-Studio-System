import { useState, type ElementType } from "react";
import {
  Activity,
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Edit3,
  Ellipsis,
  ListFilter,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "./design-lab.css";
import "./reference-prototype.css";

type BookingStatus = "Confirmed" | "Pending" | "Waitlist";

type Booking = {
  id: number;
  initials: string;
  name: string;
  reference: string;
  relative: string;
  status: BookingStatus;
  className: string;
  instructor: string;
  time: string;
  branch: string;
  payment: string;
  credit: string;
  capacity: string;
};

const BOOKINGS: Booking[] = [
  { id: 1, initials: "LH", name: "Layla Hassan", reference: "BK-427-008", relative: "in 18 min", status: "Confirmed", className: "Ballet Foundation", instructor: "Mariam Adel", time: "Today · 5:00 PM", branch: "Maadi", payment: "Package credit", credit: "7 remaining", capacity: "14 / 16" },
  { id: 2, initials: "NA", name: "Nour Ahmed", reference: "BK-427-012", relative: "in 42 min", status: "Confirmed", className: "Contemporary Flow", instructor: "Mariam Hassan", time: "Today · 7:00 PM", branch: "New Cairo", payment: "Package credit", credit: "4 remaining", capacity: "12 / 14" },
  { id: 3, initials: "AK", name: "Adam Karim", reference: "BK-427-016", relative: "in 1 hr", status: "Pending", className: "Hip-Hop Juniors", instructor: "Omar Nasser", time: "Today · 7:30 PM", branch: "Maadi", payment: "Cash due", credit: "Not reserved", capacity: "15 / 16" },
  { id: 4, initials: "LM", name: "Lina Mostafa", reference: "BK-427-019", relative: "tomorrow", status: "Waitlist", className: "Ballet Level 2", instructor: "Dina Fawzy", time: "Tomorrow · 6:00 PM", branch: "New Cairo", payment: "Monthly ballet", credit: "Active", capacity: "16 / 16" },
  { id: 5, initials: "YS", name: "Youssef Samir", reference: "BK-427-024", relative: "tomorrow", status: "Confirmed", className: "Jazz Beginners", instructor: "Tala Kamel", time: "Tomorrow · 8:00 PM", branch: "Maadi", payment: "Paid online", credit: "Drop-in", capacity: "9 / 14" },
];

const NAV_ITEMS = ["Overview", "Bookings", "Attendance", "Calendar", "Students", "Packages"];
const FILTERS = ["All branches", "All classes", "Today", "Confirmed"];

function IconButton({ label, icon: Icon, disabled = false }: { label: string; icon: ElementType; disabled?: boolean }) {
  return <button className="rf-icon-button" type="button" aria-label={label} disabled={disabled}><Icon size={15} strokeWidth={1.8} /></button>;
}

function Status({ value, inverse = false }: { value: BookingStatus; inverse?: boolean }) {
  return <span className={cn("rf-status", `rf-status-${value.toLowerCase()}`, inverse && "rf-status-inverse")}><i />{value}</span>;
}

function BookingRow({ booking, selected, onSelect }: { booking: Booking; selected: boolean; onSelect: () => void }) {
  return (
    <button className={cn("rf-booking-row", selected && "is-selected")} type="button" onClick={onSelect} aria-pressed={selected}>
      <span className="rf-avatar rf-avatar-small">{booking.initials}</span>
      <span className="rf-booking-person"><strong>{booking.name}</strong><small>#{booking.reference} · {booking.relative}</small></span>
      <Status value={booking.status} inverse={selected} />
      <span className="rf-row-more" aria-hidden="true"><MoreHorizontal size={15} /></span>
    </button>
  );
}

export default function ReferencePrototypePage() {
  const [nav, setNav] = useState("Bookings");
  const [selectedFilter, setSelectedFilter] = useState("All branches");
  const [selectedId, setSelectedId] = useState(2);
  const [queueView, setQueueView] = useState("All bookings");
  const selected = BOOKINGS.find((booking) => booking.id === selectedId) ?? BOOKINGS[1];

  return (
    <div className="admin2-lab admin2-reference">
      <main className="rf-frame">
        <header className="rf-header">
          <div className="rf-brand" aria-label="Central Studio Admin">
            <span className="rf-brand-mark"><Activity size={18} /></span>
            <span><strong>Central Studio</strong><small>Admin operations</small></span>
          </div>

          <nav className="rf-nav" aria-label="Prototype navigation">
            {NAV_ITEMS.map((item) => (
              <button key={item} type="button" className={nav === item ? "is-selected" : ""} onClick={() => setNav(item)} aria-pressed={nav === item}>{item}</button>
            ))}
          </nav>

          <div className="rf-utilities">
            <IconButton label="Search" icon={Search} />
            <IconButton label="Calendar" icon={CalendarDays} />
            <IconButton label="Notifications" icon={Bell} />
            <IconButton label="Settings" icon={Settings2} />
            <IconButton label="Sync unavailable" icon={RefreshCw} disabled />
            <button className="rf-profile" type="button" aria-label="Open admin profile"><span>AO</span></button>
          </div>
        </header>

        <section className="rf-titlebar" aria-labelledby="rf-page-title">
          <div className="rf-title-group">
            <IconButton label="Back" icon={ArrowLeft} />
            <h1 id="rf-page-title">Bookings</h1>
          </div>
          <div className="rf-title-actions">
            <IconButton label="List view" icon={ListFilter} />
            <button className="rf-secondary-button" type="button"><SlidersHorizontal size={14} />Manage view</button>
            <button className="rf-primary-button" type="button"><Plus size={14} />Create booking</button>
          </div>
        </section>

        <section className="rf-summary-grid" aria-label="Booking summary">
          <article className="rf-summary-main">
            <div className="rf-metrics">
              <div><span>Today&apos;s bookings</span><strong>128</strong><small>+8.4% from last Tuesday</small></div>
              <div><span>Upcoming this week</span><strong>374</strong><small>Across 42 scheduled classes</small></div>
              <div><span>Average attendance</span><strong>86<em>%</em></strong><small>12 classes completed today</small></div>
            </div>
            <div className="rf-activity-line" aria-label="Booking activity timeline">
              <div className="rf-timeline-labels"><span>9 AM</span><span>12 PM</span><span>3 PM</span><span>6 PM</span><span>9 PM</span></div>
              <div className="rf-timeline-track"><i style={{ width: "24%" }} /><i style={{ width: "16%" }} /><i style={{ width: "29%" }} /><i style={{ width: "11%" }} /></div>
              <div className="rf-timeline-avatars">
                <div className="rf-avatar-stack"><span>LH</span><span>NA</span><span>AK</span><b>+18</b></div>
                <div className="rf-avatar-stack"><span>LM</span><span>YS</span><b>+12</b></div>
                <div className="rf-avatar-stack"><span>MA</span><span>ON</span><span>DK</span><b>+24</b></div>
              </div>
            </div>
          </article>

          <article className="rf-capacity-panel">
            <div className="rf-panel-heading"><div><span>Today&apos;s attendance</span><strong>86 / 102</strong></div><IconButton label="Open attendance summary" icon={Ellipsis} /></div>
            <div className="rf-capacity-visual" aria-label="Attendance capacity by state">
              <div className="rf-capacity-bar rf-capacity-muted" style={{ height: "48%" }}><strong>16</strong><span>Expected</span></div>
              <div className="rf-capacity-bar rf-capacity-primary" style={{ height: "88%" }}><strong>74</strong><span>Checked in</span></div>
              <div className="rf-capacity-bar rf-capacity-dark" style={{ height: "62%" }}><strong>12</strong><span>Pending</span></div>
              <button type="button" className="rf-capacity-action">View attendance</button>
            </div>
          </article>
        </section>

        <section className="rf-filterbar" aria-label="Booking filters">
          <div className="rf-filter-label"><span>Active filters</span><b>4</b></div>
          <div className="rf-filter-pills">
            {FILTERS.map((filter) => <button key={filter} type="button" className={selectedFilter === filter ? "is-selected" : ""} onClick={() => setSelectedFilter(filter)} aria-pressed={selectedFilter === filter}>{filter}<ChevronDown size={12} /></button>)}
          </div>
          <label className="rf-search"><Search size={14} /><input aria-label="Search bookings" placeholder="Search bookings" /></label>
        </section>

        <section className="rf-workspace" aria-labelledby="rf-workspace-title">
          <div className="rf-workspace-head">
            <div><span>Operations queue</span><h2 id="rf-workspace-title">Upcoming bookings</h2></div>
            <div className="rf-workspace-tabs" role="tablist" aria-label="Booking status view">
              {[["All bookings", "128"], ["Pending", "12"], ["Waitlist", "8"]].map(([label, count]) => (
                <button key={label} type="button" role="tab" aria-selected={queueView === label} onClick={() => setQueueView(label)}>{label} <b>{count}</b></button>
              ))}
            </div>
            <div className="rf-workspace-tools"><IconButton label="Export bookings" icon={CircleDollarSign} /><IconButton label="More booking actions" icon={MoreHorizontal} /></div>
          </div>

          <div className="rf-workspace-body">
            <div className="rf-booking-list" aria-label="Booking queue">
              {BOOKINGS.map((booking) => <BookingRow key={booking.id} booking={booking} selected={booking.id === selectedId} onSelect={() => setSelectedId(booking.id)} />)}
            </div>

            <article className="rf-booking-detail" aria-live="polite">
              <div className="rf-detail-head">
                <div><span>Booking details</span><strong>#{selected.reference}</strong></div>
                <div><span>Branch</span><strong>{selected.branch}</strong></div>
                <div className="rf-detail-person"><span className="rf-avatar">{selected.initials}</span><div><span>Participant</span><strong>{selected.name}</strong></div></div>
              </div>

              <div className="rf-detail-cards">
                <div><span>Class</span><strong>{selected.className}</strong><small><Users size={12} />{selected.capacity} reserved</small></div>
                <div><span>Instructor</span><strong>{selected.instructor}</strong><small><Clock3 size={12} />Arrives 20 min early</small></div>
                <div><span>Date / time</span><strong>{selected.time}</strong><small><CalendarDays size={12} />Studio 2</small></div>
              </div>

              <div className="rf-detail-footer">
                <div className="rf-detail-stats">
                  <div><span>Payment</span><strong>{selected.payment}</strong></div>
                  <div><span>Package balance</span><strong>{selected.credit}</strong></div>
                  <div><span>Class capacity</span><strong>{selected.capacity}</strong></div>
                </div>
                <div className="rf-detail-actions">
                  <IconButton label="Edit booking" icon={Edit3} />
                  <IconButton label="Message participant" icon={MessageSquareText} />
                  <IconButton label="More selected booking actions" icon={MoreHorizontal} />
                  <button type="button" className="rf-primary-button"><Check size={14} />Check in</button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
