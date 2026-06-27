/* global React */
const { useState: usePS } = React;

/* ============================================================
   Central Studio — Profile tab
   Personal control center: identity, stats, studio pass,
   account management, attendance, settings, children (parent).
   ============================================================ */

function PIcon({ name, size = 20, stroke = 2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'edit':     return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></svg>;
    case 'bookings': return <svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
    case 'package':  return <svg {...p}><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" /><path d="m4 6.5 8 4.5 8-4.5M12 11v9" /></svg>;
    case 'credits':  return <svg {...p}><circle cx="9" cy="9" r="6" /><path d="M14.5 5.3a6 6 0 1 1 0 13.4" /></svg>;
    case 'history':  return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4M12 8v4l3 2" /></svg>;
    case 'bell':     return <svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case 'help':     return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" /><circle cx="12" cy="17" r="0.6" fill={color} stroke="none" /></svg>;
    case 'shield':   return <svg {...p}><path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" /></svg>;
    case 'lock':     return <svg {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
    case 'privacy':  return <svg {...p}><path d="M6 3h9l5 5v13H6V3Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
    case 'chevron':  return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'plus':     return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case 'mail':     return <svg {...p}><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="m3 6.5 9 6 9-6" /></svg>;
    case 'phone':    return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" /></svg>;
    case 'check':    return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'expand':   return <svg {...p}><path d="M8 3H3v5M16 3h5v5M16 21h5v-5M8 21H3v-5" /></svg>;
    case 'logout':   return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
    case 'star':     return <svg {...p} fill={color} stroke="none"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z" /></svg>;
    case 'flame':    return <svg {...p}><path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 .5-1.5.5-1.5C16 11 17 13 17 15a5 5 0 0 1-10 0c0-4 3-5 5-12Z" /></svg>;
    default: return null;
  }
}

const PROFILE_USER = {
  name: 'Nadine Adel', email: 'Nadine@example.com', phone: '011 2345 6789',
  verified: true, role: 'Parent', provider: 'Local',
  credits: 7, upcoming: 18, attended: 10, streak: 5,
};
const CHILDREN = [
  { id: 'omar', name: 'Omar', gender: 'Boy', age: 3, born: '2022-09-16', slot: 'child-omar' },
  { id: 'layla', name: 'Layla', gender: 'Girl', age: 6, born: '2019-05-02', slot: 'child-layla' },
];
const ATTENDANCE = [
  { cls: 'Hip Hop Foundations', inst: 'Maya Reyes', when: 'Mon · 6:30 PM', status: 'Attended' },
  { cls: 'Salsa On2 Social', inst: 'Diego Santos', when: 'Tue · 7:00 PM', status: 'Late' },
  { cls: 'Afro Heat', inst: 'Aisha Bello', when: 'Sat · 11:00 AM', status: 'Missed' },
  { cls: 'Breaking Bootcamp', inst: 'Kofi Mensah', when: 'Thu · 6:00 PM', status: 'Attended' },
];
const CREDIT_LOG = [
  { delta: '+4', reason: 'Package purchase', date: 'Jun 12', bal: 7 },
  { delta: '-1', reason: 'Class attendance · Hip Hop', date: 'Jun 10', bal: 3 },
  { delta: '-1', reason: 'Class attendance · Salsa', date: 'Jun 8', bal: 4 },
];

/* ---------- small building blocks ---------- */
function GroupLabel({ children }) {
  return <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-ink-400)', padding: '0 4px', marginBottom: 10 }}>{children}</div>;
}
function Group({ label, children }) {
  return (
    <section style={{ padding: '0 20px', marginBottom: 24 }}>
      {label && <GroupLabel>{label}</GroupLabel>}
      <div style={{ background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {children}
      </div>
    </section>
  );
}
function Row({ icon, tint = 'var(--cs-cyan-400)', label, sub, value, badge, onClick, danger, last }) {
  const [h, setH] = usePS(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '14px 16px', background: h ? 'rgba(255,255,255,0.03)' : 'transparent', border: 'none',
        borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.06)', transition: 'background 140ms' }}>
      <span style={{ width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)',
        background: danger ? 'rgba(255,59,71,0.12)' : 'rgba(255,255,255,0.06)', color: danger ? 'var(--cs-danger-500)' : tint }}>
        <PIcon name={icon} size={19} stroke={2.1} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: danger ? 'var(--cs-danger-500)' : '#fff' }}>{label}</span>
        {sub && <span style={{ display: 'block', font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-400)', marginTop: 1 }}>{sub}</span>}
      </span>
      {value && <span style={{ font: 'var(--role-body-sm)', fontWeight: 600, color: 'var(--cs-ink-300)' }}>{value}</span>}
      {badge}
      <PIcon name="chevron" size={17} stroke={2.4} color="var(--cs-ink-500)" />
    </button>
  );
}

