/* global React */
const { useState: useXS, useRef: useXR } = React;

/* ============================================================
   Central Studio — Explore / Classes (Part 1)
   Data, hero, search, filters, featured program, carousel
   ============================================================ */

const EXPLORE_CLASSES = [
{ id: 'e1', title: 'Hip Hop Foundations', style: 'Hip Hop', category: 'hiphop',
  desc: 'Learn grooves, rhythm, musicality and choreography in a fun high-energy environment.',
  inst: { id: 'maya', name: 'Maya Reyes', spec: 'Hip Hop Specialist', slot: 'inst-maya' },
  price: 350, priceUnit: 'EGP', day: 'Saturday', time: '9:00 PM', timeEnd: '11:00 PM', dur: '120 min',
  status: 'Available', level: 'Teens', difficulty: 'Beginner',
  totalSeats: 20, available: 12, booked: 8, credits: 7,
  rating: 4.8, reviews: 124, isTrending: true, isNew: false, slot: 'x-cls-1',
  benefits: ['Musicality & rhythm', 'Freestyle fundamentals', 'Crew choreography'] },
{ id: 'e2', title: 'Hip Hop Intermediate', style: 'Hip Hop', category: 'hiphop',
  desc: 'Elevate your street style with complex footwork, power moves and flow.',
  inst: { id: 'maya', name: 'Maya Reyes', spec: 'Hip Hop Specialist', slot: 'inst-maya' },
  price: 350, priceUnit: 'EGP', day: 'Monday', time: '6:30 PM', timeEnd: '8:00 PM', dur: '90 min',
  status: 'Few Seats', level: 'Teens', difficulty: 'Intermediate',
  totalSeats: 15, available: 3, booked: 12, credits: 5,
  rating: 4.9, reviews: 89, isTrending: false, isNew: false, slot: 'x-cls-2',
  benefits: ['Power move drills', 'Cypher culture', 'Competition prep'] },
{ id: 'e3', title: "Lil' Movers Ballet", style: 'Ballet', category: 'ballet',
  desc: "A playful intro to ballet basics — posture, positions and joy of movement for ages 5–8.",
  inst: { id: 'lena', name: 'Lena Park', spec: 'Classical Ballet', slot: 'inst-lena' },
  price: 280, priceUnit: 'EGP', day: 'Wednesday', time: '4:00 PM', timeEnd: '4:45 PM', dur: '45 min',
  status: 'Full', level: 'Kids', difficulty: 'Beginner',
  totalSeats: 12, available: 0, booked: 12, credits: 4,
  rating: 5.0, reviews: 67, isTrending: false, isNew: false, slot: 'x-cls-3',
  benefits: ['Posture & alignment', 'Basic positions', 'Confidence building'] },
{ id: 'e4', title: 'Ballet Foundations', style: 'Ballet', category: 'ballet',
  desc: 'Classical technique from barre to centre — for teens building a serious practice.',
  inst: { id: 'lena', name: 'Lena Park', spec: 'Classical Ballet', slot: 'inst-lena' },
  price: 380, priceUnit: 'EGP', day: 'Thursday', time: '5:00 PM', timeEnd: '6:30 PM', dur: '90 min',
  status: 'Available', level: 'Teens', difficulty: 'Intermediate',
  totalSeats: 14, available: 6, booked: 8, credits: 6,
  rating: 4.7, reviews: 45, isTrending: false, isNew: true, slot: 'x-cls-4',
  benefits: ['Barre technique', 'Pointe preparation', 'Performance artistry'] },
{ id: 'e5', title: 'Salsa On2 Social', style: 'Salsa', category: 'salsa',
  desc: 'Partnerwork, turns and timing for the social dance floor. Live-music sessions monthly.',
  inst: { id: 'diego', name: 'Diego Santos', spec: 'Salsa & Latin', slot: 'inst-diego' },
  price: 350, priceUnit: 'EGP', day: 'Tuesday', time: '7:00 PM', timeEnd: '8:30 PM', dur: '90 min',
  status: 'Few Seats', level: 'Adults', difficulty: 'Intermediate',
  totalSeats: 20, available: 2, booked: 18, credits: 5,
  rating: 4.9, reviews: 203, isTrending: true, isNew: false, slot: 'x-cls-5',
  benefits: ['Partner connection', 'Turn patterns', 'Social floor confidence'] },
{ id: 'e6', title: 'Afro Heat', style: 'Afro', category: 'afro',
  desc: 'High-energy Afrobeats choreography that doubles as serious cardio. All bodies welcome.',
  inst: { id: 'aisha', name: 'Aisha Bello', spec: 'Afro & West African', slot: 'inst-aisha' },
  price: 350, priceUnit: 'EGP', day: 'Saturday', time: '11:00 AM', timeEnd: '12:00 PM', dur: '60 min',
  status: 'Available', level: 'Adults', difficulty: 'Beginner',
  totalSeats: 25, available: 14, booked: 11, credits: 5,
  rating: 4.8, reviews: 156, isTrending: true, isNew: false, slot: 'x-cls-6',
  benefits: ['Afrobeats grooves', 'Core strength', 'Cardio fitness'] },
{ id: 'e7', title: 'Breaking Bootcamp', style: 'Breaking', category: 'breaking',
  desc: 'From toprock to power moves — a 6-week bootcamp for committed B-boys & B-girls.',
  inst: { id: 'kofi', name: 'Kofi Mensah', spec: 'Breakdance & Street', slot: 'inst-kofi' },
  price: 420, priceUnit: 'EGP', day: 'Sunday', time: '3:00 PM', timeEnd: '5:00 PM', dur: '120 min',
  status: 'Available', level: 'Teens', difficulty: 'Advanced',
  totalSeats: 12, available: 5, booked: 7, credits: 8,
  rating: 4.9, reviews: 78, isTrending: true, isNew: true, slot: 'x-cls-7',
  benefits: ['Toprock & footwork', 'Power moves', 'Battle preparation'] }];


