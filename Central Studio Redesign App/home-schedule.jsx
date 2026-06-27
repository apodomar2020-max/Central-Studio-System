/* global React */

function CHIcon({ name, size=16 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2.4, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'added':    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'used':     return <svg {...p}><path d="M12 19V5M5 12h14"/></svg>;
    case 'refunded': return <svg {...p}><path d="M3 12a9 9 0 0 0 15 6.7M21 12a9 9 0 0 0-15-6.7"/><path d="M3 4v4h4M21 20v-4h-4"/></svg>;
    case 'expired':  return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/></svg>;
    default: return null;
  }
}

const { useState: useSCH } = React;

/* ============================================================
   Central Studio — My Bookings (Part 1)
   Data, helpers, booking cards, assessment card, filters
   ============================================================ */

const BOOKINGS = [
{ id: 'b1', type: 'class', ref: 'CS000024', status: 'Confirmed', payStatus: 'Package Credit',
  name: 'Hip Hop Foundations', style: 'Hip Hop',
  student: { name: 'Omar', slot: 'child-omar' },
  inst: { name: 'Maya Reyes', slot: 'inst-maya' },
  day: 'Saturday', date: 'Jun 28, 2026', time: '9:00 PM', timeEnd: '11:00 PM', dur: '120 min', branch: 'Main Branch',
  pkg: { name: 'Premium Package', credits: 7, total: 10 }, paid: true, phase: 'upcoming',
  notes: 'Please arrive 15 min early for warm-up.' },
{ id: 'b2', type: 'assessment', ref: 'CS000025', status: 'Scheduled', payStatus: 'Free',
  name: 'Ballet Level Assessment', style: 'Ballet',
  student: { name: 'Layla', slot: 'child-layla' },
  inst: { name: 'Lena Park', slot: 'inst-lena' },
  day: 'Wednesday', date: 'Jul 2, 2026', time: '4:00 PM', timeEnd: '4:45 PM', dur: '45 min', branch: 'Main Branch',
  balletLevel: 'Beginner', assessResult: null, paid: true, phase: 'upcoming' },
{ id: 'b3', type: 'class', ref: 'CS000026', status: 'Pending', payStatus: 'Pending Payment',
  name: 'Salsa On2 Social', style: 'Salsa',
  student: { name: 'Nadine Adel', slot: 'profile-avatar' },
  inst: { name: 'Diego Santos', slot: 'inst-diego' },
  day: 'Tuesday', date: 'Jul 8, 2026', time: '7:00 PM', timeEnd: '8:30 PM', dur: '90 min', branch: 'Main Branch',
  paid: false, phase: 'upcoming', warningMsg: 'Seat not guaranteed until payment is completed.' },
{ id: 'b4', type: 'workshop', ref: 'CS000027', status: 'Confirmed', payStatus: 'Online Payment',
  name: 'Breaking Bootcamp — Week 4', style: 'Breaking',
  student: { name: 'Omar', slot: 'child-omar' },
  inst: { name: 'Kofi Mensah', slot: 'inst-kofi' },
  day: 'Sunday', date: 'Jul 13, 2026', time: '3:00 PM', timeEnd: '5:00 PM', dur: '120 min', branch: 'Main Branch',
  paid: true, phase: 'upcoming' },
{ id: 'b5', type: 'class', ref: 'CS000020', status: 'Attended', payStatus: 'Paid',
  name: 'Afro Heat', style: 'Afro',
  student: { name: 'Nadine Adel', slot: 'profile-avatar' },
  inst: { name: 'Aisha Bello', slot: 'inst-aisha' },
  day: 'Saturday', date: 'Jun 14, 2026', time: '11:00 AM', timeEnd: '12:00 PM', dur: '60 min', branch: 'Main Branch',
  paid: true, phase: 'past' },
{ id: 'b6', type: 'class', ref: 'CS000018', status: 'Completed', payStatus: 'Package Credit',
  name: 'Hip Hop Foundations', style: 'Hip Hop',
  student: { name: 'Omar', slot: 'child-omar' },
  inst: { name: 'Maya Reyes', slot: 'inst-maya' },
  day: 'Saturday', date: 'Jun 7, 2026', time: '9:00 PM', timeEnd: '11:00 PM', dur: '120 min', branch: 'Main Branch',
  pkg: { name: 'Premium Package', credits: 8, total: 10 }, paid: true, phase: 'past' },
{ id: 'b7', type: 'assessment', ref: 'CS000016', status: 'Accepted', payStatus: 'Free',
  name: 'Ballet Level Assessment', style: 'Ballet',
  student: { name: 'Layla', slot: 'child-layla' },
  inst: { name: 'Lena Park', slot: 'inst-lena' },
  day: 'Wednesday', date: 'May 28, 2026', time: '4:00 PM', timeEnd: '4:45 PM', dur: '45 min', branch: 'Main Branch',
  balletLevel: 'Beginner', assessResult: 'Intermediate', paid: true, phase: 'past' },
{ id: 'b8', type: 'class', ref: 'CS000015', status: 'Cancelled', payStatus: 'Refunded',
  name: 'Ballet Foundations', style: 'Ballet',
  student: { name: 'Layla', slot: 'child-layla' },
  inst: { name: 'Lena Park', slot: 'inst-lena' },
  day: 'Thursday', date: 'Jun 5, 2026', time: '5:00 PM', timeEnd: '6:30 PM', dur: '90 min', branch: 'Main Branch',
  paid: true, phase: 'cancelled' },
{ id: 'b9', type: 'class', ref: 'CS000014', status: 'No Show', payStatus: 'Paid',
  name: 'Hip Hop Foundations', style: 'Hip Hop',
  student: { name: 'Omar', slot: 'child-omar' },
  inst: { name: 'Maya Reyes', slot: 'inst-maya' },
  day: 'Saturday', date: 'May 31, 2026', time: '9:00 PM', timeEnd: '11:00 PM', dur: '120 min', branch: 'Main Branch',
  paid: true, phase: 'cancelled' }];


