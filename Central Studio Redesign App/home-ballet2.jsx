/* global React */

function B2Icon({ name, size=24 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'clipboard': return <svg {...p}><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h4"/></svg>;
    case 'camera':    return <svg {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
    case 'calendar':  return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>;
    case 'ribbon':    return <svg {...p}><circle cx="12" cy="9" r="6"/><path d="M8.2 14.4 7 22l5-3 5 3-1.2-7.6"/></svg>;
    case 'hourglass': return <svg {...p}><path d="M5 22h14M5 2h14"/><path d="M17 22v-4.2a4 4 0 0 0-1.2-2.8l-3.8-3.8 3.8-3.8A4 4 0 0 0 17 4.2V2"/><path d="M7 2v2.2a4 4 0 0 0 1.2 2.8l3.8 3.8-3.8 3.8A4 4 0 0 0 7 17.8V22"/></svg>;
    case 'mail':      return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
    case 'download':  return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>;
    default: return null;
  }
}

const { useState: useBL2, useRef: useBL2R } = React;
const { PField } = window;

/* ============================================================
   Central Studio — Ballet Assessment Application Flow
   9-step form: Intro → Info → Physical → Media → Review →
   Success → Status → Appointment → Result
   ============================================================ */

const STEPS_LABELS = ['Intro','Details','Physical','Media','Review','Submitted','Status','Appointment','Result'];

/* shared step wrapper */
function APage({ step, children, footer }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* progress */}
      <div style={{ padding:'0 20px 14px', flexShrink:0 }}>
        <div style={{ display:'flex', gap:3 }}>
          {Array.from({length:9}).map((_,i) => (
            <div key={i} style={{ flex:1, height:3, borderRadius:2,
              background: i<step ? 'var(--cs-cyan-400)' : i===step-1 ? 'rgba(167,139,250,0.7)' : 'rgba(255,255,255,0.08)',
              transition:'background 300ms' }} />
          ))}
        </div>
        <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-500)', marginTop:5, fontWeight:600 }}>
          Step {step} of {STEPS_LABELS.length} · {STEPS_LABELS[step-1]}
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0 20px' }}>{children}</div>
      {footer && <div style={{ padding:'14px 20px 20px', flexShrink:0, borderTop:'1px solid rgba(255,255,255,0.07)', background:'var(--cs-ink-900)' }}>{footer}</div>}
    </div>
  );
}

function AContinue({ onClick, label='Continue →', disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ width:'100%', padding:'14px', background:'linear-gradient(135deg,var(--cs-cyan-400),var(--cs-cyan-500))', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, borderRadius:'var(--radius-md)', border:'none', cursor: disabled?'not-allowed':'pointer', opacity: disabled?0.45:1 }}>{label}</button>
  );
}

function ASection({ title, children }) {
  return (
    <div style={{ marginBottom:22 }}>
      <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:12 }}>{title}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:13 }}>{children}</div>
    </div>
  );
}

function ASelect({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width:'100%', padding:'13px 14px', fontSize:15, fontFamily:'var(--font-body)', color:'#fff', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'var(--radius-sm)', outline:'none', appearance:'none' }}>
        {options.map(o => <option key={o} value={o} style={{ background:'#0a0b0d' }}>{o}</option>)}
      </select>
    </div>
  );
}

