/* global React */

function PPIcon({ name, size=18 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'calendar':  return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>;
    case 'check':     return <svg {...p}><path d="M20 6 9 17l-5-5"/></svg>;
    case 'package':   return <svg {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>;
    case 'star':      return <svg {...p} fill="currentColor" stroke="none"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.1l1-5.8L3.5 9.2l5.9-.9L12 3Z"/></svg>;
    case 'clock':     return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
    case 'message':   return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'phone':     return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z"/></svg>;
    case 'mail':      return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
    case 'search':    return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.4-4.4"/></svg>;
    default: return null;
  }
}

const { useState: usePP } = React;

/* ─── Shared sub-page shell ─────────────────────────────────── */
function SubPage({ title, onBack, rightAction, children }) {
  return (
    <div style={{ position:'absolute', inset:0, zIndex:90, background:'var(--cs-ink-900)', overflowY:'auto', animation:'profSlide 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes profSlide{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div style={{ padding:'56px 20px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'var(--cs-ink-900)', position:'sticky', top:0, zIndex:10 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:14, padding:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Back
        </button>
        <h1 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:17, color:'#fff' }}>{title}</h1>
        <div style={{ minWidth:54, display:'flex', justifyContent:'flex-end' }}>{rightAction || <span />}</div>
      </div>
      {children}
    </div>
  );
}

/* shared atoms */
function PField({ label, value, onChange, type='text', readOnly, placeholder }) {
  const [f, setF] = usePP(false);
  return (
    <div>
      <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>{label}</div>
      <input type={type} value={value} onChange={e => onChange && onChange(e.target.value)} readOnly={readOnly} placeholder={placeholder||''}
        onFocus={() => setF(true)} onBlur={() => setF(false)}
        style={{ width:'100%', padding:'14px', fontSize:15, fontFamily:'var(--font-body)', color: readOnly ? 'var(--cs-ink-400)' : '#fff',
          background: readOnly ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
          border:`1.5px solid ${f ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.10)'}`,
          borderRadius:'var(--radius-sm)', outline:'none', transition:'border 180ms', cursor: readOnly ? 'default' : 'text' }} />
    </div>
  );
}
function PToggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width:48, height:27, borderRadius:14, padding:2, cursor:'pointer', border:'none', flexShrink:0,
      background: on ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.15)', transition:'background 220ms' }}>
      <span style={{ display:'block', width:23, height:23, borderRadius:'50%', background:'#fff',
        transform: on ? 'translateX(21px)' : 'translateX(0)', transition:'transform 220ms' }} />
    </button>
  );
}
function PSaveBtn({ onClick, saved }) {
  return <button onClick={onClick} style={{ padding:'7px 14px', borderRadius:'var(--radius-pill)', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:13, border:'none', cursor:'pointer' }}>{saved ? '✓ Saved' : 'Save'}</button>;
}

