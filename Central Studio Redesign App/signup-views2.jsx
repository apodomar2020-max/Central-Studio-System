/* global React */
const { useState: useS2, useRef: useR2, useMemo: useM2 } = React;

const { Icon, StatusBar, StageVideo, PrimaryCTA, GhostBtn, BackBtn,
  Eyebrow, Divider, FloatInput, ProgressDots, DANCE_STYLES,
  Screen, Body, Footer } = window;

/* ═══════════════════════════════════════════════════════════════
   VERIFY — Phone → OTP
═══════════════════════════════════════════════════════════════ */
function Verify({ go, t, form, set }) {
  const [phase, setPhase] = useS2(form._startCode ? 'code' : 'phone');
  const [phone, setPhone] = useS2(form.phone || '');
  const [phoneErr, setPhoneErr] = useS2('');

  function submitPhone() {
    if (phone.replace(/\D/g, '').length < 8) {setPhoneErr('Enter a valid phone number');return;}
    set({ phone });setPhase('code');
  }

  if (phase === 'phone') return (
    <Screen>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(70% 50% at 20% 110%,rgba(0,182,215,0.09) 0%,transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>
        <StatusBar dark />
        <div style={{ flexShrink: 0, display: 'flex', margin: "60px 0px 0px", alignItems: "center", padding: "0px 24px", flexDirection: "row", justifyContent: "flex-start", gap: "100px", height: "50px" }}>
          <BackBtn onClick={() => go('signup')} />
          <ProgressDots total={4} current={1} />
        </div>
        <Body style={{ paddingTop: 20 }}>
          <Eyebrow color="var(--cs-cyan-400)">Step 2 of 4</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', lineHeight: 0.9,
            textTransform: 'uppercase', margin: '0 0 8px', fontSize: "85px", color: "rgb(0, 182, 215)" }}>
            Verify<br />Phone
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5, marginBottom: 28 }}>
            We'll send a 6-digit code to confirm your number.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 86, flexShrink: 0, padding: '16px 10px', borderRadius: 'var(--radius-md)',
              border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14, color: '#fff',
              cursor: 'pointer', gap: 4 }}>
              🇪🇬 +20
            </div>
            <div style={{ flex: 1 }}>
              <FloatInput label="Phone Number" value={phone}
              onChange={(v) => {setPhone(v);setPhoneErr('');}}
              type="tel" icon="phone" error={phoneErr} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5 }}>
            Standard SMS rates may apply. Your number won't be shared.
          </p>
        </Body>
        <Footer>
          <PrimaryCTA label="Send Code" icon="arrow" ctaStyle={t.ctaStyle}
          onClick={submitPhone} disabled={phone.replace(/\D/g, '').length < 8} />
        </Footer>
      </div>
    </Screen>);


  return <OtpPhase go={go} t={t} form={form} set={set} phone={phone}
  onEditNumber={() => {setPhoneErr('');setPhase('phone');}} />;
}

