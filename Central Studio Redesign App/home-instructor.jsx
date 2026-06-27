/* global React */
const { useState: useIP } = React;

/* ============================================================
   Central Studio — Instructor Profile Experience
   Full profile overlay with internal sub-page navigation.
   Wired from Home Instructors carousel & class card avatars.
   ============================================================ */

/* ─── Extended instructor data ──────────────────────────────── */
const INST_DATA = {
  maya: {
    name: 'Maya Reyes', title: 'Senior Hip Hop Instructor', slot: 'inst-maya',
    badges: ['Senior Instructor', 'Featured'],
    bio: "Maya has been at the heart of Central Studio's street dance scene for over 8 years. Born in Cairo with roots in New York's hip hop culture, she bridges authentic urban movement with world-class teaching methodology.",
    philosophy: 'Dance is a language. My job is to give you the vocabulary to say what you feel.',
    stats: { exp: '8 yrs', classes: 450, students: 120, styles: 3 },
    specializations: [{ style: 'Hip Hop', level: 'All levels', years: 8 }, { style: 'Freestyle', level: 'Intermediate–Advanced', years: 6 }, { style: 'Breaking (basics)', level: 'Beginner', years: 3 }],
    certs: ['Hip Hop Foundation Certificate (NYC)', 'CSTD Street Dance Diploma', 'Youth Dance Leadership Award', 'Cypher Culture Workshop — Berlin 2023'],
    experience: [{ role: 'Senior Instructor', place: 'Central Studio', years: '2019–Present' }, { role: 'Guest Instructor', place: 'Cairo Dance Academy', years: '2017–2019' }, { role: 'Choreographer', place: 'National Youth Theater', years: '2016–2018' }],
    schedule: { Monday: ['Hip Hop Foundations · 6:30 PM · 90 min'], Thursday: [], Saturday: ['Hip Hop Intermediate · 9:00 PM · 120 min'], Sunday: [] },
    achievements: [{ title: 'Best Street Dance Instructor', org: 'Cairo Dance Awards', date: '2023' }, { title: 'Choreography Excellence Award', org: 'National Arts Council', date: '2022' }, { title: 'Top Rated Instructor', org: 'Central Studio', date: '2024' }],
    languages: ['Arabic', 'English'],
    branches: ['Main Branch'],
    related: ['kofi', 'aisha']
  },
  diego: {
    name: 'Diego Santos', title: 'Salsa & Latin Dance Specialist', slot: 'inst-diego',
    badges: ['Featured'],
    bio: "Diego grew up in the vibrant dance halls of São Paulo before training in Cali and New York. With over a decade of competition and social dance experience, he brings authentic Latin energy to every class.",
    philosophy: 'Connection is everything. Technique opens doors, but feeling makes you dance.',
    stats: { exp: '12 yrs', classes: 680, students: 200, styles: 4 },
    specializations: [{ style: 'Salsa On2', level: 'All levels', years: 12 }, { style: 'Bachata', level: 'Beginner–Intermediate', years: 8 }, { style: 'Latin Social', level: 'All levels', years: 10 }, { style: 'Kizomba', level: 'Beginner', years: 4 }],
    certs: ['World Salsa Summit — Certified Instructor', 'Latin Dance Congress (Cali) — Advanced Certification', 'Dance Vision International Diploma'],
    experience: [{ role: 'Latin Dance Specialist', place: 'Central Studio', years: '2018–Present' }, { role: 'Competition Coach', place: 'Cairo Latin Festival', years: '2015–2018' }, { role: 'Professional Performer', place: 'Latin Heat Show', years: '2013–2016' }],
    schedule: { Tuesday: ['Salsa On2 Social · 7:00 PM · 90 min'], Friday: ['Bachata Fundamentals · 6:00 PM · 60 min'] },
    achievements: [{ title: 'Latin Dance Festival — 1st Place (Pro Division)', org: 'Cairo Latin Festival', date: '2022' }, { title: 'Best New Instructor', org: 'Central Studio', date: '2018' }],
    languages: ['Arabic', 'English', 'Portuguese', 'Spanish'],
    branches: ['Main Branch'],
    related: ['maya', 'aisha']
  },
  aisha: {
    name: 'Aisha Bello', title: 'Afro & West African Dance Instructor', slot: 'inst-aisha',
    badges: [],
    bio: "Aisha was raised between Lagos and London, immersed in Afrobeats culture from childhood. Her classes blend traditional West African movement with contemporary Afrobeats choreography for a full-body experience.",
    philosophy: 'Every body is a dancer\'s body. Afro dance celebrates who you are.',
    stats: { exp: '6 yrs', classes: 280, students: 95, styles: 2 },
    specializations: [{ style: 'Afrobeats', level: 'All levels', years: 6 }, { style: 'West African Traditional', level: 'Beginner–Intermediate', years: 4 }],
    certs: ['LCDT Afro-Contemporary Certificate (London)', 'Cultural Dance Teaching Diploma'],
    experience: [{ role: 'Afro Dance Instructor', place: 'Central Studio', years: '2020–Present' }, { role: 'Cultural Performer', place: 'African Arts Festival', years: '2018–2020' }],
    schedule: { Saturday: ['Afro Heat · 11:00 AM · 60 min'], Wednesday: ['Afro Fundamentals · 5:30 PM · 60 min'] },
    achievements: [{ title: 'Cultural Dance Excellence', org: 'Egyptian Dance Board', date: '2023' }],
    languages: ['Arabic', 'English', 'Yoruba'],
    branches: ['Main Branch'],
    related: ['maya', 'diego']
  },
  kofi: {
    name: 'Kofi Mensah', title: 'Breakdance & Street Arts Instructor', slot: 'inst-kofi',
    badges: ['Senior Instructor'],
    bio: "Kofi is a veteran b-boy with 15 years in the breaking scene, competing across Europe and the Middle East. His bootcamps are intense, structured, and transformative — designed to build real breakers.",
    philosophy: 'Breaking is discipline. Power moves come from patience and repetition.',
    stats: { exp: '15 yrs', classes: 520, students: 140, styles: 2 },
    specializations: [{ style: 'Breaking (B-Boying)', level: 'All levels', years: 15 }, { style: 'Popping & Locking', level: 'Beginner–Intermediate', years: 8 }],
    certs: ['YKK Battle — Judge Certification', 'Street Dance Pedagogy Diploma', 'Urban Arts Foundation — Master Instructor'],
    experience: [{ role: 'Head of Breaking Program', place: 'Central Studio', years: '2017–Present' }, { role: 'Battle Judge', place: 'Regional Hip Hop Championships', years: '2015–Present' }],
    schedule: { Sunday: ['Breaking Bootcamp · 3:00 PM · 120 min'], Thursday: ['Foundations (Toprock/Footwork) · 5:00 PM · 90 min'] },
    achievements: [{ title: 'YKK Battle — Top 8 (B-Boy Veteran)', org: 'YKK International', date: '2023' }, { title: 'MENA Cypher — Judge\'s Award', org: 'MENA Hip Hop Summit', date: '2022' }],
    languages: ['Arabic', 'English', 'Twi'],
    branches: ['Main Branch'],
    related: ['maya', 'diego']
  },
  lena: {
    name: 'Lena Park', title: 'Principal Ballet Instructor', slot: 'inst-lena',
    badges: ['Ballet Instructor', 'Senior Instructor', 'Featured'],
    bio: "Trained at the Royal Ballet School, Lena performed professionally with companies in London, Paris and Seoul before transitioning to teaching. She leads Central Studio's acclaimed Ballet Program with precision and artistry.",
    philosophy: 'Ballet is not perfection. It\'s the unending pursuit of it.',
    stats: { exp: '15 yrs', classes: 900, students: 180, styles: 3 },
    specializations: [{ style: 'Classical Ballet', level: 'All levels', years: 15 }, { style: 'Contemporary Ballet', level: 'Intermediate–Advanced', years: 10 }, { style: 'Pointe Work', level: 'Intermediate+', years: 12 }],
    certs: ['Royal Ballet School — Teaching Diploma', 'ISTD Examiner Certification', 'RAD Grade 8 Certificate', 'Cecchetti Method — Advanced Instructor'],
    experience: [{ role: 'Principal Instructor', place: 'Central Studio', years: '2016–Present' }, { role: 'Corps de Ballet', place: 'Seoul City Ballet', years: '2012–2016' }, { role: 'Guest Artist', place: 'Paris Opera Ballet (workshop)', years: '2011' }],
    schedule: { Tuesday: ['Elementary Technique · 4:30 PM · 75 min'], Wednesday: ["Lil' Movers Ballet · 4:00 PM · 45 min"], Thursday: ['Ballet Foundations · 5:00 PM · 90 min'], Friday: ['Intermediate Ballet · 5:00 PM · 90 min'] },
    achievements: [{ title: 'Best Ballet Instructor — Cairo', org: 'Egyptian Arts Board', date: '2024' }, { title: 'Excellence in Dance Education', org: 'ISTD', date: '2023' }, { title: 'Royal Ballet School — Distinction', org: 'RBS', date: '2009' }],
    languages: ['Arabic', 'English', 'French', 'Korean'],
    branches: ['Main Branch'],
    related: ['maya', 'aisha']
  },
  marcus: {
    name: 'Marcus Lee', title: 'Popping & Locking Specialist', slot: 'inst-marcus',
    badges: [],
    bio: "Marcus has been popping since 2010, learning from originators of the Fresno and Waving style. He brings West Coast funk culture to Cairo with classes that are equal parts education and celebration.",
    philosophy: 'Feel the music first. The technique follows.',
    stats: { exp: '10 yrs', classes: 320, students: 85, styles: 2 },
    specializations: [{ style: 'Popping', level: 'All levels', years: 10 }, { style: 'Locking', level: 'Beginner–Intermediate', years: 7 }],
    certs: ['Funkin\' Stylez — Certified Level 2', 'Boogaloo Intensive Workshop — LA 2021'],
    experience: [{ role: 'Popping Instructor', place: 'Central Studio', years: '2021–Present' }, { role: 'Guest Teacher', place: 'Various studios, Cairo', years: '2018–2021' }],
    schedule: { Monday: ['Popping Fundamentals · 7:30 PM · 60 min'], Saturday: ['Locking Social · 2:00 PM · 60 min'] },
    achievements: [{ title: 'Freestyle Session Battle — Top 4', org: 'Cairo Funk Festival', date: '2023' }],
    languages: ['Arabic', 'English'],
    branches: ['Main Branch'],
    related: ['kofi', 'maya']
  }
};

