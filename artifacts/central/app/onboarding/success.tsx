/**
 * Success — design `Success` (signup-views2.jsx). Final onboarding screen
 * ("Thanks Page"). "You're in!" with the dancer's name + loaded-styles count.
 *
 * This screen is the single handoff point out of onboarding: its CTA calls
 * the shared `enterApp()` (services/authProfile.ts), which defers to the
 * root index redirect rather than hardcoding a destination here. That keeps
 * this screen forward-compatible with the upcoming backend-driven Profile
 * Completion Engine — the engine can change where `enterApp()`/index.tsx
 * send the user without this screen needing to change.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { STORAGE_KEYS } from "@/constants/danceStyles";
import { useAppContext } from "@/contexts/AppContext";
import { enterApp } from "@/services/authProfile";
import { CS, Eyebrow, Icon, PrimaryCTA, StageVideo } from "@/components/signup/SignupKit";
import { SuccessConfetti, useSuccessPopHaptic } from "@/components/success/SuccessCelebration";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

export default function OnboardingSuccessScreen() {
  const insets = useSafeAreaInsets();
  const { user, setIsOnboarded } = useAppContext();
  const [styleCount, setStyleCount] = useState(0);
  const pop = useSuccessPopHaptic();

  const firstName =
    (user?.fullName?.trim().split(/\s+/)[0] || user?.email?.split("@")[0] || "dancer").replace(/[^a-z0-9 ]/gi, "") || "dancer";

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.danceStyles);
      if (raw) { try { const a = JSON.parse(raw); setStyleCount(Array.isArray(a) ? a.length : 0); } catch { setStyleCount(0); } }
    })();
  }, []);

  async function handleEnterApp() {
    await setIsOnboarded(true);
    // Future Profile Completion Engine handoff point — see enterApp() in
    // services/authProfile.ts. Do not hardcode a route here.
    await enterApp();
  }

  return (
    <View style={styles.screen}>
      <StageVideo />
      <SuccessConfetti />

      <View style={styles.body}>
        <Animated.View style={[styles.ring, { transform: [{ scale: pop }] }]}>
          <Icon name="check" size={40} stroke={3} color={CS.ink900} />
        </Animated.View>
        <Eyebrow>You're on the list</Eyebrow>
        <Text style={styles.title}>
          You're{"\n"}
          <Text style={{ color: CS.cyan400 }}>in!</Text>
        </Text>
        <Text style={styles.lead}>
          Welcome to Central Studio, <Text style={styles.name}>{firstName}</Text>.
        </Text>
        {styleCount > 0 && <Text style={styles.sub}>{styleCount} style{styleCount !== 1 ? "s" : ""} loaded into your feed.</Text>}
      </View>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        <PrimaryCTA label="Start Dancing" icon="arrow" onPress={handleEnterApp} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: 30 },
  ring: {
    width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: CS.cyan500, marginBottom: 24,
    shadowColor: CS.cyan500, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  title: { fontFamily: "Anton_400Regular", fontSize: 64, lineHeight: 58, ...iosDisplayTextStyle(64, 58), textTransform: "uppercase", color: "#FFFFFF", marginTop: 4 },
  lead: { fontFamily: "Archivo_400Regular", fontSize: 16, color: "rgba(255,255,255,0.60)", marginTop: 14, lineHeight: 24 },
  name: { fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  sub: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "rgba(255,255,255,0.38)", marginTop: 6 },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
});
