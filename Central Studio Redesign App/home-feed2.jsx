/* global React */
const { useState: useF2S } = React;

/* ============================================================
   Home feed — Packages + Reels
   ============================================================ */

/* ---------- Packages ---------- */
function Packages({ layout, onPick }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <SectionHeader eyebrow="Save more, dance more" title="Packages" action="Compare" onAction={() => onPick && onPick('p2')} />
      {layout === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 20px' }}>
          {PACKAGES.map(p => <PackageRow key={p.id} p={p} onPick={() => onPick(p.id)} />)}
        </div>
      )}
      {layout === 'cards' && (
        <div className="hscroll" style={{ padding: '0 20px', alignItems: 'stretch' }}>
          {PACKAGES.map(p => (
            <div key={p.id} className="snap" style={{ width: 230 }}><PackageCard p={p} onPick={() => onPick(p.id)} /></div>
          ))}
        </div>
      )}
      {layout === 'highlight' && (
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PackageCard p={PACKAGES[1]} onPick={() => onPick('p2')} featured />
          <div style={{ display: 'flex', gap: 12 }}>
            {[PACKAGES[0], PACKAGES[2]].map(p => (
              <div key={p.id} style={{ flex: 1 }}><PackageMini p={p} onPick={() => onPick(p.id)} /></div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PopularBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 'var(--radius-pill)',
      background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11, letterSpacing: '0.02em' }}>
      <Icon name="star" size={12} /> POPULAR
    </span>
  );
}

function PackageCard({ p, onPick, featured }) {
  const hot = p.popular || featured;
  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
      padding: '18px 18px 18px', borderRadius: 'var(--radius-lg)',
      background: hot ? 'linear-gradient(160deg, rgba(0,182,215,0.16), rgba(0,182,215,0.04))' : 'var(--cs-ink-800)',
      border: hot ? '1.5px solid var(--cs-cyan-500)' : '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)',
          background: hot ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.07)', color: hot ? 'var(--cs-ink-900)' : 'var(--cs-cyan-400)' }}>
          <Icon name={p.icon} size={22} stroke={2.2} />
        </span>
        {hot && <PopularBadge />}
      </div>
      <h3 style={{ font: 'var(--role-h4)', fontSize: 19, color: '#fff' }}>{p.name}</h3>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '6px 0 8px' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 38, color: '#fff', lineHeight: 0.9 }}>{p.price}</span>
        <span style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-400)' }}>{p.unit}</span>
      </div>
      <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.45, marginBottom: 14 }}>{p.desc}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {p.features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--role-body-sm)', color: 'var(--cs-ink-200)' }}>
            <Icon name="check" size={15} stroke={2.6} color="var(--cs-cyan-400)" />{f}
          </div>
        ))}
      </div>
      <button onClick={onPick} style={{ marginTop: 'auto', width: '100%', padding: '13px', cursor: 'pointer', border: 'none',
        borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14,
        background: hot ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.08)', color: hot ? 'var(--cs-ink-900)' : '#fff' }}>
        Choose {p.name}
      </button>
    </div>
  );
}

function PackageRow({ p, onPick }) {
  const hot = p.popular;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)',
      border: hot ? '1.5px solid var(--cs-cyan-500)' : '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{ width: 46, height: 46, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)',
        background: hot ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.07)', color: hot ? 'var(--cs-ink-900)' : 'var(--cs-cyan-400)' }}>
        <Icon name={p.icon} size={24} stroke={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ font: 'var(--role-h4)', fontSize: 17, color: '#fff' }}>{p.name}</h3>
          {hot && <PopularBadge />}
        </div>
        <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', marginTop: 3 }}>{p.desc}</p>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: '#fff', lineHeight: 0.9 }}>{p.price}</div>
        <button onClick={onPick} style={{ marginTop: 6, padding: '7px 14px', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-pill)',
          background: hot ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.08)', color: hot ? 'var(--cs-ink-900)' : '#fff',
          fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12 }}>Choose</button>
      </div>
    </div>
  );
}