/* ─── icon component (Lucide-style) ────────────────────────── */
function IPIcon({ name, size = 18, stroke = 2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'back':return <svg {...p}><path d="M15 18l-6-6 6-6" /></svg>;
    case 'share':return <svg {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>;
    case 'bookmark':return <svg {...p}><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></svg>;
    case 'book':return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'cal':return <svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case 'check':return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'clock':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>;
    case 'pin':return <svg {...p}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
    case 'play':return <svg {...p} fill={color} stroke="none"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>;
    case 'award':return <svg {...p}><circle cx="12" cy="9" r="6" /><path d="M8.2 14.4 7 22l5-3 5 3-1.2-7.6" /></svg>;
    case 'phone':return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" /></svg>;
    case 'chevron':return <svg {...p}><path d="M9 6l6 6-6 6" /></svg>;
    case 'users':return <svg {...p}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.2A3.4 3.4 0 0 1 16 12M21 20c0-2.4-1.6-4.2-4-4.8" /></svg>;
    case 'globe':return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" /></svg>;
    default:return null;
  }
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ─── InstructorProfile ─────────────────────────────────────── */
function InstructorProfile({ inst: rawInst, onBack, onToast }) {
  const inst = INST_DATA[rawInst.id] || { ...rawInst, stats: { exp: '—', classes: 0, students: 0, styles: 1 }, specializations: [], certs: [], experience: [], schedule: {}, achievements: [], languages: ['Arabic', 'English'], branches: ['Main Branch'], related: [], badges: [] };
  const [sub, setSub] = useIP('main');
  const [saved, setSaved] = useIP(false);

  const relatedInsts = (inst.related || []).map((id) => ({ id, ...INST_DATA[id] })).filter(Boolean);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 98, background: 'var(--cs-ink-900)', display: 'flex', flexDirection: 'column', animation: 'instIn 360ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes instIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {sub === 'gallery' && <SubGallery inst={inst} onBack={() => setSub('main')} onToast={onToast} />}
      {sub === 'videos' && <SubVideos inst={inst} onBack={() => setSub('main')} onToast={onToast} />}
      {sub === 'schedule' && <SubSchedule inst={inst} onBack={() => setSub('main')} onToast={onToast} />}
      {sub === 'classes' && <SubClasses inst={inst} onBack={() => setSub('main')} onToast={onToast} />}
      {sub === 'achievements' && <SubAchievements inst={inst} onBack={() => setSub('main')} />}
      {sub !== 'main' ? null :
      <>
          {/* scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 100 }}>

            {/* HERO */}
            <div style={{ position: 'relative', height: 280 }}>
              <image-slot id={inst.slot} shape="rect" fit="cover" placeholder={inst.name} style={{ position: 'absolute', inset: 0, width: '100%', height: "270px", padding: "0px" }}></image-slot>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(5,6,8,0.55) 0%,rgba(5,6,8,0.10) 38%,rgba(5,6,8,0.90) 100%)', pointerEvents: 'none' }} />
              {/* top bar */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '52px 18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: "13px" }}>
                <button onClick={onBack} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', cursor: 'pointer' }}>
                  <IPIcon name="back" size={22} stroke={2.2} />
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => onToast('Profile link copied!')} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', cursor: 'pointer' }}><IPIcon name="share" size={19} /></button>
                  <button onClick={() => {setSaved((s) => !s);onToast(saved ? 'Removed from favorites' : 'Saved to favorites');}} style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)', color: saved ? 'var(--cs-cyan-400)' : '#fff', cursor: 'pointer' }}><IPIcon name="bookmark" size={19} stroke={saved ? 2.5 : 2} /></button>
                </div>
              </div>
              {/* name overlay */}
              <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  {(inst.badges || []).map((b) => <span key={b} style={{ padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.85)', backdropFilter: 'blur(8px)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{b}</span>)}
                </div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 44, lineHeight: 0.88, textTransform: 'uppercase', color: '#fff', marginBottom: 6 }}>{inst.name}</h1>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, color: 'var(--cs-ink-200)' }}>{inst.title}</div>
              </div>
            </div>

            {/* STATS */}
            <div style={{ display: 'flex', padding: '0', background: 'var(--cs-ink-800)', borderBottom: '1px solid rgba(255,255,255,0.07)', alignItems: "center", justifyContent: "center" }}>
              {[['exp', 'Experience'], ['classes', 'Classes'], ['students', 'Students'], ['styles', 'Styles']].map(([k, l]) =>
            <div key={k} style={{ flex: 1, textAlign: 'center', padding: '14px 4px', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--cs-cyan-400)', lineHeight: 0.9 }}>{inst.stats[k]}</div>
                  <div style={{ font: 'var(--role-body-sm)', fontSize: 10.5, color: 'var(--cs-ink-400)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                </div>
            )}
            </div>

            <div style={{ padding: '0 20px' }}>
              {/* ABOUT */}
              <ISection title="About">
                <p style={{ font: 'var(--role-body)', color: 'var(--cs-ink-200)', lineHeight: 1.65 }}>{inst.bio}</p>
                {inst.philosophy && <div style={{ marginTop: 14, padding: '13px 16px', borderRadius: 'var(--radius-md)', background: 'rgba(0,182,215,0.07)', border: '1px solid rgba(0,182,215,0.22)' }}>
                  <div style={{ font: 'var(--role-eyebrow)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 6 }}>Teaching Philosophy</div>
                  <p style={{ font: 'var(--role-body)', color: '#fff', fontStyle: 'italic', lineHeight: 1.55 }}>"{inst.philosophy}"</p>
                </div>}
              </ISection>

              {/* SPECIALIZATIONS */}
              {inst.specializations?.length > 0 &&
            <ISection title="Specializations">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {inst.specializations.map((s) =>
                <div key={s.style} style={{ display: 'flex', alignItems: 'center', padding: '11px 14px', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ flex: 1, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: '#fff' }}>{s.style}</span>
                        <span style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', marginRight: 12 }}>{s.level}</span>
                        <span style={{ padding: '3px 8px', borderRadius: 'var(--radius-pill)', background: 'rgba(0,182,215,0.12)', color: 'var(--cs-cyan-400)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11 }}>{s.years} yrs</span>
                      </div>
                )}
                  </div>
                </ISection>
            }

              {/* QUALIFICATIONS */}
              {inst.certs?.length > 0 &&
            <ISection title="Qualifications & Certifications">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {inst.certs.map((c, i) =>
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--role-body-sm)', fontSize: 13.5, color: 'var(--cs-ink-200)', fontWeight: 500 }}>
                        <span style={{ width: 22, height: 22, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,182,215,0.14)', color: 'var(--cs-cyan-400)' }}><IPIcon name="check" size={13} stroke={2.8} /></span>{c}
                      </div>
                )}
                  </div>
                </ISection>
            }

              {/* EXPERIENCE TIMELINE */}
              {inst.experience?.length > 0 &&
            <ISection title="Professional Experience">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {inst.experience.map((e, i) =>
                <div key={i} style={{ display: 'flex', gap: 14 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
                          <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--cs-cyan-500)', flexShrink: 0 }} />
                          {i < inst.experience.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 16, background: 'rgba(0,182,215,0.25)', margin: '4px 0' }} />}
                        </div>
                        <div style={{ flex: 1, paddingBottom: i < inst.experience.length - 1 ? 16 : 0 }}>
                          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, color: '#fff' }}>{e.role}</div>
                          <div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-cyan-400)', marginTop: 2, fontWeight: 700 }}>{e.place}</div>
                          <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-500)', marginTop: 2 }}>{e.years}</div>
                        </div>
                      </div>
                )}
                  </div>
                </ISection>
            }

              {/* WEEKLY SCHEDULE (compact) */}
              <ISection title="Weekly Schedule" action={{ label: 'Full Schedule', onClick: () => setSub('schedule') }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {DAYS.filter((d) => inst.schedule?.[d]?.length).map((d) =>
                <div key={d} style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13.5, color: 'var(--cs-cyan-400)', width: 72, flexShrink: 0 }}>{d.slice(0, 3)}</span>
                      <div style={{ flex: 1 }}>
                        {inst.schedule[d].map((cls, i) => <div key={i} style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-200)', fontWeight: 600 }}>{cls}</div>)}
                      </div>
                    </div>
                )}
                </div>
              </ISection>

              {/* GALLERY */}
              <ISection title="Gallery" action={{ label: 'View all', onClick: () => setSub('gallery') }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[1, 2, 3].map((i) =>
                <div key={i} onClick={() => setSub('gallery')} style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                      <image-slot id={`${inst.slot}-gal-${i}`} shape="rect" fit="cover" placeholder={`Photo ${i}`} style={{ width: '100%', height: '100%' }}></image-slot>
                    </div>
                )}
                </div>
              </ISection>

              {/* ACHIEVEMENTS */}
              {inst.achievements?.length > 0 &&
            <ISection title="Achievements" action={{ label: 'View all', onClick: () => setSub('achievements') }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {inst.achievements.slice(0, 2).map((a, i) =>
                <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ width: 38, height: 38, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'rgba(255,184,28,0.12)', color: '#FFB81C' }}><IPIcon name="award" size={20} stroke={2} /></span>
                        <div>
                          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14.5, color: '#fff' }}>{a.title}</div>
                          <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-400)', marginTop: 2 }}>{a.org} · {a.date}</div>
                        </div>
                      </div>
                )}
                  </div>
                </ISection>
            }

              {/* LANGUAGES */}
              <ISection title="Languages">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {inst.languages.map((l) =>
                <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 'var(--radius-pill)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--cs-ink-200)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13 }}>
                      <IPIcon name="globe" size={14} stroke={1.8} color="var(--cs-cyan-400)" />{l}
                    </span>
                )}
                </div>
              </ISection>

              {/* BRANCH AVAILABILITY */}
              <ISection title="Branch Availability">
                {inst.branches.map((b) =>
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-md)' }}>
                    <IPIcon name="pin" size={18} color="var(--cs-cyan-400)" />
                    <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: '#fff' }}>{b}</span>
                  </div>
              )}
              </ISection>

              {/* RELATED INSTRUCTORS */}
              {relatedInsts.length > 0 &&
            <ISection title="Similar Instructors">
                  <div className="hscroll" style={{ gap: 12 }}>
                    {relatedInsts.map((r) =>
                <div key={r.id} className="snap" style={{ width: 120 }}>
                        <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', height: 150 }}>
                          <image-slot id={r.slot + '-rel'} shape="rect" fit="cover" placeholder={r.name} style={{ width: '100%', height: '100%' }}></image-slot>
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 40%,rgba(5,6,8,0.88) 100%)', pointerEvents: 'none' }} />
                          <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>
                            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: '#fff', lineHeight: 1.2 }}>{r.name}</div>
                            <div style={{ font: 'var(--role-body-sm)', fontSize: 11, color: 'var(--cs-ink-300)', marginTop: 2 }}>{r.specializations?.[0]?.style || ''}</div>
                          </div>
                        </div>
                      </div>
                )}
                  </div>
                </ISection>
            }

              {/* CONTACT */}
              <ISection title="Contact Studio">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[{ ic: 'phone', label: 'Call Studio', sub: '+20 11 2345 6789' }, { ic: 'phone', label: 'WhatsApp', sub: '+20 11 2345 6789' }].map((c) =>
                <button key={c.label} onClick={() => onToast(`Opening ${c.label}…`)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'rgba(0,182,215,0.10)', color: 'var(--cs-cyan-400)', flexShrink: 0 }}><IPIcon name={c.ic} size={19} /></span>
                      <div><div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14.5, color: '#fff' }}>{c.label}</div><div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-400)', marginTop: 1 }}>{c.sub}</div></div>
                    </button>
                )}
                </div>
              </ISection>
            </div>
          </div>

          {/* STICKY BOTTOM BAR */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '12px 16px 24px', background: 'linear-gradient(180deg,rgba(10,11,13,0) 0%,var(--cs-ink-900) 28%)', backdropFilter: 'blur(10px)', display: 'flex', gap: 10 }}>
            <button onClick={() => setSub('schedule')} style={{ flex: 0, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--radius-md)', color: 'var(--cs-ink-200)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <IPIcon name="cal" size={16} />Schedule
            </button>
            <button onClick={() => onToast(`Opening studio to book a class with ${inst.name}…`)} style={{ flex: 1, padding: '13px', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <IPIcon name="book" size={17} stroke={2.4} color="var(--cs-ink-900)" />Book a Class
            </button>
          </div>
        </>
      }
    </div>);

}

