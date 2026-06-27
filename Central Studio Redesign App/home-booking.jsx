/* global React */
const { useState: useBK, useMemo: useBKM } = React;

/* ============================================================
   Central Studio — Booking Flow (3 steps + results)
   Triggered from class cards, instructor profile, or class detail.
   ============================================================ */

/* ─── mock user data (mirrors home-profile.jsx) ─────────────── */
const BK_USER = { name:'Nadine Adel', email:'Nadine@example.com', role:'Parent', credits:7, pkg:{ name:'Premium Package', total:10, expiry:'Aug 31, 2026' } };
const BK_CHILDREN = [
  { id:'omar',  name:'Omar',  age:3, gender:'Boy',  slot:'child-omar' },
  { id:'layla', name:'Layla', age:6, gender:'Girl', slot:'child-layla' },
];

/* ─── generate sessions from class ─────────────────────────── */
function makeSessions(cls) {
  const base = [
    { id:'s1', label:'This week',   date:'Sat, Jun 28, 2026', avail:2,         st:'Few Seats' },
    { id:'s2', label:'Next week',   date:'Sat, Jul 5, 2026',  avail: cls?.available || 8, st:'Available' },
    { id:'s3', label:'In 2 weeks',  date:'Sat, Jul 12, 2026', avail:0,         st:'Full' },
    { id:'s4', label:'In 3 weeks',  date:'Sat, Jul 19, 2026', avail: cls?.available || 6, st:'Available' },
  ];
  return base.map(s => ({ ...s, time: cls?.time || '9:00 PM', timeEnd: cls?.timeEnd || '11:00 PM', dur: cls?.dur || '60 min', inst: cls?.inst?.name || 'Instructor', branch:'Main Branch', price: cls?.price || 350, unit: cls?.priceUnit || 'EGP', total: cls?.totalSeats || 20 }));
}

/* ─── shared icon ───────────────────────────────────────────── */
function BKI({ name, size=18, stroke=2, color='currentColor' }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:color, strokeWidth:stroke, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'back':    return <svg {...p}><path d="M15 18l-6-6 6-6"/></svg>;
    case 'check':   return <svg {...p}><path d="M20 6 9 17l-5-5"/></svg>;
    case 'circle':  return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>;
    case 'cal':     return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>;
    case 'clock':   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
    case 'pin':     return <svg {...p}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'user':    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/></svg>;
    case 'card':    return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>;
    case 'cash':    return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>;
    case 'warn':    return <svg {...p}><path d="M12 9v4M12 17h.01"/><path d="M10.3 4 2 20h20L13.7 4a2 2 0 0 0-3.4 0Z"/></svg>;
    case 'plus':    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'x':       return <svg {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case 'refresh': return <svg {...p}><path d="M3 12a9 9 0 0 0 15 6.7M21 12a9 9 0 0 0-15-6.7"/><path d="M3 4v4h4M21 20v-4h-4"/></svg>;
    default: return null;
  }
}