/* faux QR — deterministic grid, mockup only */
function FauxQR({ size = 150, dark = '#0A0B0D', light = '#fff' }) {
  const n = 21;
  const cells = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const finder = (cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
    const inFinder = finder(0, 0) || finder(n - 7, 0) || finder(0, n - 7);
    let on;
    if (inFinder) {
      const fx = x < 7 ? x : x - (n - 7), fy = y < 7 ? y : y - (n - 7);
      const ring = fx === 0 || fx === 6 || fy === 0 || fy === 6;
      const core = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4;
      on = ring || core;
    } else {
      on = ((x * 73 + y * 137 + x * y * 17) % 100) > 52;
    }
    if (on) cells.push(<rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill={dark} />);
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} style={{ background: light, borderRadius: 8, display: 'block', shapeRendering: 'crispEdges' }}>
      {cells}
    </svg>
  );
}

function StatCard({ icon, value, label, tint }) {
  return (
    <div style={{ flex: 1, background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)', padding: '14px 12px', textAlign: 'center' }}>
      <span style={{ display: 'inline-grid', placeItems: 'center', width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', color: tint, marginBottom: 8 }}>
        <PIcon name={icon} size={18} stroke={2.2} />
      </span>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: '#fff', lineHeight: 0.9 }}>{value}</div>
      <div style={{ font: 'var(--role-body-sm)', fontSize: 11.5, color: 'var(--cs-ink-400)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function AttPill({ status }) {
  const map = { Attended: 'var(--cs-success-500)', Late: 'var(--cs-amber-500)', Missed: 'var(--cs-danger-500)', Cancelled: 'var(--cs-ink-400)' };
  const c = map[status] || 'var(--cs-ink-400)';
  return <span style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.05)', color: c, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11 }}>{status}</span>;
}

function ChildCard({ c, onEdit, onDelete }) {
  const tint = c.gender === 'Girl' ? 'var(--cs-magenta-500)' : 'var(--cs-cyan-400)';
  const tintRgb = c.gender === 'Girl' ? '255,46,126' : '45,205,236';
  // Gender avatar SVG icons (no image-slot)
  const BoyIcon = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      <path d="M17 3h4v4M17 7l4-4"/>
    </svg>
  );
  const GirlIcon = () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      <path d="M12 16v5M9.5 18.5h5"/>
    </svg>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: `rgba(${tintRgb},0.13)`,
          boxShadow: `0 0 0 2px ${tint}`,
          color: tint }}>
          {c.gender === 'Girl' ? <GirlIcon /> : <BoyIcon />}
        </div>
        <span style={{ position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: '50%', background: tint, border: '2px solid var(--cs-ink-800)', display:'grid', placeItems:'center' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--cs-ink-900)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            {c.gender === 'Girl' ? <><path d="M12 16v5M9.5 18.5h5"/><circle cx="12" cy="8" r="4"/></> : <><path d="M17 3h4v4M17 7l4-4"/><circle cx="10" cy="10" r="4"/></>}
          </svg>
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, color: '#fff' }}>{c.name}</span>
          <span style={{ font: 'var(--role-eyebrow)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: tint }}>{c.gender}</span>
        </div>
        <div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-400)', marginTop: 2 }}>Age {c.age} · Born {c.born}</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onEdit} aria-label="Edit child" style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--cs-ink-200)' }}><PIcon name="edit" size={16} /></button>
      </div>
    </div>
  );
}