/* ─── Section wrapper ───────────────────────────────────────── */
function ISection({ title, children, action }) {
  return (
    <div style={{ paddingTop: 22, paddingBottom: 4, borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)' }}>{title}</div>
        {action && <button onClick={action.onClick} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-ink-300)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 12.5 }}>{action.label} <IPIcon name="chevron" size={14} stroke={2.4} /></button>}
      </div>
      {children}
    </div>);

}

/* ─── Sub-screen: Gallery ───────────────────────────────────── */
function SubGallery({ inst, onBack }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'instIn 280ms var(--timing-ease-out) both' }}>
      <div style={{ padding: '56px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--cs-ink-900)', zIndex: 5 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', display: 'flex' }}><IPIcon name="back" size={22} stroke={2.2} /></button>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>Gallery</h1>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: 3 }}>
        {Array.from({ length: 6 }).map((_, i) =>
        <div key={i} style={{ aspectRatio: '1', position: 'relative' }}>
            <image-slot id={`${inst.slot}-gal-${i + 1}`} shape="rect" fit="cover" placeholder={`Photo ${i + 1}`} style={{ width: '100%', height: '100%' }}></image-slot>
            <div style={{ position: 'absolute', bottom: 8, right: 8, width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', color: '#fff' }}>
              <IPIcon name="share" size={14} />
            </div>
          </div>
        )}
      </div>
    </div>);

}

/* ─── Sub-screen: Videos ────────────────────────────────────── */
function SubVideos({ inst, onBack, onToast }) {
  const videos = [{ title: 'Introduction', dur: '2:34', cat: 'Intro' }, { title: 'Hip Hop Warm-Up Routine', dur: '8:12', cat: 'Training' }, { title: 'Choreography Breakdown', dur: '15:40', cat: 'Performance' }, { title: 'Student Showcase Highlights', dur: '6:20', cat: 'Events' }];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'instIn 280ms var(--timing-ease-out) both' }}>
      <div style={{ padding: '56px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--cs-ink-900)', zIndex: 5 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', display: 'flex' }}><IPIcon name="back" size={22} stroke={2.2} /></button>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>Videos</h1>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {videos.map((v, i) =>
        <div key={i} style={{ display: 'flex', gap: 12, cursor: 'pointer', padding: '12px', background: 'var(--cs-ink-800)', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.08)' }} onClick={() => onToast(`Playing: ${v.title}`)}>
            <div style={{ position: 'relative', width: 100, flexShrink: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--cs-ink-700)' }}>
              <image-slot id={`${inst.slot}-vid-${i + 1}`} shape="rect" fit="cover" placeholder=" " style={{ width: '100%', height: 64 }}></image-slot>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center' }}>
                  <IPIcon name="play" size={14} color="#fff" />
                </span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14.5, color: '#fff', lineHeight: 1.2 }}>{v.title}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span style={{ font: 'var(--role-body-sm)', fontSize: 11.5, color: 'var(--cs-ink-400)' }}>{v.dur}</span>
                <span style={{ font: 'var(--role-body-sm)', fontSize: 11.5, color: 'var(--cs-cyan-400)', fontWeight: 700 }}>{v.cat}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>);

}

/* ─── Sub-screen: Full Schedule ─────────────────────────────── */
function SubSchedule({ inst, onBack, onToast }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'instIn 280ms var(--timing-ease-out) both' }}>
      <div style={{ padding: '56px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--cs-ink-900)', zIndex: 5 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', display: 'flex' }}><IPIcon name="back" size={22} stroke={2.2} /></button>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>Weekly Schedule</h1>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DAYS.map((d) => {
          const sessions = inst.schedule?.[d] || [];
          return (
            <div key={d} style={{ padding: '14px 16px', background: 'var(--cs-ink-800)', border: `1px solid ${sessions.length ? 'rgba(0,182,215,0.28)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 'var(--radius-lg)' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, color: sessions.length ? '#fff' : 'var(--cs-ink-500)', marginBottom: sessions.length ? 8 : 0 }}>{d}</div>
              {sessions.length ? sessions.map((cls, i) =>
              <div key={i} style={{ font: 'var(--role-body-sm)', fontSize: 13, color: 'var(--cs-ink-200)', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <IPIcon name="clock" size={13} color="var(--cs-cyan-400)" stroke={2} />{cls}
                  <button onClick={() => onToast(`Booking class…`)} style={{ marginLeft: 'auto', padding: '4px 10px', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11, borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer' }}>Book</button>
                </div>
              ) : <div style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-600)' }}>No classes scheduled</div>}
            </div>);

        })}
      </div>
    </div>);

}

/* ─── Sub-screen: Achievements ──────────────────────────────── */
function SubAchievements({ inst, onBack }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'instIn 280ms var(--timing-ease-out) both' }}>
      <div style={{ padding: '56px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--cs-ink-900)', zIndex: 5 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', display: 'flex' }}><IPIcon name="back" size={22} stroke={2.2} /></button>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>Achievements</h1>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {inst.achievements.map((a, i) =>
        <div key={i} style={{ padding: '16px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,184,28,0.18)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)', background: 'rgba(255,184,28,0.12)', color: '#FFB81C' }}><IPIcon name="award" size={24} stroke={2} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, color: '#fff' }}>{a.title}</div>
                <div style={{ font: 'var(--role-body-sm)', color: '#FFB81C', fontWeight: 700, marginTop: 3 }}>{a.org}</div>
                <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-500)', marginTop: 2 }}>{a.date}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>);

}

/* ─── Sub-screen: Classes ────────────────────────────────────── */
function SubClasses({ inst, onBack, onToast }) {
  const classes = window.EXPLORE_CLASSES?.filter((c) => c.inst.id === inst.id) || [];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'instIn 280ms var(--timing-ease-out) both' }}>
      <div style={{ padding: '56px 18px 14px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'sticky', top: 0, background: 'var(--cs-ink-900)', zIndex: 5 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-cyan-400)', display: 'flex' }}><IPIcon name="back" size={22} stroke={2.2} /></button>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff' }}>Classes</h1>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {classes.length === 0 ? <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--cs-ink-400)', font: 'var(--role-body-sm)' }}>No classes found for this instructor.</div> :
        classes.map((c) =>
        <div key={c.id} style={{ padding: '14px', borderRadius: 'var(--radius-lg)', background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 17, color: '#fff', marginBottom: 6 }}>{c.title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-300)', fontWeight: 600, marginBottom: 10 }}>
              <span>{c.style} · {c.level} · {c.difficulty}</span>
              <span>{c.day} · {c.time} · {c.dur}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: c.available > 3 ? 'rgba(31,184,113,0.14)' : c.available > 0 ? 'rgba(255,176,46,0.14)' : 'rgba(255,59,71,0.10)', color: c.available > 3 ? 'var(--cs-success-500)' : c.available > 0 ? 'var(--cs-amber-500)' : 'var(--cs-danger-500)', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11 }}>{c.available > 0 ? `${c.available} seats left` : 'Full'}</span>
              <button onClick={() => onToast(`Booking ${c.title}…`)} style={{ marginLeft: 'auto', padding: '7px 14px', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12.5, borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer' }}>Book</button>
            </div>
          </div>
        )}
      </div>
    </div>);

}

Object.assign(window, { InstructorProfile });