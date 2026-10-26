import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Anton_400Regular } from "@expo-google-fonts/anton";
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from "@expo-google-fonts/archivo";
import { SpaceMono_400Regular, SpaceMono_700Bold } from "@expo-google-fonts/space-mono";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import Constants from "expo-constants";
// Type-only: erased at compile time, so this never pulls the native
// `expo-notifications` module into the startup bundle. In stock Expo Go
// (SDK 53+) that module's require throws during evaluation — see
// services/notificationsRuntime.ts. All runtime access goes through the
// import-safe lazy loader below.
import type { NotificationResponse } from "expo-notifications";
import { router, Stack, useNavigationContainerRef, usePathname, useRootNavigationState, useSegments } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useReducer, useEffect, useLayoutEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { AUTH_MODAL_SCREENS, completedAuthModalHistory, normalRoutePresentation } from "@/utils/iosAuthModalHistory";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import FeedbackGate from "@/components/feedback/FeedbackGate";
import PushRegistrationGate from "@/components/PushRegistrationGate";
import { BackgroundMusicProvider } from "@/components/BackgroundMusicProvider";
import { SplashSceneGate } from "@/components/SplashSceneGate";
import { AppContextProvider } from "@/contexts/AppContext";
import { useAppContext } from "@/contexts/AppContext";
import { TabVisibilityProvider } from "@/contexts/TabVisibilityContext";
import { CentralAlertProvider } from "@/providers/CentralAlertProvider";
import { initialNotificationIntentState, notificationIntentReducer, notificationIntentRoute, notificationNavigationReady } from "@/services/notificationIntent";
import { customFetch } from "@workspace/api-client-react";
import { ensureNotificationHandler, loadExpoNotifications } from "@/services/notificationsRuntime";
import { scrubCrashEvent } from "@/services/telemetryPrivacy";
import { useAndroidHardwareBackGuard } from "@/hooks/useAndroidHardwareBackGuard";
import { useOAuthFlowState } from "@/services/oauthFlowState";
import { getStudentToken } from "@/services/secureTokenStorage";

type ExpoManifestWithUpdateMetadata = {
  extra?: {
    expoClient?: {
      owner?: string;
      slug?: string;
    };
  };
  metadata?: {
    updateGroup?: string;
  };
};

const sentryDsn = (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn;
const updatesManifest = Updates.manifest as ExpoManifestWithUpdateMetadata | null;
const updateGroup = updatesManifest?.metadata?.updateGroup;
const expoOwner = updatesManifest?.extra?.expoClient?.owner ?? Constants.expoConfig?.owner;
const expoSlug = updatesManifest?.extra?.expoClient?.slug ?? Constants.expoConfig?.slug;

// The foreground-presentation handler used to be installed here at module
// scope via a static `expo-notifications` import — the exact call that
// crashed stock Expo Go. It now runs from NotificationRoutingGate's effect
// through the import-safe lazy loader (no-op in Expo Go, unchanged in EAS
// builds).

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubCrashEvent,
});

Sentry.setTag("expo-update-id", Updates.updateId ?? "embedded");
Sentry.setTag("expo-is-embedded-update", String(Updates.isEmbeddedLaunch));

if (typeof updateGroup === "string") {
  Sentry.setTag("expo-update-group-id", updateGroup);
  if (expoOwner && expoSlug) {
    Sentry.setTag("expo-update-debug-url", `https://expo.dev/accounts/${expoOwner}/projects/${expoSlug}/updates/${updateGroup}`);
  }
} else if (Updates.isEmbeddedLaunch) {
  Sentry.setTag("expo-update-debug-url", "not applicable for embedded updates");
}

if (__DEV__) {
  (globalThis as typeof globalThis & { __centralTestSentry?: () => void }).__centralTestSentry = () => {
    Sentry.captureException(new Error("Central Studio Sentry test error"));
  };
}

SplashScreen.preventAutoHideAsync();

// Completes the OAuth redirect (Google Sign-In) when the app regains focus.
WebBrowser.maybeCompleteAuthSession();

// Point the generated API client at the backend.
// Override via env vars in your .env.local file (never commit secrets):
//   EXPO_PUBLIC_API_URL=https://your-api.example.com
setBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000");