/* ─── Step 1: Intro ─────────────────────────────────────────── */
function Step1({ next }) {
  return (
    <APage step={1} footer={<AContinue onClick={next} label="Start Application →" />}>
      <div style={{ paddingBottom:20 }}>
        <div style={{ padding:'22px 0 18px', textAlign:'center' }}>
          <div style={{ width:72, height:72, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(0,182,215,0.12)', color:'var(--cs-cyan-400)', margin:'0 auto 16px' }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.8"/><path d="M8 21l3.5-7L9 11l3-4.5"/><path d="M9 6.5l4 2 3-1.5"/><path d="M13 8.5l2 4-2.5 2.5M15.5 19l-2-4.5"/></svg></div>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:46, lineHeight:0.88, textTransform:'uppercase', color:'#fff', marginBottom:12 }}>Ballet<br />Assessment</h2>
          <p style={{ font:'var(--role-body)', color:'var(--cs-ink-200)', lineHeight:1.6, maxWidth:290, margin:'0 auto' }}>A free placement assessment to find the perfect level for your dance journey.</p>
        </div>
        {[{ ic:'clipboard', title:'Complete the form', desc:'Personal info, dance background, and physical details' }, { ic:'camera', title:'Submit your media', desc:'Profile photo, full-body photo, and optional video' }, { ic:'calendar', title:'Get your appointment', desc:'We\'ll contact you to schedule the assessment session' }, { ic:'ribbon', title:'Receive your result', desc:'Your level placement within 48 hours of the session' }].map(s => (
          <div key={s.title} style={{ display:'flex', gap:13, marginBottom:14, padding:'13px', background:'rgba(0,182,215,0.07)', border:'1px solid rgba(0,182,215,0.16)', borderRadius:'var(--radius-lg)' }}>
            <span style={{ width:36, height:36, flexShrink:0, display:'grid', placeItems:'center', borderRadius:'var(--radius-md)', background:'rgba(0,182,215,0.12)', color:'var(--cs-cyan-400)' }}><B2Icon name={s.ic} size={20} /></span>
            <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{s.title}</div><div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', marginTop:2 }}>{s.desc}</div></div>
          </div>
        ))}
        <div style={{ padding:'12px 14px', borderRadius:'var(--radius-md)', background:'rgba(0,182,215,0.08)', border:'1px solid rgba(0,182,215,0.22)', font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', fontWeight:600 }}>
          ✦ The placement assessment is completely free of charge.
        </div>
      </div>
    </APage>
  );
}

/* ─── Step 2: Applicant Information ────────────────────────── */
function Step2({ next, form, set }) {
  const isMinor = form.dob && (new Date().getFullYear() - new Date(form.dob).getFullYear() < 18);
  return (
    <APage step={2} footer={<AContinue onClick={next} disabled={!form.name||!form.email||!form.phone} />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:20 }}>Applicant Information</h2>
        <ASection title="Personal Information">
          <PField label="Full Name *" value={form.name||''} onChange={v => set({name:v})} placeholder="First and last name" />
          <PField label="Date of Birth *" value={form.dob||''} onChange={v => set({dob:v})} type="date" />
          <div>
            <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>Gender *</div>
            <div style={{ display:'flex', gap:8 }}>
              {['Female','Male','Other'].map(g => (
                <button key={g} onClick={() => set({gender:g})} style={{ flex:1, padding:'11px 4px', borderRadius:'var(--radius-md)', cursor:'pointer', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12.5, background: form.gender===g?'rgba(0,182,215,0.16)':'rgba(255,255,255,0.05)', border: form.gender===g?'1.5px solid var(--cs-cyan-400)':'1.5px solid rgba(255,255,255,0.08)', color: form.gender===g?'var(--cs-cyan-400)':'var(--cs-ink-400)' }}>{g}</button>
              ))}
            </div>
          </div>
        </ASection>
        <ASection title="Contact Information">
          <PField label="Email Address *" value={form.email||''} onChange={v => set({email:v})} type="email" placeholder="your@email.com" />
          <PField label="Phone Number *" value={form.phone||''} onChange={v => set({phone:v})} type="tel" placeholder="+20 11 ..." />
        </ASection>
        {isMinor && (
          <ASection title="Parent Information">
            <PField label="Parent Name" value={form.parentName||''} onChange={v => set({parentName:v})} />
            <PField label="Parent Phone" value={form.parentPhone||''} onChange={v => set({parentPhone:v})} type="tel" />
            <PField label="Parent Email" value={form.parentEmail||''} onChange={v => set({parentEmail:v})} type="email" />
          </ASection>
        )}
        <ASection title="Dance Background">
          <ASelect label="Years of Experience" value={form.experience||'Less than 1 year'} onChange={v => set({experience:v})} options={['Less than 1 year','1–2 years','3–4 years','5–7 years','8+ years']} />
          <ASelect label="Current Ballet Level (self-assessed)" value={form.currentLevel||'None — Complete Beginner'} onChange={v => set({currentLevel:v})} options={['None — Complete Beginner','Pre Ballet','Beginner','Elementary','Intermediate','Advanced']} />
          <PField label="Previous Ballet Schools" value={form.schools||''} onChange={v => set({schools:v})} placeholder="e.g. Cairo Ballet Academy (optional)" />
          <PField label="Previous Performances" value={form.performances||''} onChange={v => set({performances:v})} placeholder="e.g. School Recital 2024 (optional)" />
        </ASection>
      </div>
    </APage>
  );
}

/* ─── Step 3: Physical Information ─────────────────────────── */
function Step3({ next, form, set }) {
  return (
    <APage step={3} footer={<AContinue onClick={next} disabled={!form.height||!form.weight} />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:20 }}>Physical Information</h2>
        <ASection title="Measurements">
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}><PField label="Height (cm) *" value={form.height||''} onChange={v => set({height:v})} type="number" placeholder="e.g. 162" /></div>
            <div style={{ flex:1 }}><PField label="Weight (kg) *" value={form.weight||''} onChange={v => set({weight:v})} type="number" placeholder="e.g. 55" /></div>
          </div>
          <ASelect label="Flexibility Level" value={form.flex||'Moderate'} onChange={v => set({flex:v})} options={['Very Limited','Limited','Moderate','Flexible','Very Flexible']} />
          <div style={{ display:'flex', gap:12 }}>
            <div style={{ flex:1 }}><ASelect label="Dominant Leg" value={form.leg||'Right'} onChange={v => set({leg:v})} options={['Right','Left']} /></div>
            <div style={{ flex:1 }}><ASelect label="Dominant Arm" value={form.arm||'Right'} onChange={v => set({arm:v})} options={['Right','Left']} /></div>
          </div>
        </ASection>
        <ASection title="Optional Notes">
          <div>
            <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>Previous Injuries</div>
            <textarea value={form.injuries||''} onChange={e => set({injuries:e.target.value})} rows={3} placeholder="Describe any previous dance-related injuries (optional)"
              style={{ width:'100%', padding:'13px', fontSize:14.5, fontFamily:'var(--font-body)', color:'#fff', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'var(--radius-sm)', outline:'none', resize:'none' }} />
          </div>
          <div>
            <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>Medical Considerations</div>
            <textarea value={form.medical||''} onChange={e => set({medical:e.target.value})} rows={3} placeholder="Any medical conditions our assessors should know about (optional)"
              style={{ width:'100%', padding:'13px', fontSize:14.5, fontFamily:'var(--font-body)', color:'#fff', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'var(--radius-sm)', outline:'none', resize:'none' }} />
          </div>
        </ASection>
      </div>
    </APage>
  );
}

/* ─── Step 4: Media Submission ─────────────────────────────── */
function Step4({ next, form, set }) {
  function UpSlot({ id, label, req, desc }) {
    const [dropped, setDropped] = useBL2(false);
    return (
      <div style={{ padding:'16px', borderRadius:'var(--radius-lg)', background: dropped?'rgba(0,182,215,0.08)':'rgba(255,255,255,0.04)', border: dropped?'2px solid rgba(0,182,215,0.45)':'2px dashed rgba(255,255,255,0.14)', cursor:'pointer', textAlign:'center' }}
        onClick={() => { setDropped(!dropped); set({[id]:!dropped?'uploaded':null}); }}>
        <div style={{ fontSize:28, marginBottom:8 }}>{dropped ? '✓' : req ? '📸' : '🎬'}</div>
        <div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, color: dropped?'var(--cs-cyan-400)':'#fff' }}>{dropped ? 'File added' : label}</div>
        <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginTop:3 }}>{dropped ? 'Tap to remove' : desc}</div>
        {req && <span style={{ marginTop:6, display:'inline-block', padding:'2px 8px', borderRadius:'var(--radius-pill)', background:'rgba(0,182,215,0.14)', color:'var(--cs-cyan-400)', fontSize:10, fontFamily:'var(--font-heading)', fontWeight:800, textTransform:'uppercase' }}>Required</span>}
      </div>
    );
  }
  const ok = form.photo1 && form.photo2;
  return (
    <APage step={4} footer={<AContinue onClick={next} disabled={!ok} label={ok?'Continue →':'Upload required files first'} />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:6 }}>Media Submission</h2>
        <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', lineHeight:1.5, marginBottom:20 }}>Tap each slot to simulate uploading your files. Required items must be uploaded to continue.</p>
        <ASection title="Required">
          <UpSlot id="photo1" label="Profile Photo" req desc="Clear headshot facing camera · JPG or PNG" />
          <UpSlot id="photo2" label="Full Body Photo" req desc="Standing straight, ballet position · JPG or PNG" />
        </ASection>
        <ASection title="Optional">
          <UpSlot id="video1" label="Ballet Performance Video" desc="Any recent performance or class footage · MP4" />
          <UpSlot id="video2" label="Training Video" desc="Basic exercises: plié, relevé, tendu · MP4" />
          <UpSlot id="portfolio" label="Portfolio Files" desc="Certificates, awards, previous programs · PDF" />
        </ASection>
        <div style={{ padding:'12px 14px', borderRadius:'var(--radius-md)', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)' }}>
          Max file size: 25 MB per file · Supported: JPG, PNG, MP4, PDF
        </div>
      </div>
    </APage>
  );
}

