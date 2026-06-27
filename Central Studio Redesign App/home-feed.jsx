/* global React */
const { useState: useFS, useEffect: useFE, useRef: useFR } = React;

/* ============================================================
   Home feed — Header, Hero carousel, Instructors, Classes
   ============================================================ */

/* ---------- Header ---------- */
function Header({ onBell }) {
  const [ringing, setRinging] = React.useState(false);
  const hasNotif = true; // notification dot is always visible

  React.useEffect(() => {
    if (!hasNotif) return;
    // ring immediately on mount, then every 5s
    const ring = () => { setRinging(true); setTimeout(() => setRinging(false), 820); };
    ring();
    const id = setInterval(ring, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <header style={{ display: 'flex', alignItems: 'center',
      padding: '64px 20px 14px', justifyContent: "space-between" }}>
      <style>{`
        @keyframes bellRing {
          0%   { transform: rotate(0deg); }
          8%   { transform: rotate(18deg); }
          20%  { transform: rotate(-16deg); }
          32%  { transform: rotate(14deg); }
          44%  { transform: rotate(-10deg); }
          56%  { transform: rotate(7deg); }
          68%  { transform: rotate(-4deg); }
          80%  { transform: rotate(2deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes bellGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,46,126,0); }
          20%       { box-shadow: 0 0 0 6px rgba(255,46,126,0.22); }
          60%       { box-shadow: 0 0 0 10px rgba(255,46,126,0.08); }
        }
      `}</style>
      <img src="assets/logo-white.png" alt="Central Studio" style={{ display: 'block', objectFit: "contain", width: "100px", height: "63px" }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBell} aria-label="Notifications" style={{ position: 'relative', width: 42, height: 42,
          display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff',
          animation: ringing ? 'bellGlow 0.82s ease-out' : 'none' }}>
          <span style={{ display:'block', transformOrigin:'top center',
            animation: ringing ? 'bellRing 0.82s cubic-bezier(0.36,0.07,0.19,0.97) both' : 'none' }}>
            <Icon name="bell" size={21} />
          </span>
          <span style={{ position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: '50%',
            background: 'var(--cs-magenta-500)', border: '2px solid var(--cs-ink-900)' }} />
        </button>
        <image-slot id="user-avatar" shape="circle" placeholder="You"
        style={{ width: 42, height: 42, borderRadius: '50%', boxShadow: '0 0 0 2px var(--cs-cyan-500)' }}></image-slot>
      </div>
    </header>);

}

/* ---------- Hero promo carousel (swipeable) ---------- */
function HeroCarousel({ style }) {
  const [idx, setIdx] = useFS(0);
  const ref = useFR(null);

  function onScroll() {
    const el = ref.current; if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== idx) setIdx(i);
  }

  // Auto-advance every 5 seconds
  React.useEffect(() => {
    const id = setInterval(() => {
      const el = ref.current; if (!el) return;
      const total = HEROES.length;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % total;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ marginBottom: 30 }}>
      <div ref={ref} className="hscroll" onScroll={onScroll} style={{ padding: '0 20px', gap: 14 }}>
        {HEROES.map((h) =>
        <div key={h.id} className="snap" style={{ width: 'calc(100% - 40px)', maxWidth: 350 }}>
            <HeroCard h={h} variant={style} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginTop: 14 }}>
        {HEROES.map((h, i) =>
        <span key={h.id} style={{ height: 6, borderRadius: 3, transition: 'all 240ms var(--timing-ease-out)',
          width: i === idx ? 22 : 6, background: i === idx ? 'var(--cs-cyan-400)' : 'rgba(255,255,255,0.22)' }} />
        )}
      </div>
    </div>);

}

function HeroCard({ h, variant }) {
  const H = 196;
  // overlay: text over full-bleed image; split: image left + text panel; ticket: angular slash cut
  if (variant === 'split') {
    return (
      <div style={{ display: 'flex', height: H, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <image-slot id={h.slot} shape="rect" fit="cover" placeholder="Promo image"
        style={{ width: '46%', height: '100%' }}></image-slot>
        <div style={{ flex: 1, padding: '20px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: h.accent, marginBottom: 8 }}>{h.eyebrow}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 0.92, color: '#fff', textTransform: 'uppercase', whiteSpace: 'pre-line' }}>{h.title}</div>
          <div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', marginTop: 8 }}>{h.sub}</div>
        </div>
      </div>);

  }
  const ticket = variant === 'ticket';
  return (
    <div style={{ position: 'relative', height: H, borderRadius: ticket ? 4 : 'var(--radius-lg)', overflow: 'hidden',
      clipPath: ticket ? 'polygon(0 0, 100% 0, 100% calc(100% - 26px), calc(100% - 26px) 100%, 0 100%)' : 'none',
      border: '1px solid rgba(255,255,255,0.08)' }}>
      <image-slot id={h.slot} shape="rect" fit="cover" placeholder="Promo image"
      style={{ position: 'absolute', inset: 0, height: '100%', opacity: "0.5", width: "310px" }}></image-slot>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,7,8,0.15) 0%, rgba(6,7,8,0.45) 45%, rgba(6,7,8,0.9) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, padding: '18px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', pointerEvents: 'none' }}>
        <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: h.accent, marginBottom: 7 }}>{h.eyebrow}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 0.9, color: '#fff', textTransform: 'uppercase', whiteSpace: 'pre-line' }}>{h.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <span style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-200)' }}>{h.sub}</span>
          <span style={{ display: 'inline-flex', borderRadius: 'var(--radius-pill)',
            background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, pointerEvents: 'auto', margin: "0px", fontSize: "10px", height: "28px", lineHeight: "0", textAlign: "center", width: "194px", justifyContent: "center", alignItems: "center", letterSpacing: "0px", flexDirection: "row", padding: "0px 10px", gap: "15px" }}>
            {h.cta} <Icon name="arrow" size={14} stroke={2.6} />
          </span>
        </div>
      </div>
    </div>);

}

