# Central Studio Mobile — Expo SDK 54 → 57 Controlled Upgrade

**Branch:** `chore/mobile-expo-sdk-57-upgrade` (created from `origin/main`, not merged)
**Canonical repo:** `apodomar2020-max/Central-Studio-System`
**Scope:** `artifacts/central` only. No backend, no Production website, no OTA, no EAS
builds, no store submission, no auth/security-semantic changes, no force push.

Commits on the branch:

| SHA | Stage |
|---|---|
| `821491e` | baseline (origin/main) |
| `a8e5447` | SDK 54 → 55 (Stage A) |
| `765300f` | SDK 55 → 56 (Stage B) |
| `be5b965` | SDK 56 → 57 (Stage C — final target) |
| _(branch HEAD)_ | `docs(mobile): Expo SDK 54→57 upgrade report + dependency notes` — this commit |

---

## A. Starting Baseline

- **Source SHA:** `821491e261c17a440afe52a61f30b95eebd560b5` — "merge: add public website branches endpoint". `origin/main == HEAD` at branch creation (verified `git fetch`).
- **Working tree:** clean on tracked files. Untracked only: `Md Files/`, a handful of `scripts/*.js|ts` — pre-existing, unrelated, left alone.
- **Mobile project:** `artifacts/central`, pnpm workspace package `@workspace/central`, `main: expo-router/entry`.

### Installed baseline versions (SDK 54)

| Package | Installed | Range in package.json |
|---|---|---|
| expo | 54.0.35 | `~54.0.27` |
| react-native | 0.81.5 | `0.81.5` |
| react / react-dom | 19.1.0 | `catalog:` (workspace catalog pins `19.1.0`, commented "must be exact, expo requires it") |
| expo-router | 6.0.24 | `~6.0.17` |
| expo-updates | 29.0.18 | `~29.0.18` |
| expo-constants | 18.0.13 | `~18.0.11` |
| @expo/cli (dev) | 54.0.23 | `54.0.23` |
| **runtimeVersion** | `{ policy: "appVersion" }` (app.json), `version: "1.0.0"` | — |
| **EAS profiles** | `development`, `preview`, `production` (`appVersionSource: remote`, cli `>= 12.0.0`) | eas.json |
| newArchEnabled | `true` (app.json) | — |

### Baseline validation (SDK 54, before any change)

| Check | Result |
|---|---|
| Mobile Node test suite (`sh ./test-mobile.sh`) | **440 pass / 57 fail** |
| Mobile typecheck (`tsc -p artifacts/central/tsconfig.json --noEmit`) | **PASS** |
| expo-doctor | **17/18** — 1 fail: patch drift inside SDK 54 (expo 54.0.35<54.0.37, expo-file-system, expo-updates, expo-constants) + Sentry prebuild advisory |

The **57 pre-existing test failures** are brittle source-inspection / layout-regex
tests (ballet student card two-column layout, package `paymentMode` assertions,
class-level badge regex, booking unknown-status grouping, ballet child-pill
sources). They are **not SDK-related** and are the regression baseline for every
stage below. Full lists saved during the run.

### Target matrix (from `api.expo.dev/v2/versions/latest`)

| SDK | expo | react-native | react |
|---|---|---|---|
| 54 (from) | 54.0.37 | 0.81.5 | 19.1.0 |
| 55 | 55.0.31 | 0.83.10 | 19.2.0 |
| 56 | 56.0.21 | 0.85.3 | 19.2.3 |
| **57 (target)** | **57.0.20** | **0.86.3** | **19.2.3** |

Expo Go on the App Store: npm `expo` dist-tag `latest` = `57.0.20` — confirmed SDK 57 is current.

---

## B. SDK 54 Dependency Inventory (Expo / native / config plugins)

**Config plugins in play** (`app.json` + `app.config.js`):
`expo-router`, `expo-font`, `expo-web-browser`, `expo-notifications` (custom sound),
`expo-video` (added in `app.config.js`), `react-native-fbsdk-next` (dynamic — Client
Token from env), `@sentry/react-native/expo` (conditional on `SENTRY_ORG/PROJECT`).

**Custom native modules (not first-party Expo):**

