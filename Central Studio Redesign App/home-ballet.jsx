/* global React */
const { useState: useBL, useMemo: useBLM } = React;

/* ============================================================
   Central Studio — Ballet Program Hub
   Overview + 8 sub-sections via internal navigation
   ============================================================ */

/* ─── DATA ─────────────────────────────────────────────────── */
const B_LEVELS = [
{ id: 'pre', name: 'Pre Ballet', age: '3–5 yrs', weekly: 2, exp: 'None required', color: 'rgba(236,72,153,0.8)', desc: 'Playful movement exploration through music, rhythm and imaginative play.', skills: ['Coordination', 'Balance', 'Music response'], next: 'Beginner' },
{ id: 'beg', name: 'Beginner', age: '5–8 yrs', weekly: 2, exp: '6 months min', color: 'var(--cs-cyan-400)', desc: 'Foundation of classical ballet — positions, basic barre and centre work.', skills: ['Positions 1–3', 'Plié & relevé', 'Basic barre'], next: 'Elementary' },
{ id: 'elem', name: 'Elementary', age: '8–12 yrs', weekly: 3, exp: '2 years min', color: 'var(--cs-cyan-400)', desc: 'Technical proficiency and artistry development across full syllabus.', skills: ['All 5 positions', 'Centre work', 'Port de bras'], next: 'Intermediate' },
{ id: 'int', name: 'Intermediate', age: '12–16 yrs', weekly: 4, exp: '4 years min', color: 'var(--cs-amber-500)', desc: 'Advanced classical vocabulary, pointe work and performance skills.', skills: ['Allegro combinations', 'Fouetté turns', 'Pointe work'], next: 'Advanced' },
{ id: 'adv', name: 'Advanced', age: '14+ yrs', weekly: 5, exp: '6 years min', color: 'var(--cs-success-500)', desc: 'Pre-professional training with the full classical ballet syllabus.', skills: ['Grand allegro', 'Pointe variations', 'Pas de deux'], next: 'Professional' },
{ id: 'pro', name: 'Professional', age: '16+ yrs', weekly: 6, exp: 'Assessment req.', color: '#FFB81C', desc: 'Elite conservatory-level training with competition and performance focus.', skills: ['Full repertoire', 'Solo variations', 'Competition prep'], next: '—' }];

const B_INSTRUCTORS = [
{ id: 'lena', name: 'Lena Park', title: 'Principal Instructor', exp: '15 yrs', spec: 'Classical Ballet · Pointe', slot: 'inst-lena', bio: 'Trained at the Royal Ballet School. Performed with leading companies across Europe and Asia for 12 years before joining Central Studio.' },
{ id: 'sara', name: 'Sara Ahmed', title: 'Ballet Faculty', exp: '10 yrs', spec: 'Pre Ballet · Beginner', slot: 'ballet-sara', bio: 'Specialist in early childhood ballet education. Developed the studio\'s foundational curriculum for ages 3–8.' },
{ id: 'nada', name: 'Nada El-Sheikh', title: 'Guest Assessor', exp: '20 yrs', spec: 'Advanced · Professional', slot: 'ballet-nada', bio: 'Former principal dancer and certified ISTD examiner. Conducts our annual level assessments and masterclasses.' }];

const B_PERF = [
{ id: 's1', title: 'Annual Ballet Showcase', date: 'Dec 20, 2026', loc: 'Cairo Opera House', elig: 'Intermediate & above', type: 'showcase' },
{ id: 's2', title: 'Spring Recital', date: 'Apr 15, 2027', loc: 'Central Studio Main Hall', elig: 'All levels', type: 'recital' },
{ id: 's3', title: 'ISTD Regional Competition', date: 'Feb 8, 2027', loc: 'Cairo', elig: 'Advanced & Professional', type: 'competition' }];

const B_FAQS = [
{ cat: 'Enrollment', q: 'What age can my child start?', a: 'Pre Ballet accepts children from age 3. Adult beginners are also welcome at any age.' },
{ cat: 'Assessments', q: 'How often are level assessments held?', a: 'Every 6 months. Students are only assessed when the instructor recommends them.' },
{ cat: 'Classes', q: 'What is the dress code?', a: 'Girls: pink/black leotard, pink tights, pink ballet shoes. Boys: white tee, black shorts, black ballet shoes.' },
{ cat: 'Payments', q: 'Are assessments included in class fees?', a: 'The initial placement assessment is free. Level assessments cost EGP 150.' },
{ cat: 'Performances', q: 'Is the showcase mandatory?', a: 'Strongly encouraged but not mandatory for students below Intermediate level.' },
{ cat: 'Enrollment', q: 'Can adults join the program?', a: 'Yes! We have adult beginner and elementary tracks. Contact us for scheduling.' }];

