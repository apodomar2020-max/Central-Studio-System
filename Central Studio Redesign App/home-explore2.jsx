/* global React */
const { useState: useX2, useMemo: useX2M } = React;

/* Pull exports from home-explore.jsx (already executed) */
const { XI, XStars, ExploreHero, ExploreSearch, ExploreFilters,
        FeaturedProgram, FeaturedCarousel, FEATURED_PROGRAM } = window;
const EXPLORE_CLASSES = window.EXPLORE_CLASSES;
const EXPLORE_CATS    = window.EXPLORE_CATS;

/* ─── Status helpers ────────────────────────────────────────── */
function statusStyle(s) {
  return s === 'Available' ? { c:'var(--cs-success-500)', bg:'rgba(31,184,113,0.16)' }
       : s === 'Few Seats'  ? { c:'var(--cs-amber-500)',   bg:'rgba(255,176,46,0.16)' }
       : s === 'Full'       ? { c:'var(--cs-danger-500)',  bg:'rgba(255,59,71,0.10)' }
       :                      { c:'var(--cs-ink-400)',     bg:'rgba(255,255,255,0.06)' };
}
function diffColor(d) {
  return d === 'Beginner' ? 'var(--cs-cyan-400)' : d === 'Intermediate' ? 'var(--cs-amber-500)' : 'var(--cs-magenta-500)';
}