/* ─── config maps ───────────────────────────────────────────── */
const TYPE_CFG = {
  class: { label: 'Class', color: 'var(--cs-cyan-400)', rgb: '45,205,236' },
  assessment: { label: 'Assessment', color: 'var(--cs-cyan-400)', rgb: '167,139,250' },
  private: { label: 'Private', color: '#FFB81C', rgb: '255,184,28' },
  workshop: { label: 'Workshop', color: 'var(--cs-amber-500)', rgb: '255,176,46' },
  masterclass: { label: 'Masterclass', color: 'var(--cs-magenta-500)', rgb: '255,46,126' }
};
const STATUS_CFG = {
  Confirmed: { c: 'var(--cs-success-500)', bg: 'rgba(31,184,113,0.16)' },
  Pending: { c: 'var(--cs-amber-500)', bg: 'rgba(255,176,46,0.16)' },
  Attended: { c: 'var(--cs-cyan-400)', bg: 'rgba(0,182,215,0.14)' },
  Completed: { c: 'var(--cs-cyan-400)', bg: 'rgba(0,182,215,0.14)' },
  Cancelled: { c: 'var(--cs-danger-500)', bg: 'rgba(255,59,71,0.12)' },
  Rejected: { c: '#c0392b', bg: 'rgba(192,57,43,0.14)' },
  'No Show': { c: 'var(--cs-ink-400)', bg: 'rgba(255,255,255,0.06)' },
  Scheduled: { c: 'var(--cs-cyan-400)', bg: 'rgba(0,182,215,0.14)' },
  Accepted: { c: 'var(--cs-success-500)', bg: 'rgba(31,184,113,0.16)' }
};
const PAY_CFG = {
  'Paid': { c: 'var(--cs-success-500)', ic: '✓' },
  'Package Credit': { c: 'var(--cs-cyan-400)', ic: 'P' },
  'Free': { c: 'var(--cs-success-500)', ic: '✓' },
  'Pending Payment': { c: 'var(--cs-amber-500)', ic: '!' },
  'Refunded': { c: 'var(--cs-cyan-400)', ic: '↩' },
  'Online Payment': { c: 'var(--cs-success-500)', ic: '✓' },
  'Cash At Studio': { c: 'var(--cs-ink-300)', ic: '$' }
};

/* ─── icon ──────────────────────────────────────────────────── */
function SBI({ name, size = 18, stroke = 2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'cal':return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'clock':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
    case 'pin':return <svg {...p}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
    case 'chevron':return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'check':return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'alert':return <svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 4 2 20h20L13.7 4a2 2 0 0 0-3.4 0Z" /></svg>;
    case 'search':return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.4-4.4" /></svg>;
    case 'x':return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'plus':return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case 'eye':return <svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'edit':return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case 'cancel':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>;
    case 'download':return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></svg>;
    case 'phone':return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" /></svg>;
    case 'back':return <svg {...p}><path d="M15 18l-6-6 6-6" /></svg>;
    default:return null;
  }
}