/* OTP entry */
function OtpPhase({ go, t, form, set, phone, onEditNumber }) {
  const LEN = 6;
  const [digits, setDigits] = useS2(Array(LEN).fill(''));
  const [err, setErr] = useS2(false);
  const [loading, setLoading] = useS2(false);
  const refs = useR2([]);
  const masked = (phone || '').replace(/(\d{2})(\d+)(\d{2})/, (_, a, m, b) => a + m.replace(/\d/g, '·') + b);

  function complete(arr) {
    if (arr.join('') === '000000') {setErr(true);return;}
    setLoading(true);
    setTimeout(() => {set({ otp: arr.join('') });setLoading(false);go('styles');}, 600);
  }
  function setAt(i, raw) {
    const val = raw.replace(/\D/g, '').slice(-1);
    const arr = [...digits];arr[i] = val;setDigits(arr);setErr(false);
    if (val && i < LEN - 1) refs.current[i + 1]?.focus();
    if (arr.every((d) => d)) complete(arr);
  }
  function keyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  }
  function paste(e) {
    const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LEN);
    if (!txt) return;e.preventDefault();
    const arr = txt.split('').concat(Array(LEN).fill('')).slice(0, LEN);
    setDigits(arr);setErr(false);
    refs.current[Math.min(txt.length, LEN - 1)]?.focus();
    if (arr.every((d) => d)) complete(arr);
  }

  return (
    <Screen>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(70% 50% at 80% 100%,rgba(0,182,215,0.09) 0%,transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>
        <StatusBar dark />
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', height: "50px", gap: "100px", padding: "0px 24px", margin: "60px 0px 0px" }}>
          <BackBtn onClick={onEditNumber} />
          <ProgressDots total={4} current={1} />
        </div>
        <Body style={{ paddingTop: 20 }}>
          <Eyebrow color="var(--cs-cyan-400)">Step 2 of 4</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', lineHeight: 0.9,
            textTransform: 'uppercase', margin: '0 0 8px', fontSize: "85px", color: "rgb(46, 205, 236)" }}>
            Enter<br />OTP Code
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5, marginBottom: 4 }}>Code sent to</p>
          <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15,
            color: '#fff', marginBottom: 28 }}>
            +20 {masked}
            <span onClick={onEditNumber} style={{ color: 'var(--cs-cyan-400)', fontWeight: 700,
              cursor: 'pointer', marginLeft: 10, fontSize: 13 }}>Edit</span>
          </p>

          {/* OTP boxes */}
          <div style={{ display: 'flex', gap: 9, justifyContent: 'center', marginBottom: 8 }} onPaste={paste}>
            {digits.map((d, i) =>
            <input key={i} ref={(el) => refs.current[i] = el} value={d}
            inputMode="numeric" maxLength={1}
            onChange={(e) => setAt(i, e.target.value)} onKeyDown={(e) => keyDown(i, e)}
            style={{ width: 46, height: 56, textAlign: 'center',
              fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-heading)', color: '#fff',
              background: err ? 'rgba(255,59,71,0.08)' : d ? 'rgba(0,182,215,0.10)' : 'rgba(255,255,255,0.05)',
              border: `2px solid ${err ? 'var(--cs-danger-500)' : d ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.14)'}`,
              borderRadius: 'var(--radius-md)', outline: 'none',
              transition: 'border-color 150ms, background 150ms',
              boxShadow: d && !err ? '0 0 0 3px rgba(0,182,215,0.14)' : 'none' }} />
            )}
          </div>
          {err && <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--cs-danger-500)',
            fontFamily: 'var(--font-heading)', fontWeight: 600, marginTop: 4 }}>
            Code didn't match. Try again.</p>}

          <div style={{ marginTop: 22, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.38)' }}>
            Didn't get it?{' '}
            <span onClick={() => setDigits(Array(LEN).fill(''))}
            style={{ color: 'var(--cs-cyan-400)', fontWeight: 700, cursor: 'pointer' }}>
              Resend code
            </span>
          </div>
          <div style={{ marginTop: 10, textAlign: 'center' }}>
            <span onClick={() => go('styles')}
            style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13,
              color: 'rgba(255,255,255,0.22)', cursor: 'pointer' }}>
              Skip for now →
            </span>
          </div>
        </Body>
        <Footer>
          <PrimaryCTA label="Verify" icon="arrow" ctaStyle={t.ctaStyle}
          loading={loading} disabled={!digits.every((d) => d) || loading}
          onClick={() => complete(digits)} />
        </Footer>
      </div>
    </Screen>);

}

/* ═══════════════════════════════════════════════════════════════
   PICK STYLES
═══════════════════════════════════════════════════════════════ */
function PickStyles({ go, t, form, set }) {
  const [selected, setSelected] = useS2(form.styles instanceof Set ? form.styles : new Set());
  const layout = t.pickerLayout || 'grid';
  function toggle(id) {setSelected((s) => {const n = new Set(s);n.has(id) ? n.delete(id) : n.add(id);return n;});}

  return (
    <Screen>
      <StageVideo />
      <div style={{ position: 'relative', zIndex: 5, display: 'contents' }}>
        <StatusBar dark />
        <div style={{ flexShrink: 0, padding: '6px 24px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          <BackBtn onClick={() => go('verify')} />
          <ProgressDots total={4} current={2} />
        </div>
        <div style={{ flexShrink: 0, padding: '16px 24px 10px', position: 'relative', zIndex: 5 }}>
          <Eyebrow color="var(--cs-cyan-400)">Step 3 of 4</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', lineHeight: 0.9,
            textTransform: 'uppercase', margin: '0 0 6px', fontSize: "85px", color: "rgb(255, 255, 255)" }}>
            Your<br />Vibe?
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5 }}>
            Pick all styles you love — we'll personalise your feed.
          </p>
        </div>

        <div style={{ position: 'relative', zIndex: 5, flex: 1, overflowY: 'auto',
          padding: '4px 24px 8px', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ display: 'grid',
            gridTemplateColumns: layout === 'chips' ? 'repeat(3,1fr)' : 'repeat(2,1fr)',
            gap: layout === 'chips' ? 8 : 10 }}>
            {DANCE_STYLES.map((s) => {
              const on = selected.has(s.id);
              if (layout === 'chips') return (
                <button key={s.id} onClick={() => toggle(s.id)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 6px', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
                  border: `1.5px solid ${on ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.12)'}`,
                  background: on ? 'rgba(0,182,215,0.16)' : 'rgba(255,255,255,0.04)',
                  transition: 'all 160ms' }}>
                  <svg width="16" height="16"><use href={`#${s.sym}`} /></svg>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12,
                    color: on ? 'var(--cs-cyan-400)' : 'rgba(255,255,255,0.55)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                </button>);

              return (
                <button key={s.id} onClick={() => toggle(s.id)}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '16px 8px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: `1.5px solid ${on ? 'var(--cs-cyan-500)' : 'rgba(255,255,255,0.09)'}`,
                  background: on ? 'rgba(0,182,215,0.13)' : 'rgba(255,255,255,0.04)',
                  transition: 'all 180ms',
                  transform: on ? 'scale(1.03)' : 'scale(1)',
                  boxShadow: on ? '0 0 0 3px rgba(0,182,215,0.16)' : 'none' }}>
                  {on && <span style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18,
                    borderRadius: '50%', background: 'var(--cs-cyan-500)', display: 'grid',
                    placeItems: 'center', color: 'var(--cs-ink-900)' }}>
                    <Icon name="check" size={11} stroke={3} />
                  </span>}
                  <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', display: 'grid',
                    placeItems: 'center', background: on ? 'rgba(0,182,215,0.20)' : 'rgba(255,255,255,0.07)' }}>
                    <svg width="26" height="26"><use href={`#${s.sym}`} /></svg>
                  </span>
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12.5,
                    color: on ? '#fff' : 'rgba(255,255,255,0.50)', textAlign: 'center', lineHeight: 1.2 }}>
                    {s.name}
                  </span>
                </button>);

            })}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 5, flexShrink: 0, padding: '10px 24px 34px' }}>
          {selected.size > 0 && <p style={{ textAlign: 'center', fontFamily: 'var(--font-heading)',
            fontWeight: 700, fontSize: 13, color: 'var(--cs-cyan-400)', marginBottom: 10 }}>
            {selected.size} style{selected.size !== 1 ? 's' : ''} selected
          </p>}
          <PrimaryCTA
            label={selected.size === 0 ? 'Skip for now' : `Continue with ${selected.size} style${selected.size !== 1 ? 's' : ''}`}
            icon="arrow" ctaStyle={t.ctaStyle}
            onClick={() => {set({ styles: selected });go('success');}} />
        </div>
      </div>
    </Screen>);

}

