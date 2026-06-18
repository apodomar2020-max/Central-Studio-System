import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppContextProvider } from "@/contexts/AppContext";

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
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding/language" options={{ animation: "fade" }} />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="auth/login"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="auth/register"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="auth/forgot-password"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="auth/reset-password"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
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
      <Stack.Screen name="change-password" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="verify-email" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="privacy-policy" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="help-support" options={{ animation: "slide_from_right" }} />
      {/* DEV-ONLY: design lab — not linked from any production navigation */}
      <Stack.Screen name="dev/design-lab" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
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
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </AppContextProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