/* ─── Step 5: Review ────────────────────────────────────────── */
function Step5({ next, form, goTo }) {
  function ReviewRow({ label, value }) {
    return value ? (
      <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{label}</span>
        <span style={{ font:'var(--role-body-sm)', color:'#fff', fontWeight:700, textAlign:'right', maxWidth:'55%' }}>{value}</span>
      </div>
    ) : null;
  }
  return (
    <APage step={5} footer={<AContinue onClick={next} label="Submit Application ✦" />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:20 }}>Review & Submit</h2>
        {[{ title:'Personal Information', step:2, rows:[['Full Name',form.name],['Date of Birth',form.dob],['Gender',form.gender],['Experience',form.experience],['Current Level',form.currentLevel]] },
          { title:'Physical Information', step:3, rows:[['Height',form.height?form.height+' cm':null],['Weight',form.weight?form.weight+' kg':null],['Flexibility',form.flex],['Dominant Leg',form.leg]] },
          { title:'Media Uploaded', step:4, rows:[['Profile Photo',form.photo1?'✓ Uploaded':null],['Full Body Photo',form.photo2?'✓ Uploaded':null],['Performance Video',form.video1?'✓ Uploaded':null]] }].map(s => (
          <div key={s.title} style={{ marginBottom:18 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)' }}>{s.title}</div>
              <button onClick={() => goTo(s.step)} style={{ font:'var(--role-body-sm)', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:700, background:'none', border:'none', cursor:'pointer' }}>Edit</button>
            </div>
            <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', padding:'0 14px' }}>
              {s.rows.map(([l,v]) => <ReviewRow key={l} label={l} value={v} />)}
            </div>
          </div>
        ))}
        <div style={{ padding:'12px 14px', borderRadius:'var(--radius-md)', background:'rgba(0,182,215,0.08)', border:'1px solid rgba(0,182,215,0.22)', font:'var(--role-body-sm)', color:'var(--cs-ink-200)', lineHeight:1.5 }}>
          By submitting you agree to Central Studio's assessment terms and privacy policy.
        </div>
      </div>
    </APage>
  );
}

