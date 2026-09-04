/**
 * Welcome — design `Welcome` (signup-views.jsx). StageVideo background, logo,
 * headline.  Three CTAs (revised product spec):
 *
 *   [Enter As Guest]   — primary cyan button — navigates directly to /(tabs)
 *                        using the app's existing unauthenticated browsing mode.
 *                        No fake guest token; public routes need no credential —
 *                        requests are simply sent without an Authorization header.
 *   [Sign Up]          — ghost button — routes to /auth/register
 *   [Sign In]          — ghost button — routes to /auth/login
 */
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CS, Eyebrow, GhostBtn, PrimaryCTA, StageVideo } from "@/components/signup/SignupKit";
import { useAppContext } from "@/contexts/AppContext";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { setUser } = useAppContext();

  async function enterAsGuest() {
    try {
      await setUser(null);
    } catch (e) {}
    router.replace("/(tabs)" as never);
  }

  function goToSignIn() {
    router.replace("/auth/login" as never);
  }

  return (
    <View style={styles.screen}>
      <StageVideo />

      <View style={[styles.logoWrap, { paddingTop: (Platform.OS === "web" ? 40 : insets.top) + 14 }]}>
        <Image
          source={require("@/assets/images/central_studio_logo.png")}
          style={styles.logo}
          contentFit="contain"
        />
      </View>

      <View style={{ flex: 1 }} />

      <View style={styles.headline}>
        <Eyebrow>Your stage awaits</Eyebrow>
        <Text style={styles.title}>
          Find your{"\n"}
          <Text style={{ color: CS.cyan400 }}>vibe.</Text>
        </Text>
        <Text style={styles.sub}>World-class dance instruction — Hip Hop to Ballet, on your time.</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        {/* Primary — Enter As Guest (unauthenticated browsing, no fake token) */}
        <PrimaryCTA
          label="Enter As Guest"
          icon="arrow"
          onPress={enterAsGuest}
        />

        {/* Secondary row — Sign Up / Sign In */}
        <View style={styles.socialRow}>
          <GhostBtn
            label="Sign Up"
            onPress={() => router.replace("/auth/register")}
          />
          <GhostBtn
            label="Sign In"
            onPress={goToSignIn}
          />
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  logoWrap: { paddingHorizontal: 26 },
  logo: { width: 128, height: 88 },
  headline: { paddingHorizontal: 26, marginBottom: 8 },
  title: { fontFamily: "Anton_400Regular", fontSize: 60, lineHeight: 54, ...iosDisplayTextStyle(60, 54), textTransform: "uppercase", letterSpacing: -0.6, color: "#FFFFFF", marginBottom: 10 - iosCapGuard(60, 54) },
  sub: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "rgba(255,255,255,0.50)", lineHeight: 22, maxWidth: 270 },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 10 },
  socialRow: { flexDirection: "row", gap: 10 },
});