const DANCE_CATEGORIES = [
{ id: 'hiphop', name: 'Hip Hop', rgbFill: '45,205,236', sym: 'icon-hiphop' },
{ id: 'ballet', name: 'Ballet', rgbFill: '167,139,250', sym: 'icon-ballet' },
{ id: 'salsa', name: 'Salsa', rgbFill: '255,46,126', sym: 'icon-salsa' },
{ id: 'afro', name: 'Afro', rgbFill: '255,176,46', sym: 'icon-afro' },
{ id: 'breaking', name: 'Breaking', rgbFill: '163,230,53', sym: 'icon-breaking' }];


const FEATURED_PROGRAM = {
  name: 'Ballet Intensive Program', sub: '12 weeks · Fundamentals to performance stage',
  features: ['Professional Instructors', 'Level Assessment', 'Performance Opportunities'],
  slot: 'x-prog-cover'
};

/* icon set (explore-specific to avoid scope collision) */
function XI({ name, size = 20, stroke = 2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'search':return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.4-4.4" /></svg>;
    case 'x':return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'chevron':return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'star':return <svg {...p} fill={color} stroke="none"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z" /></svg>;
    case 'cal':return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'clock':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
    case 'check':return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'fire':return <svg {...p}><path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 .5-1.5.5-1.5C16 11 17 13 17 15a5 5 0 0 1-10 0c0-4 3-5 5-12Z" /></svg>;
    case 'users':return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" /></svg>;
    case 'back':return <svg {...p}><path d="M15 18l-6-6 6-6" /></svg>;
    case 'arrow':return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'play':return <svg {...p} fill={color} stroke="none"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>;
    default:return null;
  }
}

function XStars({ rating }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => <XI key={i} name="star" size={11} color={i < Math.round(rating) ? '#FFB81C' : 'rgba(255,255,255,0.18)'} />)}
      <span style={{ font: 'var(--role-body-sm)', fontSize: 11.5, color: 'var(--cs-ink-300)', marginLeft: 3 }}>{rating}</span>
    </span>);

}

/* ─── Hero ─────────────────────────────────────────────────── */
function ExploreHero({ count }) {
  return (
    <div style={{ position: 'relative', padding: '64px 22px 22px', overflow: 'hidden', background: 'transparent', textAlign: "left", backgroundSize: "cover", backgroundPosition: "center bottom", height: "290px" }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, pointerEvents: 'none',
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
      <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 8 }}>Explore</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 68, lineHeight: 0.88, textTransform: 'uppercase', color: '#fff', letterSpacing: '-0.015em', maxWidth: 220 }}>Classes</h1>
      <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', marginTop: 12, maxWidth: 210, lineHeight: 1.5 }}>
        Discover dance styles, instructors, and programs designed for every level.
      </p>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '6px 14px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.12)', border: '1px solid rgba(0,182,215,0.38)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cs-cyan-400)' }} />
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: 'var(--cs-cyan-400)', whiteSpace: 'nowrap' }}>{count} Active Classes</span>
      </div>
    </div>);

}

