/* global React */
const { useState: useLS, useEffect: useLE, useRef: useLR } = React;

/* ============================================================
   Central Studio — Home, shared library (icons, chrome, data)
   ============================================================ */

/* ---------- icon set (Lucide-style, 2px stroke per DS) ---------- */
function Icon({ name, size = 22, stroke = 2, color = 'currentColor', fill = 'none' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill,
    stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'bell':return <svg {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case 'home':return <svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></svg>;
    case 'compass':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>;
    case 'classes':return <svg {...p}><circle cx="13" cy="4" r="1.8"/><path d="M8 21l3.5-7L9 11l3-4.5"/><path d="M9 6.5l4 2 3-1.5"/><path d="M13 8.5l2 4-2.5 2.5M15.5 19l-2-4.5"/></svg>;
    case 'calendar':return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'user':return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6" /></svg>;
    case 'play':return <svg {...p} fill={color} stroke="none"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>;
    case 'clock':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
    case 'arrow':return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'chevron':return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'check':return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'star':return <svg {...p} fill={color} stroke="none"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z" /></svg>;
    case 'heart':return <svg {...p}><path d="M12 20s-7-4.3-7-9.4A3.6 3.6 0 0 1 12 7a3.6 3.6 0 0 1 7 3.6C19 15.7 12 20 12 20Z" /></svg>;
    case 'spark':return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>;
    case 'instagram':return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill={color} stroke="none" /></svg>;
    case 'users':return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" /></svg>;
    case 'infinity':return <svg {...p}><path d="M7 9a3 3 0 1 0 0 6c2 0 3-1.5 5-3s3-3 5-3a3 3 0 1 1 0 6c-2 0-3-1.5-5-3S9 9 7 9Z" /></svg>;
    case 'ticket':return <svg {...p}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" /><path d="M15 6v12" strokeDasharray="2 2" /></svg>;
    default:return null;
  }
}

/* ---------- iOS status bar (always white text on dark) ---------- */
function StatusBar() {
  const c = '#fff';
  return (
    <div className="ios-status">
      <span>9:41</span>
      <span className="right">
        <svg width="18" height="12" viewBox="0 0 18 12" fill={c}><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="5" y="4.5" width="3" height="7.5" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"><path d="M1 4.2a11 11 0 0 1 15 0" /><path d="M3.6 6.8a7.2 7.2 0 0 1 9.8 0" /><path d="M6.2 9.3a3.4 3.4 0 0 1 4.6 0" /><circle cx="8.5" cy="11" r="0.6" fill={c} stroke="none" /></svg>
        <svg width="26" height="13" viewBox="0 0 26 13" fill="none"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke={c} opacity="0.45" /><rect x="2.5" y="2.5" width="17" height="8" rx="2" fill={c} /><rect x="24" y="4" width="2" height="5" rx="1" fill={c} opacity="0.45" /></svg>
      </span>
    </div>);

}

/* ---------- bottom tab bar ---------- */
const TABS = [
{ id: 'home', label: 'Home', icon: 'home' },
{ id: 'explore', label: 'Classes', icon: 'classes' },
{ id: 'schedule', label: 'Schedule', icon: 'calendar' },
{ id: 'profile', label: 'Profile', icon: 'user' }];

function TabBar({ active, onChange }) {
  const [pulse, setPulse] = React.useState(null);
  React.useEffect(() => {
    const id = setInterval(() => {
      setPulse('explore');
      setTimeout(() => setPulse(null), 700);
    }, 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <nav style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 50,
      paddingBottom: 22, paddingTop: 10,
      background: 'linear-gradient(180deg, rgba(10,11,13,0) 0%, rgba(10,11,13,0.92) 34%, var(--cs-ink-900) 70%)',
      backdropFilter: 'blur(12px)' }}>
      <style>{`
        @keyframes tabPop {
          0%   { transform: scale(1) translateY(0); }
          30%  { transform: scale(1.28) translateY(-4px); }
          60%  { transform: scale(0.92) translateY(1px); }
          80%  { transform: scale(1.06) translateY(-1px); }
          100% { transform: scale(1) translateY(0); }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '0 14px' }}>
        {TABS.map((t) => {
          const on = active === t.id;
          const isPulsing = pulse === t.id && !on;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
              color: on ? 'var(--cs-cyan-400)' : isPulsing ? 'var(--cs-cyan-400)' : 'var(--cs-ink-400)', transition: 'color 160ms' }}>
              <span style={{ display:'block', animation: isPulsing ? 'tabPop 0.65s cubic-bezier(0.22,1,0.36,1) both' : 'none' }}>
                <Icon name={t.icon} size={24} stroke={on ? 2.4 : 2} fill={on ? 'rgba(0,182,215,0.16)' : 'none'} />
              </span>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: on ? 700 : 600, fontSize: 11, letterSpacing: '0.01em' }}>{t.label}</span>
            </button>);
        })}
      </div>
    </nav>);
}

/* ---------- section header ---------- */
function SectionHeader({ eyebrow, title, action = 'See all', onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 20px', marginBottom: 14 }}>
      <div>
        {eyebrow && <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 6 }}>{eyebrow}</div>}
        <h2 style={{ font: 'var(--role-h3)', fontSize: 24, color: '#fff', letterSpacing: 'var(--ls-tight)' }}>{title}</h2>
      </div>
      {onAction &&
      <button onClick={onAction} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--cs-ink-300)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13, paddingBottom: 3, lineHeight: "0", height: "10px" }}>
          {action} <Icon name="chevron" size={15} stroke={2.4} />
        </button>
      }
    </div>);

}

/* ---------- level + status chips ---------- */
function LevelChip({ level }) {
  const map = { Kids: 'var(--cs-lime-500)', Teens: 'var(--cs-cyan-400)', Adults: 'var(--cs-violet-500)', 'All levels': 'var(--cs-ink-300)' };
  const c = map[level] || 'var(--cs-ink-300)';
  return (
    <span style={{ ...{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 'var(--radius-pill)',
        background: 'rgba(255,255,255,0.06)', border: `1px solid ${c}`, color: c,
        font: 'var(--role-eyebrow)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', flexDirection: "row", lineHeight: "0" }, color: "rgb(197, 162, 255)", background: "rgba(57, 0, 152, 0.243)", lineHeight: "0" }}>
      {level}
    </span>);

}
function StatusChip({ status }) {
  const map = {
    Available: { c: 'var(--cs-success-500)', bg: 'rgba(31,184,113,0.14)', label: 'Available' },
    '2 Left': { c: 'var(--cs-amber-500)', bg: 'rgba(255,176,46,0.14)', label: '2 left' },
    Full: { c: 'var(--cs-ink-400)', bg: 'rgba(255,255,255,0.05)', label: 'Full' }
  };
  const s = map[status] || map.Available;
  return (
    <span style={{ ...{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
        background: s.bg, color: s.c, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12, lineHeight: "0", height: "25px" }, color: "rgb(255, 255, 255)", background: "rgba(255, 255, 255, 0.314)" }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.c, backgroundColor: "rgb(255, 255, 255)" }} />{s.label}
    </span>);

}

/* ---------- DATA ---------- */
const INSTRUCTORS = [
{ id: 'maya', name: 'Maya Reyes', style: 'Hip Hop', slot: 'inst-maya' },
{ id: 'diego', name: 'Diego Santos', style: 'Salsa', slot: 'inst-diego' },
{ id: 'aisha', name: 'Aisha Bello', style: 'Afro', slot: 'inst-aisha' },
{ id: 'kofi', name: 'Kofi Mensah', style: 'Breaking', slot: 'inst-kofi' },
{ id: 'lena', name: 'Lena Park', style: 'Ballet', slot: 'inst-lena' },
{ id: 'marcus', name: 'Marcus Lee', style: 'Popping', slot: 'inst-marcus' }];


const HEROES = [
{ id: 'h1', eyebrow: 'New series', title: 'Breaking\nBootcamp', sub: '6 weeks · toprock to power moves', cta: 'Join now', slot: 'hero-1', accent: 'var(--cs-cyan-400)' },
{ id: 'h2', eyebrow: 'This weekend', title: 'Salsa\nSocial Night', sub: 'Live band · all levels welcome', cta: 'Reserve a spot', slot: 'hero-2', accent: 'var(--cs-magenta-500)' },
{ id: 'h3', eyebrow: 'Refer & earn', title: 'Bring a\nfriend, free', sub: 'Give a class, get a class on us', cta: 'Invite friends', slot: 'hero-3', accent: 'var(--cs-amber-500)' }];


const CLASSES = [
{ id: 'c1', title: 'Hip Hop Foundations', desc: 'Groove, bounce & musicality from the ground up.', inst: INSTRUCTORS[0], price: 24, day: 'Mon', time: '6:30 PM', dur: '60 min', status: 'Available', level: 'Teens' },
{ id: 'c2', title: 'Salsa On2 Social', desc: 'Partnerwork, turns & timing for the dance floor.', inst: INSTRUCTORS[1], price: 28, day: 'Tue', time: '7:00 PM', dur: '75 min', status: '2 Left', level: 'Adults' },
{ id: 'c3', title: "Lil' Movers Ballet", desc: 'A playful intro to ballet basics for ages 5–8.', inst: INSTRUCTORS[4], price: 18, day: 'Wed', time: '4:00 PM', dur: '45 min', status: 'Full', level: 'Kids' },
{ id: 'c4', title: 'Afro Heat', desc: 'High-energy Afrobeats choreography & cardio.', inst: INSTRUCTORS[2], price: 24, day: 'Sat', time: '11:00 AM', dur: '60 min', status: 'Available', level: 'Adults' }];


const PACKAGES = [
{ id: 'p1', name: 'Drop-In', icon: 'ticket', price: '$28', unit: '/ class', desc: 'Pay as you go. One class, zero commitment.', features: ['Any single class', 'Book up to 7 days ahead'], popular: false },
{ id: 'p2', name: '5-Class Pack', icon: 'star', price: '$120', unit: '/ 5 classes', desc: 'Save 14% — your most flexible option.', features: ['$24 per class', 'Valid for 3 months', 'Share with a partner'], popular: true },
{ id: 'p3', name: 'Unlimited', icon: 'infinity', price: '$159', unit: '/ month', desc: 'All styles, all levels. Dance every day.', features: ['Unlimited classes', 'Priority booking', 'Member events'], popular: false }];


const REELS = [
{ id: 'r1', slot: 'reel-1', cap: 'Footwork drill 🔥', views: '128K', tag: 'Breaking' },
{ id: 'r2', slot: 'reel-2', cap: 'Salsa shines combo', views: '94K', tag: 'Salsa' },
{ id: 'r3', slot: 'reel-3', cap: 'Afro warm-up', views: '212K', tag: 'Afro' },
{ id: 'r4', slot: 'reel-4', cap: '8-count, slow → fast', views: '76K', tag: 'Hip Hop' },
{ id: 'r5', slot: 'reel-5', cap: 'Recital highlights', views: '58K', tag: 'Ballet' }];


Object.assign(window, {
  Icon, StatusBar, TabBar, TABS, SectionHeader, LevelChip, StatusChip,
  INSTRUCTORS, HEROES, CLASSES, PACKAGES, REELS
});