// Dynamic auth token getter:
//   If a student access token (JWT) is stored from a prior login, use it.
//   The server verifies the JWT signature — the mobile app never trusted.
//   Otherwise return null so no Authorization header is sent — unauthenticated
//   class listings, packages, etc. are public routes and need no credential.
// Security Wave — Mobile SecureStore / Privacy Hardening: the token now
// lives in SecureStore (Keychain/Keystore), not AsyncStorage — see
// services/secureTokenStorage.ts, the single source of truth for this
// value (read/write/clear/legacy-migration all live there).
setAuthTokenGetter(async () => getStudentToken());

const queryClient = new QueryClient();

// Finance Batch 1 (Part B2): React Query's `refetchOnWindowFocus` does
// nothing on React Native — there is no browser window-focus event — so
// without this, every screen using a generated `useGetMy*` query hook
// (Credit History, package center, etc.) can show a stale credit balance
// until its own unrelated refetch trigger happens to fire. Wiring
// `focusManager` to AppState is the standard React Query React Native
// integration: it makes `refetchOnWindowFocus` (already query-client
// default) actually fire when the app returns to the foreground, for every
// query in the app, without touching each screen individually.
function onAppStateChange(status: AppStateStatus): void {
  focusManager.setFocused(status === "active");
}

const ANDROID_HARDWARE_BACK_PROTECTED_ROUTES = new Set([
  "auth/login",
  "auth/register",
  "auth/complete-profile",
  "auth/forgot-password",
  "auth/otp-verification",
  "auth/reset-password",
  "verify-email",
  "onboarding/children",
  "onboarding/medical",
  "onboarding/styles",
  "onboarding/success",
]);

function routeKeyFromSegments(segments: string[]) {
  return segments.join("/") || "index";
}

function notificationResponseKey(response: NotificationResponse): string {
  const notificationId = response.notification.request.identifier;
  const action = response.actionIdentifier;
  const appNotificationId = response.notification.request.content.data?.notificationId;
  return `${notificationId}:${action}:${String(appNotificationId ?? "")}`;
}

function NotificationRoutingGate() {
  const { isLoading, user } = useAppContext();
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const segments = useSegments();
  const [intent, dispatch] = useReducer(notificationIntentReducer, initialNotificationIntentState);
  const currentAccountRef = useRef(user?.id ?? null);
  currentAccountRef.current = user?.id ?? null;
  const previousAccountRef = useRef(user?.id ?? null);
  useEffect(() => {
    if (isLoading) return;
    if (previousAccountRef.current !== (user?.id ?? null)) {
      queryClient.clear();
      if (previousAccountRef.current && intent.pending) {
        const discardedKey = intent.pending.key;
        void loadExpoNotifications().then(Notifications => {
          const last = Notifications?.getLastNotificationResponse();
          if (last && notificationResponseKey(last) === discardedKey) Notifications?.clearLastNotificationResponse();
        }).catch(() => {});
      }
    }
    previousAccountRef.current = user?.id ?? null;
    if (!isLoading) dispatch({ type: "session", account: user?.id ?? null });
  }, [isLoading, user?.id, intent.pending]);
  const canNavigateToNotificationTarget = notificationNavigationReady(isLoading, user?.id ?? null,
    user?.emailVerified === true, Boolean(navigationState?.key), pathname, segments[0] === "(tabs)");

  const queueResponse = useCallback(
    (Notifications: Awaited<ReturnType<typeof loadExpoNotifications>>, response: NotificationResponse | null) => {
      if (!response?.notification || response.actionIdentifier !== Notifications?.DEFAULT_ACTION_IDENTIFIER) return;
      dispatch({ type: "receive", key: notificationResponseKey(response), data: response.notification.request.content.data });
    }, [],
  );

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    void (async () => {
      // Foreground presentation handler — real builds only, once. No-op in Expo Go.
      await ensureNotificationHandler();

      // Expo Go (SDK 53+) has no expo-notifications native module: the loader
      // returns null and notification listeners / response replay are skipped.
      // Notification-history UI and every other route still render normally.
      const Notifications = await loadExpoNotifications();
      if (cancelled || !Notifications) return;

      try {
        queueResponse(Notifications, Notifications.getLastNotificationResponse());
      } catch {
        // Notification response retrieval is best-effort and must not block launch.
      }

      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        queueResponse(Notifications, response);
      });
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [queueResponse]);

  useEffect(() => {
    const pending = intent.pending;
    const account = user?.id;
    if (!canNavigateToNotificationTarget || !pending || !account || intent.account !== account || pending.owner !== account) return;
    let cancelled = false;
    void (async () => {
      const route = await notificationIntentRoute(pending.data, () => customFetch("/api/notifications/my?limit=100&offset=0"));
      if (cancelled || currentAccountRef.current !== account) return;
      // Auth/index redirects have left their routes before this effect can run.
      // A duplicate destination rejected by pushOnce is already being navigated to.
      try {
        pushOnce(route as never);
        dispatch({ type: "consume", key: pending.key });
        const Notifications = await loadExpoNotifications();
        const last = Notifications?.getLastNotificationResponse();
        if (last && notificationResponseKey(last) === pending.key) Notifications?.clearLastNotificationResponse();
      } catch {
        // Keep the native response for a subsequent launch if navigation fails.
      }
    })();
    return () => { cancelled = true; };
  }, [canNavigateToNotificationTarget, intent.pending, intent.account, user?.id, pathname]);

  return null;
}

