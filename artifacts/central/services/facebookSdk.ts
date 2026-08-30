/**
 * Lazy, environment-guarded access to `react-native-fbsdk-next`.
 *
 * WHY THIS EXISTS
 *
 * `react-native-fbsdk-next` is a CUSTOM native module wired in through a
 * config plugin (see app.config.js). It exists only in binaries we build
 * ourselves — EAS development / preview / production. It is NOT part of
 * Expo Go's fixed native module set, and its entry module throws while
 * being evaluated when the native side is missing.
 *
 * `hooks/useFacebookSignIn.ts` used to import it at module scope. Because
 * that hook is imported by `app/auth/login.tsx` and `app/auth/register.tsx`
 * — and by nothing else — those two route modules failed to evaluate under
 * Expo Go, so Expo Router could not resolve their default export and served
 * `app/+not-found.tsx` instead: "This screen doesn't exist", on exactly
 * Sign In and Sign Up, while every other screen worked. Android was
 * unaffected because it runs a real EAS build with the SDK compiled in.
 *
 * The fix is to never touch the module during route evaluation. Nothing
 * here runs at import time; the SDK is resolved on first actual use, and
 * only in a runtime that can support it.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not make Facebook login work in Expo Go — that is impossible
 * without the native SDK, and no browser/implicit-flow fallback is
 * attempted (that would move token handling somewhere less safe and change
 * what the backend is asked to verify). Facebook sign-in is simply reported
 * as unavailable so the UI can disable the button. In every real build the
 * SDK loads and behaviour is byte-for-byte what it was before.
 */
import Constants from "expo-constants";

/**
 * Expo Go reports `appOwnership === "expo"`; any binary we build reports
 * "standalone" (or null under a dev client). Same check `services/
 * pushNotifications.ts` already uses for the identical "custom native
 * module absent" problem — kept consistent rather than inventing a second
 * notion of "are we in Expo Go".
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

/** The only two pieces of the SDK this app uses. */
export type FacebookSdk = {
  LoginManager: {
    logInWithPermissions(permissions: string[]): Promise<{ isCancelled: boolean }>;
  };
  AccessToken: {
    getCurrentAccessToken(): Promise<{ accessToken: string } | null>;
  };
};

// `undefined` = not resolved yet, `null` = resolved and unavailable.
let cached: FacebookSdk | null | undefined;

/**
 * Returns the SDK, or null when this runtime cannot provide it.
 *
 * The `require` is deliberate rather than a dynamic `import()`: Metro still
 * sees it statically, so the module is bundled normally for real builds,
 * but it is only EVALUATED when this function is actually called. The
 * `isExpoGo()` short-circuit means we never even attempt the require in
 * Expo Go, and the try/catch covers any other runtime where the native
 * side is missing.
 */
export function loadFacebookSdk(): FacebookSdk | null {
  if (cached !== undefined) return cached;
  if (isExpoGo()) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("react-native-fbsdk-next") as FacebookSdk;
  } catch {
    cached = null;
  }
  return cached;
}

/** True only when Facebook sign-in can actually run in this runtime. */
export function isFacebookSdkAvailable(): boolean {
  return loadFacebookSdk() !== null;
}

/** Test-only: clears the memoized result so each case resolves fresh. */
export function __resetFacebookSdkCacheForTests(): void {
  cached = undefined;
}