/* ─── Search ────────────────────────────────────────────────── */
function ExploreSearch({ query, onChange }) {
  const [focus, setFocus] = useXS(false);
  return (
    <div style={{ padding: '0 20px', marginBottom: 16 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center',
        background: focus ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.06)',
        border: focus ? '1.5px solid rgba(0,182,215,0.72)' : '1.5px solid rgba(255,255,255,0.10)',
        borderRadius: 'var(--radius-pill)', backdropFilter: 'blur(12px)',
        boxShadow: focus ? '0 0 0 3px rgba(0,182,215,0.11)' : 'none', transition: 'border 180ms, background 180ms' }}>
        <span style={{ position: 'absolute', left: 16, color: focus ? 'var(--cs-cyan-400)' : 'var(--cs-ink-400)', transition: 'color 180ms', pointerEvents: 'none' }}>
          <XI name="search" size={18} stroke={2.2} />
        </span>
        <input value={query} onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        placeholder="Search classes, instructors, styles…"
        style={{ width: '100%', padding: '14px 46px', fontSize: 15, fontFamily: 'var(--font-body)', color: '#fff', background: 'transparent', border: 'none', outline: 'none' }} />
        {query &&
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 12, width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: '#fff' }}>
            <XI name="x" size={14} stroke={2.4} />
          </button>
        }
      </div>
    </div>);

}

/* ─── Filters ───────────────────────────────────────────────── */
function ExploreFilters({ filters, onChange }) {
  const ages = ['All', 'Kids', 'Teens', 'Adults'];
  const levels = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];
  const onAge = (v) => onChange({ ...filters, age: v === 'All' ? 'all' : v.toLowerCase() });
  const onLevel = (v) => onChange({ ...filters, level: v === 'All Levels' ? 'all' : v.toLowerCase() });
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', margin: '0 20px 10px', padding: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-pill)' }}>
        {ages.map((a) => {
          const on = filters.age === 'all' && a === 'All' || filters.age === a.toLowerCase();
          return <button key={a} onClick={() => onAge(a)} style={{ flex: 1, padding: '9px 4px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', border: 'none',
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
            background: on ? 'var(--cs-ink-900)' : 'transparent', color: on ? '#fff' : 'var(--cs-ink-400)',
            transition: 'all 160ms', boxShadow: on ? '0 2px 8px rgba(0,0,0,0.3)' : 'none' }}>{a}</button>;
        })}
      </div>
      <div className="hscroll" style={{ padding: '0 20px', gap: 8 }}>
        {levels.map((l) => {
          const key = l === 'All Levels' ? 'all' : l.toLowerCase();
          const on = filters.level === key;
          return <button key={l} onClick={() => onLevel(l)} style={{ flexShrink: 0, padding: '8px 15px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap',
            background: on ? 'var(--cs-ink-900)' : 'rgba(255,255,255,0.05)',
            border: on ? '1.5px solid rgba(255,255,255,0.28)' : '1.5px solid rgba(255,255,255,0.08)',
            color: on ? '#fff' : 'var(--cs-ink-400)', transition: 'all 160ms' }}>{l}</button>;
        })}
      </div>
    </div>);

}

/* ─── Featured Program ──────────────────────────────────────── */
function FeaturedProgram({ onApply, onView }) {
  const [status, setStatus] = useXS('Not Applied');
  const sts = { 'Not Applied': { c: 'var(--cs-ink-300)', bg: 'rgba(255,255,255,0.08)' }, Pending: { c: 'var(--cs-amber-500)', bg: 'rgba(255,176,46,0.16)' }, Accepted: { c: 'var(--cs-success-500)', bg: 'rgba(31,184,113,0.16)' }, Rejected: { c: 'var(--cs-danger-500)', bg: 'rgba(255,59,71,0.14)' } };
  const s = sts[status];
  const cycle = () => {const o = ['Not Applied', 'Pending', 'Accepted', 'Rejected'];setStatus((v) => o[(o.indexOf(v) + 1) % 4]);};
  return (
    <section style={{ padding: '0 20px', marginBottom: 26 }}>
      <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 12 }}>Featured Program</div>
      <div style={{ position: 'relative', height: 216, borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)' }}>
        <image-slot id={FEATURED_PROGRAM.slot} shape="rect" fit="cover" placeholder="Program cover"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}></image-slot>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(175deg, rgba(5,6,8,0.22) 0%, rgba(5,6,8,0.30) 25%, rgba(5,6,8,0.97) 100%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'rgba(124,58,237,0.82)', backdropFilter: 'blur(8px)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Featured Program</span>
          <button onClick={cycle} style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: s.bg, backdropFilter: 'blur(8px)', color: s.c, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11 }}>{status}</button>
        </div>
        <div style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 0.9, textTransform: 'uppercase', color: '#fff', marginBottom: 6 }}>{FEATURED_PROGRAM.name}</h2>
          <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', marginBottom: 12 }}>{FEATURED_PROGRAM.sub}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onView} style={{ flex: 1, padding: '12px', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14, borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer' }}>View Program</button>
            {status === 'Not Applied' && <button onClick={onApply} style={{ flex: 1, padding: '12px', background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(8px)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.20)', cursor: 'pointer' }}>Apply Now</button>}
          </div>
        </div>
      </div>
    </section>);

}