/* ─── step progress bar ─────────────────────────────────────── */
function BKProgress({ step }) {
  const labels = ['Participant','Schedule','Confirm'];
  const numStep = typeof step === 'number' ? step : 0;
  return (
    <div style={{ padding:'0 20px 14px' }}>
      <div style={{ display:'flex', gap:3, marginBottom:7 }}>
        {[1,2,3].map(s => <div key={s} style={{ flex:1, height:3, borderRadius:2, background: s <= numStep ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.08)', transition:'background 300ms' }} />)}
      </div>
      {typeof step === 'number' && <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-500)', fontWeight:600 }}>Step {step} of 3 · {labels[step-1]}</div>}
    </div>
  );
}

/* ─── class summary card ────────────────────────────────────── */
function ClassSummaryCard({ cls }) {
  if (!cls) return null;
  return (
    <div style={{ margin:'0 20px 16px', padding:'13px 14px', borderRadius:'var(--radius-lg)', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', display:'flex', gap:12 }}>
      <image-slot id={cls.slot} shape="rect" fit="cover" placeholder={cls.title} style={{ width:60, height:60, borderRadius:'var(--radius-md)', flexShrink:0 }}></image-slot>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, color:'#fff', lineHeight:1.2 }}>{cls.title}</div>
        <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-cyan-400)', marginTop:3, fontWeight:700 }}>{cls.style} · {cls.level}</div>
        <div style={{ display:'flex', gap:10, marginTop:4, font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', fontWeight:600 }}>
          <span>{cls.inst?.name}</span><span>·</span><span style={{ color:'#fff', fontWeight:800 }}>{cls.priceUnit} {cls.price}</span>
          {cls.credits > 0 && <span style={{ color:'var(--cs-cyan-400)', fontWeight:700 }}>or {cls.credits} cr</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── STEP 1: Select Participant ────────────────────────────── */
function Step1({ cls, participant, setParticipant, onNext }) {
  return (
    <div style={{ flex:1, overflowY:'auto', paddingBottom:20 }}>
      <div style={{ padding:'4px 20px 16px' }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:4 }}>Who is this for?</h2>
        <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)' }}>Select who will be attending this class.</p>
      </div>
      <ClassSummaryCard cls={cls} />

      {/* Account owner info */}
      <div style={{ margin:'0 20px 16px', padding:'11px 14px', borderRadius:'var(--radius-md)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ font:'var(--role-body-sm)', fontSize:11, color:'var(--cs-ink-500)', textTransform:'uppercase', letterSpacing:'0.07em', fontWeight:700, marginBottom:4 }}>Account Owner</div>
        <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{BK_USER.name}</div>
        <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)' }}>{BK_USER.email} · {BK_USER.role} Account</div>
      </div>

      {/* Myself */}
      <div style={{ padding:'0 20px', marginBottom:12 }}>
        <div style={{ font:'var(--role-eyebrow)', fontSize:10.5, letterSpacing:'0.09em', textTransform:'uppercase', color:'var(--cs-ink-400)', marginBottom:10 }}>Participant</div>
        <button onClick={() => setParticipant({ id:'self', name:BK_USER.name, type:'self', slot:'profile-avatar' })} style={{ display:'flex', alignItems:'center', gap:13, width:'100%', padding:'13px 14px', borderRadius:'var(--radius-lg)', cursor:'pointer', textAlign:'left',
          background: participant?.id==='self' ? 'rgba(0,182,215,0.10)' : 'var(--cs-ink-800)',
          border: participant?.id==='self' ? '1.5px solid var(--cs-cyan-500)' : '1px solid rgba(255,255,255,0.08)' }}>
          <image-slot id="profile-avatar" shape="circle" placeholder={BK_USER.name[0]} style={{ width:44, height:44, borderRadius:'50%', flexShrink:0, pointerEvents:'none', boxShadow: participant?.id==='self' ? '0 0 0 2px var(--cs-cyan-500)' : 'none' }}></image-slot>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15, color:'#fff' }}>{BK_USER.name}</div>
            <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:1 }}>Myself · {BK_USER.role}</div>
          </div>
          <span style={{ width:22, height:22, borderRadius:'50%', display:'grid', placeItems:'center', flexShrink:0,
            background: participant?.id==='self' ? 'var(--cs-cyan-500)' : 'transparent',
            border: participant?.id==='self' ? 'none' : '2px solid rgba(255,255,255,0.20)' }}>
            {participant?.id==='self' && <BKI name="check" size={13} stroke={3} color="var(--cs-ink-900)" />}
          </span>
        </button>
      </div>

      {/* Children */}
      {BK_CHILDREN.length > 0 && (
        <div style={{ padding:'0 20px' }}>
          <div style={{ font:'var(--role-eyebrow)', fontSize:10.5, letterSpacing:'0.09em', textTransform:'uppercase', color:'var(--cs-ink-400)', marginBottom:10 }}>Children</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {BK_CHILDREN.map(c => {
              const sel = participant?.id === c.id;
              const tint = c.gender==='Girl' ? 'var(--cs-magenta-500)' : 'var(--cs-cyan-400)';
              return (
                <button key={c.id} onClick={() => setParticipant({ ...c, type:'child' })} style={{ display:'flex', alignItems:'center', gap:13, width:'100%', padding:'13px 14px', borderRadius:'var(--radius-lg)', cursor:'pointer', textAlign:'left',
                  background: sel ? 'rgba(0,182,215,0.10)' : 'var(--cs-ink-800)',
                  border: sel ? '1.5px solid var(--cs-cyan-500)' : '1px solid rgba(255,255,255,0.08)' }}>
                  <image-slot id={c.slot} shape="circle" placeholder={c.name[0]} style={{ width:44, height:44, borderRadius:'50%', flexShrink:0, pointerEvents:'none', boxShadow: `0 0 0 2px ${sel ? 'var(--cs-cyan-500)' : tint}` }}></image-slot>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15, color:'#fff' }}>{c.name}</span>
                      <span style={{ font:'var(--role-body-sm)', fontSize:11, color:tint, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.05em' }}>{c.gender}</span>
                    </div>
                    <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:1 }}>Age {c.age} · Child</div>
                  </div>
                  <span style={{ width:22, height:22, borderRadius:'50%', display:'grid', placeItems:'center', flexShrink:0,
                    background: sel ? 'var(--cs-cyan-500)' : 'transparent',
                    border: sel ? 'none' : '2px solid rgba(255,255,255,0.20)' }}>
                    {sel && <BKI name="check" size={13} stroke={3} color="var(--cs-ink-900)" />}
                  </span>
                </button>
              );
            })}
            <button onClick={() => {}} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px', borderRadius:'var(--radius-lg)', cursor:'pointer', background:'transparent', border:'1.5px dashed rgba(255,255,255,0.15)', color:'var(--cs-ink-300)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13 }}>
              <BKI name="plus" size={16} stroke={2.4} /> Add Child
            </button>
          </div>
        </div>
      )}

      <div style={{ padding:'20px 20px 0' }}>
        <button onClick={onNext} disabled={!participant} style={{ width:'100%', padding:'14px', borderRadius:'var(--radius-md)', border:'none', cursor: participant?'pointer':'not-allowed', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, background: participant?'var(--cs-cyan-500)':'rgba(255,255,255,0.06)', color: participant?'var(--cs-ink-900)':'var(--cs-ink-500)', opacity: participant?1:0.55 }}>
          Continue to Schedule →
        </button>
      </div>
    </div>
  );
}

