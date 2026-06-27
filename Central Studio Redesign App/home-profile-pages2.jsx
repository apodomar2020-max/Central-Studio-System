/* global React */

function PP2Icon({ name, size=18 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2, strokeLinecap:'round', strokeLinejoin:'round' };
  switch(name) {
    case 'message':  return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'phone':    return <svg {...p}><path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z"/></svg>;
    case 'mail':     return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
    case 'pin':      return <svg {...p}><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'download': return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>;
    case 'search':   return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.4-4.4"/></svg>;
    default: return null;
  }
}

const { useState: usePP2 } = React;
const { SubPage: SP, PField, PToggle } = window;

/* ─── 5. HELP & SUPPORT ─────────────────────────────────────── */
const FAQS = [
  { q:'How do I cancel a booking?', a:'Go to My Bookings, find your booking, tap View Details and select Cancel. Cancellations within 24h may incur a fee.' },
  { q:'What happens to my credits if I miss a class?', a:'Credits used for missed classes are non-refundable unless you cancel before the studio deadline.' },
  { q:'Can I transfer my package credits to someone else?', a:'Package credits are non-transferable and can only be used by the registered account holder.' },
  { q:'How do I book a private session?', a:'Contact the studio directly via WhatsApp or phone to arrange a private one-on-one session with an instructor.' },
  { q:'What is the assessment process for Ballet?', a:'Ballet assessments are conducted by Lena Park. You\'ll receive a level result within 48 hours of your assessment date.' },
];
function HelpSupport({ onBack, onToast }) {
  const [open, setOpen] = usePP2(null);
  const [q, setQ] = usePP2('');
  const [subject, setSubject] = usePP2('');
  const [desc, setDesc] = usePP2('');
  const filtered = FAQS.filter(f => f.q.toLowerCase().includes(q.toLowerCase()) || !q);
  return (
    <SP title="Help & Support" onBack={onBack}>
      <div style={{ padding:'20px 20px 100px' }}>
        {/* search */}
        <div style={{ position:'relative', marginBottom:22 }}>
          <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--cs-ink-400)', pointerEvents:'none' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.4-4.4"/></svg>
          </span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search FAQs…"
            style={{ width:'100%', padding:'13px 13px 13px 42px', fontSize:14.5, fontFamily:'var(--font-body)', color:'#fff', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'var(--radius-pill)', outline:'none' }} />
        </div>
        {/* faqs */}
        <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Frequently Asked</div>
        <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden', marginBottom:22 }}>
          {filtered.map((f,i) => (
            <div key={i} style={{ borderBottom: i===filtered.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setOpen(open===i?null:i)} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', background:'transparent', border:'none', cursor:'pointer', textAlign:'left', gap:12 }}>
                <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff', flex:1 }}>{f.q}</span>
                <span style={{ color:'var(--cs-ink-400)', transition:'transform 220ms', transform: open===i?'rotate(90deg)':'none', flexShrink:0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                </span>
              </button>
              {open===i && <div style={{ padding:'0 16px 14px', font:'var(--role-body-sm)', color:'var(--cs-ink-300)', lineHeight:1.6 }}>{f.a}</div>}
            </div>
          ))}
        </div>
        {/* contact */}
        <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Contact Studio</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:22 }}>
          {[{ label:'WhatsApp', sub:'Quick support response', ic:'💬', col:'#25D366' }, { label:'Call Us', sub:'+20 11 2345 6789', ic:'📞', col:'var(--cs-cyan-400)' }, { label:'Email', sub:'studio@centralstudio.eg', ic:'✉️', col:'var(--cs-magenta-500)' }].map(c => (
            <button key={c.label} onClick={() => onToast(`Opening ${c.label}…`)} style={{ display:'flex', alignItems:'center', gap:13, padding:'13px 16px', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', cursor:'pointer', textAlign:'left' }}>
              <span style={{ width:42, height:42, display:'grid', placeItems:'center', borderRadius:'var(--radius-md)', background:'rgba(0,182,215,0.10)', color:'var(--cs-cyan-400)', flexShrink:0 }}><PP2Icon name={c.ic} size={20} /></span>
              <div style={{ flex:1 }}><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15, color:'#fff' }}>{c.label}</div><div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:1 }}>{c.sub}</div></div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
          ))}
        </div>
        {/* report */}
        <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Report a Problem</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <PField label="Subject" value={subject} onChange={setSubject} placeholder="e.g. Booking issue" />
          <div>
            <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginBottom:6 }}>Description</div>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} placeholder="Describe the problem…"
              style={{ width:'100%', padding:'14px', fontSize:14.5, fontFamily:'var(--font-body)', color:'#fff', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'var(--radius-sm)', outline:'none', resize:'none' }} />
          </div>
          <button onClick={() => { if (subject && desc) { onToast('Report submitted. We\'ll be in touch!'); setSubject(''); setDesc(''); } else onToast('Please fill in subject & description'); }}
            style={{ padding:'13px', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>Submit Report</button>
        </div>
      </div>
    </SP>
  );
}