/* ─── Featured Carousel ─────────────────────────────────────── */
function FeaturedCard({ c, onSelect }) {
  const stC = c.status === 'Available' ? 'var(--cs-success-500)' : c.status === 'Few Seats' ? 'var(--cs-amber-500)' : 'var(--cs-danger-500)';
  return (
    <div onClick={() => onSelect(c)} style={{ position: 'relative', width: 260, height: 162, borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer', flexShrink: 0, border: '1px solid rgba(255,255,255,0.08)' }}>
      <image-slot id={'xf-' + c.id} shape="rect" fit="cover" placeholder={c.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}></image-slot>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(5,6,8,0.08) 0%, rgba(5,6,8,0.44) 50%, rgba(5,6,8,0.93) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: "row", height: "19px" }}>
        <span style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(8px)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{c.style}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(8px)', color: stC, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 10 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: stC }} />{c.status}
        </span>
      </div>
      {(c.isTrending || c.isNew) &&
      <span style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 'var(--radius-pill)',
        background: c.isTrending ? 'rgba(255,59,71,0.85)' : 'rgba(0,182,215,0.85)', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10 }}>
          <XI name={c.isTrending ? 'fire' : 'play'} size={10} color="#fff" />{c.isTrending ? 'Trending' : 'New'}
        </span>
      }
      <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, color: '#fff', lineHeight: 1.15, marginBottom: 5 }}>{c.title}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <XStars rating={c.rating} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--cs-cyan-400)' }}>{c.priceUnit} {c.price}</span>
        </div>
      </div>
    </div>);

}

function FeaturedCarousel({ classes, onSelect }) {
  if (!classes || !classes.length) return null;
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <XI name="fire" size={15} color="var(--cs-magenta-500)" />
            <span style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-magenta-500)' }}>Most Popular</span>
          </div>
          <h2 style={{ font: 'var(--role-h3)', fontSize: 22, color: '#fff', letterSpacing: 'var(--ls-tight)' }}>Trending Now</h2>
        </div>
        <button style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-ink-300)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13, paddingBottom: 2 }}>
          See all <XI name="chevron" size={15} stroke={2.4} />
        </button>
      </div>
      <div className="hscroll" style={{ padding: '0 20px' }}>
        {classes.map((c) => <FeaturedCard key={c.id} c={c} onSelect={onSelect} />)}
      </div>
    </section>);

}

Object.assign(window, {
  EXPLORE_CLASSES, DANCE_CATEGORIES: window.DANCE_CATEGORIES || [], EXPLORE_CATS: window.EXPLORE_CATS, XI, XStars,
  ExploreHero, ExploreSearch, ExploreFilters, FeaturedProgram, FeaturedCard, FeaturedCarousel,
  FEATURED_PROGRAM
});
// override DANCE_CATEGORIES with explore version
window.EXPLORE_CATS = [
{ id: 'hiphop', name: 'Hip Hop', rgbFill: '45,205,236', sym: 'icon-hiphop' },
{ id: 'ballet', name: 'Ballet', rgbFill: '167,139,250', sym: 'icon-ballet' },
{ id: 'salsa', name: 'Salsa', rgbFill: '255,46,126', sym: 'icon-salsa' },
{ id: 'afro', name: 'Afro', rgbFill: '255,176,46', sym: 'icon-afro' },
{ id: 'breaking', name: 'Breaking', rgbFill: '163,230,53', sym: 'icon-breaking' }];

window.EXPLORE_CLASSES = EXPLORE_CLASSES;