| Module | Baseline ver | Import sites |
|---|---|---|
| `react-native-fbsdk-next` | 13.4.3 | `hooks/useFacebookSignIn.ts` (static) ← `app/auth/login.tsx`, `app/auth/register.tsx` |
| `react-native-webview` | 13.15.0 | `components/BotChallenge.tsx` (Turnstile) |
| `react-native-keyboard-controller` | 1.18.5 | `_layout.tsx` (`KeyboardProvider`) + 6 auth/profile screens |
| `lottie-react-native` | 7.3.8 | bookings, classes, ballet classes/performances |
| `react-native-qrcode-svg` | 6.3.21 | `app/my-qr.tsx` |
| `@sentry/react-native` | 8.17.2 | `_layout.tsx`, metro config, expo plugin |
| `expo-updates` | 29.0.18 | `_layout.tsx` |
| `expo-dev-client` | 6.0.21 | native build only |

**Expo-managed first-party modules:** expo-asset, expo-audio, expo-auth-session,
expo-blur, expo-clipboard, expo-constants, expo-crypto, expo-file-system,
expo-font, expo-glass-effect, expo-haptics, expo-image, expo-image-picker,
expo-linear-gradient, expo-linking, expo-location, expo-notifications,
expo-secure-store, expo-splash-screen, expo-status-bar, expo-symbols,
expo-system-ui, expo-video, expo-web-browser.

**Pre-recorded compatibility constraints:**
- `@sentry/react-native` intentionally on v8 and in `expo.install.exclude`
  (`EXPO_DEPENDENCY_NOTES.md`) — SDK bundles `~7.11.0`; not downgraded.
- `@types/react` / `@types/react-dom` in `expo.install.exclude`, aligned to the catalog.
- `pnpm-workspace.yaml` enforces `minimumReleaseAge: 1440` (24 h supply-chain delay) —
  did not block this upgrade (all SDK 55/56/57 versions are months old).
- `react` / `react-dom` come from the shared workspace **catalog** (`19.1.0`), also
  consumed by the admin/web Vite app.

---

## C. SDK 55 Upgrade (Stage A) — commit `a8e5447`

Installed: **expo 55.0.31 · react-native 0.83.10 · react/react-dom 19.2.0 · expo-router 55.0.18 · expo-updates 55.0.30** (+ full expo-\* / RN-ecosystem alignment to SDK 55 `bundledNativeModules.json`).

**Isolation of the React bump:** `react` / `react-dom` changed from `catalog:` to an
explicit `19.2.0` **in `artifacts/central/package.json` only**. The workspace catalog
stays at `19.1.0`, so the admin/web app is untouched.

### Breaking changes resolved

1. **`app.json` — `newArchEnabled` removed.** The New Architecture is the only
   architecture from RN 0.82+; the key is now rejected by the config schema
   (expo-doctor "Expo config schema" check failed until removed).
2. **`app/(tabs)/_layout.tsx` — native-tabs API.** `Icon` and `Label` are no longer
   top-level exports of `expo-router/unstable-native-tabs`; they are namespaced under
   `NativeTabs.Trigger`. Aliased locally (`const Icon = NativeTabs.Trigger.Icon` …) so
   the JSX is unchanged. `src` / `selectedColor` / label children props still valid.
3. **`expo-video` `VideoView` — `allowsFullscreen` removed.** Replaced by
   `fullscreenOptions={{ enable: <bool> }}` in `app/auth/login.tsx` and
   `app/class/[id].tsx`.

### Validation

| Check | Result |
|---|---|
| expo-doctor | **20/20 pass** (was 17/18) |
| tsc (mobile) | **PASS** |
| Mobile test suite | **440 / 57** — `diff` of failing-test set vs baseline **empty → 0 regressions** |
| `expo export --platform ios` (full Metro bundle) | **success**, 9.6 MB hbc, every route, no warnings |

---

## D. SDK 56 Upgrade (Stage B) — commit `765300f`

Installed: **expo 56.0.21 · react-native 0.85.3 · react/react-dom 19.2.3 · expo-router 56.2.20 · expo-updates 56.0.26**.

### Breaking changes resolved

1. **`app.json` — `splash` top-level key removed.** Migrated to the
   `expo-splash-screen` config plugin (same `image` / `resizeMode` / `backgroundColor`).