/* ─── STEP 2: Select Session ────────────────────────────────── */
function Step2({ cls, participant, session, setSession, onNext }) {
  const sessions = useBKM(() => makeSessions(cls), [cls]);
  const stMap = { Available:{ c:'var(--cs-success-500)', bg:'rgba(31,184,113,0.14)' }, 'Few Seats':{ c:'var(--cs-amber-500)', bg:'rgba(255,176,46,0.14)' }, Full:{ c:'var(--cs-danger-500)', bg:'rgba(255,59,71,0.10)' } };
  return (
    <div style={{ flex:1, overflowY:'auto', paddingBottom:20 }}>
      <div style={{ padding:'4px 20px 14px' }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:4 }}>Pick a session</h2>
        <div style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'5px 12px', borderRadius:'var(--radius-pill)', background:'rgba(0,182,215,0.10)', border:'1px solid rgba(0,182,215,0.28)' }}>
          <image-slot id={participant?.slot} shape="circle" placeholder={participant?.name?.[0]||'?'} style={{ width:20, height:20, borderRadius:'50%', flexShrink:0 }}></image-slot>
          <span style={{ font:'var(--role-body-sm)', fontWeight:700, color:'var(--cs-cyan-400)' }}>{participant?.name}</span>
          <span style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-400)' }}>· {participant?.type==='self'?'Myself':'Child'}</span>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'0 20px' }}>
        {sessions.map(s => {
          const st = stMap[s.st] || stMap.Available;
          const sel = session?.id === s.id;
          const full = s.st === 'Full';
          return (
            <div key={s.id} onClick={() => !full && setSession(s)} style={{ padding:'14px 16px', borderRadius:'var(--radius-lg)', cursor: full?'not-allowed':'pointer',
              background: sel?'rgba(0,182,215,0.10)':'var(--cs-ink-800)',
              border: sel?'1.5px solid var(--cs-cyan-500)':'1px solid rgba(255,255,255,0.08)',
              opacity: full?0.55:1, transition:'border-color 160ms' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                <div>
                  <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:16, color:'#fff' }}>{s.date}</div>
                  <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:2 }}>{s.label}</div>
                </div>
                <span style={{ padding:'4px 10px', borderRadius:'var(--radius-pill)', background:st.bg, color:st.c, fontFamily:'var(--font-heading)', fontWeight:700, fontSize:11, alignSelf:'flex-start' }}>
                  {s.st === 'Full' ? 'Full · Join Waitlist' : s.st}
                </span>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 12px', font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-300)', fontWeight:600, marginBottom:10 }}>
                <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><BKI name="clock" size={13} stroke={2} color="var(--cs-cyan-400)" />{s.time} – {s.timeEnd} · {s.dur}</span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><BKI name="pin" size={13} stroke={2} color="var(--cs-ink-500)" />{s.branch}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', fontWeight:600 }}>
                  <span style={{ color: s.avail===0?'var(--cs-danger-500)':s.avail<=3?'var(--cs-amber-500)':'var(--cs-success-500)', fontWeight:800 }}>{s.avail}</span> / {s.total} seats
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ fontFamily:'var(--font-display)', fontSize:18, color:'#fff' }}>{s.unit} {s.price}</span>
                  {sel && <span style={{ width:22, height:22, borderRadius:'50%', display:'grid', placeItems:'center', background:'var(--cs-cyan-500)' }}><BKI name="check" size={13} stroke={3} color="var(--cs-ink-900)" /></span>}
                </div>
              </div>
              {/* capacity bar */}
              <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.07)', overflow:'hidden', marginTop:10 }}>
                <div style={{ height:'100%', width:Math.round((1-s.avail/s.total)*100)+'%', background: s.avail===0?'var(--cs-danger-500)':s.avail<=3?'var(--cs-amber-500)':'var(--cs-cyan-500)', borderRadius:2 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding:'20px 20px 0' }}>
        <div style={{ padding:'10px 14px', borderRadius:'var(--radius-md)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginBottom:14 }}>
          Cancellation allowed up to 24h before class · Please arrive 10 min early.
        </div>
        <button onClick={onNext} disabled={!session || session.st==='Full'} style={{ width:'100%', padding:'14px', borderRadius:'var(--radius-md)', border:'none', cursor: session&&session.st!=='Full'?'pointer':'not-allowed', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, background: session&&session.st!=='Full'?'var(--cs-cyan-500)':'rgba(255,255,255,0.06)', color: session&&session.st!=='Full'?'var(--cs-ink-900)':'var(--cs-ink-500)', opacity: session?1:0.55 }}>
          {session?.st==='Full' ? 'Join Waitlist' : 'Continue to Confirmation →'}
        </button>
      </div>
    </div>
  );
}