/* ─── 6. CHANGE PASSWORD ─────────────────────────────────────── */
function ChangePassword({ onBack, onToast }) {
  const [cur, setCur] = usePP2('');
  const [nw,  setNw]  = usePP2('');
  const [cf,  setCf]  = usePP2('');
  const [show, setShow] = usePP2({ cur:false, nw:false, cf:false });
  const [done, setDone] = usePP2(false);
  const strength = !nw ? 0 : nw.length < 6 ? 1 : nw.length < 10 ? 2 : /[A-Z]/.test(nw) && /[0-9]/.test(nw) ? 4 : 3;
  const strLabel = ['','Weak','Fair','Strong','Very Strong'][strength];
  const strColor = ['','var(--cs-danger-500)','var(--cs-amber-500)','var(--cs-success-500)','var(--cs-cyan-400)'][strength];
  const mismatch = cf && nw !== cf;
  function update() {
    if (!cur) return onToast('Enter your current password');
    if (strength < 2) return onToast('Password is too weak');
    if (mismatch) return onToast('Passwords do not match');
    setDone(true); setTimeout(() => { onToast('Password updated!'); onBack(); }, 900);
  }
  return (
    <SP title="Change Password" onBack={onBack}>
      <div style={{ padding:'28px 20px 100px', display:'flex', flexDirection:'column', gap:18 }}>
        {[{ label:'Current Password', val:cur, set:setCur, k:'cur' }, { label:'New Password', val:nw, set:setNw, k:'nw' }, { label:'Confirm New Password', val:cf, set:setCf, k:'cf' }].map(({ label, val, set, k }) => (
          <div key={k}>
            <div style={{ font:'var(--role-body-sm)', color: k==='cf'&&mismatch ? 'var(--cs-danger-500)' : 'var(--cs-ink-400)', marginBottom:6 }}>{label}</div>
            <div style={{ position:'relative' }}>
              <input type={show[k]?'text':'password'} value={val} onChange={e => set(e.target.value)} placeholder="••••••••"
                style={{ width:'100%', padding:'14px 46px 14px 14px', fontSize:15, fontFamily:'var(--font-body)', color:'#fff',
                  background:'rgba(255,255,255,0.06)', border:`1.5px solid ${k==='cf'&&mismatch?'var(--cs-danger-500)':'rgba(255,255,255,0.10)'}`,
                  borderRadius:'var(--radius-sm)', outline:'none' }} />
              <button onClick={() => setShow(s => ({...s, [k]:!s[k]}))} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--cs-ink-400)', display:'flex' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {show[k] ? <><path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.3 3.3M6.6 6.6A18 18 0 0 0 2 12s3.5 8 10 8a10 10 0 0 0 4-.8"/><path d="M3 3l18 18"/></> : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>}
                </svg>
              </button>
            </div>
          </div>
        ))}
        {nw && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginBottom:6 }}>
              <span>Password strength</span><span style={{ color:strColor, fontWeight:700 }}>{strLabel}</span>
            </div>
            <div style={{ display:'flex', gap:4 }}>
              {[1,2,3,4].map(i => <div key={i} style={{ flex:1, height:4, borderRadius:2, background: i<=strength ? strColor : 'rgba(255,255,255,0.08)', transition:'background 200ms' }} />)}
            </div>
            <div style={{ font:'var(--role-body-sm)', fontSize:12, color:'var(--cs-ink-400)', marginTop:8 }}>Minimum 8 characters · Include uppercase & numbers</div>
          </div>
        )}
        {mismatch && <div style={{ font:'var(--role-body-sm)', color:'var(--cs-danger-500)' }}>Passwords do not match</div>}
        <button onClick={update} style={{ padding:'14px', background: done ? 'rgba(31,184,113,0.16)' : 'var(--cs-cyan-500)', color: done ? 'var(--cs-success-500)' : 'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:15, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>
          {done ? '✓ Password Updated' : 'Update Password'}
        </button>
      </div>
    </SP>
  );
}