/* ═══════════════════════════════════════════════════════════════
   SUCCESS
═══════════════════════════════════════════════════════════════ */
function Success({ go, t, form, onEnterApp }) {
  const confetti = useM2(() => Array.from({ length: 24 }).map((_, i) => ({
    left: (i * 4.2 + i % 3 * 7) % 96 + '%',
    color: ['var(--cs-cyan-400)', 'var(--cs-magenta-500)', 'var(--cs-amber-500)', 'var(--cs-lime-500)'][i % 4],
    delay: i % 7 * 0.11, dur: 1.5 + i % 5 * 0.28, size: 6 + i % 3 * 4
  })), []);
  const name = (form.firstName || form.email?.split('@')[0] || 'dancer').
  replace(/[^a-z0-9]/gi, ' ').trim() || 'dancer';

  return (
    <Screen>
      <StageVideo />
      <div style={{ position: 'absolute', inset: 0, zIndex: 12, pointerEvents: 'none', overflow: 'hidden' }}>
        {confetti.map((c, i) =>
        <span key={i} style={{ position: 'absolute', top: '-6%', left: c.left,
          width: c.size, height: c.size * 0.6, background: c.color, borderRadius: 1,
          animation: `cfFall ${c.dur}s ease-in ${c.delay}s infinite` }} />
        )}
      </div>
      <style>{`@keyframes cfFall{0%{transform:translateY(0) rotate(0);opacity:0}8%{opacity:1}100%{transform:translateY(860px) rotate(400deg);opacity:0}}`}</style>

      <div style={{ position: 'relative', zIndex: 14, flex: 1, display: 'flex',
        flexDirection: 'column', justifyContent: 'center', padding: '0 30px' }}>
        <div style={{ width: 76, height: 76, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)',
          boxShadow: '0 0 0 12px rgba(0,182,215,0.14), 0 0 40px rgba(0,182,215,0.28)',
          marginBottom: 24, animation: 'popIn 520ms cubic-bezier(0.34,1.56,0.64,1) both' }}>
          <Icon name="check" size={40} stroke={3} />
        </div>
        <style>{`@keyframes popIn{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}`}</style>

        <Eyebrow color="var(--cs-cyan-400)">You're on the list</Eyebrow>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 64,
          lineHeight: 0.9, textTransform: 'uppercase', color: '#fff',
          margin: '10px 0 0', letterSpacing: '-0.01em' }}>
          You're<br /><span style={{ color: 'var(--cs-cyan-400)' }}>in!</span>
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'rgba(255,255,255,0.60)',
          marginTop: 14, lineHeight: 1.55, textTransform: 'capitalize' }}>
          <span style={{ textTransform: 'none' }}>Welcome to Central Studio, </span>
          <strong style={{ color: '#fff' }}>{name}</strong>.
        </p>
        {form.styles?.size > 0 &&
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(255,255,255,0.38)', marginTop: 6 }}>
            {form.styles.size} style{form.styles.size !== 1 ? 's' : ''} loaded into your feed.
          </p>
        }
      </div>

      <Footer>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryCTA label="Start Dancing" icon="arrow" ctaStyle={t.ctaStyle}
          onClick={() => onEnterApp ? onEnterApp() : go('welcome')} />
          <button onClick={() => go('welcome')} style={{ background: 'none', border: 'none',
            cursor: 'pointer', padding: '8px 0', fontFamily: 'var(--font-heading)', fontWeight: 600,
            fontSize: 13, color: 'rgba(255,255,255,0.24)', textAlign: 'center' }}>
            Restart flow
          </button>
        </div>
      </Footer>
    </Screen>);

}

Object.assign(window, { Verify, OtpPhase, PickStyles, Success });