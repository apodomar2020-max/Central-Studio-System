# Central Studio — Design vs. Implementation Gap Report

**Date:** 2026-06-22
**Design source:** `Central Studio Redesign App/` (Claude Design web prototype + `_ds` token system)
**Implementation:** `artifacts/central` (Expo / React Native, expo-router)
**Areas audited (per your selection):** Home feed · Profile & Booking · Ballet & Signup/Auth

---

## TL;DR

Your app is **much closer to the design than it feels**. The design tokens (`constants/colors.ts`), fonts (Anton / Archivo / Space Mono), and most screens already match the redesign — your "visual parity" commits did real work. The remaining differences are concentrated in **a few specific flows**, not spread evenly everywhere.

The single biggest real gap is the **Signup/Auth flow**: the design has a 4-step onboarding (account → phone OTP → pick dance styles → success) that the app does not implement. Everything else is polish or small structural deltas.

Severity legend: 🔴 missing feature · 🟠 structural/behavioral difference · 🟡 cosmetic polish · 🟢 already matches

---

## 1. Home feed — 🟢 At parity

`app/(tabs)/index.tsx` matches `home-feed.jsx` / `home-feed2.jsx` in structure and order: Header (logo + bell w/ badge + avatar with cyan ring) → Hero carousel → Instructors row → Upcoming classes → Packages → Reels. Components map 1:1 (ClassCard with level/status chips, instructor tag, Book button, credit button; PackageCard with POPULAR badge; auto-play reels).

| Item | Status | Note |
|---|---|---|
| Section order & components | 🟢 | Identical |
| Hero auto-advance + dots | 🟢 | Present |
| Bell ring/glow micro-animation | 🟡 | Design animates the bell every 5s; app uses a static icon + badge |
| Hero `split` / `ticket` variants | 🟢 N/A | These are *design tweak-panel* options only, not required screens |

**Verdict:** No build needed beyond optional bell animation polish.

---

## 2. Profile — 🟢 Strong parity

`app/(tabs)/profile.tsx` faithfully implements `home-profile.jsx`: identity header with verified badge, 3 stat cards (Credits / Upcoming / Attended), Studio Pass with QR + "Full screen", Account group, Attendance history, Children (parent), Activity & support, Privacy & security, Sign Out, version line. All subpages exist (`edit-profile`, `credit-history`, `notifications`, `package-center`, `change-password`, `verify-email`, `help-support`, `privacy-policy`, `my-qr`).

| Item | Status | Note |
|---|---|---|
| Identity / stats / studio pass / menus | 🟢 | Matches |
| All listed subpages exist | 🟢 | Confirmed on disk |
| **Two-Factor Auth screen** | 🟠 | Design (`home-profile-pages2.jsx → TwoFA`) has a real enable flow; app only has the menu row (no dedicated 2FA screen) |
| Child card gender avatars / tints | 🟡 | Design uses gender-tinted ringed avatars (cyan boy / magenta girl) with a small badge; worth verifying the app card matches |

**Verdict:** Optional — build the **Two-Factor Auth** screen; verify child-card styling.

---

## 3. Booking flow — 🟠 Works, but diverges from design

`app/booking/flow.tsx` is a 3-step flow, but differs from `home-booking.jsx`:

| Aspect | Design | App | Status |
|---|---|---|---|
| Step labels | Participant · **Schedule** · **Confirm** | Participant · **Details** · **Payment** | 🟠 |
| Step 2 content | **Session picker** (multiple dates w/ availability; Full → "Join Waitlist") | "Details" step | 🟠 verify session selection exists |
| Payment methods | Use Package Credit · Pay Online · **Pay at Studio** | online · **cash** · packageCredit | 🟠 naming/labels differ |
| Success screen | Display-font "BOOKING CONFIRMED!" + booking-ID + full details table (Branch, Time range, Payment label) | `confirmation.tsx` (271 lines) | 🟠 verify it matches the design's table + typography |
| **Waitlist / failure result screen** | Dedicated `ResultScreen` — "Class is Full", **Waitlist Position #4**, retry CTA | not clearly present | 🔴 likely missing |

**Verdict:** Align step labels + payment labels, and **add the Waitlist/failure result screen**.

---

## 4. Ballet program — 🟢 Built out; assessment differs slightly

All ballet subpages exist (`index`, `levels`, `instructors`, `classes`, `requirements`, `performances`, `faq`, `contact`, `assessment`, `application-status`, `edit-application`) — matching `home-ballet.jsx`.

| Item | Status | Note |
|---|---|---|
| Landing + nav cards + levels/instructors/classes/FAQ/etc. | 🟢 | Present |
| Assessment multi-step form | 🟠 | Design (`home-ballet2.jsx`) opens with an **intro/overview step** ("Complete form → Submit media → Get appointment → Receive result") and ends with a **status timeline**; app's `assessment.tsx` starts at "Parent/Guardian Information". Status is handled in a separate `application-status.tsx`. |

**Verdict:** Optional — add the assessment **intro/overview step**; otherwise at parity.

---

## 5. Signup / Auth — 🔴 Biggest gap

The design's onboarding (`signup-views.jsx`, `signup-views2.jsx`, `signup-screens.jsx`) is a **4-step flow with progress dots**:

1. **Welcome** — stage background video + Apple / Google / Facebook + "continue with email"
2. **Create Account** — name / email / password (`ProgressDots 0/4`)
3. **Verify** — **Phone number → OTP code entry** (`ProgressDots 1/4`)
4. **Pick Styles** — **select favorite dance styles to personalize the feed** (`ProgressDots 2/4`)
5. **Success** — "X styles loaded into your feed" (`ProgressDots 3/4`)

The app has `login.tsx` (video bg + Google/Facebook), `register.tsx` (email + Google/Facebook), `complete-profile.tsx`, and `onboarding/{choose,language}.tsx`.

| Design step | In app? | Status |
|---|---|---|
| Welcome w/ video + social | 🟢 | login.tsx has video + Google/Facebook |
| Email create-account | 🟢 | register.tsx |
| **Phone + OTP verification** | ❌ | 🔴 Missing |
| **"Pick your dance styles" personalization** | ❌ | 🔴 Missing |
| **Signup success screen** ("styles loaded") | ❌ | 🔴 Missing |
| **4-step ProgressDots indicator** | ❌ | 🔴 Missing |
| **Apple Sign-In** | ❌ | 🔴 Missing (Google + Facebook only) |

**Verdict:** This is where most of the perceived "difference" lives. Highest-impact build target.

---

## Recommended build order

1. **Signup/Auth flow** (🔴): add Phone+OTP step, Dance-Styles picker, Success screen, shared ProgressDots; optionally Apple Sign-In.
2. **Booking** (🟠/🔴): align step + payment labels, add Waitlist/failure result screen, match confirmation typography.
3. **Profile** (🟠): build the Two-Factor Auth screen.
4. **Ballet** (🟠): add assessment intro/overview step.

> Note: the redesign is a web prototype (HTML/CSS/JSX via CDN React). It can't be dropped into the Expo app directly — each gap below is re-implemented as React Native components using your existing tokens in `constants/colors.ts` and the loaded fonts. That's the "how to apply both together" piece: treat the prototype as the **spec**, not as code to copy.