/* ---------- Instructors ---------- */
function Instructors({ onSeeAll, onSelectInstructor }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <SectionHeader eyebrow="Learn from the best" title="Instructors" onAction={onSeeAll} />
      <div className="hscroll" style={{ padding: '0 20px' }}>
        {INSTRUCTORS.map((p) =>
        <div key={p.id} className="snap" style={{ width: 132 }} onClick={() => onSelectInstructor && onSelectInstructor(p)}>
            <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor:'pointer' }}>
              <image-slot id={p.slot} shape="rect" fit="cover" placeholder={p.name.split(' ')[0]}
            style={{ width: '100%', height: 168 }}></image-slot>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 45%, rgba(6,7,8,0.85) 100%)', pointerEvents: 'none' }} />
              <span style={{ position: 'absolute', top: 9, left: 9, borderRadius: 'var(--radius-pill)',
              background: 'rgba(0,182,215,0.92)', color: 'var(--cs-ink-900)', font: 'var(--role-eyebrow)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: "3px", width: "70px", textAlign: "center", height: "15px", fontFamily: "Archivo" }}>{p.style}</span>
              <div style={{ position: 'absolute', left: 10, bottom: 9, right: 10, pointerEvents: 'none' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: '#fff', lineHeight: 1.1 }}>{p.name}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>);

}

/* ---------- Instructor inline (avatar + name) for class cards ---------- */
function InstructorTag({ inst, size = 30 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <image-slot id={`ci-${inst.id}`} shape="circle" placeholder=" "
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }}></image-slot>
      <span style={{ font: 'var(--role-body-sm)', fontWeight: 600, color: 'var(--cs-ink-200)' }}>{inst.name}</span>
    </div>);

}

/* ---------- Upcoming classes ---------- */
function UpcomingClasses({ layout, booked, onBook, onSeeAll }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <SectionHeader eyebrow="Don't miss out" title="Upcoming classes" onAction={onSeeAll} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 20px' }}>
        {CLASSES.map((c) =>
        <ClassCard key={c.id} c={c} layout={layout} booked={!!booked[c.id]} onBook={() => onBook(c.id)} />
        )}
      </div>
    </section>);

}

function MetaRow({ c }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 7px', font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', fontWeight: 600, width: "314px", justifyContent: "center" }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', width: "240px" }}>
        <Icon name="calendar" size={15} stroke={2} />{c.day} · {c.time}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <Icon name="clock" size={15} stroke={2} />{c.dur}
      </span>
    </div>);

}