/* ─── small reusable atoms ──────────────────────────────────── */
function StatusPill({ status }) {
  const s = STATUS_CFG[status] || { c: 'var(--cs-ink-400)', bg: 'rgba(255,255,255,0.06)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
      background: s.bg, color: s.c, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.c }} />{status}
    </span>);

}
function PayPill({ payStatus }) {
  const p = PAY_CFG[payStatus] || { c: 'var(--cs-ink-400)', ic: '—' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: 'var(--role-body-sm)', fontSize: 11.5, color: p.c, fontWeight: 700 }}>
      <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.07)', fontSize: 10 }}>{p.ic}</span>
      {payStatus}
    </span>);

}
function MiniSlot({ slot, name, label, size = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <image-slot id={slot + '-bk'} shape="circle" placeholder={name[0]} style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }}></image-slot>
      <div>
        <div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13.5, color: '#fff' }}>{name}</div>
      </div>
    </div>);

}
function PackageMeter({ pkg }) {
  if (!pkg) return null;
  const pct = Math.round(pkg.credits / pkg.total * 100);
  return (
    <div style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(0,182,215,0.07)', border: '1px solid rgba(0,182,215,0.22)', marginTop: 10, width: "321px" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5, color: 'var(--cs-cyan-400)' }}>{pkg.name}</span>
        <span style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-300)', fontWeight: 600 }}>{pkg.credits} credits left</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)' }}>
        <div style={{ height: '100%', width: pct + '%', borderRadius: 2, background: 'linear-gradient(90deg,var(--cs-cyan-500),var(--cs-cyan-400))', transition: 'width 600ms' }} />
      </div>
    </div>);

}
function ActionBtn({ label, icon, primary, danger, ghost, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '9px 13px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: 'none',
      fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap',
      background: primary ? 'var(--cs-cyan-500)' : danger ? 'rgba(255,59,71,0.12)' : 'rgba(255,255,255,0.07)',
      color: primary ? 'var(--cs-ink-900)' : danger ? 'var(--cs-danger-500)' : 'var(--cs-ink-200)', justifyContent: "center", width: "175px", height: "48px" }}>
      {icon && <SBI name={icon} size={14} stroke={2.4} />}{label}
    </button>);

}

