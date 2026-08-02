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
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router, Stack, usePathname, useRootNavigationState, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
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
import { NotificationRoute, resolveNotificationRoute } from "@/services/notificationNavigation";
import { useAndroidHardwareBackGuard } from "@/hooks/useAndroidHardwareBackGuard";
import { useOAuthFlowState } from "@/services/oauthFlowState";

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

Sentry.init({
  dsn: sentryDsn,
  enabled: Boolean(sentryDsn),
  tracesSampleRate: 0,
  sendDefaultPii: false,
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
//   EXPO_PUBLIC_API_KEY=your-secret-key
setBaseUrl(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000");

// Dynamic auth token getter:
//   1. If a student access token (JWT) is stored from a prior login, use it.
//      The server verifies the JWT signature — the mobile app never trusted.
//   2. Otherwise fall back to the shared EXPO_PUBLIC_API_KEY for guest browsing
//      (unauthenticated class listings, packages, etc. still work).
const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? null;
setAuthTokenGetter(async () => {
  try {
    const studentToken = await AsyncStorage.getItem("studentToken");
    if (studentToken) return studentToken;
  } catch {
    // AsyncStorage failure — fall through to API key
  }
  return apiKey;
});

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

function notificationResponseKey(response: Notifications.NotificationResponse): string {
  const notificationId = response.notification.request.identifier;
  const action = response.actionIdentifier;
  const appNotificationId = response.notification.request.content.data?.notificationId;
  return `${notificationId}:${action}:${String(appNotificationId ?? "")}`;
}

function NotificationRoutingGate() {
  const { isLoading, user } = useAppContext();
  const navigationState = useRootNavigationState();
  const processedResponsesRef = useRef<Set<string>>(new Set());
  const pendingRouteRef = useRef<NotificationRoute | null>(null);
  const navigationReady = Boolean(navigationState?.key);
  const canNavigateToNotificationTarget = navigationReady && !isLoading && Boolean(user?.id) && user?.emailVerified === true;

  const queueResponse = useCallback((response: Notifications.NotificationResponse | null) => {
    if (!response?.notification) return;
    const key = notificationResponseKey(response);
    if (processedResponsesRef.current.has(key)) return;
    processedResponsesRef.current.add(key);
    pendingRouteRef.current = resolveNotificationRoute(response.notification.request.content.data);
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Older native modules may not expose this; the local processed set still dedupes.
    }
  }, []);

  useEffect(() => {
    try {
      queueResponse(Notifications.getLastNotificationResponse());
    } catch {
      // Notification response retrieval is best-effort and must not block launch.
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      queueResponse(response);
    });

    return () => {
      subscription.remove();
    };
  }, [queueResponse]);

  useEffect(() => {
    if (!canNavigateToNotificationTarget || !pendingRouteRef.current) return;
    const route = pendingRouteRef.current;
    pendingRouteRef.current = null;
    setTimeout(() => {
      router.push(route as never);
    }, 0);
  }, [canNavigateToNotificationTarget]);

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
  const hideBottomTabs = pathname.startsWith("/class/");

  return (
    <TabVisibilityProvider hideBottomTabs={hideBottomTabs}>
      <AndroidHardwareBackGuard />
      <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding/welcome" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="auth/login"
          options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }}
        />
        <Stack.Screen
          name="auth/register"
          options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }}
        />
        <Stack.Screen
          name="auth/complete-profile"
          options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }}
        />
        <Stack.Screen
          name="auth/forgot-password"
          options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }}
        />
        <Stack.Screen
          name="auth/reset-password"
          options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }}
        />
        <Stack.Screen name="onboarding/children" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/medical" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/styles" options={{ animation: "slide_from_right", gestureEnabled: false }} />
        <Stack.Screen name="onboarding/success" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="class/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="instructor/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="booking/flow" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="booking/confirmation"
          options={{ animation: "fade", gestureEnabled: false }}
        />
        <Stack.Screen
          name="ballet/assessment"
          options={{ animation: "slide_from_right" }}
        />
        <Stack.Screen name="referral" options={{ animation: "slide_from_right" }} />
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