2. **`StyleSheet.absoluteFillObject` removed in RN 0.85 — runtime *and* types.**
   `{...StyleSheet.absoluteFillObject}` would have become `{...undefined}`, silently
   dropping `position:absolute; inset:0` from ~16 overlay / backdrop / glow styles
   (modals, glass backdrops, hidden OTP input). Renamed every
   `StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill` (now a plain frozen
   spreadable object of identical shape) across **15 files** in `app/` and `components/`.
3. **`app/(tabs)/_layout.tsx` — `tabBarIcon` `color` is now `ColorValue`, not `string`.**
   Widened `NavGlyph`'s `color` prop to `ColorValue` and imported the type. SVG
   `stroke`/`fill` already accept `ColorValue`.
4. **`typescript`** — SDK 56 recommends `~6.0`. That is a workspace-wide major
   (tsconfig.base, api-server, lib/\*, admin app) and out of scope. Added `typescript`
   to `expo.install.exclude`; TS 5.9.3 type-checks the SDK 56/57 `.d.ts` set cleanly.
   Recorded in `EXPO_DEPENDENCY_NOTES.md` as a separate follow-up.

### Validation

| Check | Result |
|---|---|
| expo-doctor | **21/22 pass** — the 1 fail is the **Hermes V1 memory-regression advisory**, whose documented fix is "upgrade to SDK 57"; it clears at Stage C. |
| tsc (mobile) | **PASS** |
| Mobile test suite | **440 / 57** — `diff` vs baseline **empty → 0 regressions** |
| `expo export --platform ios` | **success**, no warnings |

Non-fatal peer warnings introduced by RN 0.85 (`strict-peer-dependencies=false`, harmless):
`@react-native/metro-config` "missing peer" (wanted by `@react-native/community-cli-plugin`
and `react-native-worklets`; the app uses Expo's Metro config via
`@sentry/react-native/metro` → `getSentryExpoConfig`, not the RN community config) and
`@testing-library/dom` "missing peer" (dev-only, via `expo-router` → `@testing-library/user-event`).

---

## E. SDK 57 Upgrade (Stage C — final target) — commit `be5b965`

Installed: **expo 57.0.20 · react-native 0.86.3 · react/react-dom 19.2.3 · expo-router 57.0.19 · expo-updates 57.0.21 · react-native-reanimated 4.5.1 · react-native-worklets 0.10.1 · @sentry/react-native 8.17.2 (kept)**.

**No new breaking changes at the 56 → 57 step.** No source edits were required.

### Validation

| Check | Result |
|---|---|
| expo-doctor | **21/21 pass — no issues detected.** The SDK 56 Hermes V1 advisory is resolved (57.0.20 ships fixed Hermes). |
| tsc (mobile) | **PASS — 0 errors** |
| Mobile test suite | **440 / 57** — `diff` vs baseline **empty → 0 regressions** |
| `expo export --platform ios --platform android` | **both bundles build clean** (iOS 8.8 MB hbc, Android 9.0 MB hbc), **no warnings** — every route resolves through Metro |
| `.expo/types/router.d.ts` (typed routes) regenerated | full route tree present; tsc validates against it |

---

## F. Breaking Changes Resolved (consolidated)

| # | SDK | Area | Fix | Files |
|---|---|---|---|---|
| 1 | 55 | Config schema | Remove `newArchEnabled` | `app.json` |
| 2 | 55 | expo-router native tabs | `Icon`/`Label` → `NativeTabs.Trigger.*` (aliased) | `app/(tabs)/_layout.tsx` |
| 3 | 55 | expo-video | `allowsFullscreen` → `fullscreenOptions={{ enable }}` | `app/auth/login.tsx`, `app/class/[id].tsx` |
| 4 | 56 | Config schema | `splash` → `expo-splash-screen` plugin | `app.json` |
| 5 | 56 | RN 0.85 API removal | `StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill` | 15 files (`app/`, `components/`) |
| 6 | 56 | RN Navigation types | `NavGlyph` `color: string` → `ColorValue` | `app/(tabs)/_layout.tsx` |
| 7 | 56 | Dependency policy | Exclude `typescript` from `expo install` (5.9 kept; TS 6 is a separate workspace change) | `package.json`, `EXPO_DEPENDENCY_NOTES.md` |
| — | 55 | React requirement | Pin `react`/`react-dom` `19.2.x` in this package (catalog stays `19.1.0` → website untouched) | `package.json`, `EXPO_DEPENDENCY_NOTES.md` |