/* ─── Premium Class Card ────────────────────────────────────── */
function ExploreClassCard({ c, isBooked, onBook, onSelect }) {
  const pct = Math.round(c.booked / c.totalSeats * 100);
  const barCol = pct >= 85 ? 'var(--cs-danger-500)' : pct >= 60 ? 'var(--cs-amber-500)' : 'var(--cs-cyan-500)';
  const st = statusStyle(c.status);
  return (
    <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
      {/* image header — tappable to open detail */}
      <div style={{ position:'relative', height:136, cursor:'pointer' }} onClick={() => onSelect(c)}>
        <image-slot id={c.slot} shape="rect" fit="cover" placeholder={c.title}
          style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}></image-slot>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg,rgba(5,6,8,0.06) 0%,rgba(5,6,8,0.70) 100%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:12, left:12, right:12, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ display:'flex', gap:6 }}>
            <span style={{ padding:'4px 9px', borderRadius:'var(--radius-pill)', background:'rgba(0,0,0,0.52)', backdropFilter:'blur(8px)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase' }}>{c.style}</span>
            <span style={{ padding:'4px 9px', borderRadius:'var(--radius-pill)', background:'rgba(0,0,0,0.52)', backdropFilter:'blur(8px)', color:diffColor(c.difficulty), fontFamily:'var(--font-heading)', fontWeight:700, fontSize:10 }}>{c.difficulty}</span>
          </div>
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:'var(--radius-pill)', background:st.bg, backdropFilter:'blur(8px)', color:st.c, fontFamily:'var(--font-heading)', fontWeight:700, fontSize:10 }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:st.c }} />{c.status}
          </span>
        </div>
        <div style={{ position:'absolute', bottom:10, left:12, display:'flex', gap:6 }}>
          {c.isTrending && <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 8px', borderRadius:'var(--radius-pill)', background:'rgba(255,59,71,0.75)', backdropFilter:'blur(8px)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:10 }}><XI name="fire" size={10} color="#fff" />Trending</span>}
          {c.isNew && <span style={{ padding:'3px 8px', borderRadius:'var(--radius-pill)', background:'rgba(0,182,215,0.75)', backdropFilter:'blur(8px)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:10 }}>✦ New</span>}
        </div>
      </div>

      {/* body */}
      <div style={{ padding:'14px 15px 0', cursor:'pointer' }} onClick={() => onSelect(c)}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:5 }}>
          <h3 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:18, color:'#fff', lineHeight:1.15 }}>{c.title}</h3>
          <XStars rating={c.rating} />
        </div>
        <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', lineHeight:1.45, marginBottom:11,
          display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{c.desc}</p>
        <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:'4px 10px', font:'var(--role-body-sm)', color:'var(--cs-ink-300)', fontWeight:600, marginBottom:11 }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}><XI name="cal" size={14} stroke={2} color="var(--cs-cyan-400)" />{c.day} · {c.time} – {c.timeEnd}</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}><XI name="clock" size={13} stroke={2} color="var(--cs-ink-400)" />{c.dur}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <image-slot id={'xi-'+c.inst.id} shape="circle" placeholder=" " style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, boxShadow:'0 0 0 1.5px var(--cs-ink-700)' }}></image-slot>
            <div>
              <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13.5, color:'#fff' }}>{c.inst.name}</div>
              <div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-400)' }}>{c.inst.spec}</div>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:20, color:'#fff', lineHeight:0.9 }}>{c.priceUnit} {c.price}</div>
            <div style={{ font:'var(--role-body-sm)', fontSize:11, color:'var(--cs-ink-500)', marginTop:2 }}>per class</div>
          </div>
        </div>
        <div style={{ height:1, background:'rgba(255,255,255,0.07)', marginBottom:11 }} />
        <div style={{ marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-400)', fontWeight:600, marginBottom:6 }}>
            <span><span style={{ color:'var(--cs-success-500)', fontWeight:700 }}>{c.available}</span> available · {c.booked}/{c.totalSeats} booked</span>
            <XI name="users" size={14} stroke={2} color="var(--cs-ink-500)" />
          </div>
          <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
            <div style={{ height:'100%', width:pct+'%', background:`linear-gradient(90deg,var(--cs-cyan-500),${barCol})`, borderRadius:3, transition:'width 600ms' }} />
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:7, font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', fontWeight:600, marginBottom:13 }}>
          {c.credits > 0
            ? <><span style={{ width:20, height:20, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(0,182,215,0.16)', color:'var(--cs-cyan-400)', fontSize:10, fontWeight:800 }}>P</span><span>Package · <span style={{ color:'#fff', fontWeight:700 }}>{c.credits} credits left</span></span></>
            : <><span style={{ width:20, height:20, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(255,255,255,0.06)', color:'var(--cs-ink-500)', fontSize:10 }}>P</span><span>No Active Package</span></>}
        </div>
      </div>

      {/* actions */}
      <div style={{ display:'flex', gap:9, padding:'0 15px 15px' }}>
        {c.credits > 0 && c.status !== 'Full' && (
          <button onClick={e => { e.stopPropagation(); onBook(c,'package'); }}
            style={{ flex:1, padding:'11px', borderRadius:'var(--radius-md)', border:'1.5px solid rgba(0,182,215,0.46)', background:'rgba(0,182,215,0.08)', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            Use Package
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onBook(c,'cash'); }}
          style={{ flex:1, padding:'11px', borderRadius:'var(--radius-md)', border:'none', cursor:'pointer',
            background: isBooked ? 'rgba(31,184,113,0.16)' : c.status === 'Full' ? 'rgba(255,255,255,0.06)' : 'var(--cs-cyan-500)',
            color: isBooked ? 'var(--cs-success-500)' : c.status === 'Full' ? 'var(--cs-ink-400)' : 'var(--cs-ink-900)',
            fontFamily:'var(--font-heading)', fontWeight:800, fontSize:13,
            display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          {isBooked ? <><XI name="check" size={14} stroke={3} />Booked</> : c.status === 'Full' ? 'Join Waitlist' : `Book · ${c.priceUnit} ${c.price}`}
        </button>
      </div>
    </div>
  );
}

/* ─── Category section (collapsible) ───────────────────────── */
function CategorySection({ cat, classes, expanded, onToggle, onSelect, isBooked, onBook }) {
  const accent = `rgba(${cat.rgbFill},0.90)`;
  return (
    <div>
      <button onClick={onToggle} style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'13px 16px',
        background:'var(--cs-ink-800)', border:`1px solid ${expanded ? `rgba(${cat.rgbFill},0.5)` : 'rgba(255,255,255,0.08)'}`,
        borderRadius: expanded ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)',
        cursor:'pointer', transition:'border-color 200ms' }}>
        <span style={{ width:42, height:42, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'var(--radius-md)', background:`rgba(${cat.rgbFill},0.13)` }}>
          <svg width="28" height="28"><use href={`#${cat.sym}`} /></svg>
        </span>
        <div style={{ flex:1, textAlign:'left' }}>
          <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:17, color:'#fff' }}>{cat.name}</div>
          <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)' }}>{classes.length} {classes.length === 1 ? 'class' : 'classes'}</div>
        </div>
        <span style={{ color:'var(--cs-ink-400)', display:'block', transition:'transform 220ms', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <XI name="chevron" size={20} stroke={2.2} />
        </span>
      </button>
      {expanded && (
        <div style={{ border:`1px solid rgba(${cat.rgbFill},0.38)`, borderTop:'none', borderRadius:'0 0 var(--radius-lg) var(--radius-lg)', padding:'14px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:14 }}>
          {classes.map(c => <ExploreClassCard key={c.id} c={c} isBooked={isBooked(c.id)} onBook={onBook} onSelect={onSelect} />)}
        </div>
      )}
    </div>
  );
}

function ExploreCategories({ classes, expanded, onToggle, onSelect, isBooked, onBook }) {
  const grouped = {};
  for (const c of classes) { if (!grouped[c.category]) grouped[c.category] = []; grouped[c.category].push(c); }
  const visible = EXPLORE_CATS.filter(cat => grouped[cat.id]?.length > 0);
  if (!visible.length) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'56px 30px', textAlign:'center' }}>
      <span style={{ width:68, height:68, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(255,255,255,0.05)', color:'var(--cs-ink-500)', marginBottom:14 }}><XI name="search" size={30} stroke={1.6} /></span>
      <h3 style={{ font:'var(--role-h4)', fontSize:20, color:'#fff', marginBottom:8 }}>No classes found</h3>
      <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', maxWidth:230 }}>Try different keywords or clear your filters.</p>
    </div>
  );
  return (
    <section style={{ padding:'0 20px', marginBottom:24 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <h2 style={{ font:'var(--role-h3)', fontSize:22, color:'#fff', letterSpacing:'var(--ls-tight)' }}>By Style</h2>
        <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600, whiteSpace:'nowrap' }}>{classes.length} classes</span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {visible.map(cat => <CategorySection key={cat.id} cat={cat} classes={grouped[cat.id]} expanded={expanded.has(cat.id)} onToggle={() => onToggle(cat.id)} onSelect={onSelect} isBooked={isBooked} onBook={onBook} />)}
      </div>
    </section>
  );
}

/* ─── Class Detail Overlay ──────────────────────────────────── */
function ClassDetailOverlay({ c, onClose, isBooked, onBook }) {
  const st = statusStyle(c.status);
  return (
    <div style={{ position:'absolute', inset:0, zIndex:100, background:'var(--cs-ink-900)', overflowY:'auto', animation:'detSlide 360ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes detSlide{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      {/* hero */}
      <div style={{ position:'relative', height:224 }}>
        <image-slot id={'xd-'+c.id} shape="rect" fit="cover" placeholder={c.title} style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}></image-slot>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg,rgba(5,6,8,0.48) 0%,rgba(5,6,8,0.10) 38%,rgba(5,6,8,0.80) 100%)', pointerEvents:'none' }} />
        <button onClick={onClose} style={{ position:'absolute', top:54, left:18, width:40, height:40, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(0,0,0,0.52)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.18)', color:'#fff', cursor:'pointer' }}>
          <XI name="back" size={22} stroke={2.2} />
        </button>
        <div style={{ position:'absolute', bottom:14, left:18, right:18 }}>
          <div style={{ display:'flex', gap:7, marginBottom:8 }}>
            <span style={{ padding:'4px 10px', borderRadius:'var(--radius-pill)', background:'rgba(0,0,0,0.56)', backdropFilter:'blur(8px)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase' }}>{c.style}</span>
            <span style={{ padding:'4px 10px', borderRadius:'var(--radius-pill)', background:st.bg, backdropFilter:'blur(8px)', color:st.c, fontFamily:'var(--font-heading)', fontWeight:700, fontSize:10 }}>{c.status}</span>
            {c.isTrending && <span style={{ padding:'4px 10px', borderRadius:'var(--radius-pill)', background:'rgba(255,59,71,0.75)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:10 }}>🔥 Trending</span>}
          </div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:42, lineHeight:0.9, textTransform:'uppercase', color:'#fff' }}>{c.title}</h1>
        </div>
      </div>

      {/* scrollable body */}
      <div style={{ padding:'20px 20px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, paddingBottom:16, borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
          <XStars rating={c.rating} />
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)' }}>({c.reviews} reviews)</span>
          <span style={{ marginLeft:'auto', padding:'4px 10px', borderRadius:'var(--radius-pill)', background:'rgba(255,255,255,0.06)', color:diffColor(c.difficulty), fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12 }}>{c.difficulty}</span>
        </div>
        <p style={{ font:'var(--role-body)', color:'var(--cs-ink-200)', lineHeight:1.62, marginBottom:20 }}>{c.desc}</p>

        {c.benefits?.length > 0 && (
          <div style={{ marginBottom:20 }}>
            <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>What you'll learn</div>
            <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
              {c.benefits.map((b,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, font:'var(--role-body-sm)', color:'var(--cs-ink-200)', fontWeight:500 }}>
                  <span style={{ width:22, height:22, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(0,182,215,0.16)', color:'var(--cs-cyan-400)' }}><XI name="check" size={13} stroke={2.8} /></span>{b}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height:1, background:'rgba(255,255,255,0.07)', marginBottom:20 }} />

        {/* schedule tiles */}
        <div style={{ marginBottom:20 }}>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Schedule</div>
          <div style={{ display:'flex', gap:9 }}>
            {[{label:'Day',val:c.day},{label:'Time',val:c.time+' – '+c.timeEnd},{label:'Duration',val:c.dur}].map(r => (
              <div key={r.label} style={{ flex:1, padding:'12px 10px', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'var(--radius-md)', textAlign:'center' }}>
                <div style={{ font:'var(--role-body-sm)', fontSize:11, color:'var(--cs-ink-500)', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.06em' }}>{r.label}</div>
                <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, color:'#fff', lineHeight:1.2 }}>{r.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* instructor */}
        <div style={{ marginBottom:20 }}>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Instructor</div>
          <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'var(--radius-lg)' }}>
            <image-slot id={'xdi-'+c.inst.id} shape="circle" placeholder=" " style={{ width:54, height:54, borderRadius:'50%', flexShrink:0, boxShadow:'0 0 0 2px var(--cs-cyan-500)' }}></image-slot>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:17, color:'#fff' }}>{c.inst.name}</div>
              <div style={{ font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', marginTop:2 }}>{c.inst.spec}</div>
            </div>
            <XStars rating={4.9} />
          </div>
        </div>

        {/* capacity */}
        <div style={{ marginBottom:20 }}>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Capacity</div>
          <div style={{ padding:'14px', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'var(--radius-lg)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', font:'var(--role-body-sm)', fontWeight:600, color:'var(--cs-ink-300)', marginBottom:10 }}>
              <span><span style={{ color:'#fff', fontWeight:800 }}>{c.totalSeats}</span> total</span>
              <span><span style={{ color:'var(--cs-success-500)', fontWeight:800 }}>{c.available}</span> available</span>
              <span><span style={{ color:'var(--cs-ink-200)', fontWeight:800 }}>{c.booked}</span> booked</span>
            </div>
            <div style={{ height:8, borderRadius:4, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:Math.round(c.booked/c.totalSeats*100)+'%', background:`linear-gradient(90deg,var(--cs-cyan-500),${c.booked/c.totalSeats>0.8?'var(--cs-danger-500)':'var(--cs-cyan-400)'})`, borderRadius:4 }} />
            </div>
          </div>
        </div>
      </div>

      {/* sticky booking footer */}
      <div style={{ position:'sticky', bottom:0, padding:'14px 20px 30px', background:'linear-gradient(180deg,rgba(10,11,13,0) 0%,var(--cs-ink-900) 28%)', backdropFilter:'blur(12px)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:28, color:'#fff', lineHeight:0.9 }}>{c.priceUnit} {c.price}</div>
            {c.credits > 0 && <div style={{ font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', marginTop:4, fontWeight:600 }}>or {c.credits} credits from your package</div>}
          </div>
          <span style={{ padding:'5px 12px', borderRadius:'var(--radius-pill)', background:st.bg, color:st.c, fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12 }}>{c.status}</span>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          {c.credits > 0 && c.status !== 'Full' && (
            <button onClick={() => { onBook(c,'package'); onClose(); }} style={{ flex:1, padding:'14px', borderRadius:'var(--radius-md)', border:'1.5px solid rgba(0,182,215,0.46)', background:'rgba(0,182,215,0.10)', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, cursor:'pointer' }}>
              Use Package
            </button>
          )}
          <button onClick={() => { onBook(c,'cash'); if (c.status !== 'Full') onClose(); }}
            style={{ flex:1, padding:'14px', borderRadius:'var(--radius-md)', border:'none', cursor:'pointer',
              background: isBooked ? 'rgba(31,184,113,0.16)' : c.status === 'Full' ? 'rgba(255,255,255,0.06)' : 'var(--cs-cyan-500)',
              color: isBooked ? 'var(--cs-success-500)' : c.status === 'Full' ? 'var(--cs-ink-400)' : 'var(--cs-ink-900)',
              fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14,
              display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
            {isBooked ? <><XI name="check" size={16} stroke={3} />Booked</> : c.status === 'Full' ? 'Join Waitlist' : `Book Now · ${c.priceUnit} ${c.price}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ExploreScreen (main orchestrator) ─────────────────────── */
function ExploreScreen({ onToast }) {
  const [query,   setQuery]   = useX2('');
  const [filters, setFilters] = useX2({ age:'all', level:'all' });
  const [expanded,setExpanded]= useX2(new Set(['hiphop']));
  const [selected,setSelected]= useX2(null);
  const [booked,  setBooked]  = useX2(new Set());
  const [balletMode, setBalletMode] = useX2(null);
  const [bookingCls, setBookingCls] = useX2(null); // 'program' | 'apply'

  const filtered = useX2M(() => {
    const q = query.toLowerCase();
    return EXPLORE_CLASSES.filter(c => {
      if (q && ![c.title,c.inst.name,c.style,c.desc].some(s => s.toLowerCase().includes(q))) return false;
      if (filters.age   !== 'all' && c.level.toLowerCase()      !== filters.age)   return false;
      if (filters.level !== 'all' && c.difficulty.toLowerCase() !== filters.level) return false;
      return true;
    });
  }, [query, filters]);

  function toggleCat(id) { setExpanded(s => { const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; }); }

  function handleBook(c) {
    setBookingCls(c);
  }

  const showFeatures = !query && filters.age === 'all' && filters.level === 'all';

  return (
    <>
      <div className="feed" style={{ paddingBottom:110, background:'radial-gradient(90% 130% at 94% -6%, rgba(0,182,215,0.18) 0%, transparent 52%), radial-gradient(70% 80% at -8% 100%, rgba(0,182,215,0.10) 0%, transparent 55%), var(--cs-ink-900)' }}>
        <ExploreHero count={EXPLORE_CLASSES.length} />
        <ExploreSearch query={query} onChange={setQuery} />
        <ExploreFilters filters={filters} onChange={setFilters} />
        {showFeatures && <FeaturedProgram onApply={() => setBalletMode('apply')} onView={() => setBalletMode('program')} />}
        {showFeatures && <FeaturedCarousel classes={EXPLORE_CLASSES.filter(c=>c.isTrending)} onSelect={setSelected} />}
        <ExploreCategories classes={filtered} expanded={expanded} onToggle={toggleCat} onSelect={setSelected} isBooked={id=>booked.has(id)} onBook={handleBook} />
      </div>
      {selected && <ClassDetailOverlay c={selected} onClose={()=>setSelected(null)} isBooked={booked.has(selected.id)} onBook={handleBook} />}
      {balletMode === 'program' && (() => { const BP = window.BalletProgram; return BP ? <BP onBack={() => setBalletMode(null)} onApply={() => setBalletMode('apply')} onToast={onToast} /> : null; })()}
      {balletMode === 'apply' && (() => { const BA = window.BalletAssessment; return BA ? <BA onBack={() => setBalletMode(null)} onToast={onToast} /> : null; })()}
      {bookingCls && (() => { const BF = window.BookingFlow; return BF ? <BF cls={bookingCls} onClose={() => setBookingCls(null)} onToast={onToast} /> : null; })()}
    </>
  );
}

Object.assign(window, { ExploreClassCard, ExploreCategories, ClassDetailOverlay, ExploreScreen });