function AndroidHardwareBackGuard() {
  const segments = useSegments();
  const oauthFlowState = useOAuthFlowState();
  const routeKey = routeKeyFromSegments([...segments]);
  const oauthInProgress = oauthFlowState !== "idle";
  const shouldBlock = ANDROID_HARDWARE_BACK_PROTECTED_ROUTES.has(routeKey) || oauthInProgress;

  // Android hardware Back is independent from stack gesture prevention; consume
  // it only for auth/OAuth/onboarding routes whose exits are explicit in-app CTAs.
  useAndroidHardwareBackGuard(shouldBlock);

  return null;
}

function RootLayoutNav() {
  const pathname = usePathname();
  const navigation = useNavigationContainerRef();
  const hideBottomTabs = pathname.startsWith("/class/") || pathname.startsWith("/booking/");

  useLayoutEffect(() => {
    if (Platform.OS !== "ios") return;
    const reconcile = () => {
      if (!navigation.isReady()) return;
      // Read current state on each action; never reset a captured destination.
      const nextState = completedAuthModalHistory(navigation.getRootState(), Platform.OS);
      if (nextState) navigation.resetRoot(nextState);
    };
    const unsubscribe = navigation.addListener("state", reconcile);
    reconcile();
    return unsubscribe;
  }, [navigation]);

  return (
    <TabVisibilityProvider hideBottomTabs={hideBottomTabs}>
      <AndroidHardwareBackGuard />
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", ...normalRoutePresentation(Platform.OS) }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding/welcome" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" />
        {AUTH_MODAL_SCREENS.map(({ name, animation }) => (
          <Stack.Screen key={name} name={name} options={{ presentation: "modal", animation, gestureEnabled: false }} />
        ))}
        <Stack.Screen name="onboarding/children" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/medical" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/styles" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/success" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="class/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="instructor/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="booking/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="booking/flow" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="booking/confirmation"
          options={{ animation: "fade", gestureEnabled: false }}
        />
        <Stack.Screen
          name="ballet/assessment"
          options={{ animation: "slide_from_right" }}
        />
        <Stack.Screen name="notifications" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="edit-profile" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="change-password" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="verify-email" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="privacy-policy" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="help-support" options={{ animation: "slide_from_right" }} />
        {/* DEV-ONLY: design lab — not linked from any production navigation */}
        <Stack.Screen name="dev/design-lab" options={{ animation: "slide_from_right" }} />
      </Stack>
    </TabVisibilityProvider>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Anton_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    Archivo_900Black,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    ...Ionicons.font,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <CentralAlertProvider>
          <AppContextProvider>
            <SplashSceneGate fontsLoaded={fontsLoaded || Boolean(fontError)}>
              <QueryClientProvider client={queryClient}>
                <GestureHandlerRootView>
                  <KeyboardProvider>
                    <BackgroundMusicProvider>
                      <FeedbackGate />
                      <PushRegistrationGate />
                      <NotificationRoutingGate />
                      <RootLayoutNav />
                    </BackgroundMusicProvider>
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </QueryClientProvider>
            </SplashSceneGate>
          </AppContextProvider>
        </CentralAlertProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