/* ─── 1. EDIT PROFILE ─────────────────────────────────────────*/
function EditProfile({ onBack, onToast, user: u }) {
  const [name, setName] = usePP(u.name);
  const [email, setEmail] = usePP(u.email);
  const [phone, setPhone] = usePP(u.phone);
  const [dob, setDob] = usePP('1990-03-15');
  const [gender, setGender] = usePP('Female');
  const [ecName, setEcName] = usePP('Ahmed Adel');
  const [ecRel, setEcRel] = usePP('Husband');
  const [ecPhone, setEcPhone] = usePP('011 9876 5432');
  const [saved, setSaved] = usePP(false);
  function save() { setSaved(true); setTimeout(() => { setSaved(false); onToast('Profile saved!'); onBack(); }, 900); }
  return (
    <SubPage title="Edit Profile" onBack={onBack} rightAction={<PSaveBtn onClick={save} saved={saved} />}>
      <div style={{ padding:'22px 20px 100px', display:'flex', flexDirection:'column', gap:24 }}>
        {/* avatar */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Profile Photo</div>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <image-slot id="profile-avatar" shape="circle" placeholder={u.name[0]} style={{ width:76, height:76, borderRadius:'50%', flexShrink:0, boxShadow:'0 0 0 3px var(--cs-cyan-500)' }}></image-slot>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <button onClick={() => onToast('Opening photo picker…')} style={{ padding:'9px 16px', borderRadius:'var(--radius-pill)', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:13, border:'none', cursor:'pointer' }}>Change Photo</button>
              <button onClick={() => onToast('Photo removed')} style={{ padding:'9px 16px', borderRadius:'var(--radius-pill)', background:'rgba(255,59,71,0.12)', color:'var(--cs-danger-500)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, border:'1px solid rgba(255,59,71,0.25)', cursor:'pointer' }}>Remove</button>
            </div>
          </div>
        </div>
        {/* personal */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Personal Information</div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <PField label="Full Name" value={name} onChange={setName} />
            <PField label="Email Address" value={email} onChange={setEmail} type="email" />
            <PField label="Phone Number" value={phone} onChange={setPhone} type="tel" />
            <PField label="Date of Birth" value={dob} onChange={setDob} type="date" />
            <div>
              <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>Gender</div>
              <div style={{ display:'flex', gap:8 }}>
                {['Female','Male','Other'].map(g => (
                  <button key={g} onClick={() => setGender(g)} style={{ flex:1, padding:'11px 6px', borderRadius:'var(--radius-md)', cursor:'pointer',
                    fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12,
                    background: gender===g ? 'var(--cs-ink-900)' : 'rgba(255,255,255,0.05)',
                    border: gender===g ? '1.5px solid rgba(0,182,215,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                    color: gender===g ? '#fff' : 'var(--cs-ink-400)' }}>{g}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* account */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Account Information</div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <PField label="Membership ID" value="CS-MEM-00142" readOnly />
            <PField label="Account Type" value={u.role} readOnly />
          </div>
        </div>
        {/* emergency */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>Emergency Contact</div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <PField label="Contact Name" value={ecName} onChange={setEcName} />
            <PField label="Relationship" value={ecRel} onChange={setEcRel} placeholder="e.g. Spouse, Parent" />
            <PField label="Phone Number" value={ecPhone} onChange={setEcPhone} type="tel" />
          </div>
        </div>
      </div>
    </SubPage>
  );
}

/* ─── 2. PACKAGE CENTER ──────────────────────────────────────── */
const PKG_DATA = [
  { id:'pk1', name:'Premium Package', type:'10-Class Pack', credits:7, total:10, used:3,
    expiry:'Aug 31, 2026', purchase:'Jun 1, 2026', price:'EGP 1,200',
    classes:['Hip Hop','Ballet','Salsa','Afro','Breaking'], status:'active' },
  { id:'pk2', name:'Starter Pack', type:'5-Class Pack', credits:0, total:5, used:5,
    expiry:'May 15, 2026', purchase:'Apr 1, 2026', price:'EGP 600',
    classes:['Hip Hop','Ballet'], status:'completed' },
];
function PackageCenter({ onBack, onToast }) {
  const [tab, setTab] = usePP('active');
  const act = PKG_DATA.find(p => p.status === 'active');
  const show = tab==='active' ? PKG_DATA.filter(p=>p.status==='active') : PKG_DATA.filter(p=>p.status!=='active');
  return (
    <SubPage title="Package Center" onBack={onBack}>
      <div style={{ padding:'20px 20px 100px' }}>
        {act && (
          <div style={{ padding:18, borderRadius:'var(--radius-lg)', background:'linear-gradient(135deg,rgba(0,182,215,0.16),rgba(0,182,215,0.10))', border:'1px solid rgba(0,182,215,0.38)', marginBottom:22 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <div>
                <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:5 }}>Active Package</div>
                <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:20, color:'#fff' }}>{act.name}</div>
                <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', marginTop:2 }}>{act.type} · Expires {act.expiry}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:44, color:'#fff', lineHeight:0.9 }}>{act.credits}</div>
                <div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-cyan-400)', marginTop:4, fontWeight:700 }}>credits left</div>
              </div>
            </div>
            <div style={{ height:7, borderRadius:4, background:'rgba(255,255,255,0.08)', overflow:'hidden', marginBottom:8 }}>
              <div style={{ height:'100%', width:Math.round((act.credits/act.total)*100)+'%', background:'linear-gradient(90deg,var(--cs-cyan-500),var(--cs-cyan-400))', borderRadius:4 }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', fontWeight:600, marginBottom:14 }}>
              <span>{act.used} used</span><span>{act.credits}/{act.total} remaining</span>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
              {act.classes.map(c => <span key={c} style={{ padding:'4px 9px', borderRadius:'var(--radius-pill)', background:'rgba(255,255,255,0.07)', color:'var(--cs-ink-200)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:11 }}>{c}</span>)}
            </div>
            <button onClick={() => onToast('Opening packages catalog…')} style={{ width:'100%', padding:'13px', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>Buy New Package</button>
          </div>
        )}
        <div style={{ display:'flex', gap:4, padding:4, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'var(--radius-pill)', marginBottom:16 }}>
          {['active','past'].map(t => { const on=tab===t; return <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:'9px', borderRadius:'var(--radius-pill)', cursor:'pointer', border:'none', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, background: on?'var(--cs-ink-900)':'transparent', color: on?'#fff':'var(--cs-ink-400)', transition:'all 160ms' }}>{t==='active'?'Active':'Past'}</button>; })}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {show.map(p => (
            <div key={p.id} style={{ padding:16, borderRadius:'var(--radius-lg)', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:16, color:'#fff' }}>{p.name}</div><div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginTop:2 }}>{p.type} · {p.price}</div></div>
                <span style={{ padding:'4px 10px', borderRadius:'var(--radius-pill)', alignSelf:'flex-start', background: p.status==='active'?'rgba(31,184,113,0.16)':'rgba(255,255,255,0.06)', color: p.status==='active'?'var(--cs-success-500)':'var(--cs-ink-400)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:11 }}>{p.status==='active'?'Active':'Completed'}</span>
              </div>
              <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:8 }}>Purchased {p.purchase} · Expires {p.expiry}</div>
              <div style={{ height:5, borderRadius:3, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
                <div style={{ height:'100%', width:Math.round((p.status==='active'?p.credits:0)/p.total*100)+'%', background:'linear-gradient(90deg,var(--cs-cyan-500),var(--cs-cyan-400))', borderRadius:3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SubPage>
  );
}

/* ─── 3. CREDIT HISTORY ──────────────────────────────────────── */
const CREDIT_TX = [
  { id:'t1', type:'added',   label:'Premium Package Activated',   date:'Jun 1',  delta:'+10', bal:10, ic:'↑', col:'var(--cs-success-500)' },
  { id:'t2', type:'used',    label:'Hip Hop Foundations',         date:'Jun 7',  delta:'-1',  bal:9,  ic:'↓', col:'var(--cs-danger-500)' },
  { id:'t3', type:'refunded',label:'Ballet Foundations (Cancelled)',date:'Jun 5', delta:'+1',  bal:8,  ic:'↩', col:'var(--cs-cyan-400)' },
  { id:'t4', type:'used',    label:'Afro Heat',                   date:'Jun 14', delta:'-1',  bal:8,  ic:'↓', col:'var(--cs-danger-500)' },
  { id:'t5', type:'used',    label:'Hip Hop Foundations',         date:'Jun 21', delta:'-1',  bal:7,  ic:'↓', col:'var(--cs-danger-500)' },
  { id:'t6', type:'expired', label:'Starter Pack Expired',        date:'May 15', delta:'-0',  bal:0,  ic:'✕', col:'var(--cs-ink-400)' },
];
function CreditHistory({ onBack }) {
  const [filter, setFilter] = usePP('all');
  const list = filter==='all' ? CREDIT_TX : CREDIT_TX.filter(t => t.type===filter);
  return (
    <SubPage title="Credit History" onBack={onBack}>
      <div style={{ padding:'20px 20px 100px' }}>
        <div style={{ padding:'18px', borderRadius:'var(--radius-lg)', background:'linear-gradient(135deg,rgba(0,182,215,0.15),rgba(10,11,13,0))', border:'1px solid rgba(0,182,215,0.35)', marginBottom:20, textAlign:'center' }}>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:6 }}>Available Credits</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:56, color:'#fff', lineHeight:0.9 }}>7</div>
          <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', marginTop:8 }}>Premium Package · Expires Aug 31, 2026</div>
        </div>
        <div className="hscroll" style={{ gap:8, marginBottom:16 }}>
          {['all','added','used','refunded','expired'].map(f => { const on=filter===f; const labels={all:'All',added:'Added',used:'Used',refunded:'Refunded',expired:'Expired'};
            return <button key={f} onClick={() => setFilter(f)} style={{ flexShrink:0, padding:'8px 14px', borderRadius:'var(--radius-pill)', cursor:'pointer', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12.5, background: on?'var(--cs-ink-900)':'rgba(255,255,255,0.05)', border: on?'1.5px solid rgba(255,255,255,0.3)':'1.5px solid rgba(255,255,255,0.08)', color: on?'#fff':'var(--cs-ink-400)' }}>{labels[f]}</button>; })}
        </div>
        <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
          {list.map((tx,i) => (
            <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderBottom: i===list.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ width:36, height:36, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(255,255,255,0.05)', color:tx.col, fontWeight:800, fontSize:16 }}>{tx.ic}</span>
              <div style={{ flex:1 }}><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{tx.label}</div><div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginTop:1 }}>{tx.date}</div></div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, color:tx.col }}>{tx.delta}</div>
                <div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-500)', marginTop:1 }}>bal {tx.bal}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SubPage>
  );
}

/* ─── 4. NOTIFICATIONS ───────────────────────────────────────── */
const NOTIFS_DATA = [
  { id:'n1', type:'class',   icon:'calendar', title:'Class Tomorrow',     desc:'Hip Hop Foundations is tomorrow at 9:00 PM. See you on the floor!', date:'Today',  time:'2:30 PM', read:false },
  { id:'n2', type:'payment', icon:'✓',  title:'Payment Confirmed',  desc:'Your online payment for Salsa On2 Social has been received.',       date:'Today',  time:'10:14 AM',read:false },
  { id:'n3', type:'package', icon:'P',  title:'Package Activated',  desc:'Premium Package is now active. You have 10 credits to use.',        date:'Jun 1',  time:'9:00 AM', read:true },
  { id:'n4', type:'studio',  icon:'star', title:'New Class Added',    desc:'K-Pop Dance Intensive is now available. Limited seats!',            date:'May 28', time:'4:00 PM', read:true },
  { id:'n5', type:'class',   icon:'clock', title:'Assessment Reminder',desc:'Ballet Level Assessment is in 24 hours. Check your schedule.',      date:'Jun 30', time:'4:00 PM', read:true },
];
const N_COL = { class:'var(--cs-cyan-400)', payment:'var(--cs-success-500)', package:'var(--cs-cyan-400)', studio:'var(--cs-magenta-500)' };
function NotificationsCenter({ onBack }) {
  const [filter, setFilter] = usePP('all');
  const [notifs, setNotifs] = usePP(NOTIFS_DATA);
  const unread = notifs.filter(n => !n.read).length;
  const list = filter==='all' ? notifs : notifs.filter(n => n.type===filter);
  const markAll = () => setNotifs(ns => ns.map(n => ({...n, read:true})));
  return (
    <SubPage title="Notifications" onBack={onBack} rightAction={unread > 0 && <button onClick={markAll} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12.5, whiteSpace:'nowrap' }}>Mark all read</button>}>
      <div style={{ padding:'16px 20px 100px' }}>
        <div className="hscroll" style={{ gap:8, marginBottom:16 }}>
          {['all','class','payment','package','studio'].map(f => { const on=filter===f; const labels={all:'All',class:'Classes',payment:'Payments',package:'Packages',studio:'Studio'};
            return <button key={f} onClick={() => setFilter(f)} style={{ flexShrink:0, padding:'8px 14px', borderRadius:'var(--radius-pill)', cursor:'pointer', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12.5, background: on?'var(--cs-ink-900)':'rgba(255,255,255,0.05)', border: on?'1.5px solid rgba(255,255,255,0.3)':'1.5px solid rgba(255,255,255,0.08)', color: on?'#fff':'var(--cs-ink-400)' }}>{labels[f]}</button>; })}
        </div>
        <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
          {list.map((n,i) => (
            <div key={n.id} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 16px', cursor:'pointer', background: n.read?'transparent':'rgba(0,182,215,0.04)', borderBottom: i===list.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}
              onClick={() => setNotifs(ns => ns.map(x => x.id===n.id ? {...x,read:true} : x))}>
              <span style={{ width:38, height:38, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(255,255,255,0.05)', color:N_COL[n.type], position:'relative', border:`1.5px solid ${N_COL[n.type]}44` }}>
                <PPIcon name={n.icon} size={16} />
                {!n.read && <span style={{ position:'absolute', top:1, right:1, width:9, height:9, borderRadius:'50%', background:'var(--cs-magenta-500)', border:'2px solid var(--cs-ink-800)' }} />}
              </span>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontFamily:'var(--font-heading)', fontWeight: n.read?600:800, fontSize:14.5, color:'#fff' }}>{n.title}</span>
                  <span style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-500)', whiteSpace:'nowrap', marginLeft:8 }}>{n.time}</span>
                </div>
                <div style={{ font:'var(--role-body-sm)', fontSize:13, color:'var(--cs-ink-300)', lineHeight:1.45 }}>{n.desc}</div>
                <div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-500)', marginTop:4 }}>{n.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SubPage>
  );
}

window.PROFILE_PAGES = window.PROFILE_PAGES || {};
Object.assign(window.PROFILE_PAGES, { editProfile:EditProfile, packageCenter:PackageCenter, creditHistory:CreditHistory, notifications:NotificationsCenter });
Object.assign(window, { SubPage, PField, PToggle });
