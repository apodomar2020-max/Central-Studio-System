/* global React */
const { useState: useSC, useEffect: useSCE } = React;

/* ================================================================
   Central Studio — Signup Shared Primitives (redesign)
   ================================================================ */

/* ── Icon ─────────────────────────────────────────────────────── */
function Icon({ name, size = 20, stroke = 2, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'back':return <svg {...p}><path d="M15 18l-6-6 6-6" /></svg>;
    case 'eye':return <svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'eyeOff':return <svg {...p}><path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.3 3.3M6.6 6.6A18 18 0 0 0 2 12s3.5 8 10 8a10 10 0 0 0 4-.8" /><path d="M3 3l18 18" /></svg>;
    case 'check':return <svg {...p}><path d="M20 6L9 17l-5-5" /></svg>;
    case 'arrow':return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'mail':return <svg {...p}><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><path d="M3 6.5l9 6 9-6" /></svg>;
    case 'phone':return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" /></svg>;
    case 'lock':return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case 'user':return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>;
    case 'spark':return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /></svg>;
    case 'x':return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'logout':return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
    default:return null;
  }
}

/* ── iOS Status Bar ───────────────────────────────────────────── */
function StatusBar({ dark = false }) {
  const c = dark ? '#fff' : 'var(--cs-ink-900)';
  return (
    <div style={{ height: 50, flexShrink: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '12px 28px 0', zIndex: 10 }}>
      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: c }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="11" viewBox="0 0 18 12" fill={c}>
          <rect x="0" y="7" width="3" height="5" rx="0.8" /><rect x="5" y="4.5" width="3" height="7.5" rx="0.8" />
          <rect x="10" y="2" width="3" height="10" rx="0.8" /><rect x="15" y="0" width="3" height="12" rx="0.8" />
        </svg>
        <svg width="16" height="11" viewBox="0 0 17 12" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 4.2a11 11 0 0 1 15 0" /><path d="M3.6 6.8a7.2 7.2 0 0 1 9.8 0" />
          <path d="M6.2 9.3a3.4 3.4 0 0 1 4.6 0" /><circle cx="8.5" cy="11" r="0.6" fill={c} stroke="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 26 13" fill="none">
          <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke={c} opacity="0.4" />
          <rect x="2" y="2" width="17" height="9" rx="2" fill={c} />
          <rect x="23.5" y="4" width="2" height="5" rx="1" fill={c} opacity="0.4" />
        </svg>
      </div>
    </div>);

}