All fixes are compatibility shims. **No auth, crypto, storage, session, or bot-protection
semantics were changed. No security hardening was removed.**

---

## G. Security Baseline Verification

`git diff 821491e..HEAD` over `artifacts/central/services`, `.../hooks`,
`.../components/BotChallenge.tsx`, `.../components/PushRegistrationGate.tsx`,
`.../contexts`, `.../utils` → **empty**. Every security-relevant module is
byte-identical to `main`.

| Behavior | Status | Evidence |
|---|---|---|
| SecureStore Student JWT | **preserved** | `services/secureTokenStorage.ts` unchanged; `expo-secure-store` 57.0.3 (first-party, in Expo Go) |
| No Student JWT in AsyncStorage | **preserved** | storage module unchanged |
| Legacy token migration | **preserved** | unchanged |
| Logout cleanup | **preserved** | unchanged |
| Session-revoked handling | **preserved** | `_layout.tsx` auth-state logic unchanged |
| Deactivated-account handling | **preserved** | `services/accountDeactivation` / `deriveAuthErrorMessage` unchanged; `useFacebookSignIn` B1C path intact |
| Security-01B2 social linking | **preserved** | `useFacebookSignIn.ts` / `useGoogleSignIn.ts` unchanged (`requiresLinkVerification` challenge flow) |
| Turnstile bot protection | **preserved** | `BotChallenge.tsx` unchanged |
| Real HTTPS Turnstile challenge page | **preserved** | still `https://central-studio-website.vercel.app/turnstile-challenge`, no site key in bundle, secret server-side |
| Registration enumeration protection | **preserved** | `tests/auth/passwordRecoveryBotProtection.test.ts` passes |
| Password recovery security | **preserved** | "public recovery calls never attach the student session" test passes |
| Sensitive child / privacy persistence | **preserved** | `tests/profile/*` (child DOB lock, public header redaction) pass |
| Notification registration isolation | **preserved** | `services/pushNotifications.ts` `isExpoGo()` gate unchanged; `PushRegistrationGate` unchanged |

Focused security/auth/notification/privacy test files: **all green** on SDK 57.

---

## H. Expo Router Verification

`expo-router` 6.0.24 → **57.0.19**. `.expo/types/router.d.ts` regenerated; `tsc`
passes against it; `expo export` compiles the whole route tree into the bundle
with no unresolved routes.

| Required route | Present |
|---|---|
| `/` (`app/index.tsx`) | ✅ |
| `/auth/login` | ✅ |
| `/auth/register` | ✅ |
| `/auth/forgot-password` | ✅ |
| `/auth/reset-password` | ✅ |
| `/auth/otp-verification`, `/auth/complete-profile`, `/verify-email` | ✅ |
| onboarding: `/onboarding/welcome|styles|children|medical|success` | ✅ |
| tabs: `/` `/classes` `/bookings` `/packages` `/profile` | ✅ |
| booking: `/booking/[id]`, `/booking/flow`, `/booking/confirmation` | ✅ |
| ballet: `/ballet` + `application-status assessment classes contact edit-application faq instructor/[id] instructors levels performances requirements` | ✅ |
| `/profile`, `/edit-profile`, `/change-password` | ✅ |
| `+not-found` fallback (`app/+not-found.tsx`), `+native-intent` | ✅ present, no `+not-found` regression |

No missing-route or `+not-found` regression at any stage.

---

## I. Expo Go (SDK 57) Native-Module Compatibility

Classification per the task's A/B/C/D scheme:

