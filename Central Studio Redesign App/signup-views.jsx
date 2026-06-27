/* global React */
const { useState: useS, useEffect: useE } = React;

const { Icon, StatusBar, StageVideo, PrimaryCTA, GhostBtn, BackBtn,
  Eyebrow, Divider, FloatInput, ProgressDots, AppleLogo, GoogleLogo } = window;

function FacebookLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>);

}

/* ── Dark Screen shell ──────────────────────────────────────── */
function Screen({ children, style = {} }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      background: '#07080a', color: '#fff', overflow: 'hidden', ...style }}>
      {children}
    </div>);

}
function Body({ children, style = {} }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch', padding: '0 24px', ...style }}>
      {children}
    </div>);

}
function Footer({ children }) {
  return <div style={{ flexShrink: 0, padding: '12px 24px 36px' }}>{children}</div>;
}

/* ═══════════════════════════════════════════════════════════════
   WELCOME
═══════════════════════════════════════════════════════════════ */
function Welcome({ go, t }) {
  return (
    <Screen>
      <StageVideo />
      <StatusBar dark />

      {/* logo */}
      <div style={{ position: 'relative', zIndex: 5, padding: '6px 26px 0', flexShrink: 0 }}>
        <img src="assets/logo-white.png" alt="Central Studio"
        style={{ width: 128, display: 'block', height: "88px", margin: "52px 0px 0px" }}
        onError={(e) => {e.target.style.display = 'none';}} />
      </div>

      {/* headline */}
      <div style={{ position: 'relative', zIndex: 5, flexShrink: 0, textAlign: "left", height: "195px", padding: "0px 26px", margin: "347px 0px 0px" }}>
        <Eyebrow color="var(--cs-cyan-400)">Your stage awaits</Eyebrow>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 60,
          lineHeight: 0.9, textTransform: 'uppercase', letterSpacing: '-0.01em',
          color: '#fff', margin: '0 0 10px' }}>
          Find your<br /><span style={{ color: 'var(--cs-cyan-400)' }}>vibe.</span>
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14,
          color: 'rgba(255,255,255,0.50)', lineHeight: 1.55, maxWidth: 270, marginBottom: 0 }}>
          World-class dance instruction — Hip Hop to Ballet, on your time.
        </p>
      </div>

      {/* CTAs */}
      <Footer>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryCTA label="Sign Up with Email" icon="arrow" ctaStyle={t.ctaStyle}
          onClick={() => go('signup')} />
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostBtn label="Facebook" icon={<FacebookLogo />} onClick={() => go('signup')} />
            <GhostBtn label="Google" icon={<GoogleLogo />} onClick={() => go('signup')} />
          </div>
          <Divider label="Already a member?" />
          <button onClick={() => go('signup')} style={{ background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14,
            color: 'var(--cs-cyan-400)', textAlign: 'center', padding: '6px 0' }}>
            Sign In →
          </button>
        </div>
      </Footer>
    </Screen>);

}

