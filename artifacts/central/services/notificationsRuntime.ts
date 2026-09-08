/**
 * Import-safe access layer for `expo-notifications`.
 *
 * WHY THIS EXISTS
 * --------------------------------------------------------------------------
 * Since Expo SDK 53 the `expo-notifications` **native module is not present
 * in stock Expo Go**. Its JS entry (`expo-notifications/build/index.js`)
 * re-exports `./NotificationsEmitter` and `./NotificationsHandler`, both of
 * which run at *module-evaluation* time:
 *
 *     import NotificationsEmitterModule from './NotificationsEmitterModule';
 *     const emitter = new LegacyEventEmitter(NotificationsEmitterModule);
 *
 * On a device `./NotificationsEmitterModule` resolves to its `.native.js`
 * variant, which is:
 *
 *     export default requireNativeModule('ExpoNotificationsEmitter');
 *
 * `requireNativeModule()` **throws synchronously** ("Cannot find native
 * module 'ExpoNotificationsEmitter'") when the native module is missing — so
 * in Expo Go a plain `import ... from "expo-notifications"` throws while the
 * importing module is still evaluating. When that importing module is a route
 * (`app/_layout.tsx`, `app/notifications.tsx`) Expo Router then reports
 * "missing the required default export" and "Cannot read property
 * 'ErrorBoundary' of undefined" as cascading fallout.
 *
 * (The separate console warning that names "Android Push notifications ...
 * removed from Expo Go" is `warnOfExpoGoPushUsage()` — on iOS it only
 * `console.warn`s and is *not* the crash; on Android it throws. It hardcodes
 * the word "Android" in its text regardless of the running platform.)
 *
 * SAME PRINCIPLE AS THE NATIVE FACEBOOK SDK: Expo Go must not crash merely
 * because a native-only capability is reachable from the import graph. So
 * nothing here statically imports `expo-notifications`; env detection is
 * import-safe, and the module is only `import()`-ed inside guarded runtime
 * paths, never in Expo Go.
 *
 * Real EAS development / preview / production binaries bundle the native
 * module — `loadExpoNotifications()` resolves normally there and every
 * existing registration / listener / navigation path is unchanged.
 */
import Constants from "expo-constants";

export type ExpoNotificationsModule = typeof import("expo-notifications");

/**
 * Import-safe. Reads only an `expo-constants` field — never touches
 * `expo-notifications`. `"expo"` app ownership === running inside Expo Go.
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

let modulePromise: Promise<ExpoNotificationsModule | null> | null = null;

/**
 * Lazily load `expo-notifications`.
 *
 * - Returns `null` immediately in Expo Go (the dynamic `import()` is never
 *   even attempted there, so the throwing native-module require never runs).
 * - Returns `null` (not a rejection) if the import fails for any other
 *   reason, so callers can treat "unavailable" uniformly without a
 *   broad try/catch that could also swallow unrelated errors.
 * - Caches the in-flight / resolved module so repeated calls share one import.
 */
export function loadExpoNotifications(): Promise<ExpoNotificationsModule | null> {
  if (isExpoGo()) return Promise.resolve(null);
  if (!modulePromise) {
    modulePromise = import("expo-notifications").catch((error) => {
      if (__DEV__) {
        console.warn("[notifications] expo-notifications module load failed", error);
      }
      modulePromise = null;
      return null;
    });
  }
  return modulePromise;
}

let handlerInstalled = false;

/**
 * Install the foreground-presentation handler exactly once, in real builds
 * only. No-op in Expo Go (module unavailable). Previously this ran at module
 * scope in `app/_layout.tsx` — which is exactly what crashed Expo Go.
 */
export async function ensureNotificationHandler(): Promise<void> {
  if (handlerInstalled) return;
  const Notifications = await loadExpoNotifications();
  if (!Notifications) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Test-only: reset memoised state between cases. */
export function __resetNotificationsRuntimeForTests(): void {
  modulePromise = null;
  handlerInstalled = false;
}