| Module | Class | Notes |
|---|---|---|
| expo-\* first-party (secure-store, auth-session, web-browser, image, blur, glass-effect, video, haptics, constants, linking, notifications, file-system, crypto, clipboard, splash-screen, symbols, system-ui, font, location, image-picker, linear-gradient) | **A** | In Expo Go SDK 57 |
| `react-native-webview` 13.16.1 | **A** | In SDK 57 `bundledNativeModules`; Turnstile works |
| `react-native-keyboard-controller` 1.21.9 | **A** | In SDK 57 `bundledNativeModules` — safe in Expo Go (used by `_layout.tsx` `KeyboardProvider` + 6 screens) |
| `lottie-react-native` 7.3.8 | **A** | In SDK 57 `bundledNativeModules` |
| `react-native-svg` 15.15.4 / `react-native-qrcode-svg` | **A** | svg bundled; qrcode-svg is pure JS on top |
| `react-native-reanimated` 4.5.1 / `react-native-worklets` 0.10.1 / `react-native-gesture-handler` / `react-native-screens` / `react-native-safe-area-context` | **A** | Bundled |
| `@sentry/react-native` 8.17.2 | **B** | Native absent in Expo Go; Sentry degrades gracefully (JS init no-ops native, warns). `_layout.tsx` init unchanged. |
| `expo-updates` 57.0.21 | **B** | Non-functional in Expo Go by design; JS import-safe; call sites already guarded (`Updates.isEnabled` / `isExpoGo()`) |
| `expo-notifications` 57.0.17 | **B** | Import-safe; remote-push limitations in Expo Go already handled by `isExpoGo()` gate in `services/pushNotifications.ts` + `PushRegistrationGate` |
| **`react-native-fbsdk-next` 13.4.3** | **B** | **Verified import-safe.** Every `FB*` sub-module is read as a plain `NativeModules.FBx` property → `undefined` in Expo Go, **never throws at module load**. No `getEnforcing` / `requireNativeModule` at module scope. `app/auth/login.tsx` and `app/auth/register.tsx` render normally. `useFacebookSignIn().signIn()` try/catches the native call path → surfaces a normal "Could not start Facebook sign-in" error state; the button is not a dead control. Full Facebook behavior unchanged on real EAS builds. |
| `expo-dev-client` 57.0.18 | **D** | Native-build only by design; irrelevant to stock Expo Go |

**Category C (route-crashing on module load): NONE.** No legitimate native
functionality was removed. The dual-platform `expo export` (every route bundled
with no unresolved-module error) corroborates this.

---

## J. Turnstile Status

Architecture **unchanged** by the upgrade:
- `components/BotChallenge.tsx` byte-identical to `main`.
- Still a `react-native-webview` `WebView` pointed at the **real HTTPS challenge page**
  (`https://central-studio-website.vercel.app/turnstile-challenge`, overridable via
  `EXPO_PUBLIC_TURNSTILE_CHALLENGE_URL`).
- **No Turnstile site key in the mobile bundle**; verification secret stays on the API
  server (`artifacts/api-server/src/lib/botProtection.ts`).
- Token is in-memory only, single-use, never persisted/logged.
- `react-native-webview` 13.15.0 → 13.16.1 (SDK 57 bundled version) — no API change
  touching `source={{ uri }}`, `onMessage`, or `window.ReactNativeWebView.postMessage`.

**No Turnstile workaround was mixed into this upgrade.** No SDK 57 WebView regression
was observed in bundling/type-checking. Whether the *rendered* iOS Turnstile behaviour
in the **current** Expo Go changes is an owner on-device check (Section M, step 8) —
the existing Production challenge URL + push-diagnostics remain authoritative.

---

## K. Automated Tests (final SDK 57 state)

| Suite | Baseline (SDK 54) | SDK 57 | New regressions |
|---|---|---|---|
| Mobile Node test suite (`sh ./test-mobile.sh`) | 440 pass / 57 fail | **440 pass / 57 fail** | **0** — failing-test-name set is `diff`-identical to baseline |
| Focused security / auth (`tests/auth/**`) | pass | **pass** | 0 |
| Notifications (`tests/notifications/**`) | pass | **pass** | 0 |
| Profile / privacy (`tests/profile/**`) | pass | **pass** | 0 |
| Booking / Ballet / classes / navigation | same pre-existing failures | **same** | 0 |

**Pre-existing failures (NOT SDK 57 regressions)** — 57 test instances / 29 unique
names, all brittle source-inspection or layout-regex assertions:
ballet student preview card two-column surface & artwork-flush layout;
`packagePurchaseChannel` `paymentMode: "pay_at_studio"`;
`class/[id]` level-badge regex; booking "unknown status" grouping/label;
"My Ballet Classes" child-pill source equality; ballet selector single-child;
applications authoritative-refresh; F-17 assessment-fee copy boundary;
`diffColor` input-mapping test. These fail identically on `main`.