/* ---------- main ---------- */
function Profile({ accountType = 'parent', onToast, onSchedule, onSignOut }) {
  const u = PROFILE_USER;
  const isParent = accountType === 'parent';
  const [profilePage, setProfilePage] = usePS('main');
  const nav = (p) => setProfilePage(p);
  const t = (m) => onToast && onToast(m);
  const badge = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
      background: 'rgba(31,184,113,0.16)', color: 'var(--cs-success-500)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11.5 }}>
      <PIcon name="check" size={12} stroke={3} /> Verified
    </span>
  );

  const PageComp = profilePage !== 'main' ? (window.PROFILE_PAGES || {})[profilePage] : null;
  return (
    <>
    {PageComp && <PageComp onBack={() => setProfilePage('main')} onToast={onToast} user={u} />}
    <div className="feed tab-pop" style={{ paddingBottom: 120, visibility: PageComp ? 'hidden' : 'visible' }}>
      {/* identity header */}
      <div style={{ padding: '66px 20px 22px', textAlign: 'center', background: 'radial-gradient(120% 90% at 50% -10%, rgba(0,182,215,0.16) 0%, transparent 60%)' }}>
        <div style={{ display: 'inline-block', position: 'relative' }}>
          <image-slot id="profile-avatar" shape="circle" placeholder={u.name[0]} style={{ width: 92, height: 92, borderRadius: '50%', boxShadow: '0 0 0 3px var(--cs-cyan-500), 0 0 28px rgba(0,182,215,0.4)' }}></image-slot>
          {/* Instagram-style verified badge on photo */}
          <span style={{ position: 'absolute', bottom: 2, right: 2, width: 26, height: 26, borderRadius: '50%', background: 'var(--cs-cyan-500)', border: '3px solid var(--cs-ink-900)', display: 'grid', placeItems: 'center', boxShadow: '0 2px 8px rgba(0,182,215,0.5)' }}>
            <PIcon name="check" size={14} stroke={3} color="var(--cs-ink-900)" />
          </span>
        </div>
        <h1 style={{ font: 'var(--role-h2)', fontSize: 28, color: '#fff', marginTop: 14, letterSpacing: 'var(--ls-tight)' }}>{u.name}</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', marginTop: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)' }}><PIcon name="mail" size={15} color="var(--cs-ink-400)" />{u.email}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', whiteSpace: 'nowrap' }}><PIcon name="phone" size={15} color="var(--cs-ink-400)" />{u.phone}</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12.5, color: 'var(--cs-cyan-400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.role}</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--cs-ink-500)' }} />
          <span style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)' }}>{u.provider} account</span>
        </div>
      </div>

      {/* quick stats */}
      <div style={{ display: 'flex', gap: 10, padding: '0 20px', marginBottom: 24 }}>
        <StatCard icon="credits" value={u.credits} label="Credits" tint="var(--cs-cyan-400)" />
        <StatCard icon="bookings" value={u.upcoming} label="Upcoming" tint="var(--cs-amber-500)" />
        <StatCard icon="check" value={u.attended} label="Attended" tint="var(--cs-success-500)" />
      </div>

      {/* studio pass */}
      <section style={{ padding: '0 20px', marginBottom: 24 }}>
        <GroupLabel>My Studio Pass</GroupLabel>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 18, borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(135deg, rgba(0,182,215,0.16), rgba(0,182,215,0.12))', border: '1px solid rgba(0,182,215,0.4)' }}>
          <div style={{ padding: 8, background: '#fff', borderRadius: 10, flexShrink: 0 }}><FauxQR size={104} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 6 }}>Member pass</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, color: '#fff' }}>{u.name}</div>
            <div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)', marginTop: 2 }}>Show at reception to check in</div>
            <button onClick={() => nav('studioPass')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '8px 14px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', border: 'none', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap' }}>
              <PIcon name="expand" size={14} stroke={2.4} /> Full screen
            </button>
          </div>
        </div>
      </section>

      {/* account management */}
      <Group label="Account">
        <Row icon="edit" label="Edit Profile" sub="Name, phone, photo, address" onClick={() => nav('editProfile')} />
        <Row icon="bookings" tint="var(--cs-amber-500)" label="My Bookings" value="18" onClick={() => onSchedule && onSchedule()} />
        <Row icon="package" tint="var(--cs-violet-500)" label="Package Center" sub="Active packages & credits" value={`${u.credits} cr`} onClick={() => nav('packageCenter')} />
        <Row icon="history" label="Credit History" sub={`${CREDIT_LOG[0].delta} · ${CREDIT_LOG[0].reason}`} onClick={() => nav('creditHistory')} last />
      </Group>

      {/* attendance */}
      <section style={{ padding: '0 20px', marginBottom: 24 }}>
        <GroupLabel>Attendance history</GroupLabel>
        <div style={{ background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {ATTENDANCE.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i === ATTENDANCE.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: a.status === 'Attended' ? 'var(--cs-success-500)' : a.status === 'Late' ? 'var(--cs-amber-500)' : 'var(--cs-danger-500)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14.5, color: '#fff' }}>{a.cls}</div>
                <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', marginTop: 1 }}>{a.inst} · {a.when}</div>
              </div>
              <AttPill status={a.status} />
            </div>
          ))}
        </div>
      </section>

      {/* children (parent only) */}
      {isParent && (
        <section style={{ padding: '0 20px', marginBottom: 24 }}>
          <GroupLabel>Children</GroupLabel>
          <div style={{ background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            {CHILDREN.map(c => <ChildCard key={c.id} c={c} onEdit={() => t(`Edit ${c.name}`)} />)}
            <button onClick={() => t('Add a child profile')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14 }}>
              <PIcon name="plus" size={18} stroke={2.4} /> Add Child
            </button>
          </div>
        </section>
      )}

      {/* notifications + help */}
      <Group label="Activity & support">
        <Row icon="bell" tint="var(--cs-magenta-500)" label="Notifications" sub="Reminders, offers, updates" badge={<span style={{ minWidth: 20, height: 20, padding: '0 6px', display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--cs-magenta-500)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11 }}>3</span>} onClick={() => nav('notifications')} />
        <Row icon="help" label="Help & Support" sub="FAQ, contact, submit an issue" onClick={() => nav('helpSupport')} last />
      </Group>

      {/* security */}
      <Group label="Privacy & security">
        <Row icon="lock" label="Change Password" onClick={() => nav('changePassword')} />
        <Row icon="mail" label="Email Verification" badge={badge} onClick={() => nav('emailVerification')} />
        <Row icon="shield" tint="var(--cs-amber-500)" label="Two-Factor Auth" sub="Add an extra layer" value="Off" onClick={() => nav('twoFA')} />
        <Row icon="privacy" label="Privacy & Permissions" sub="Policy, terms, data usage" onClick={() => nav('privacy')} last />
      </Group>

      <Group>
        <Row icon="logout" label="Sign Out" sub="Sign out from the app" danger onClick={() => { t('Signing out…'); setTimeout(() => onSignOut && onSignOut(), 600); }} last />
      </Group>

      <div style={{ textAlign: 'center', font: 'var(--role-body-sm)', fontSize: 11.5, color: 'var(--cs-ink-500)', marginTop: 4 }}>Central Studio · v1.0.0</div>
    </div>
    </>
  );
}

Object.assign(window, { Profile, PIcon });