const B_CLASSES = [
{ id: 'c1', name: "Lil' Movers Ballet", level: 'Pre Ballet', inst: 'Sara Ahmed', dur: '45 min', seats: 12, avail: 0, days: 'Wed', time: '4:00 PM', branch: 'Main Branch' },
{ id: 'c2', name: 'Ballet Foundations', level: 'Beginner', inst: 'Sara Ahmed', dur: '60 min', seats: 14, avail: 6, days: 'Thu', time: '5:00 PM', branch: 'Main Branch' },
{ id: 'c3', name: 'Elementary Technique', level: 'Elementary', inst: 'Lena Park', dur: '75 min', seats: 12, avail: 3, days: 'Tue · Fri', time: '4:30 PM', branch: 'Main Branch' },
{ id: 'c4', name: 'Intermediate Ballet', level: 'Intermediate', inst: 'Lena Park', dur: '90 min', seats: 10, avail: 4, days: 'Mon · Wed · Fri', time: '5:00 PM', branch: 'Main Branch' }];


/* ─── shared atoms ──────────────────────────────────────────── */
/* ─── DS-style icon set for ballet nav ─────────────────────── */
function BIcon({ name, size = 22 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'levels':return <svg {...p}><path d="M12 2l2.4 5 5.6.8-4 4 1 5.6L12 15l-5 2.4 1-5.6-4-4 5.6-.8Z" /><path d="M5 19h14" /></svg>;
    case 'cal':return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'users':return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" /></svg>;
    case 'award':return <svg {...p}><circle cx="12" cy="9" r="6" /><path d="M8.2 14.4 7 22l5-3 5 3-1.2-7.6" /></svg>;
    case 'list':return <svg {...p}><path d="M9 6h10M9 12h10M9 18h10M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>;
    case 'help':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" /></svg>;
    case 'phone':return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" /></svg>;
    default:return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

function BBack({ onClick, label = 'Back' }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, padding: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>{label}
    </button>);

}
function BStat({ value, label }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, color: '#fff', lineHeight: 0.9 }}>{value}</div>
      <div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-400)', marginTop: 5 }}>{label}</div>
    </div>);

}
function BNavCard({ icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', background: 'var(--cs-ink-800)', border: '1px solid rgba(0,182,215,0.15)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
      <span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'rgba(0,182,215,0.12)', color: 'var(--cs-cyan-400)', flexShrink: 0 }}><BIcon name={icon} size={22} /></span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: '#fff' }}>{title}</div>
        {sub && <div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-400)', marginTop: 1 }}>{sub}</div>}
      </div>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--cs-cyan-400)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}><path d="M9 6l6 6-6 6" /></svg>
    </button>);

}
function BApplyCTA({ onApply }) {
  return (
    <button onClick={onApply} style={{ width: '100%', padding: '15px', background: 'linear-gradient(135deg,var(--cs-cyan-400),var(--cs-cyan-500))', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,182,215,0.2)' }}>
      ✦ Apply Now
    </button>);

}

/* ─── sub-page: levels ──────────────────────────────────────── */
function BLevels({ onSelect }) {
  return (
    <div style={{ padding: '20px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {B_LEVELS.map((l) =>
      <div key={l.id} style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }} onClick={() => onSelect(l)}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.14)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{l.name}</span>
            <span style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', fontWeight: 600 }}>{l.age}</span>
          </div>
          <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.45, marginBottom: 8 }}>{l.desc}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {l.skills.map((s) => <span key={s} style={{ padding: '3px 8px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.06)', color: 'var(--cs-ink-200)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10 }}>{s}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 9, font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', fontWeight: 600 }}>
            <span>📅 {l.weekly}×/week</span><span>🎓 {l.exp}</span><span>→ {l.next}</span>
          </div>
        </div>
      )}
    </div>);

}