- **TypeScript:** `tsc -p artifacts/central/tsconfig.json --noEmit` → **PASS**.
- **ESLint:** not configured for `artifacts/central` (no eslint config, no lint script) → **N/A**.
- **expo-doctor:** **21/21 pass**.
- **Expo config:** `expo config --type public` resolves; schema check passes.
- **Metro bundle:** `expo export` iOS + Android → **success, no warnings**.

---

## L. Expo Doctor / TypeScript (per stage)

| Stage | expo-doctor | tsc (mobile) |
|---|---|---|
| Baseline SDK 54 | 17/18 (patch drift + Sentry note) | PASS |
| SDK 55 | **20/20** | PASS (after 3 fixes) |
| SDK 56 | **21/22** (Hermes V1 advisory → "go to 57") | PASS (after 3 fixes) |
| **SDK 57** | **21/21 — no issues** | **PASS (no fixes needed)** |

**Persistent informational note (all stages, not a check failure):**
`[@sentry/react-native/expo] Sentry native configuration is missing from your
prebuilt iOS project. Run npx expo prebuild --clean`. This is triggered by a
stale local (git-ignored, untracked) `artifacts/central/ios/` folder. It is
**irrelevant to Expo Go** and to EAS (EAS runs a clean prebuild). Addressed in
Section N as part of the later native-rebuild step.

---

## M. Owner Expo Go Test Instructions

**Do not merge. Do not publish OTA.** Automated validation has passed far enough
for on-device QA.

```bash
cd artifacts/central
npx expo start -c
```

Open the project in the **current App Store Expo Go (SDK 57)** on the physical iPhone
and walk through:

1. **App loads** — Metro bundles, splash → app, no red screen.
2. **Home** (`/` tab) renders.
3. **Sign In** (`/auth/login`) — screen renders; background video plays; email/password fields usable.
4. **Sign Up** (`/auth/register`) — screen renders (this is the route most at risk from `react-native-fbsdk-next`; it is expected to render fine — see Section I).
5. **Email auth UI** — validation, error states, keyboard handling (`react-native-keyboard-controller` is in Expo Go).
6. **Google flow** — `expo-auth-session` proxy flow where Expo Go supports it.
7. **Facebook button** — expected **graceful unavailable** state in Expo Go: pressing it surfaces a normal error, no crash, no "This screen doesn't exist".
8. **Register / Turnstile** — the WebView challenge page loads over HTTPS and returns a token; confirm iOS Turnstile still renders as before in the newer Expo Go.
9. **Forgot Password** (`/auth/forgot-password` → OTP → reset) — all steps render; bot token attached.
10. **Tabs / navigation** — Home / Classes / My Bookings / Profile switch; deep links into `/booking/*`, `/ballet/*`, `/edit-profile`, `/my-qr` work; no `+not-found`.

Expected caveats in Expo Go (by design, unchanged): Facebook login unavailable;
push-notification registration skipped (`isExpoGo()` gate); `expo-updates` inert;
Sentry native crash reporting inactive (JS breadcrumbs still work).

---

## N. Native Build / Runtime Impact

- **SDK 57 changes the native runtime** (RN 0.81 → 0.86, new Hermes, New Architecture
  now mandatory). **Existing EAS builds (SDK 54) must not receive SDK 57 JS.** No OTA
  was published; no EAS build was created — as required.
- **When this ships:** new **iOS and Android native binaries must be built** (EAS
  `development` for dev-client testing, then `preview`, then `production`). Not done
  here — deliberately deferred to the release step.
- **`runtimeVersion` audit (Section 11):** policy is `{ policy: "appVersion" }`,
  `version: "1.0.0"`, `eas.json` `appVersionSource: "remote"`. **Not changed.** But
  note: with the native runtime now incompatible with the SDK 54 binaries, the first
  post-upgrade release **must** carry a new `appVersion` (so `runtimeVersion` changes
  and OTA payloads can never be delivered to an SDK 54 build), **or** switch to
  `{ policy: "fingerprint" }`. Recommend `fingerprint` going forward so native/JS
  runtime drift is tracked automatically. This is a release-time decision, flagged
  here, not actioned.
- **Stale local `artifacts/central/ios/`** (git-ignored, untracked): safe to delete;
  EAS/`expo prebuild --clean` regenerates it from `app.json` + `app.config.js` at
  build time. The Sentry plugin will be applied by that clean prebuild.