/* ── Stage Video background ──────────────────────────────────── */
function StageVideo() {
  const [src, setSrc] = useSC(null);
  const [dragging, setDragging] = useSC(false);
  const inputRef = React.useRef(null);

  function loadFile(file) {
    if (!file || !file.type.startsWith('video/')) return;
    setSrc(URL.createObjectURL(file));
  }

  const PlayIcon = () =>
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 6 4-6 4V8z" fill="currentColor" stroke="none" />
    </svg>;


  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}
    onDragOver={(e) => {e.preventDefault();setDragging(true);}}
    onDragLeave={(e) => {if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);}}
    onDrop={(e) => {e.preventDefault();setDragging(false);loadFile(e.dataTransfer.files[0]);}}>

      {/* base */}
      <div style={{ position: 'absolute', inset: 0, background: '#07080a' }} />

      {/* video */}
      {src &&
      <video autoPlay muted loop playsInline
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: "0.39" }}>
          <source src={src} />
        </video>
      }

      {/* bokeh fallback */}
      {!src && <>
        <div style={{ position: 'absolute', top: '-10%', left: '15%', width: 280, height: 520,
          background: 'radial-gradient(ellipse,rgba(0,182,215,0.14) 0%,transparent 68%)',
          transform: 'rotate(-18deg)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '-5%', right: '5%', width: 220, height: 440,
          background: 'radial-gradient(ellipse,rgba(255,46,126,0.10) 0%,transparent 68%)',
          transform: 'rotate(12deg)', pointerEvents: 'none' }} />
        {[{ l: '10%', b: '20%', s: 6, c: 'rgba(0,182,215,0.7)', d: 8 }, { l: '30%', b: '16%', s: 4, c: 'rgba(255,46,126,0.6)', d: 11 },
        { l: '70%', b: '26%', s: 7, c: 'rgba(0,182,215,0.5)', d: 9 }, { l: '84%', b: '14%', s: 4, c: 'rgba(255,176,46,0.5)', d: 13 },
        { l: '54%', b: '34%', s: 5, c: 'rgba(163,230,53,0.4)', d: 7 }, { l: '44%', b: '10%', s: 3, c: 'rgba(255,46,126,0.4)', d: 10 }].
        map((b, i) => <span key={i} style={{ position: 'absolute', left: b.l, bottom: b.b,
          width: b.s, height: b.s, borderRadius: '50%', background: b.c,
          boxShadow: `0 0 ${b.s * 3}px ${b.c}`,
          animation: `bokehFloat ${b.d}s ease-in-out ${-i * 1.4}s infinite alternate` }} />)}
        <style>{`@keyframes bokehFloat{from{transform:translateY(0) scale(1)}to{transform:translateY(-18px) scale(1.3)}}`}</style>

        {/* Prominent "Add Video" tap zone — centered */}
        <div onClick={() => inputRef.current?.click()}
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          padding: '20px 28px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
          background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(10px)',
          border: '1.5px dashed rgba(0,182,215,0.55)',
          color: 'var(--cs-cyan-400)', userSelect: 'none' }}>
          <PlayIcon />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14,
            letterSpacing: '0.06em', textTransform: 'uppercase' }}>Add Dance Video</span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'rgba(255,255,255,0.38)', textAlign: 'center', lineHeight: 1.4 }}>
            Tap to upload or<br />drag & drop a video
          </span>
        </div>
      </>}

      {/* drag-over overlay */}
      {dragging &&
      <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center',
        background: 'rgba(0,182,215,0.15)', border: '3px dashed var(--cs-cyan-400)',
        backdropFilter: 'blur(4px)' }}>
          <div style={{ textAlign: 'center', color: 'var(--cs-cyan-400)',
          fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>
            <PlayIcon />
            <div style={{ marginTop: 10 }}>Drop video here</div>
          </div>
        </div>
      }

      {/* Change Video pill (only when video loaded) */}
      {src &&
      <div onClick={() => inputRef.current?.click()}
      style={{ position: 'absolute', bottom: 180, right: 14, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px',
        borderRadius: 'var(--radius-pill)', background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.20)',
        cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 700,
        fontSize: 12, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.05em',
        textTransform: 'uppercase', userSelect: 'none' }}>
          <PlayIcon />
          Change Video
        </div>
      }

      {/* hidden file input */}
      <input ref={inputRef} type="file" accept="video/*"
      style={{ display: 'none', position: 'absolute' }}
      onChange={(e) => loadFile(e.target.files[0])} />

      {/* noise grain */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
      {/* gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(180deg,rgba(7,8,10,0.36) 0%,rgba(7,8,10,0) 28%,rgba(7,8,10,0.18) 55%,rgba(7,8,10,0.97) 100%)' }} />
    </div>);

}



/* ── CTA Button ───────────────────────────────────────────────── */
function PrimaryCTA({ label, onClick, disabled, ctaStyle = 'solid', icon, loading }) {
  const [press, setPress] = useSC(false);
  const style = {
    width: '100%', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16,
    padding: '15px 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    color: 'var(--cs-ink-900)', background: disabled ? 'rgba(0,182,215,0.35)' : 'var(--cs-cyan-500)',
    borderRadius: ctaStyle === 'pill' ? 'var(--radius-pill)' : ctaStyle === 'slash' ? 2 : 'var(--radius-md)',
    transform: press ? 'scale(0.975)' : 'scale(1)',
    transition: 'transform 120ms, background 150ms',
    boxShadow: disabled ? 'none' : '0 4px 20px rgba(0,182,215,0.28)',
    clipPath: ctaStyle === 'slash' ? 'polygon(0 0,100% 0,100% 100%,18px 100%,0 calc(100% - 18px))' : 'none'
  };
  if (ctaStyle === 'gradient') style.background = 'linear-gradient(118deg, var(--cs-cyan-500) 0%, var(--cs-cyan-400) 40%, var(--cs-magenta-500) 100%)';
  return (
    <button style={style} disabled={disabled}
    onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)} onMouseLeave={() => setPress(false)}
    onTouchStart={() => setPress(true)} onTouchEnd={() => setPress(false)}
    onClick={onClick}>
      {loading ? <span style={{ width: 18, height: 18, border: '2.5px solid rgba(0,0,0,0.25)', borderTopColor: 'var(--cs-ink-900)', borderRadius: '50%', animation: 'spin 700ms linear infinite' }} /> : label}
      {!loading && icon && <Icon name={icon} size={18} stroke={2.6} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </button>);

}

/* ── Ghost / social button ────────────────────────────────────── */
function GhostBtn({ label, icon, onClick, light }) {
  const [press, setPress] = useSC(false);
  return (
    <button style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
      background: light ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
      border: light ? '1.5px solid rgba(0,0,0,0.16)' : '1.5px solid rgba(255,255,255,0.14)',
      color: light ? 'var(--cs-ink-900)' : '#fff',
      fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15,
      transform: press ? 'scale(0.975)' : 'scale(1)', transition: 'transform 120ms',
      backdropFilter: 'blur(8px)' }}
    onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)} onMouseLeave={() => setPress(false)}
    onTouchStart={() => setPress(true)} onTouchEnd={() => setPress(false)}
    onClick={onClick}>
      {icon && icon}
      {label}
    </button>);

}

/* ── Back button ──────────────────────────────────────────────── */
function BackBtn({ onClick, dark }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(10px)',
      flexShrink: 0,
      boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)',
      WebkitTapHighlightColor: 'transparent', color: "rgb(255, 0, 0)", textAlign: "center", fontSize: "12px" }}>
      <Icon name="back" size={22} stroke={2.4} />
    </button>);

}

