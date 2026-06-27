/* global React, ReactDOM */
const { useState: useSA, useEffect: useEA } = React;

const CS_AUTH_KEY = 'cs_signed_in_v1';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "welcomeStyle": "spotlight",
  "ctaStyle": "solid",
  "pickerLayout": "grid"
} /*EDITMODE-END*/;

const STORE_KEY = 'cs_signup_state_v2';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    o.form = o.form || {};
    o.form.styles = new Set(o.form.styles || []);
    return o;
  } catch (e) {return null;}
}

function SignupApp(props) {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const saved = React.useRef(loadState()).current;

  const [screen, setScreen] = useSA(saved?.screen || 'welcome');
  const [form, setForm] = useSA(saved?.form || {
    method: 'email', email: '', password: '', phone: '', otp: '', styles: new Set()
  });

  // persist navigation + form across reloads (iterative design convenience)
  useEA(() => {
    const payload = { screen, form: { ...form, styles: [...form.styles] } };
    try {localStorage.setItem(STORE_KEY, JSON.stringify(payload));} catch (e) {}
  }, [screen, form]);

  function set(patch) {setForm((f) => ({ ...f, ...patch }));}

  function go(next, opts = {}) {
    if (next === 'verify') set({ _startCode: !!opts.startCode });
    if (next === 'welcome') {
      // reset for a clean restart
      setForm({ method: 'email', firstName: '', lastName: '', email: '', password: '', phone: '', otp: '', styles: new Set() });
    }
    setScreen(next);
  }

  const common = { go, t, form, set };

  const enterApp = props.onEnterApp;

  return (
    <div className="cs-stage-backdrop" style={{ height: "978px" }}>
      <div className="phone">
        <div key={screen} className="screen-enter" style={{ position: 'absolute', inset: 0 }}>
          {screen === 'welcome' && <Welcome go={go} t={t} />}
          {screen === 'signup' && <CreateAccount {...common} />}
          {screen === 'verify' && <Verify {...common} />}
          {screen === 'styles' && <PickStyles {...common} />}
          {screen === 'success' && <Success go={go} t={t} form={form} onEnterApp={enterApp} />}
        </div>
        <div className="home-indicator" style={{
          background: screen === 'welcome' || screen === 'success' ? 'rgba(255,255,255,0.85)' : screen === 'signup' || screen === 'verify' ? 'rgba(0,0,0,0.25)' : 'var(--cs-ink-900)' }} />
      </div>

      <TweaksPanel>
        <TweakSection label="Welcome screen" />
        <TweakRadio label="Direction" value={t.welcomeStyle}
        options={['spotlight', 'marquee', 'split']}
        onChange={(v) => {setTweak('welcomeStyle', v);setScreen('welcome');}} />

        <TweakSection label="Call to action" />
        <TweakRadio label="Button style" value={t.ctaStyle}
        options={['solid', 'pill', 'slash', 'gradient']}
        onChange={(v) => setTweak('ctaStyle', v)} />

        <TweakSection label="Dance-style picker" />
        <TweakRadio label="Layout" value={t.pickerLayout}
        options={['grid', 'chips', 'list']}
        onChange={(v) => {setTweak('pickerLayout', v);setScreen('styles');}} />

        <TweakSection label="Jump to screen" />
        <TweakSelect label="Screen" value={screen}
        options={['welcome', 'signup', 'verify', 'styles', 'success']}
        onChange={(v) => setScreen(v)} />
      </TweaksPanel>
    </div>);

}

Object.assign(window, { SignupApp, CS_AUTH_KEY });