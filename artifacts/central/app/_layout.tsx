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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Sentry from "@sentry/react-native";
import * as Updates from "expo-updates";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import FeedbackGate from "@/components/feedback/FeedbackGate";
import PushRegistrationGate from "@/components/PushRegistrationGate";
import { AppContextProvider } from "@/contexts/AppContext";
import { TabVisibilityProvider } from "@/contexts/TabVisibilityContext";

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

function RootLayoutNav() {
  const pathname = usePathname();
  const hideBottomTabs = pathname.startsWith("/class/");

  return (
    <TabVisibilityProvider hideBottomTabs={hideBottomTabs}>
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
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppContextProvider>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <FeedbackGate />
                <PushRegistrationGate />
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </AppContextProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