/* ── Eyebrow text ─────────────────────────────────────────────── */
function Eyebrow({ children, color = 'var(--cs-cyan-400)' }) {
  return (
    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 11,
      letterSpacing: '0.13em', textTransform: 'uppercase', color, marginBottom: 8 }}>
      {children}
    </div>);

}

/* ── Divider with label ───────────────────────────────────────── */
function Divider({ label = 'or' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 12,
        color: 'rgba(255,255,255,0.32)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
    </div>);

}

/* ── Floating input ───────────────────────────────────────────── */
function FloatInput({ label, value, onChange, type = 'text', icon, rightEl, error, autoFocus, light }) {
  const [focus, setFocus] = useSC(false);
  const raised = focus || !!value;
  const id = 'fi-' + label.replace(/\s/g, '');
  const borderColor = error ? 'var(--cs-danger-500)' : focus ? 'var(--cs-cyan-500)' : light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.12)';
  const bgColor = light ? focus ? 'rgba(0,182,215,0.04)' : 'rgba(0,0,0,0.05)' : focus ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)';
  const iconColor = focus ? 'var(--cs-cyan-500)' : light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.3)';
  const labelColor = error ? 'var(--cs-danger-500)' : focus ? 'var(--cs-cyan-500)' : light ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.38)';
  const textColor = light ? 'var(--cs-ink-900)' : '#fff';
  return (
    <div style={{ position: 'relative' }}>
      {icon && <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
        color: iconColor, pointerEvents: 'none', transition: 'color 150ms', zIndex: 1 }}>
        <Icon name={icon} size={17} stroke={2} />
      </span>}
      <div style={{ position: 'relative', borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${borderColor}`,
        background: bgColor,
        transition: 'border-color 150ms, background 150ms',
        boxShadow: focus && !error ? '0 0 0 3px rgba(0,182,215,0.12)' : 'none' }}>
        <label htmlFor={id} style={{ position: 'absolute', left: icon ? 44 : 14,
          top: raised ? 8 : '50%', transform: raised ? 'none' : 'translateY(-50%)',
          fontSize: raised ? 11 : 15, fontWeight: raised ? 700 : 400,
          color: labelColor,
          transition: 'all 150ms', pointerEvents: 'none', fontFamily: 'var(--font-heading)',
          letterSpacing: raised ? '0.06em' : 0, textTransform: raised ? 'uppercase' : 'none' }}>
          {label}
        </label>
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        autoFocus={autoFocus}
        style={{ display: 'block', width: '100%', paddingLeft: icon ? 44 : 14,
          paddingRight: rightEl ? 44 : 14, paddingTop: 22, paddingBottom: 10,
          fontSize: 15, fontFamily: 'var(--font-body)', color: textColor,
          background: 'transparent', border: 'none', outline: 'none' }} />
      </div>
      {rightEl && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>{rightEl}</span>}
      {error && <p style={{ margin: '4px 0 0 4px', fontSize: 12, color: 'var(--cs-danger-500)', fontFamily: 'var(--font-heading)', fontWeight: 600 }}>{error}</p>}
    </div>);

}

/* ── Progress dots ────────────────────────────────────────────── */
function ProgressDots({ total, current }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) =>
      <span key={i} style={{ width: i === current ? 20 : 7, height: 7, borderRadius: 4,
        background: i === current ? 'var(--cs-cyan-500)' : i < current ? 'rgba(0,182,215,0.45)' : 'rgba(255,255,255,0.15)',
        transition: 'all 300ms' }} />
      )}
    </div>);

}

/* ── Apple / Google SVG logos ─────────────────────────────────── */
function AppleLogo({ color = '#fff' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={color}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>);

}
function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>);

}

const DANCE_STYLES = [
{ id: 'hiphop', name: 'Hip Hop', sym: 'icon-hiphop' },
{ id: 'afro', name: 'Afro', sym: 'icon-afro' },
{ id: 'salsa', name: 'Salsa', sym: 'icon-salsa' },
{ id: 'bachata', name: 'Bachata', sym: 'icon-bachata' },
{ id: 'breaking', name: 'Breaking', sym: 'icon-breaking' },
{ id: 'locking', name: 'Locking', sym: 'icon-locking' },
{ id: 'popping', name: 'Popping', sym: 'icon-popping' },
{ id: 'contemporary', name: 'Contemporary', sym: 'icon-contemporary' },
{ id: 'ballet', name: 'Ballet', sym: 'icon-ballet' },
{ id: 'jazz', name: 'Jazz', sym: 'icon-jazz' },
{ id: 'zumba', name: 'Zumba', sym: 'icon-zumba' },
{ id: 'house', name: 'House Dance', sym: 'icon-house' }];


Object.assign(window, {
  Icon, StatusBar, StageVideo, PrimaryCTA, GhostBtn, BackBtn, Eyebrow,
  Divider, FloatInput, ProgressDots, AppleLogo, GoogleLogo, DANCE_STYLES
});