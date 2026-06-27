/* global React */
const { useState: useSC2, useMemo: useSC2M } = React;

/* Pull part-1 exports */
const { BOOKINGS, SBI, StatusPill, PayPill, MiniSlot, PackageMeter, ActionBtn,
  BookingCard, AssessmentCard, BookingEmptyState, STATUS_CFG, PAY_CFG, TYPE_CFG } = window;

/* ─── Booking Detail Overlay ────────────────────────────────── */
function BookingDetailOverlay({ b, onClose, onToast }) {
  const tc = TYPE_CFG[b.type] || TYPE_CFG.class;
  const timeline = b.phase === 'upcoming' ?
  [{ label: 'Booking Created', done: true, date: 'Jun 20, 2026' }, { label: 'Payment Confirmed', done: b.paid, date: b.paid ? 'Jun 20, 2026' : '—' }, { label: 'Class Date', done: false, date: `${b.day}, ${b.date}` }] :
  b.phase === 'past' ?
  [{ label: 'Booking Created', done: true, date: 'Jun 1, 2026' }, { label: 'Payment Confirmed', done: true, date: 'Jun 1, 2026' }, { label: b.status === 'Attended' ? 'Attended' : 'Completed', done: true, date: b.date }] :
  [{ label: 'Booking Created', done: true, date: 'May 25, 2026' }, { label: 'Cancelled', done: true, date: b.date }];

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--cs-ink-900)', overflowY: 'auto', animation: 'bkSlide 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes bkSlide{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

      {/* hero strip */}
      <div style={{ padding: '58px 20px 20px', background: `linear-gradient(135deg, rgba(${tc.rgb || '45,205,236'},0.18) 0%, rgba(10,11,13,0) 60%)`, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cs-ink-300)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, marginBottom: 16, padding: 0 }}>
          <SBI name="back" size={20} stroke={2.2} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: `rgba(${tc.rgb || '45,205,236'},0.16)`, color: tc.color, fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{tc.label}</span>
          <StatusPill status={b.status} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, lineHeight: 0.9, textTransform: 'uppercase', color: '#fff', marginBottom: 6 }}>{b.name}</h1>
        <p style={{ font: 'var(--role-body-sm)', fontSize: 12.5, color: 'var(--cs-ink-500)', fontFamily: 'var(--font-body-mono,monospace)' }}>Booking #{b.ref}</p>
      </div>

      {/* body */}
      <div style={{ padding: '20px' }}>
        {/* schedule + branch */}
        <DetailSection title="Schedule">
          <DetailRow icon="cal" label="Day & Date" value={`${b.day}, ${b.date}`} />
          <DetailRow icon="clock" label="Time" value={`${b.time} – ${b.timeEnd} (${b.dur})`} />
          <DetailRow icon="pin" label="Branch" value={b.branch} />
        </DetailSection>

        {/* people */}
        <DetailSection title="People">
          <div style={{ display: 'flex', gap: 20, padding: '4px 0' }}>
            <MiniSlot slot={b.student.slot} name={b.student.name} label="Student" size={36} />
            <MiniSlot slot={b.inst.slot} name={b.inst.name} label="Instructor" size={36} />
          </div>
        </DetailSection>

        {/* ballet assessment extras */}
        {b.type === 'assessment' &&
        <DetailSection title="Assessment">
            {b.balletLevel && <DetailRow icon="check" label="Current Level" value={b.balletLevel} valueColor="var(--cs-cyan-400)" />}
            {b.assessResult && <DetailRow icon="check" label="Result" value={b.assessResult} valueColor="var(--cs-success-500)" />}
            {!b.assessResult && <DetailRow icon="clock" label="Status" value="Pending review" />}
          </DetailSection>
        }

        {/* payment */}
        <DetailSection title="Payment">
          <DetailRow icon="check" label="Method" value={b.payStatus} valueColor={(PAY_CFG[b.payStatus] || {}).c} />
          {b.pkg && <div style={{ marginTop: 10 }}><PackageMeter pkg={b.pkg} /></div>}
          {b.warningMsg &&
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(255,176,46,0.10)', border: '1px solid rgba(255,176,46,0.26)', marginTop: 10 }}>
              <SBI name="alert" size={15} stroke={2.4} color="var(--cs-amber-500)" />
              <span style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-amber-400)', lineHeight: 1.45 }}>{b.warningMsg}</span>
            </div>
          }
        </DetailSection>

        {/* timeline */}
        <DetailSection title="Booking Timeline">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {timeline.map((step, i) =>
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                  background: step.done ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.07)',
                  border: step.done ? 'none' : '1.5px solid rgba(255,255,255,0.18)' }}>
                    {step.done && <SBI name="check" size={12} stroke={3} color="var(--cs-ink-900)" />}
                  </span>
                  {i < timeline.length - 1 && <div style={{ flex: 1, minHeight: 22, background: step.done ? 'rgba(0,182,215,0.35)' : 'rgba(255,255,255,0.08)', margin: '4px 0', height: "0px", width: "1px" }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: i < timeline.length - 1 ? 14 : 0 }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14.5, color: step.done ? '#fff' : 'var(--cs-ink-400)' }}>{step.label}</div>
                  <div style={{ font: 'var(--role-body-sm)', fontSize: 12, color: 'var(--cs-ink-500)', marginTop: 2 }}>{step.date}</div>
                </div>
              </div>
            )}
          </div>
        </DetailSection>

        {/* notes */}
        {b.notes &&
        <DetailSection title="Studio Notes">
            <p style={{ font: 'var(--role-body-sm)', color: 'var(--cs-ink-300)', lineHeight: 1.5 }}>{b.notes}</p>
          </DetailSection>
        }
      </div>

      {/* sticky actions footer */}
      <div style={{ position: 'sticky', bottom: 0, padding: '14px 20px 30px', background: 'linear-gradient(180deg,rgba(10,11,13,0) 0%,var(--cs-ink-900) 28%)', backgroundPosition: "center center", backgroundSize: "cover", height: "79px" }}>
        <div className="hscroll" style={{ gap: 10, paddingBottom: 2, height: "48px", width: "333px", justifyContent: "space-evenly", alignItems: "stretch" }}>
          
          {b.phase === 'upcoming' && b.status !== 'Cancelled' && <ActionBtn label="Cancel Booking" icon="cancel" danger onClick={() => {onToast('Cancellation submitted');onClose();}} />}
          {!b.paid && <ActionBtn label="Pay Now" primary onClick={() => {onToast('Redirecting to payment…');onClose();}} />}
          {b.paid && b.phase !== 'upcoming' && <ActionBtn label="Download Receipt" icon="download" onClick={() => onToast('Downloading receipt…')} />}
          
        </div>
      </div>
    </div>);

}

function DetailSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 10 }}>{title}</div>
      <div style={{ background: 'var(--cs-ink-800)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-lg)', padding: '14px' }}>
        {children}
      </div>
    </div>);

}
function DetailRow({ icon, label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'var(--role-body-sm)', color: 'var(--cs-ink-400)', fontWeight: 600 }}>
        <SBI name={icon} size={14} stroke={2} color="var(--cs-ink-500)" />{label}
      </span>
      <span style={{ font: 'var(--role-body-sm)', fontWeight: 700, color: valueColor || '#fff' }}>{value}</span>
    </div>);

}

/* ─── ScheduleScreen (main) ─────────────────────────────────── */
function ScheduleScreen({ onToast }) {
  const [phase, setPhase] = useSC2('upcoming');
  const [query, setQuery] = useSC2('');
  const [student, setStudent] = useSC2('all');
  const [selected, setSelected] = useSC2(null);

  const students = ['all', ...new Set(BOOKINGS.map((b) => b.student.name))];

  const list = useSC2M(() => {
    const q = query.toLowerCase();
    return BOOKINGS.filter((b) => {
      if (b.phase !== phase) return false;
      if (student !== 'all' && b.student.name !== student) return false;
      if (q && ![b.name, b.style, b.ref, b.inst.name, b.student.name].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [phase, query, student]);

  const phaseCounts = useSC2M(() => ({
    upcoming: BOOKINGS.filter((b) => b.phase === 'upcoming').length,
    past: BOOKINGS.filter((b) => b.phase === 'past').length,
    cancelled: BOOKINGS.filter((b) => b.phase === 'cancelled').length
  }), []);

  return (
    <>
      <div className="feed" style={{ paddingBottom: 110, background: 'radial-gradient(85% 120% at 10% -8%, rgba(255,176,46,0.16) 0%, transparent 50%), radial-gradient(65% 75% at 100% 90%, rgba(255,46,126,0.12) 0%, transparent 55%), var(--cs-ink-900)' }}>
        {/* header */}
        <div style={{ padding: '64px 20px 18px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ font: 'var(--role-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--cs-cyan-400)', marginBottom: 6 }}>My Account</div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 0.88, textTransform: 'uppercase', color: '#fff', letterSpacing: '-0.01em' }}>My<br />Bookings</h1>
          </div>
          <button onClick={() => onToast('Opening class catalog…')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 16px', borderRadius: 'var(--radius-pill)', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, marginBottom: 6, width: "134px", justifyContent: "center" }}>
            <SBI name="plus" size={16} stroke={2.6} color="var(--cs-ink-900)" /> New
          </button>
        </div>

        {/* search */}
        <div style={{ padding: '0 20px', marginBottom: 14 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.10)', borderRadius: 'var(--radius-pill)' }}>
            <span style={{ position: 'absolute', left: 14, color: 'var(--cs-ink-400)', pointerEvents: 'none' }}><SBI name="search" size={17} stroke={2.2} /></span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bookings, classes, refs…"
            style={{ width: '100%', padding: '12px 42px', fontSize: 14.5, fontFamily: 'var(--font-body)', color: '#fff', background: 'transparent', border: 'none', outline: 'none' }} />
            {query && <button onClick={() => setQuery('')} style={{ position: 'absolute', right: 10, width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.10)', border: 'none', cursor: 'pointer', color: '#fff' }}><SBI name="x" size={13} stroke={2.4} /></button>}
          </div>
        </div>

        {/* phase tabs */}
        <div style={{ display: 'flex', margin: '0 20px 14px', padding: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 'var(--radius-pill)' }}>
          {['upcoming', 'past', 'cancelled'].map((p) => {
            const on = phase === p;
            const label = { upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled' }[p];
            return (
              <button key={p} onClick={() => setPhase(p)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '10px 4px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', border: 'none',
                fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5,
                background: on ? 'var(--cs-ink-900)' : 'transparent', color: on ? '#fff' : 'var(--cs-ink-500)',
                transition: 'all 180ms', boxShadow: on ? '0 2px 8px rgba(0,0,0,0.3)' : 'none' }}>
                {label}
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: on ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.08)', color: on ? 'var(--cs-ink-900)' : 'var(--cs-ink-400)', fontSize: 10, fontWeight: 800, lineHeight: 1 }}>{phaseCounts[p]}</span>
              </button>);

          })}
        </div>

        {/* student filter */}
        <div className="hscroll" style={{ padding: '0 20px', gap: 8, marginBottom: 20 }}>
          {students.map((s) => {
            const on = student === s;
            const bk = BOOKINGS.find((b) => b.student.name === s);
            return (
              <button key={s} onClick={() => setStudent(s)} style={{ display: 'inline-flex', gap: 7, padding: '7px 13px 7px 7px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', flexShrink: 0,
                background: on ? 'var(--cs-ink-900)' : 'rgba(255,255,255,0.05)',
                border: on ? '1.5px solid rgba(0,182,215,0.5)' : '1.5px solid rgba(255,255,255,0.08)',
                fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: on ? '#fff' : 'var(--cs-ink-400)', transition: 'all 160ms', lineHeight: "0", flexDirection: "row", alignItems: "center", justifyContent: "center", width: "147px" }}>
                {s !== 'all' && bk && <image-slot id={bk.student.slot + '-sf'} shape="circle" placeholder={s[0]} style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }}></image-slot>}
                {s === 'all' ? 'All Students' : s}
              </button>);

          })}
        </div>

        {/* booking list */}
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {list.length === 0 ?
          <BookingEmptyState phase={phase} onNew={() => onToast('Opening class catalog…')} /> :
          list.map((b) => b.type === 'assessment' ?
          <AssessmentCard key={b.id} b={b} onSelect={setSelected} onToast={onToast} /> :
          <BookingCard key={b.id} b={b} onSelect={setSelected} onToast={onToast} />)
          }
        </div>
      </div>

      {selected && <BookingDetailOverlay b={selected} onClose={() => setSelected(null)} onToast={onToast} />}
    </>);

}

Object.assign(window, { BookingDetailOverlay, DetailSection, DetailRow, ScheduleScreen });