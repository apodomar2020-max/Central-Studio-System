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
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { STORAGE_KEYS } from "@/constants/danceStyles";
import { useAppContext } from "@/contexts/AppContext";
import { enterApp } from "@/services/authProfile";
import { CS, Eyebrow, Icon, PrimaryCTA, StageVideo } from "@/components/signup/SignupKit";

const CONFETTI_COLORS = [CS.cyan400, "#FF2E7E", CS.amber, "#B6E80A"];

function Confetti() {
  const pieces = useRef(
    Array.from({ length: 24 }).map((_, i) => ({
      left: `${(i * 4.2 + (i % 3) * 7) % 96}%`,
      color: CONFETTI_COLORS[i % 4],
      size: 6 + (i % 3) * 4,
      delay: (i % 7) * 110,
      dur: 1500 + (i % 5) * 280,
      v: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    const loops = pieces.map((p) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.v, { toValue: 1, duration: p.dur, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [pieces]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            top: "-6%",
            left: p.left as any,
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: 1,
            opacity: p.v.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 0] }),
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, 860] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "400deg"] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

export default function OnboardingSuccessScreen() {
  const insets = useSafeAreaInsets();
  const { user, setIsOnboarded } = useAppContext();
  const [styleCount, setStyleCount] = useState(0);
  const pop = useRef(new Animated.Value(0)).current;

  const firstName =
    (user?.fullName?.trim().split(/\s+/)[0] || user?.email?.split("@")[0] || "dancer").replace(/[^a-z0-9 ]/gi, "") || "dancer";

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.danceStyles);
      if (raw) { try { const a = JSON.parse(raw); setStyleCount(Array.isArray(a) ? a.length : 0); } catch { setStyleCount(0); } }
    })();
  }, [pop]);

  async function handleEnterApp() {
    await setIsOnboarded(true);
    // Future Profile Completion Engine handoff point — see enterApp() in
    // services/authProfile.ts. Do not hardcode a route here.
    await enterApp();
  }

  return (
    <View style={styles.screen}>
      <StageVideo />
      <Confetti />

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
  title: { fontFamily: "Anton_400Regular", fontSize: 64, lineHeight: 58, textTransform: "uppercase", color: "#FFFFFF", marginTop: 4 },
  lead: { fontFamily: "Archivo_400Regular", fontSize: 16, color: "rgba(255,255,255,0.60)", marginTop: 14, lineHeight: 24 },
  name: { fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  sub: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "rgba(255,255,255,0.38)", marginTop: 6 },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
});
