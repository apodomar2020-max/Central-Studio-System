# Expo Dependency Notes

## Sentry

`@sentry/react-native` is intentionally excluded from `expo install --check`.
The app uses the Sentry Expo config plugin, Sentry Metro config, and runtime
initialization from `@sentry/react-native` v8. Downgrading only to satisfy Expo's
recommended range should be tested with a native preview build first.

## React Type Packages

`@types/react` and `@types/react-dom` are intentionally aligned with the
workspace catalog. Keeping Central on Expo's older recommended type range caused
pnpm to expose duplicate same-version native module peer contexts to
`expo-doctor`. These type packages are development-only and do not change the
native runtime.

## TypeScript

`typescript` is intentionally excluded from `expo install --check`. Expo SDK 56+
recommends `typescript@~6.0`, but TypeScript is a workspace-wide dependency
(`tsconfig.base.json`, api-server, lib/*, the admin/web app) and bumping it to a
new major is out of scope for the mobile SDK upgrade. TypeScript 5.9 type-checks
the SDK 56/57 `.d.ts` set for `artifacts/central` cleanly
(`tsc -p artifacts/central/tsconfig.json --noEmit` passes). Revisit as a
separate, workspace-wide change.

## React / React DOM

`react` and `react-dom` are pinned explicitly in this package's `package.json`
(`19.2.x`) instead of `catalog:`. Expo SDK 55+ requires React 19.2, but the
shared workspace catalog stays on 19.1.0 for the admin/web (Vite) app, which the
mobile SDK upgrade must not touch. Keep these two in sync with the React version
in the target Expo SDK's `bundledNativeModules.json`.

## react-native-fbsdk-next in Expo Go

`react-native-fbsdk-next` is a custom native module and is **not** present in
stock Expo Go. Its JS is import-safe there: every `FB*` module is read as a
plain `NativeModules.FBx` property (resolves to `undefined`, never throws), so
`app/auth/login.tsx` and `app/auth/register.tsx` render normally. Facebook sign
-in is unavailable-but-graceful in Expo Go — `useFacebookSignIn().signIn()`
try/catches the native call path and surfaces a normal error state. Full
Facebook behavior is unchanged on real EAS native builds. Do not convert the
static import to a lazy/guarded one without re-testing the native build.