/* ─── 7. EMAIL VERIFICATION ──────────────────────────────────── */
function EmailVerification({ onBack, onToast, user: u }) {
  const [sent, setSent] = usePP2(false);
  return (
    <SP title="Email Verification" onBack={onBack}>
      <div style={{ padding:'28px 20px 100px' }}>
        <div style={{ padding:20, borderRadius:'var(--radius-lg)', background:'linear-gradient(135deg,rgba(31,184,113,0.14),rgba(10,11,13,0))', border:'1px solid rgba(31,184,113,0.35)', marginBottom:24, textAlign:'center' }}>
          <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:64, height:64, borderRadius:'50%', background:'rgba(31,184,113,0.16)', color:'var(--cs-success-500)', fontSize:28, marginBottom:14 }}>✓</span>
          <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:18, color:'#fff', marginBottom:6 }}>Email Verified</div>
          <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)' }}>Your email address is confirmed and active.</div>
        </div>
        <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden', marginBottom:22 }}>
          {[{ label:'Current Email', val:u.email }, { label:'Verified On', val:'Jun 1, 2026' }, { label:'Status', val:'Active ✓' }].map((r,i,arr) => (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 16px', borderBottom: i===arr.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{r.label}</span>
              <span style={{ font:'var(--role-body-sm)', fontWeight:700, color:'#fff' }}>{r.val}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <button onClick={() => { setSent(true); onToast('Verification email resent!'); }} style={{ padding:'13px', background: sent ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)', color: sent ? 'var(--cs-ink-400)' : '#fff', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1px solid rgba(255,255,255,0.12)', cursor:'pointer' }}>{sent ? '✓ Verification Email Sent' : 'Resend Verification Email'}</button>
          <button onClick={() => onToast('Opening email change flow…')} style={{ padding:'13px', background:'transparent', color:'var(--cs-cyan-400)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1.5px solid rgba(0,182,215,0.4)', cursor:'pointer' }}>Change Email Address</button>
        </div>
      </div>
    </SP>
  );
}

/* ─── 8. TWO-FACTOR AUTH ─────────────────────────────────────── */
function TwoFA({ onBack, onToast }) {
  const [enabled, setEnabled] = usePP2(false);
  const [method,  setMethod]  = usePP2('email');
  const [step,    setStep]    = usePP2('main'); // main | setup | codes
  const [otp,     setOtp]     = usePP2('');
  function enable() { if (otp.length === 6) { setEnabled(true); setStep('main'); setOtp(''); onToast('Two-Factor Auth enabled!'); } else onToast('Enter the 6-digit code'); }
  return (
    <SP title="Two-Factor Auth" onBack={onBack}>
      <div style={{ padding:'28px 20px 100px' }}>
        {/* status card */}
        <div style={{ padding:18, borderRadius:'var(--radius-lg)', background: enabled ? 'linear-gradient(135deg,rgba(31,184,113,0.14),rgba(10,11,13,0))' : 'rgba(255,255,255,0.04)', border: enabled ? '1px solid rgba(31,184,113,0.35)' : '1px solid rgba(255,255,255,0.08)', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:17, color:'#fff', marginBottom:4 }}>Two-Factor Authentication</div>
              <div style={{ font:'var(--role-body-sm)', color: enabled ? 'var(--cs-success-500)' : 'var(--cs-ink-400)' }}>{enabled ? '✓ Enabled — your account is more secure' : 'Disabled — enable for extra security'}</div>
            </div>
            <PToggle on={enabled} onChange={v => { if (!v) { setEnabled(false); setStep('main'); onToast('2FA disabled'); } else setStep('setup'); }} />
          </div>
        </div>
        {step === 'setup' && !enabled && (
          <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:24 }}>
            <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)' }}>Verification Method</div>
            {[{ id:'email', label:'Email OTP', sub:'Code sent to your email address' }, { id:'sms', label:'SMS OTP', sub:'Code sent to your phone number' }].map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background: method===m.id?'rgba(0,182,215,0.10)':'var(--cs-ink-800)', border: method===m.id?'1.5px solid rgba(0,182,215,0.5)':'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', cursor:'pointer', textAlign:'left' }}>
                <span style={{ width:18, height:18, borderRadius:'50%', border:`2px solid ${method===m.id?'var(--cs-cyan-500)':'var(--cs-ink-500)'}`, display:'grid', placeItems:'center', flexShrink:0 }}>
                  {method===m.id && <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--cs-cyan-500)' }} />}
                </span>
                <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:15, color:'#fff' }}>{m.label}</div><div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', marginTop:1 }}>{m.sub}</div></div>
              </button>
            ))}
            <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-300)' }}>We sent a 6-digit code to your {method === 'email' ? 'email' : 'phone'}. Enter it below to verify.</div>
            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
              {Array.from({length:6}).map((_,i) => (
                <input key={i} maxLength={1} value={otp[i]||''} inputMode="numeric"
                  onChange={e => { const d=e.target.value.replace(/\D/g,''); const a=[...otp.padEnd(6,' ')]; a[i]=d; setOtp(a.join('').trimEnd()); }}
                  style={{ width:44, height:52, flexShrink:0, textAlign:'center', fontSize:20, fontWeight:800, fontFamily:'var(--font-heading)', color:'#fff', background:'rgba(255,255,255,0.07)', border:'1.5px solid rgba(255,255,255,0.15)', borderRadius:'var(--radius-sm)', outline:'none' }} />
              ))}
            </div>
            <button onClick={enable} style={{ padding:'13px', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:14, borderRadius:'var(--radius-md)', border:'none', cursor:'pointer' }}>Enable 2FA</button>
          </div>
        )}
        {enabled && <button onClick={() => onToast('Recovery codes downloaded')} style={{ width:'100%', padding:'13px', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, borderRadius:'var(--radius-md)', border:'1px solid rgba(255,255,255,0.12)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}><PP2Icon name="download" size={16} /> Download Recovery Codes</button>}
      </div>
    </SP>
  );
}

/* ─── 9. PRIVACY & PERMISSIONS ───────────────────────────────── */
function PrivacySettings({ onBack, onToast }) {
  const [prefs, setPrefs] = usePP2({ email:true, push:true, marketing:false, promo:false });
  function set(k, v) { setPrefs(p => ({...p, [k]:v})); }
  return (
    <SP title="Privacy & Permissions" onBack={onBack}
      rightAction={<button onClick={() => onToast('Preferences saved!')} style={{ padding:'7px 14px', borderRadius:'var(--radius-pill)', background:'var(--cs-cyan-500)', color:'var(--cs-ink-900)', fontFamily:'var(--font-heading)', fontWeight:800, fontSize:13, border:'none', cursor:'pointer' }}>Save</button>}>
      <div style={{ padding:'22px 20px 100px', display:'flex', flexDirection:'column', gap:22 }}>
        {/* communication */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Communication Preferences</div>
          <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
            {[{ k:'email', label:'Email Notifications', sub:'Booking confirmations & reminders' }, { k:'push', label:'Push Notifications', sub:'App alerts and class updates' }, { k:'marketing', label:'Marketing Messages', sub:'Special offers and promotions' }, { k:'promo', label:'Promotional Offers', sub:'Discounts and new packages' }].map((r,i,arr) => (
              <div key={r.k} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderBottom: i===arr.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ flex:1 }}><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{r.label}</div><div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:2 }}>{r.sub}</div></div>
                <PToggle on={prefs[r.k]} onChange={v => set(r.k, v)} />
              </div>
            ))}
          </div>
        </div>
        {/* data */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:10 }}>Data & Privacy</div>
          <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
            {[{ label:'Download My Data', sub:'Export your account data as a file', action:'Download' }, { label:'Privacy Policy', sub:'How we collect and use your data', action:'View' }, { label:'Terms & Conditions', sub:'Our terms of service', action:'View' }, { label:'Cancellation Policy', sub:'Studio cancellation rules', action:'View' }].map((r,i,arr) => (
              <button key={r.label} onClick={() => onToast(r.action + ': ' + r.label)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'14px 16px', background:'transparent', border:'none', cursor:'pointer', borderBottom: i===arr.length-1?'none':'1px solid rgba(255,255,255,0.06)', textAlign:'left' }}>
                <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'#fff' }}>{r.label}</div><div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:2 }}>{r.sub}</div></div>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color:'var(--cs-ink-500)', flexShrink:0, marginLeft:8 }}><path d="M9 6l6 6-6 6"/></svg>
              </button>
            ))}
          </div>
        </div>
        {/* danger zone */}
        <div>
          <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-danger-500)', marginBottom:10 }}>Account Management</div>
          <div style={{ background:'var(--cs-ink-800)', border:'1px solid rgba(255,59,71,0.22)', borderRadius:'var(--radius-lg)', overflow:'hidden' }}>
            <button onClick={() => onToast('Logging out of all devices…')} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'14px 16px', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.06)', cursor:'pointer', textAlign:'left' }}>
              <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'var(--cs-amber-500)' }}>Logout From All Devices</div><div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:2 }}>Revoke all active sessions</div></div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--cs-amber-500)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
            <button onClick={() => onToast('Deletion request submitted. Team will contact you.')} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'14px 16px', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}>
              <div><div style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14.5, color:'var(--cs-danger-500)' }}>Delete Account</div><div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', marginTop:2 }}>Permanently remove your account</div></div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--cs-danger-500)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </SP>
  );
}