/* ─── regular booking card ──────────────────────────────────── */
function BookingCard({ b, onSelect, onToast }) {
  const tc = TYPE_CFG[b.type] || TYPE_CFG.class;
  return (
    <div style={{ display: 'flex', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {/* colored type strip */}
      <div style={{ width: 4, flexShrink: 0, background: tc.color }} />
      <div style={{ flex: 1, padding: '14px 14px' }}>
        {/* row 1: type tag + status + ref */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ padding: '3px 8px', borderRadius: 'var(--radius-pill)', background: `rgba(${tc.rgb},0.16)`, color: tc.color, fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{tc.label}</span>
            <StatusPill status={b.status} />
          </div>
          
        </div>
        {/* class name */}
        <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, color: '#fff', lineHeight: 1.15, marginBottom: 10 }}>{b.name}</h3>
        {/* schedule */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', font: 'var(--role-body-sm)', fontSize: 13, color: 'var(--cs-ink-300)', fontWeight: 600, marginBottom: 10, flexFlow: "column wrap", alignItems: "flex-start" }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><SBI name="cal" size={14} stroke={2} color="var(--cs-cyan-400)" />{b.day} · {b.date}</span>
          <span style={{ display: 'inline-flex', gap: 5, whiteSpace: 'nowrap', flexDirection: "row", width: "313px", alignItems: "flex-start" }}><SBI name="clock" size={13} stroke={2} color="var(--cs-ink-400)" />{b.time} – {b.timeEnd} · {b.dur}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><SBI name="pin" size={13} stroke={2} color="var(--cs-ink-400)" />{b.branch}</span>
        </div>
        {/* student + instructor */}
        <div style={{ display: 'flex', gap: 18, marginBottom: 10, flexDirection: "row" }}>
          <MiniSlot slot={b.student.slot} name={b.student.name} label="Student" />
          <MiniSlot slot={b.inst.slot} name={b.inst.name} label="Instructor" />
        </div>
        {/* payment */}
        <div style={{ marginBottom: b.pkg || b.warningMsg ? 0 : 2, width: "317px" }}>
          <PayPill payStatus={b.payStatus} />
        </div>
        {/* package meter */}
        {b.pkg && <PackageMeter pkg={b.pkg} />}
        {/* payment warning */}
        {b.warningMsg &&
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(255,176,46,0.10)', border: '1px solid rgba(255,176,46,0.28)', marginTop: 10 }}>
            <SBI name="alert" size={15} stroke={2.4} color="var(--cs-amber-500)" />
            <span style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-amber-400)', lineHeight: 1.45 }}>{b.warningMsg}</span>
          </div>
        }
        {/* actions */}
        <div className="hscroll" style={{ marginTop: 13, paddingBottom: 2, width: "319px", flexDirection: "row", gap: "10px", alignItems: "stretch", justifyContent: "space-between" }}>
          <ActionBtn label="View Details" icon="eye" onClick={() => onSelect(b)} />
          
          {b.phase === 'upcoming' && b.status !== 'Cancelled' && <ActionBtn label="Cancel" icon="cancel" danger onClick={() => onToast('Cancellation submitted')} />}
          {!b.paid && <ActionBtn label="Pay Now" primary onClick={() => onToast('Redirecting to payment…')} />}
          {b.paid && b.phase !== 'upcoming' && <ActionBtn label="Receipt" icon="download" onClick={() => onToast('Downloading receipt…')} />}
          
        </div>
      </div>
    </div>);

}

/* ─── ballet assessment card (special design) ──────────────── */
function AssessmentCard({ b, onSelect, onToast }) {
  const assessStatus = { Pending: STATUS_CFG.Pending, Accepted: STATUS_CFG.Accepted, Rejected: STATUS_CFG.Cancelled, Scheduled: STATUS_CFG.Scheduled };
  const s = assessStatus[b.status] || STATUS_CFG.Scheduled;
  return (
    <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid rgba(0,182,215,0.30)' }}>
      {/* gradient header */}
      <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, rgba(0,182,215,0.18) 0%, rgba(0,182,215,0.12) 100%)', borderBottom: '1px solid rgba(0,182,215,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.22)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Ballet Assessment</span>
            <StatusPill status={b.status} />
          </div>
          
        </div>
        <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff', marginBottom: 6 }}>{b.name}</h3>
        <div style={{ display: 'flex', gap: 16 }}>
          <MiniSlot slot={b.student.slot} name={b.student.name} label="Student" size={26} />
          {b.balletLevel &&
          <div>
              <div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Level</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13.5, color: 'var(--cs-cyan-400)' }}>{b.balletLevel}</div>
            </div>
          }
          {b.assessResult &&
          <div>
              <div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Result</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13.5, color: 'var(--cs-success-500)' }}>{b.assessResult}</div>
            </div>
          }
        </div>
      </div>
      {/* body */}
      <div style={{ padding: '12px 16px', background: 'var(--cs-ink-800)' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px', font: 'var(--role-body-sm)', fontSize: 13, color: 'var(--cs-ink-300)', fontWeight: 600, marginBottom: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><SBI name="cal" size={14} stroke={2} color="var(--cs-cyan-400)" />{b.day} · {b.date}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><SBI name="clock" size={13} stroke={2} color="var(--cs-ink-400)" />{b.time} – {b.timeEnd} · {b.dur}</span>
        </div>
        <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
          <MiniSlot slot={b.inst.slot} name={b.inst.name} label="Assessor" size={26} />
          <div><div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Branch</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13.5, color: '#fff' }}>{b.branch}</div></div>
        </div>
        <PayPill payStatus={b.payStatus} />
        <div className="hscroll" style={{ gap: 8, marginTop: 12, paddingBottom: 2 }}>
          <ActionBtn label="View Details" icon="eye" onClick={() => onSelect(b)} />
          
          <ActionBtn label="Contact Studio" icon="phone" onClick={() => onToast('Opening studio contact…')} />
        </div>
      </div>
    </div>);

}

/* ─── empty state ───────────────────────────────────────────── */
function BookingEmptyState({ phase, onNew }) {
  const cfg = {
    upcoming: { title: 'No upcoming bookings', sub: 'Your next dance adventure is waiting for you.', cta: 'Book a Class' },
    past: { title: 'No booking history yet', sub: 'Completed bookings and attendance will show up here.', cta: null },
    cancelled: { title: 'No cancelled bookings', sub: 'Looks like you\'ve kept every appointment. Keep it up!', cta: null }
  };
  const e = cfg[phase] || cfg.upcoming;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 30px', textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,182,215,0.10)', color: 'var(--cs-cyan-400)', marginBottom: 18 }}>
        <SBI name="cal" size={34} stroke={1.6} />
      </div>
      <h3 style={{ font: 'var(--role-h4)', fontSize: 21, color: '#fff', marginBottom: 8 }}>{e.title}</h3>
      <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-400)', maxWidth: 230, lineHeight: 1.5, marginBottom: e.cta ? 20 : 0 }}>{e.sub}</p>
      {e.cta && <button onClick={onNew} style={{ padding: '13px 24px', borderRadius: 'var(--radius-pill)', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer' }}>{e.cta}</button>}
    </div>);

}

Object.assign(window, {
  BOOKINGS, TYPE_CFG, STATUS_CFG, PAY_CFG,
  SBI, StatusPill, PayPill, MiniSlot, PackageMeter, ActionBtn,
  BookingCard, AssessmentCard, BookingEmptyState
});