/* ─── sub-page: classes ─────────────────────────────────────── */
function BClasses({ onApply }) {
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {B_CLASSES.map((c) =>
      <div key={c.id} style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, color: '#fff' }}>{c.name}</div>
              <div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-cyan-400)', marginTop: 2, fontWeight: 700 }}>{c.level}</div>
            </div>
            <span style={{ padding: '4px 9px', borderRadius: 'var(--radius-pill)', alignSelf: 'flex-start',
            background: c.avail === 0 ? 'rgba(255,59,71,0.12)' : c.avail <= 3 ? 'rgba(255,176,46,0.14)' : 'rgba(31,184,113,0.14)',
            color: c.avail === 0 ? 'var(--cs-danger-500)' : c.avail <= 3 ? 'var(--cs-amber-500)' : 'var(--cs-success-500)',
            fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 10 }}>
              {c.avail === 0 ? 'Full' : `${c.avail} left`}
            </span>
          </div>
          <div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)', fontWeight: 600, display: 'flex', flexWrap: 'wrap', gap: '3px 12px', marginBottom: 10 }}>
            <span>🕐 {c.time} · {c.dur}</span><span>📅 {c.days}</span><span>👤 {c.inst}</span><span>📍 {c.branch}</span>
          </div>
          <button onClick={onApply} style={{ width: '100%', padding: '10px', background: 'rgba(0,182,215,0.12)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13, borderRadius: 'var(--radius-md)', border: '1.5px solid rgba(0,182,215,0.30)', cursor: 'pointer' }}>Apply for this class</button>
        </div>
      )}
    </div>);

}

/* ─── sub-page: instructors ─────────────────────────────────── */
function BInstructors() {
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {B_INSTRUCTORS.map((i) =>
      <div key={i.id} style={{ padding: '16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(0,182,215,0.16)' }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
            <image-slot id={'bl-' + i.slot} shape="circle" placeholder={i.name[0]} style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, boxShadow: '0 0 0 2px var(--cs-cyan-400)' }}></image-slot>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>{i.name}</div>
              <div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-cyan-400)', marginTop: 2, fontWeight: 700 }}>{i.title}</div>
              <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', marginTop: 3 }}>{i.exp} experience · {i.spec}</div>
            </div>
          </div>
          <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.5 }}>{i.bio}</p>
        </div>
      )}
    </div>);

}

/* ─── sub-page: performances ────────────────────────────────── */
function BPerformances() {
  const typeColor = { showcase: 'var(--cs-cyan-400)', recital: 'var(--cs-cyan-400)', competition: 'var(--cs-amber-500)' };
  const typeIcon = { showcase: '🎭', recital: '💃', competition: '🏆' };
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {B_PERF.map((p) =>
      <div key={p.id} style={{ padding: '16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: `1px solid ${typeColor[p.type]}33` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20 }}>{typeIcon[p.type]}</span>
            <span style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: `${typeColor[p.type]}22`, color: typeColor[p.type], fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{p.type}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff', marginBottom: 6 }}>{p.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)', fontWeight: 600 }}>
            <span>📅 {p.date}</span><span>📍 {p.loc}</span><span>✓ Eligibility: {p.elig}</span>
          </div>
        </div>
      )}
    </div>);

}

/* ─── sub-page: requirements ────────────────────────────────── */
function BRequirements() {
  const sections = [
  { title: 'Enrollment Requirements', items: ['Placement assessment required for levels Intermediate and above', 'Age requirements per level (see Levels page)', 'Completion of application form'] },
  { title: 'Dress Code — Girls', items: ['Pink or black leotard', 'Pink ballet tights', 'Pink canvas or satin ballet shoes', 'Hair in a neat bun with hairpins'] },
  { title: 'Dress Code — Boys', items: ['White fitted t-shirt', 'Black ballet shorts or tights', 'Black canvas ballet shoes'] },
  { title: 'Attendance Policy', items: ['Minimum 80% attendance required to progress', '3 consecutive absences require a make-up class', 'Assessment eligibility requires 85% attendance in the past term'] },
  { title: 'Level Progression', items: ['Progression recommended by instructor based on skill and attendance', 'Assessments held every 6 months', 'Assessment fee: EGP 150'] }];

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map((s) =>
      <div key={s.title} style={{ padding: '16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(0,182,215,0.12)' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, color: 'var(--cs-cyan-400)', marginBottom: 10 }}>{s.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {s.items.map((item, i) =>
          <div key={i} style={{ display: 'flex', gap: 9, font: 'var(--role-body-sm)', fontSize: 13, color: 'var(--cs-ink-200)', fontWeight: 500 }}>
                <span style={{ flexShrink: 0, color: 'var(--cs-cyan-400)', fontWeight: 800 }}>·</span>{item}
              </div>
          )}
          </div>
        </div>
      )}
    </div>);

}