/* ─── 10. MY STUDIO PASS (FULL) ──────────────────────────────── */
function FauxQR2({ size=180, dark='#0A0B0D', light='#fff' }) {
  const n=21, cells=[];
  for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    const finder=(cx,cy)=>x>=cx&&x<cx+7&&y>=cy&&y<cy+7;
    const inF=finder(0,0)||finder(n-7,0)||finder(0,n-7);
    let on; if(inF){const fx=x<7?x:x-(n-7),fy=y<7?y:y-(n-7);const ring=fx===0||fx===6||fy===0||fy===6;const core=fx>=2&&fx<=4&&fy>=2&&fy<=4;on=ring||core;}
    else{on=((x*73+y*137+x*y*17)%100)>52;}
    if(on)cells.push(<rect key={x+'-'+y} x={x} y={y} width="1" height="1" fill={dark}/>);
  }
  return <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} style={{ background:light, borderRadius:10, display:'block', shapeRendering:'crispEdges' }}>{cells}</svg>;
}
function StudioPassFull({ onBack, onToast, user: u }) {
  return (
    <div style={{ position:'absolute', inset:0, zIndex:90, background:'#050608', overflowY:'auto', animation:'profSlide 340ms var(--timing-ease-out) both' }}>
      <style>{`@keyframes profSlide{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      {/* header bg gradient */}
      <div style={{ padding:'56px 20px 28px', background:'radial-gradient(80% 50% at 50% -10%,rgba(0,182,215,0.28) 0%,transparent 60%)', textAlign:'center', borderBottom:'1px solid rgba(255,255,255,0.07)', position:'relative' }}>
        <button onClick={onBack} style={{ position:'absolute', top:58, left:20, display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.14)', padding:'7px 12px', borderRadius:'var(--radius-pill)', cursor:'pointer', color:'var(--cs-ink-200)', fontFamily:'var(--font-heading)', fontWeight:600, fontSize:13 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Back
        </button>
        <div style={{ font:'var(--role-eyebrow)', letterSpacing:'var(--ls-eyebrow)', textTransform:'uppercase', color:'var(--cs-cyan-400)', marginBottom:16 }}>Member Pass</div>
        <image-slot id="profile-avatar" shape="circle" placeholder={u.name[0]} style={{ width:96, height:96, borderRadius:'50%', boxShadow:'0 0 0 3px var(--cs-cyan-500), 0 0 32px rgba(0,182,215,0.4)', display:'inline-block' }}></image-slot>
        <h1 style={{ fontFamily:'var(--font-heading)', fontWeight:800, fontSize:24, color:'#fff', marginTop:14 }}>{u.name}</h1>
        <div style={{ font:'var(--role-body-sm)', fontSize:12.5, color:'var(--cs-ink-400)', fontFamily:'var(--font-body-mono,monospace)', marginTop:4, letterSpacing:'0.08em' }}>CS-MEM-00142</div>
        <div style={{ display:'inline-flex', alignItems:'center', gap:7, marginTop:10, padding:'5px 13px', borderRadius:'var(--radius-pill)', background:'rgba(31,184,113,0.14)', border:'1px solid rgba(31,184,113,0.35)', color:'var(--cs-success-500)', fontFamily:'var(--font-heading)', fontWeight:700, fontSize:12 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--cs-success-500)' }} />Active Member
        </div>
      </div>
      {/* QR section */}
      <div style={{ padding:'28px 20px 20px', display:'flex', flexDirection:'column', alignItems:'center' }}>
        <div style={{ padding:16, background:'#fff', borderRadius:16, boxShadow:'0 0 40px rgba(0,182,215,0.18)', marginBottom:14 }}>
          <FauxQR2 size={180} />
        </div>
        <div style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', textAlign:'center', marginBottom:28 }}>Show this code at the studio reception to check in</div>
        {/* membership info */}
        <div style={{ width:'100%', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-lg)', overflow:'hidden', marginBottom:16 }}>
          {[{ label:'Account Type', val:u.role }, { label:'Active Package', val:'Premium Package' }, { label:'Credits Left', val:`${u.credits} credits` }, { label:'Package Expires', val:'Aug 31, 2026' }].map((r,i,arr) => (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'13px 16px', borderBottom: i===arr.length-1?'none':'1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ font:'var(--role-body-sm)', color:'var(--cs-ink-400)', fontWeight:600 }}>{r.label}</span>
              <span style={{ fontFamily:'var(--font-heading)', fontWeight:700, fontSize:14, color:'#fff' }}>{r.val}</span>
            </div>
          ))}
        </div>
        {/* stats */}
        <div style={{ display:'flex', gap:10, width:'100%', marginBottom:24 }}>
          {[{ val:'18', label:'Total Bookings', tint:'var(--cs-cyan-400)' }, { val:'10', label:'Attended', tint:'var(--cs-success-500)' }, { val:'56%', label:'Attendance', tint:'var(--cs-amber-500)' }].map(s => (
            <div key={s.label} style={{ flex:1, textAlign:'center', padding:'14px 10px', background:'var(--cs-ink-800)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'var(--radius-md)' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:26, color:s.tint, lineHeight:0.9 }}>{s.val}</div>
              <div style={{ font:'var(--role-body-sm)', fontSize:11, color:'var(--cs-ink-400)', marginTop:6 }}>{s.label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

window.PROFILE_PAGES = window.PROFILE_PAGES || {};
Object.assign(window.PROFILE_PAGES, { helpSupport:HelpSupport, changePassword:ChangePassword, emailVerification:EmailVerification, twoFA:TwoFA, privacy:PrivacySettings, studioPass:StudioPassFull });
