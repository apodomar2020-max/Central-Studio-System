/* global React, ReactDOM */
const { useState: useAS, useEffect: useAE } = React;

/* ── Auth gate ─────────────────────────────────────────────── */
function RootApp() {
  const [signedIn, setSignedIn] = useAS(() => !!localStorage.getItem(window.CS_AUTH_KEY || 'cs_signed_in_v1'));

  function handleEnterApp() {
    localStorage.setItem(window.CS_AUTH_KEY || 'cs_signed_in_v1', '1');
    setSignedIn(true);
  }
  function handleSignOut() {
    localStorage.removeItem(window.CS_AUTH_KEY || 'cs_signed_in_v1');
    localStorage.removeItem('cs_signup_state_v1');
    setSignedIn(false);
  }

  if (!signedIn) {
    const SA = window.SignupApp;
    return SA ? <SA onEnterApp={handleEnterApp} /> : <div style={{color:'#fff',padding:40}}>Loading signup…</div>;
  }
  return <HomeApp onSignOut={handleSignOut} />;
}

const HOME_TWEAKS = /*EDITMODE-BEGIN*/{
  "heroStyle": "overlay",
  "classLayout": "standard",
  "packagesLayout": "cards",
  "reelsLayout": "carousel",
  "accountType": "parent"
}/*EDITMODE-END*/;

function Toast({ msg, onDone }) {
  useAE(() => {
    if (!msg) return;
    const id = setTimeout(onDone, 2200);
    return () => clearTimeout(id);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="tab-pop" style={{ position: 'absolute', left: 20, right: 20, bottom: 96, zIndex: 70,
      display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderRadius: 'var(--radius-md)',
      background: 'var(--cs-ink-700)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: 'var(--shadow-lg)' }}>
      <span style={{ width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--cs-cyan-500)', color: 'var(--cs-ink-900)', flexShrink: 0 }}>
        <Icon name="check" size={16} stroke={3} />
      </span>
      <span style={{ font: 'var(--role-body-sm)', fontWeight: 600, color: '#fff' }}>{msg}</span>
    </div>
  );
}

function HomeApp({ onSignOut }) {
  const [t, setTweak] = useTweaks(HOME_TWEAKS);
  const [tab, setTab] = useAS('home');
  const [booked, setBooked] = useAS({});
  const [openInstructor, setOpenInstructor] = useAS(null);
  const [bookingCls, setBookingCls] = useAS(null);
  const [toast, setToast] = useAS('');

  function book(id) {
    const c = CLASSES.find(x => x.id === id);
    if (c && c.status === 'Full') { setToast(`Added to the ${c.title} waitlist`); return; }
    setBooked(b => {
      const next = { ...b, [id]: !b[id] };
      setToast(next[id] ? `Booked — ${c.title}! See you there.` : `Removed ${c.title} from your bookings`);
      return next;
    });
  }
  function pickPackage(id) {
    const p = PACKAGES.find(x => x.id === id);
    if (p) setToast(`${p.name} selected — let's dance!`);
  }

  return (
    <div className="cs-stage-backdrop">
      <div className="phone cs-stage">
        <StatusBar />

        {tab === 'home' ? (
          <div className="feed" style={{ paddingBottom: 110, background: 'radial-gradient(80% 110% at 50% -5%, rgba(163,230,53,0.11) 0%, transparent 52%), radial-gradient(65% 70% at 95% 95%, rgba(0,182,215,0.13) 0%, transparent 55%), var(--cs-ink-900)' }}>
            <Header onBell={() => setToast('No new notifications')} />
            <div className="rise"><HeroCarousel style={t.heroStyle} /></div>
            <Instructors onSeeAll={() => setTab('explore')} onSelectInstructor={setOpenInstructor} />
            <UpcomingClasses layout={t.classLayout} booked={booked} onBook={(c) => setBookingCls(c)} onSeeAll={() => setTab('schedule')} />
            <Packages layout={t.packagesLayout} onPick={pickPackage} />
            <Reels layout={t.reelsLayout} />
          </div>
        ) : tab === 'explore' ? (
          <ExploreScreen onToast={setToast} />
        ) : tab === 'schedule' ? (
          <ScheduleScreen onToast={setToast} />
        ) : tab === 'profile' ? (
          <Profile accountType={t.accountType} onToast={setToast} onSchedule={() => setTab('schedule')} onSignOut={onSignOut} />
        ) : (
          <EmptyTab tab={tab} />
        )}

        {bookingCls && (() => { const BF = window.BookingFlow; return BF ? <BF cls={bookingCls} onClose={() => setBookingCls(null)} onToast={setToast} /> : null; })()}
        {openInstructor && (() => { const IP = window.InstructorProfile; return IP ? <IP inst={openInstructor} onBack={() => setOpenInstructor(null)} onToast={setToast} /> : null; })()}
        <Toast msg={toast} onDone={() => setToast('')} />
        <TabBar active={tab} onChange={setTab} />
        <div className="home-indicator" />
      </div>

      <TweaksPanel>
        <TweakSection label="Hero promo cards" />
        <TweakRadio label="Style" value={t.heroStyle}
          options={['overlay', 'split', 'ticket']}
          onChange={(v) => { setTweak('heroStyle', v); setTab('home'); }} />

        <TweakSection label="Class card" />
        <TweakRadio label="Layout" value={t.classLayout}
          options={['standard', 'compact', 'ticket']}
          onChange={(v) => { setTweak('classLayout', v); setTab('home'); }} />

        <TweakSection label="Packages" />
        <TweakRadio label="Layout" value={t.packagesLayout}
          options={['cards', 'list', 'highlight']}
          onChange={(v) => { setTweak('packagesLayout', v); setTab('home'); }} />

        <TweakSection label="Reels" />
        <TweakRadio label="Layout" value={t.reelsLayout}
          options={['carousel', 'grid']}
          onChange={(v) => { setTweak('reelsLayout', v); setTab('home'); }} />

        <TweakSection label="Profile" />
        <TweakRadio label="Account type" value={t.accountType}
          options={['parent', 'student']}
          onChange={(v) => { setTweak('accountType', v); setTab('profile'); }} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<RootApp />);