/* ─── sub-page: FAQ ─────────────────────────────────────────── */
function BFAQ({ onContact }) {
  const [open, setOpen] = useBL(null);
  const [q, setQ] = useBL('');
  const filtered = B_FAQS.filter((f) => !q || f.q.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--cs-ink-400)', pointerEvents: 'none', fontSize: 15 }}>🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search FAQs…"
        style={{ width: '100%', padding: '12px 12px 12px 40px', fontSize: 14.5, fontFamily: 'var(--font-body)', color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(0,182,215,0.20)', borderRadius: 'var(--radius-pill)', outline: 'none' }} />
      </div>
      <div style={{ background: 'var(--cs-ink-800)', border: '1px solid rgba(0,182,215,0.14)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {filtered.map((f, i) =>
        <div key={i} style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => setOpen(open === i ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, color: '#fff', flex: 1 }}>{f.q}</span>
              <span style={{ color: 'var(--cs-cyan-400)', transition: 'transform 220ms', display: 'block', transform: open === i ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </span>
            </button>
            {open === i && <div style={{ padding: '0 16px 14px', font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.6 }}>{f.a}</div>}
          </div>
        )}
      </div>
      <button onClick={onContact} style={{ padding: '13px', background: 'rgba(0,182,215,0.12)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, borderRadius: 'var(--radius-md)', border: '1.5px solid rgba(0,182,215,0.30)', cursor: 'pointer' }}>Contact Ballet Department</button>
    </div>);

}

/* ─── sub-page: contact ─────────────────────────────────────── */

function BCI({ name, size=20 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'message': return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'phone':   return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z"/></svg>;
    case 'mail':    return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
    case 'pin':     return <svg {...p}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
    default: return null;
  }
}
function BContact({ onToast }) {
  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: 18, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg,rgba(0,182,215,0.14),rgba(10,11,13,0))', border: '1px solid rgba(0,182,215,0.28)', textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 0.9, textTransform: 'uppercase', color: '#fff', marginBottom: 8 }}>Ballet<br />Department</div>
        <div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)' }}>We're here to help with any question about the program, assessments, or classes.</div>
      </div>
      {[{ ic: '💬', label: 'WhatsApp', sub: '+20 11 2345 6789' }, { ic: '📞', label: 'Phone', sub: '+20 11 2345 6789' }, { ic: '✉️', label: 'Email', sub: 'ballet@centralstudio.eg' }, { ic: '📍', label: 'Studio Location', sub: 'Main Branch, Cairo' }].map((c) =>
      <button key={c.label} onClick={() => onToast(`Opening ${c.label}…`)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', background: 'var(--cs-ink-800)', border: '1px solid rgba(0,182,215,0.14)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'rgba(0,182,215,0.10)', fontSize: 20, flexShrink: 0 }}>{c.ic}</span>
          <div style={{ flex: 1 }}><div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: '#fff' }}>{c.label}</div><div style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-400)', marginTop: 1 }}>{c.sub}</div></div>
        </button>
      )}
    </div>);

}