function PackageMini({ p, onPick }) {
  return (
    <button onClick={onPick} style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: '16px 14px',
      borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)',
        background: 'rgba(255,255,255,0.07)', color: 'var(--cs-cyan-400)', marginBottom: 10 }}>
        <Icon name={p.icon} size={20} stroke={2.2} />
      </span>
      <div style={{ font: 'var(--role-h4)', fontSize: 15, color: '#fff' }}>{p.name}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--cs-cyan-400)', marginTop: 2 }}>{p.price}</div>
      <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)' }}>{p.unit}</div>
    </button>
  );
}

/* ---------- Reels (Instagram-style) ---------- */
function Reels({ layout }) {
  return (
    <section style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 20px', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <Icon name="instagram" size={16} color="var(--cs-magenta-500)" />
            <span style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-magenta-500)' }}>@centralstudio</span>
          </div>
          <h2 style={{ font: 'var(--role-h3)', fontSize: 24, color: '#fff', letterSpacing: 'var(--ls-tight)' }}>Latest reels</h2>
        </div>
        <button style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--cs-ink-300)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13, paddingBottom: 3 }}>
          Follow <Icon name="chevron" size={15} stroke={2.4} />
        </button>
      </div>

      {layout === 'carousel' ? (
        <div className="hscroll" style={{ padding: '0 20px' }}>
          {REELS.map(r => <div key={r.id} className="snap" style={{ width: 150 }}><ReelCard r={r} /></div>)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 20px' }}>
          {REELS.slice(0, 4).map(r => <ReelCard r={r} key={r.id} />)}
        </div>
      )}
    </section>
  );
}

function ReelCard({ r }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 'var(--radius-md)', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)' }}>
      <image-slot id={r.slot} shape="rect" fit="cover" placeholder="Reel" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}></image-slot>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,7,8,0.05) 40%, rgba(6,7,8,0.85) 100%)', pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 9, right: 9, width: 30, height: 30, display: 'grid', placeItems: 'center',
        borderRadius: '50%', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', color: '#fff', pointerEvents: 'none' }}>
        <Icon name="play" size={14} color="#fff" />
      </span>
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, pointerEvents: 'none' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1.2, marginBottom: 4 }}>{r.cap}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, font: 'var(--role-eyebrow)', fontSize: 10, color: 'var(--cs-ink-200)' }}>
          <Icon name="play" size={11} color="var(--cs-ink-200)" /> {r.views} views
        </div>
      </div>
    </div>
  );
}

/* ---------- simple empty tab screens ---------- */
function EmptyTab({ tab }) {
  const map = {
    explore:  { icon: 'compass',  title: 'Explore styles', sub: 'Browse 12+ dance styles and find your next move.' },
    schedule: { icon: 'calendar', title: 'Your schedule', sub: 'Booked classes and reminders will live here.' },
    profile:  { icon: 'user',     title: 'Your profile', sub: 'Progress, packages and settings — coming soon.' },
  };
  const e = map[tab] || map.explore;
  return (
    <div className="tab-pop" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 48px 120px', textAlign: 'center' }}>
      <span style={{ width: 84, height: 84, display: 'grid', placeItems: 'center', borderRadius: '50%',
        background: 'rgba(0,182,215,0.12)', color: 'var(--cs-cyan-400)' }}>
        <Icon name={e.icon} size={38} stroke={1.8} />
      </span>
      <h2 style={{ font: 'var(--role-h3)', fontSize: 26, color: '#fff' }}>{e.title}</h2>
      <p style={{ font: 'var(--role-body)', color: 'var(--cs-ink-300)', maxWidth: 260 }}>{e.sub}</p>
    </div>
  );
}

Object.assign(window, { Packages, PackageCard, PackageRow, PackageMini, Reels, ReelCard, EmptyTab });