/* ─── STEP 3: Confirm & Payment ─────────────────────────────── */
function Step3({ cls, participant, session, onConfirm }) {
  const [payMethod, setPayMethod] = useBK('package');
  const [agreed, setAgreed] = useBK(false);
  const hasPkg = BK_USER.credits > 0;
  const creditsAfter = BK_USER.credits - (cls?.credits || 1);
  const ctaLabel = payMethod==='package' ? 'Use Credit & Confirm' : payMethod==='online' ? 'Pay & Confirm' : 'Reserve Seat';

  return (
    <div style={{ flex:1, overflowY:'auto', paddingBottom:20 }}>
      <div style={{ padding:'4px 20px 14px' }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:4 }}>Confirm booking</h2>
        <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)' }}>Review the details below before confirming.</p>
      </div>

      {/* Booking Summary */}
      <div style={{ margin:'0 20px 16px', padding:'14px', borderRadius:'var(--radius-lg)', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ font:'var(--role-eyebrow)', fontSize:10.5, letterSpacing:'0.09em', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Booking Summary</div>
        {[['Class', cls?.title], ['Style', `${cls?.style} · ${cls?.level}`], ['Instructor', cls?.inst?.name], ['Duration', cls?.dur], ['Date', session?.date], ['Time', `${session?.time} – ${session?.timeEnd}`], ['Branch', session?.branch]].map(([l,v]) => v && (
          <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{l}</span>
            <span style={{ font:'var(--role-body-sm)', color:'#fff', fontWeight:700, textAlign:'right', maxWidth:'60%' }}>{v}</span>
          </div>
        ))}
        <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>Participant</span>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', fontWeight:800 }}>{participant?.name} ({participant?.type==='self'?'Myself':'Child'})</span>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0' }}>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>Account Owner</span>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-200)', fontWeight:700 }}>{BK_USER.name}</span>
        </div>
      </div>

      {/* Payment Method */}
      <div style={{ padding:'0 20px', marginBottom:14 }}>
        <div style={{ font:'var(--role-eyebrow)', fontSize:10.5, letterSpacing:'0.09em', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Payment Method</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[{ id:'package', label:'Use Package Credit', sub:`${BK_USER.pkg.name} · ${BK_USER.credits} credits available`, dis:!hasPkg, ic:'circle' },
            { id:'online',  label:'Pay Online', sub:`${session?.unit} ${session?.price} · Secure payment`, dis:false, ic:'card' },
            { id:'studio',  label:'Pay at Studio', sub:'Payment due at reception', dis:false, ic:'cash' }].map(m => {
            const on = payMethod===m.id;
            return (
              <button key={m.id} onClick={() => !m.dis && setPayMethod(m.id)} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 14px', borderRadius:'var(--radius-lg)', cursor:m.dis?'not-allowed':'pointer', textAlign:'left',
                background: on?'rgba(0,182,215,0.10)':'rgba(255,255,255,0.04)',
                border: on?'1.5px solid var(--cs-cyan-500)':'1px solid rgba(255,255,255,0.08)',
                opacity:m.dis?0.4:1 }}>
                <span style={{ width:38, height:38, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'var(--radius-md)', background: on?'var(--cs-cyan-500)':'rgba(255,255,255,0.06)', color: on?'var(--cs-ink-900)':'var(--cs-ink-300)' }}><BKI name={m.ic} size={19} /></span>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{m.label}</div>
                  <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginTop:1 }}>{m.sub}</div>
                </div>
                <span style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, display:'grid', placeItems:'center', background: on?'var(--cs-cyan-500)':'transparent', border: on?'none':'2px solid rgba(255,255,255,0.20)' }}>
                  {on && <BKI name="check" size={12} stroke={3} color="var(--cs-ink-900)" />}
                </span>
              </button>
            );
          })}
        </div>
        {payMethod==='package' && hasPkg && (
          <div style={{ marginTop:10, padding:'12px 14px', borderRadius:'var(--radius-md)', background:'rgba(0,182,215,0.07)', border:'1px solid rgba(0,182,215,0.22)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', font:'var(--role-body-sm)', fontWeight:600, marginBottom:7 }}>
              <span style={{ color:'var(--cs-ink-300)' }}>{BK_USER.pkg.name}</span>
              <span style={{ color: creditsAfter < 2?'var(--cs-amber-500)':'var(--cs-cyan-400)' }}>{BK_USER.credits} → {creditsAfter} credits</span>
            </div>
            <div style={{ height:4, borderRadius:2, background:'rgba(255,255,255,0.08)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:Math.round((creditsAfter/BK_USER.pkg.total)*100)+'%', background:'linear-gradient(90deg,var(--cs-cyan-500),var(--cs-cyan-400))', borderRadius:2 }} />
            </div>
            <div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-500)', marginTop:5 }}>Expires {BK_USER.pkg.expiry}</div>
          </div>
        )}
        {payMethod==='studio' && (
          <div style={{ marginTop:10, display:'flex', gap:8, padding:'10px 12px', borderRadius:'var(--radius-md)', background:'rgba(255,176,46,0.09)', border:'1px solid rgba(255,176,46,0.28)' }}>
            <BKI name="warn" size={15} stroke={2.4} color="var(--cs-amber-500)" />
            <span style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-amber-400)', lineHeight:1.45 }}>Seat is not guaranteed until payment is completed at the studio.</span>
          </div>
        )}
      </div>

      {/* Price */}
      <div style={{ margin:'0 20px 14px', padding:'12px 14px', borderRadius:'var(--radius-md)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)' }}>Class price</span>
          <span style={{ font:'var(--role-body-sm)', color:'#fff', fontWeight:700 }}>{session?.unit} {session?.price}</span>
        </div>
        {payMethod==='package' && <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)' }}>Package credit</span>
          <span style={{ font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', fontWeight:800 }}>−{cls?.credits||1} credit</span>
        </div>}
        <div style={{ height:1, background:'rgba(255,255,255,0.07)', margin:'8px 0' }} />
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14.5, color:'#fff' }}>Total due</span>
          <span style={{ fontFamily:'var(--font-display)', fontSize:20, color: payMethod==='package'?'var(--cs-cyan-400)':'#fff' }}>{payMethod==='package'?'Covered':'EGP '+session?.price}</span>
        </div>
      </div>

      {/* Terms */}
      <div style={{ margin:'0 20px 14px' }}>
        <button onClick={() => setAgreed(a=>!a)} style={{ display:'flex', alignItems:'flex-start', gap:10, background:'none', border:'none', cursor:'pointer', textAlign:'left', padding:0, width:'100%' }}>
          <span style={{ width:20, height:20, flexShrink:0, display:'grid', placeItems:'center', borderRadius:4, marginTop:1,
            background: agreed?'var(--cs-cyan-500)':'transparent', border: agreed?'none':'1.5px solid rgba(255,255,255,0.25)' }}>
            {agreed && <BKI name="check" size={13} stroke={3} color="var(--cs-ink-900)" />}
          </span>
          <span style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-300)', lineHeight:1.5 }}>I agree to the <span style={{ color:'var(--cs-cyan-400)', fontWeight:700 }}>cancellation policy</span> and <span style={{ color:'var(--cs-cyan-400)', fontWeight:700 }}>studio terms</span>.</span>
        </button>
      </div>

      <div style={{ padding:'0 20px' }}>
        <button onClick={() => agreed && onConfirm({ payMethod })} disabled={!agreed} style={{ width:'100%', padding:'15px', borderRadius:'var(--radius-md)', border:'none', cursor:agreed?'pointer':'not-allowed', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, background:agreed?'var(--cs-cyan-500)':'rgba(255,255,255,0.06)', color:agreed?'var(--cs-ink-900)':'var(--cs-ink-500)', opacity:agreed?1:0.6 }}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