function BookButton({ c, booked, onBook, full, block }) {
  const disabled = c.status === 'Full';
  const [hover, setHover] = useFS(false);
  const label = disabled ? 'Waitlist' : booked ? 'Booked' : 'Book';
  const bg = booked ? 'rgba(31,184,113,0.16)' : disabled ? 'rgba(255,255,255,0.06)' : 'var(--cs-cyan-500)';
  const col = booked ? 'var(--cs-success-500)' : disabled ? 'var(--cs-ink-300)' : 'var(--cs-ink-900)';
  return (
    <button onClick={onBook} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    style={{ ...{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: block ? '100%' : 'auto', padding: block ? '13px' : '10px 20px', cursor: 'pointer', border: 'none',
        borderRadius: 'var(--radius-md)', background: bg, color: col,
        fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14,
        boxShadow: !disabled && !booked && hover ? 'var(--glow-cyan)' : 'none',
        transform: hover && !disabled ? 'translateY(-1px)' : 'none', transition: 'transform 140ms, box-shadow 200ms' }, width: "174px" }}>
      {booked && <Icon name="check" size={15} stroke={3} />}{label}
    </button>);

}

function ClassCard({ c, layout, booked, onBook }) {
  const card = { background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' };

  if (layout === 'compact') {
    return (
      <div style={{ ...card, display: 'flex', gap: 12, padding: 12, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', width: 84, flexShrink: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <image-slot id={`cls-${c.id}`} shape="rect" fit="cover" placeholder=" " style={{ width: '100%', height: '100%' }}></image-slot>
          <span style={{ position: 'absolute', top: 6, left: 6 }}><LevelChip level={c.level} /></span>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ font: 'var(--role-h4)', fontSize: 16, color: '#fff' }}>{c.title}</h3>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, color: 'var(--cs-cyan-400)', fontSize: 16, whiteSpace: 'nowrap' }}>${c.price}</span>
          </div>
          <MetaRow c={c} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
            <StatusChip status={c.status} />
            <BookButton c={c} booked={booked} onBook={onBook} />
          </div>
        </div>
      </div>);

  }

  if (layout === 'ticket') {
    return (
      <div style={{ ...card, borderRadius: 8, display: 'flex', position: 'relative' }}>
        <div style={{ position: 'relative', width: 96, flexShrink: 0, overflow: 'hidden' }}>
          <image-slot id={`cls-${c.id}`} shape="rect" fit="cover" placeholder=" " style={{ width: '100%', height: '100%' }}></image-slot>
        </div>
        <div style={{ width: 0, borderLeft: '2px dashed rgba(255,255,255,0.14)', margin: '12px 0' }} />
        <div style={{ flex: 1, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LevelChip level={c.level} /><StatusChip status={c.status} />
          </div>
          <h3 style={{ font: 'var(--role-h4)', fontSize: 19, color: '#fff' }}>{c.title}</h3>
          <MetaRow c={c} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <InstructorTag inst={c.inst} size={26} />
            <span style={{ fontFamily: 'var(--font-display)', color: '#fff', fontSize: 24 }}>${c.price}</span>
          </div>
          <BookButton c={c} booked={booked} onBook={onBook} block />
        </div>
      </div>);

  }

  /* standard (default): full-width image header + body */
  return (
    <div style={{ ...card, backgroundColor: "rgb(0, 0, 0)" }}>
      <div style={{ position: 'relative', height: 130, overflow: 'hidden' }}>
        <image-slot id={`cls-${c.id}`} shape="rect" fit="cover" placeholder={c.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: "0.5" }}></image-slot>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,7,8,0.1) 0%, rgba(6,7,8,0.7) 100%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between' }}>
          <LevelChip level={c.level} /><StatusChip status={c.status} />
        </div>
      </div>
      <div style={{ padding: '15px 16px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <h3 style={{ font: 'var(--role-h4)', fontSize: 20, color: '#fff', marginBottom: 4 }}>{c.title}</h3>
            <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.45 }}>{c.desc}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', color: 'var(--cs-cyan-400)', lineHeight: 0.9, fontSize: "20px" }}>${c.price}</div>
          </div>
        </div>
        <MetaRow c={c} />
        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <InstructorTag inst={c.inst} />
          <BookButton c={c} booked={booked} onBook={onBook} />
        </div>
      </div>
    </div>);

}

Object.assign(window, { Header, HeroCarousel, HeroCard, Instructors, InstructorTag, UpcomingClasses, ClassCard, MetaRow, BookButton });