- **Config plugins** unchanged: `react-native-fbsdk-next`, `@sentry/react-native/expo`,
  `expo-splash-screen` (new), `expo-notifications`, `expo-video`, `expo-router`,
  `expo-font`, `expo-web-browser`. All resolve under SDK 57 (`expo config` passes).

---

## O. Files / Commits

### Commits (branch `chore/mobile-expo-sdk-57-upgrade`)

- `a8e5447` — SDK 54 → 55 (Stage A)
- `765300f` — SDK 55 → 56 (Stage B)
- `be5b965` — SDK 56 → 57 (Stage C)
- **branch HEAD** — `docs(mobile): Expo SDK 54→57 upgrade report + dependency notes`
  (`EXPO_DEPENDENCY_NOTES.md` updates + this report). This is the current tip of
  `chore/mobile-expo-sdk-57-upgrade`; its SHA is reported alongside this file at
  delivery.

### Source files changed (cumulative, vs `821491e`)

| File | Change |
|---|---|
| `artifacts/central/package.json` | expo-\* / RN dep versions → SDK 57; `react`/`react-dom` pinned `19.2.3` (off catalog); `typescript` added to `expo.install.exclude` |
| `artifacts/central/app.json` | removed `newArchEnabled`; `splash` block → `expo-splash-screen` plugin |
| `artifacts/central/app/(tabs)/_layout.tsx` | native-tabs `Icon`/`Label` aliasing; `NavGlyph` `color: ColorValue` |
| `artifacts/central/app/auth/login.tsx` | `VideoView` `fullscreenOptions` |
| `artifacts/central/app/class/[id].tsx` | `VideoView` `fullscreenOptions` |
| `artifacts/central/app/(tabs)/index.tsx`, `app/auth/forgot-password.tsx`, `app/auth/otp-verification.tsx`, `app/ballet/index.tsx`, `app/ballet/performances.tsx`, `app/change-password.tsx`, `app/dev/design-lab.tsx`, `components/BookingCard.tsx`, `components/BookingDetailsView.tsx`, `components/DiscoveryClassCard.tsx`, `components/ProfileSelectField.tsx`, `components/SplashSceneGate.tsx`, `components/ballet/BalletScheduleCard.tsx`, `components/feedback/FeedbackModal.tsx`, `components/ui/CentralAlertDialog.tsx` | `StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill` |
| `artifacts/central/EXPO_DEPENDENCY_NOTES.md` | TypeScript / React-pin / fbsdk-in-Expo-Go rationale |
| `pnpm-lock.yaml` | regenerated |
| `MOBILE_EXPO_SDK_57_UPGRADE_REPORT.md` | this report |

No changes outside `artifacts/central/` except `pnpm-lock.yaml` and this report.
The workspace **catalog was not modified** → admin/web app, api-server, lib/\* untouched.

---

## P. Verdict

# Expo SDK 57 Upgrade = READY FOR OWNER EXPO GO QA

- Sequential 54 → 55 → 56 → 57, a validated checkpoint committed at each stage.
- Final state: **expo-doctor 21/21**, **mobile tsc PASS**, **mobile tests 440/57 with
  0 new regressions** (57 pre-existing failures unchanged from `main`), **iOS + Android
  Metro bundles build clean**.
- Every required route present; no `+not-found` regression.
- Security baseline byte-identical to `main` and re-verified by the focused test files —
  SecureStore JWT, token migration, session-revoked / deactivated handling,
  Security-01B2 linking, Turnstile (real HTTPS page, no bundle key), enumeration /
  recovery protection, notification isolation.
- Expo Go native-module audit: **no Category C**. `react-native-fbsdk-next` is
  import-safe; Facebook is unavailable-but-graceful; auth routes render.
- Turnstile architecture untouched; no bot-protection bypass.

**Remaining before production release (NOT part of this task):**
1. Owner on-device QA in the current Expo Go (Section M).
2. New EAS native builds — iOS + Android — for `development` → `preview` → `production`
   (Section N). SDK 57 native runtime is not compatible with the existing SDK 54 binaries.
3. `runtimeVersion` decision at release: bump `appVersion` or switch to `fingerprint`.
4. Optional follow-ups: workspace-wide TypeScript 6 bump; delete stale local `ios/`.

**Not done, per instructions:** no merge to `main`, no OTA publish, no Production EAS
builds, no store submission, no force push, no backend/website/auth-semantic changes.