/* ─── MAIN: BalletProgram ───────────────────────────────────── */
function BalletProgram({ onBack, onApply, onToast }) {
  const [sub, setSub] = useBL('overview');
  const [selLevel, setSelLevel] = useBL(null);

  const titles = { overview: 'Ballet Program', levels: 'Ballet Levels', classes: 'Ballet Classes', instructors: 'Instructors', performances: 'Performances', requirements: 'Requirements', faq: 'FAQ', contact: 'Contact' };
  const goBack = sub === 'overview' ? onBack : sub === 'level-detail' ? () => setSub('levels') : () => setSub('overview');

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 95, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'balletIn 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes balletIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {/* header */}
      <div style={{ padding: '56px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,182,215,0.15)', background: 'var(--cs-ink-900)', position: 'sticky', top: 0, zIndex: 10 }}>
        <BBack onClick={goBack} />
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>{titles[sub] || 'Ballet Program'}</h1>
        {sub === 'overview' ? <button onClick={onApply} style={{ padding: '7px 13px', borderRadius: 'var(--radius-pill)', background: 'linear-gradient(135deg,var(--cs-cyan-400),var(--cs-cyan-500))', color: '#fff', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12.5, border: 'none', cursor: 'pointer' }}>Apply ✦</button> : <span style={{ width: 54 }} />}
      </div>

      {/* OVERVIEW */}
      {sub === 'overview' &&
      <>
          {/* hero — full-bleed image-slot with overlay */}
          <div style={{ position:'relative', minHeight:320, borderBottom:'1px solid rgba(0,182,215,0.12)', overflow:'hidden' }}>
            <image-slot id="ballet-hero-bg" shape="rect" fit="cover" placeholder="Ballet Program cover"
              style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}></image-slot>
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(5,6,8,0.38) 0%, rgba(5,6,8,0.22) 30%, rgba(5,6,8,0.82) 75%, rgba(5,6,8,0.97) 100%)', pointerEvents:'none' }} />
            <div style={{ position:'relative', padding:'26px 20px 22px' }}>
              <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 8 }}>Central Studio</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 52, textTransform: 'uppercase', color: '#fff', marginBottom: 12, lineHeight: "1" }}>Ballet<br />Program</h2>
              <p style={{ font: 'var(--role-body)', color: 'var(--cs-ink-200)', lineHeight: 1.6, marginBottom: 22 }}>
                A world-class ballet education program developing technique, artistry, and confidence in dancers of all ages — from Pre Ballet to Professional level.
              </p>
              {/* stats */}
              <div style={{ display: 'flex', gap: 0, padding: '16px', background: 'rgba(0,0,0,0.42)', backdropFilter:'blur(12px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--radius-lg)', marginBottom: 20 }}>
                <BStat value="48" label="Active students" />
                <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }} />
                <BStat value="3" label="Instructors" />
                <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }} />
                <BStat value="6" label="Levels" />
                <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }} />
                <BStat value="12" label="Classes/week" />
              </div>
              <BApplyCTA onApply={onApply} />
            </div>
          </div>
          {/* navigation */}
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <BNavCard icon="levels" title="Ballet Levels" sub="Pre Ballet → Professional — 6 levels" onClick={() => setSub('levels')} />
            <BNavCard icon="cal" title="Ballet Classes" sub={`${B_CLASSES.length} active classes available`} onClick={() => setSub('classes')} />
            <BNavCard icon="users" title="Instructors" sub="Meet our ballet faculty" onClick={() => setSub('instructors')} />
            <BNavCard icon="award" title="Performance Opportunities" sub="Showcases, recitals & competitions" onClick={() => setSub('performances')} />
            <BNavCard icon="list" title="Program Requirements" sub="Dress code, attendance & progression" onClick={() => setSub('requirements')} />
            <BNavCard icon="help" title="FAQ" sub="Common questions answered" onClick={() => setSub('faq')} />
            <BNavCard icon="phone" title="Contact Ballet Department" sub="ballet@centralstudio.eg" onClick={() => setSub('contact')} />
          </div>
        </>
      }

      {/* LEVELS list */}
      {sub === 'levels' && <BLevels onSelect={(l) => {setSelLevel(l);setSub('level-detail');}} />}

      {/* LEVEL DETAIL */}
      {sub === 'level-detail' && selLevel &&
      <div style={{ padding: '20px' }}>
          <div style={{ padding: '18px', borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg,rgba(0,182,215,0.14),rgba(10,11,13,0))', border: '1px solid rgba(0,182,215,0.28)', marginBottom: 18 }}>
            <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.16)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{selLevel.name}</span>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, color: '#fff', margin: '10px 0 8px' }}>{selLevel.desc}</div>
            <div style={{ display: 'flex', gap: 14, font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)', fontWeight: 600 }}>
              <span>👶 {selLevel.age}</span><span>📅 {selLevel.weekly}×/week</span><span>🎓 {selLevel.exp}</span>
            </div>
          </div>
          {[{ label: 'Skills Covered', items: selLevel.skills }, { label: 'Progression', items: [`Completion leads to: ${selLevel.next}`, 'Assessed by instructor recommendation', 'Assessment fee: EGP 150'] }].map((s) =>
        <div key={s.label} style={{ marginBottom: 16 }}>
              <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 10 }}>{s.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.items.map((item, i) =>
            <div key={i} style={{ display: 'flex', gap: 9, font: 'var(--role-body-sm)', fontSize: 13.5, color: 'var(--cs-ink-200)', fontWeight: 500 }}>
                    <span style={{ flexShrink: 0, color: 'var(--cs-cyan-400)', fontWeight: 800 }}>·</span>{item}
                  </div>
            )}
              </div>
            </div>
        )}
          <BApplyCTA onApply={onApply} />
        </div>
      }

      {sub === 'classes' && <BClasses onApply={onApply} />}
      {sub === 'instructors' && <BInstructors />}
      {sub === 'performances' && <BPerformances />}
      {sub === 'requirements' && <BRequirements />}
      {sub === 'faq' && <BFAQ onContact={() => setSub('contact')} />}
      {sub === 'contact' && <BContact onToast={onToast} />}
    </div>);

}

Object.assign(window, { BalletProgram });