/* ═══════════════════════════════════════════════════════════════
   CREATE ACCOUNT
═══════════════════════════════════════════════════════════════ */
function CreateAccount({ go, t, form, set }) {
  const [firstName, setFirstName] = useS(form.firstName || '');
  const [lastName, setLastName] = useS(form.lastName || '');
  const [email, setEmail] = useS(form.email || '');
  const [password, setPassword] = useS(form.password || '');
  const [showPwd, setShowPwd] = useS(false);
  const [errors, setErrors] = useS({});
  const [loading, setLoading] = useS(false);

  const pwdStrength = !password ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 :
  /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;
  const strCfg = [null,
  { label: 'Too short', color: 'var(--cs-danger-500)' },
  { label: 'Weak', color: 'var(--cs-amber-500)' },
  { label: 'Good', color: 'var(--cs-cyan-400)' },
  { label: 'Strong', color: 'var(--cs-success-500)' }];


  function validate() {
    const e = {};
    if (!firstName.trim()) e.firstName = 'Required';
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) e.email = 'Valid email required';
    if (password.length < 6) e.password = 'At least 6 characters';
    setErrors(e);return !Object.keys(e).length;
  }
  function submit() {
    if (!validate()) return;
    setLoading(true);
    setTimeout(() => {set({ firstName, lastName, email, password });setLoading(false);go('verify');}, 700);
  }

  return (
    <Screen>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(80% 60% at 80% -10%,rgba(0,182,215,0.10) 0%,transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>
        <StatusBar dark />
        <div style={{ flexShrink: 0, padding: '6px 24px 0', display: 'flex', justifyContent: "flex-start", gap: "100px", flexDirection: "row", height: "50px", alignItems: "center", margin: "60px 0px 0px" }}>
          <BackBtn onClick={() => go('welcome')} />
          <ProgressDots total={4} current={0} />
        </div>

        <Body style={{ paddingTop: 20 }}>
          <Eyebrow color="var(--cs-cyan-400)">Step 1 of 4</Eyebrow>
          <h2 style={{ fontFamily: 'var(--font-display)', lineHeight: 0.9,
            textTransform: 'uppercase', margin: '0 0 8px', fontSize: "85px", color: "rgb(0, 182, 215)" }}>
            Create<br />Account
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.42)', lineHeight: 1.5, marginBottom: 24, height: "46px" }}>
            Join thousands of dancers at Central Studio.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: "stretch", justifyContent: "flex-start", height: "354px" }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <FloatInput label="First Name" value={firstName} onChange={(v) => {setFirstName(v);setErrors((e) => ({ ...e, firstName: '' }));}}
                icon="user" error={errors.firstName} />
              </div>
              <div style={{ flex: 1 }}>
                <FloatInput label="Last Name" value={lastName} onChange={setLastName} />
              </div>
            </div>
            <FloatInput label="Email Address" value={email}
            onChange={(v) => {setEmail(v);setErrors((e) => ({ ...e, email: '' }));}}
            type="email" icon="mail" error={errors.email} />
            <FloatInput label="Password" value={password}
            onChange={(v) => {setPassword(v);setErrors((e) => ({ ...e, password: '' }));}}
            type={showPwd ? 'text' : 'password'} icon="lock" error={errors.password}
            rightEl={
            <button onClick={() => setShowPwd((v) => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.38)', padding: 4 }}>
                  <Icon name={showPwd ? 'eyeOff' : 'eye'} size={17} stroke={2} />
                </button>
            } />

            {password.length > 0 &&
            <div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  {[1, 2, 3, 4].map((i) =>
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, transition: 'background 250ms',
                  background: i <= pwdStrength ? strCfg[pwdStrength]?.color || 'var(--cs-cyan-400)' : 'rgba(255,255,255,0.10)' }} />
                )}
                </div>
                <p style={{ fontSize: 12, fontFamily: 'var(--font-heading)', fontWeight: 600,
                color: strCfg[pwdStrength]?.color, margin: 0 }}>{strCfg[pwdStrength]?.label}</p>
              </div>
            }

            <Divider label="or sign up with" />
            <div style={{ display: 'flex', gap: 10 }}>
              <GhostBtn label="Facebook" icon={<FacebookLogo />} onClick={() => go('verify')} />
              <GhostBtn label="Google" icon={<GoogleLogo />} onClick={() => go('verify')} />
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', lineHeight: 1.5,
              textAlign: 'center', marginTop: 4, paddingBottom: 8 }}>
              By continuing you agree to our{' '}
              <span style={{ color: 'var(--cs-cyan-400)', fontWeight: 600, cursor: 'pointer' }}>Terms</span>
              {' '}and{' '}
              <span style={{ color: 'var(--cs-cyan-400)', fontWeight: 600, cursor: 'pointer' }}>Privacy Policy</span>
            </p>
          </div>
        </Body>

        <Footer>
          <PrimaryCTA label="Continue" icon="arrow" ctaStyle={t.ctaStyle}
          onClick={submit} loading={loading}
          disabled={!firstName || !email || !password} />
        </Footer>
      </div>
    </Screen>);

}

Object.assign(window, { Welcome, CreateAccount, Screen, Body, Footer });