/* ─── Success Screen ────────────────────────────────────────── */
function SuccessScreen({ cls, participant, session, payMethod, onClose, onToast }) {
  const bookingId = 'CS' + String(Math.floor(Math.random()*900000+100000));
  const payLabel = { package:'Package Credit Used', online:'Paid Online', studio:'Pay at Studio' }[payMethod] || 'Confirmed';
  return (
    <div style={{ flex:1, overflowY:'auto', paddingBottom:30 }}>
      <div style={{ padding:'30px 20px 20px', textAlign:'center' }}>
        <style>{`
          @keyframes bkCirclePop {
            0%   { transform: scale(0);   opacity: 0; }
            55%  { transform: scale(1.18); opacity: 1; }
            75%  { transform: scale(0.92); }
            90%  { transform: scale(1.06); }
            100% { transform: scale(1);   opacity: 1; }
          }
          @keyframes bkRingPulse {
            0%   { box-shadow: 0 0 0px   8px rgba(0,182,215,0.55); }
            60%  { box-shadow: 0 0 0px  28px rgba(0,182,215,0.18); }
            100% { box-shadow: 0 0 32px 12px rgba(0,182,215,0.30); }
          }
          @keyframes bkCheckDraw {
            0%   { stroke-dashoffset: 60; opacity: 0; }
            30%  { opacity: 1; }
            100% { stroke-dashoffset: 0;  opacity: 1; }
          }
          @keyframes bkSuccessGlow {
            0%, 100% { opacity: 0.7; transform: scale(1); }
            50%       { opacity: 1;   transform: scale(1.08); }
          }
        `}</style>
        {/* glow halo */}
        <div style={{ position:'relative', width:80, height:80, margin:'0 auto 20px' }}>
          <div style={{ position:'absolute', inset:-14, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,182,215,0.22) 0%, transparent 70%)', animation:'bkSuccessGlow 2.2s ease-in-out 0.6s infinite', pointerEvents:'none' }} />
          <div style={{ width:80, height:80, borderRadius:'50%', background:'var(--cs-cyan-500)', display:'grid', placeItems:'center',
            animation:'bkCirclePop 0.55s cubic-bezier(0.22,1,0.36,1) both, bkRingPulse 0.8s ease-out 0.35s both' }}>
            {/* animated check SVG with stroke-dasharray draw */}
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5"
                stroke="var(--cs-ink-900)" strokeWidth="3"
                strokeDasharray="60" strokeDashoffset="60"
                style={{ animation:'bkCheckDraw 0.45s cubic-bezier(0.22,1,0.36,1) 0.42s both' }} />
            </svg>
          </div>
        </div>
        <h2 style={{ fontFamily:'var(--font-display)', fontSize:44, lineHeight:0.88, textTransform:'uppercase', color:'#fff', marginBottom:10 }}>Booking<br />Confirmed!</h2>
        <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', marginBottom:24 }}>See you on the floor, <span style={{ color:'#fff', fontWeight:700 }}>{participant?.name}</span>!</div>
      </div>
      <div style={{ margin:'0 20px 16px', background:'var(--cs-ink-800)', border:'1px solid rgba(0,182,215,0.28)', borderRadius:'var(--radius-lg)', padding:'14px' }}>
        {[['Booking ID', bookingId], ['Class', cls?.title], ['Participant', `${participant?.name} (${participant?.type==='self'?'Myself':'Child'})`], ['Account Owner', BK_USER.name], ['Date', session?.date], ['Time', `${session?.time} – ${session?.timeEnd}`], ['Branch', session?.branch], ['Payment', payLabel]].map(([l,v]) => (
          <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{l}</span>
            <span style={{ font:'var(--role-body-sm)', color: l==='Booking ID'?'var(--cs-cyan-400)':'#fff', fontWeight:700, textAlign:'right', maxWidth:'55%', fontFamily: l==='Booking ID'?'monospace':undefined }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ padding:'0 20px', display:'flex', flexDirection:'column', gap:10 }}>
        <button onClick={() => onToast('Added to calendar!')} style={{ padding:'13px', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>
          Add to Calendar
        </button>
        <button onClick={onClose} style={{ padding:'13px', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1px solid rgba(255,255,255,0.12)', cursor:'pointer' }}>View My Bookings</button>
        <button onClick={onClose} style={{ padding:'10px', background:'transparent', color:'var(--cs-ink-400)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:13, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>Close</button>
      </div>
    </div>
  );
}

/* ─── Failure / Waitlist Screen ─────────────────────────────── */
function ResultScreen({ type, cls, onRetry, onClose }) {
  const cfg = {
    failure: { ic:'x', col:'var(--cs-danger-500)', glow:'rgba(255,59,71,0.3)', title:'Booking Failed', sub:'Something went wrong. Please try again or contact the studio.', cta:'Try Again' },
    waitlist:{ ic:'clock', col:'var(--cs-amber-500)', glow:'rgba(255,176,46,0.3)', title:'Class is Full', sub:`You've been added to the waitlist for ${cls?.title}. We'll notify you if a spot opens.`, cta:'Choose Another Session' },
  }[type] || {};
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'30px', textAlign:'center' }}>
      <div style={{ width:76, height:76, borderRadius:'50%', background:`rgba(${type==='failure'?'255,59,71':'255,176,46'},0.14)`, border:`2px solid ${cfg.col}`, display:'grid', placeItems:'center', marginBottom:20, boxShadow:`0 0 24px ${cfg.glow}` }}>
        <BKI name={cfg.ic} size={38} stroke={2} color={cfg.col} />
      </div>
      <h2 style={{ fontFamily:'var(--font-display)', fontSize:40, lineHeight:0.88, textTransform:'uppercase', color:'#fff', marginBottom:12 }}>{cfg.title}</h2>
      <p style={{ font:'var(--role-body)', color:'var(--cs-ink-300)', lineHeight:1.6, maxWidth:270, marginBottom:28 }}>{cfg.sub}</p>
      {type==='waitlist' && <div style={{ padding:'10px 16px', borderRadius:'var(--radius-pill)', background:'rgba(255,176,46,0.12)', border:'1px solid rgba(255,176,46,0.30)', color:'var(--cs-amber-500)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, marginBottom:20 }}>Waitlist Position: #4</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
        <button onClick={onRetry} style={{ padding:'13px', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>{cfg.cta}</button>
        <button onClick={onClose} style={{ padding:'13px', background:'rgba(255,255,255,0.06)', color:'var(--cs-ink-200)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1px solid rgba(255,255,255,0.10)', cursor:'pointer' }}>Close</button>
      </div>
    </div>
  );
}

/* ─── BookingFlow (orchestrator) ────────────────────────────── */
function BookingFlow({ cls, onClose, onToast }) {
  const [step, setStep] = useBK(1);
  const [participant, setParticipant] = useBK(null);
  const [session, setSession] = useBK(null);
  const [result, setResult] = useBK(null); // null | 'success' | 'failure' | 'waitlist'
  const [payMethod, setPayMethod] = useBK('package');

  function confirm({ payMethod: pm }) {
    setPayMethod(pm);
    // simulate 90% success, 10% failure
    const ok = Math.random() > 0.15;
    if (session?.st === 'Full') { setResult('waitlist'); return; }
    setResult(ok ? 'success' : 'failure');
    setStep('result');
  }

  const stepNum = typeof step === 'number' ? step : 0;
  const showProgress = typeof step === 'number';

  return (
    <div style={{ position:'absolute', inset:0, zIndex:102, background:'var(--cs-ink-900)', display:'flex', flexDirection:'column', animation:'bkFlowIn 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes bkFlowIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {/* header */}
      <div style={{ padding:'56px 20px 0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <button onClick={step === 1 || step === 'result' ? onClose : () => setStep(s => typeof s==='number' ? Math.max(1,s-1) : 1)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:14, padding:0 }}>
          <BKI name="back" size={20} stroke={2.2} />{step===1||step==='result'?'Cancel':'Back'}
        </button>
        <h1 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:16, color:'#fff' }}>
          {step==='result' ? (result==='success'?'Booking Confirmed':result==='waitlist'?'Waitlist':'Booking Failed') : 'Book Class'}
        </h1>
        <span style={{ width:60 }} />
      </div>

      {showProgress && <div style={{ paddingTop:14, flexShrink:0 }}><BKProgress step={stepNum} /></div>}

      {step === 1 && <Step1 cls={cls} participant={participant} setParticipant={setParticipant} onNext={() => setStep(2)} />}
      {step === 2 && <Step2 cls={cls} participant={participant} session={session} setSession={setSession} onNext={() => setStep(3)} />}
      {step === 3 && <Step3 cls={cls} participant={participant} session={session} onConfirm={confirm} />}
      {step === 'result' && result === 'success' && <SuccessScreen cls={cls} participant={participant} session={session} payMethod={payMethod} onClose={onClose} onToast={onToast} />}
      {step === 'result' && result !== 'success' && <ResultScreen type={result} cls={cls} onRetry={() => setStep(2)} onClose={onClose} />}
    </div>
  );
}

Object.assign(window, { BookingFlow });