/* ─── Step 6: Success ───────────────────────────────────────── */
function Step6({ next }) {
  const ref = 'ASS-' + String(Math.floor(Math.random()*90000+10000));
  return (
    <APage step={6} footer={<AContinue onClick={next} label="Track Application Status →" />}>
      <div style={{ paddingBottom:20, textAlign:'center' }}>
        <div style={{ padding:'32px 0 16px' }}>
          <div style={{ width:80, height:80, borderRadius:'50%', background:'linear-gradient(135deg,var(--cs-cyan-400),var(--cs-cyan-500))', display:'grid', placeItems:'center', margin:'0 auto 20px', boxShadow:'0 0 32px rgba(0,182,215,0.4)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:44, lineHeight:0.88, textTransform:'uppercase', color:'#fff', marginBottom:12 }}>Application<br />Submitted!</h2>
          <p style={{ font:'var(--role-body)', color:'var(--cs-ink-200)', lineHeight:1.6, maxWidth:280, margin:'0 auto 24px' }}>We've received your application and will review it within 2–3 business days.</p>
        </div>
        {[{ label:'Application Number', value:ref }, { label:'Submission Date', value:'Jun 21, 2026' }, { label:'Current Status', value:'Submitted' }, { label:'Next Step', value:'Under Review (2–3 days)' }].map(r => (
          <div key={r.label} style={{ display:'flex', justifyContent:'space-between', padding:'12px 16px', background:'var(--cs-ink-800)', border:'1px solid rgba(0,182,215,0.14)', borderRadius:'var(--radius-lg)', marginBottom:10 }}>
            <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{r.label}</span>
            <span style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:13, color: r.label==='Current Status'?'var(--cs-cyan-400)':'#fff' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </APage>
  );
}

/* ─── Step 7: Assessment Status ─────────────────────────────── */
function Step7({ next }) {
  const timeline = [
    { label:'Application Submitted',    date:'Jun 21, 2026', done:true,  active:false },
    { label:'Under Review',             date:'Jun 22, 2026', done:true,  active:false },
    { label:'Assessment Scheduled',     date:'Jun 25, 2026', done:true,  active:true  },
    { label:'Assessment Completed',     date:'—',            done:false, active:false },
    { label:'Result Released',          date:'—',            done:false, active:false },
  ];
  return (
    <APage step={7} footer={<AContinue onClick={next} label="View Appointment Details →" />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:6 }}>Application Status</h2>
        <div style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'6px 14px', borderRadius:'var(--radius-pill)', background:'rgba(0,182,215,0.12)', border:'1px solid rgba(0,182,215,0.35)', marginBottom:24 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--cs-cyan-400)' }} />
          <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, color:'var(--cs-cyan-400)' }}>Assessment Scheduled</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:0, marginBottom:24 }}>
          {timeline.map((s,i) => (
            <div key={i} style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:24, flexShrink:0 }}>
                <span style={{ width:24, height:24, borderRadius:'50%', display:'grid', placeItems:'center', flexShrink:0,
                  background: s.active ? 'var(--cs-cyan-400)' : s.done ? 'rgba(0,182,215,0.3)' : 'rgba(255,255,255,0.06)',
                  border: s.active ? 'none' : s.done ? '2px solid rgba(0,182,215,0.5)' : '2px solid rgba(255,255,255,0.12)' }}>
                  {s.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={s.active?"#fff":"var(--cs-cyan-400)"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                </span>
                {i < timeline.length-1 && <div style={{ width:1, flex:1, minHeight:20, background: s.done?'rgba(0,182,215,0.3)':'rgba(255,255,255,0.07)', margin:'4px 0' }} />}
              </div>
              <div style={{ flex:1, paddingBottom: i<timeline.length-1?16:0 }}>
                <div style={{ fontFamily:'var(--font-heading)', fontWeight: s.active?800:700, fontSize:14.5, color: s.active?'var(--cs-cyan-400)': s.done?'#fff':'var(--cs-ink-500)' }}>{s.label}</div>
                <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-500)', marginTop:2 }}>{s.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </APage>
  );
}

/* ─── Step 8: Assessment Appointment ────────────────────────── */
function Step8({ next }) {
  const [confirmed, setConfirmed] = useBL2(false);
  return (
    <APage step={8} footer={<AContinue onClick={next} label="View Your Result →" />}>
      <div style={{ paddingBottom:20 }}>
        <h2 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:22, color:'#fff', marginBottom:20 }}>Your Assessment</h2>
        <div style={{ padding:18, borderRadius:'var(--radius-lg)', background:'linear-gradient(135deg,rgba(0,182,215,0.14),rgba(10,11,13,0))', border:'1px solid rgba(0,182,215,0.30)', marginBottom:18 }}>
          {[{ ic:'📅', label:'Date', val:'Saturday, Jun 28, 2026' }, { ic:'⏰', label:'Time', val:'2:00 PM – 3:00 PM (60 min)' }, { ic:'📍', label:'Location', val:'Central Studio — Main Hall' }, { ic:'👤', label:'Assessor', val:'Nada El-Sheikh (ISTD Examiner)' }].map(r => (
            <div key={r.label} style={{ display:'flex', gap:12, marginBottom:12, alignItems:'center' }}>
              <span style={{ fontSize:20, flexShrink:0 }}>{r.ic}</span>
              <div><div style={{ font:'var(--role-body-sm)', fontSize:11.5, color:'var(--cs-ink-500)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 }}>{r.label}</div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff', marginTop:1 }}>{r.val}</div></div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Preparation Notes</div>
          {['Wear appropriate ballet attire (leotard, tights, ballet shoes)','Arrive 15 minutes before your appointment','Warm up independently before entering the assessment room','Bring your application confirmation number: ASS-47291','No jewellery except small earrings during assessment'].map((n,i) => (
            <div key={i} style={{ display:'flex', gap:9, marginBottom:9, font:'var(--role-body-sm)', fontSize:13, color:'var(--cs-ink-200)', fontWeight:500 }}>
              <span style={{ color:'var(--cs-cyan-400)', fontWeight:800, flexShrink:0 }}>·</span>{n}
            </div>
          ))}
        </div>
        <button onClick={() => setConfirmed(!confirmed)} style={{ width:'100%', padding:'13px', background: confirmed?'rgba(0,182,215,0.14)':'rgba(255,255,255,0.06)', color: confirmed?'var(--cs-cyan-400)':'var(--cs-ink-200)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border: confirmed?'1.5px solid rgba(0,182,215,0.4)':'1.5px solid rgba(255,255,255,0.10)', cursor:'pointer' }}>
          {confirmed ? '✓ Attendance Confirmed' : 'Confirm Attendance'}
        </button>
      </div>
    </APage>
  );
}

/* ─── Step 9: Assessment Result ─────────────────────────────── */
function Step9({ onBack, onToast }) {
  const [outcome, setOutcome] = useBL2('Accepted');
  const configs = {
    Accepted: { ic:'ribbon', col:'var(--cs-cyan-400)', shadow:'rgba(0,182,215,0.4)', title:'Congratulations!', sub:'You\'ve been placed in the Intermediate level.', detail:'Your assessment showed strong technical foundation and exceptional musicality. We\'re excited to welcome you to the program.', fields:[['Assigned Level','Intermediate'],['Start Date','Jul 7, 2026'],['Recommended Class','Intermediate Ballet — Mon/Wed/Fri 5:00 PM']] },
    Waitlisted:{ ic:'hourglass', col:'var(--cs-amber-500)', shadow:'rgba(255,176,46,0.3)', title:'On the Waitlist', sub:'You\'ll be the first to know when a spot opens.', detail:'You showed great potential. We\'re at capacity for your level right now, but a spot will open up soon.', fields:[['Waitlist Position','#3'],['Estimated Wait','4–6 weeks'],['Action Required','None — we\'ll contact you']] },
    Rejected:  { ic:'mail', col:'var(--cs-ink-300)', shadow:'none', title:'Not This Time', sub:'A few things to work on before your next assessment.', detail:'Thank you for your application. With more practice you\'ll be ready for the next assessment cycle.', fields:[['Next Assessment','Dec 2026'],['Recommended Class','Private lessons with Lena Park'],['Feedback','Focus on turnout and core alignment']] },
  };
  const c = configs[outcome];
  return (
    <APage step={9}>
      <div style={{ paddingBottom:30 }}>
        {/* demo outcome switcher */}
        <div style={{ display:'flex', gap:4, padding:4, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'var(--radius-pill)', marginBottom:24 }}>
          {['Accepted','Waitlisted','Rejected'].map(o => {
            const on = outcome===o;
            return <button key={o} onClick={() => setOutcome(o)} style={{ flex:1, padding:'8px 4px', borderRadius:'var(--radius-pill)', cursor:'pointer', border:'none', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12, background: on?'var(--cs-ink-900)':'transparent', color: on?'#fff':'var(--cs-ink-500)', transition:'all 160ms' }}>{o}</button>;
          })}
        </div>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ width:72, height:72, display:'grid', placeItems:'center', borderRadius:'50%', background:'rgba(0,182,215,0.12)', color:c.col, margin:'0 auto 16px', boxShadow:'0 0 0 2px currentColor' }}><B2Icon name={c.ic} size={36} /></div>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:44, lineHeight:0.88, textTransform:'uppercase', color:'#fff', marginBottom:10 }}>{c.title}</h2>
          <p style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:16, color:c.col, marginBottom:10 }}>{c.sub}</p>
          <p style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)', lineHeight:1.55, maxWidth:280, margin:'0 auto' }}>{c.detail}</p>
        </div>
        <div style={{ background:'var(--cs-ink-800)', border:`1px solid ${c.col}33`, borderRadius:'var(--radius-lg)', overflow:'hidden', marginBottom:18 }}>
          {c.fields.map(([l,v],i,a) => (
            <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'12px 16px', borderBottom: i===a.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{l}</span>
              <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:13, color:'#fff', textAlign:'right', maxWidth:'55%' }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {outcome==='Accepted' && <button onClick={() => onToast('Placement accepted!')} style={{ padding:'13px', background:`linear-gradient(135deg,var(--cs-cyan-400),var(--cs-cyan-500))`, color:'#fff', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>Accept Placement ✦</button>}
          <button onClick={() => onToast('Opening studio contact…')} style={{ padding:'13px', background:'rgba(255,255,255,0.06)', color:'var(--cs-ink-200)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1px solid rgba(255,255,255,0.10)', cursor:'pointer' }}>Contact Studio</button>
        </div>
      </div>
    </APage>
  );
}

/* ─── BalletAssessment (orchestrator) ───────────────────────── */
function BalletAssessment({ onBack, onToast }) {
  const [step, setStep] = useBL2(1);
  const [form, setForm] = useBL2({ flex:'Moderate', leg:'Right', arm:'Right', experience:'Less than 1 year', currentLevel:'None — Complete Beginner', gender:'Female' });
  const set = (patch) => setForm(f => ({...f,...patch}));
  const next = () => setStep(s => Math.min(s+1, 9));
  const goBack = step <= 1 ? onBack : () => setStep(s => s-1);

  return (
    <div style={{ position:'absolute', inset:0, zIndex:95, background:'var(--cs-ink-900)', display:'flex', flexDirection:'column', animation:'balletIn 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes balletIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      {/* header */}
      <div style={{ padding:'56px 20px 14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(0,182,215,0.14)', flexShrink:0 }}>
        <button onClick={goBack} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:14, padding:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Back
        </button>
        <h1 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:16, color:'#fff' }}>Ballet Assessment</h1>
        <span style={{ width:54 }} />
      </div>
      {/* steps */}
      <div style={{ flex:1, minHeight:0 }}>
        {step===1 && <Step1 next={next} />}
        {step===2 && <Step2 next={next} form={form} set={set} />}
        {step===3 && <Step3 next={next} form={form} set={set} />}
        {step===4 && <Step4 next={next} form={form} set={set} />}
        {step===5 && <Step5 next={next} form={form} goTo={setStep} />}
        {step===6 && <Step6 next={next} />}
        {step===7 && <Step7 next={next} />}
        {step===8 && <Step8 next={next} />}
        {step===9 && <Step9 onBack={onBack} onToast={onToast} />}
      </div>
    </div>
  );
}

Object.assign(window, { BalletAssessment });
