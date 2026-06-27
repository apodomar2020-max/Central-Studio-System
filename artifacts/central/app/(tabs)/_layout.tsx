/**
 * Central Studio — Tab Navigator
 *
 * Design: 4 tabs — Home · Classes · Schedule · Profile
 * (Fix Pack 1 — Visual Parity, 2026-06-22)
 *
 * Route safety notes
 * ──────────────────
 * • packages.tsx route file is NOT deleted — it remains hidden/internal for
 *   direct package browsing fallbacks; Package Center is a separate stack screen.
 * • bookings.tsx route file is NOT deleted — it remains accessible via
 *   router.push("/(tabs)/bookings") from profile menu and booking confirmation.
 * • The "Schedule" tab name maps to the existing "bookings" route which
 *   shows the student's schedule/booking list — semantically correct.
 * • NativeTabLayout (Liquid Glass / iOS 26+) also updated to 4 triggers.
 *
 * Classes icon
 * ─────────────
 * Design calls for a custom dancer-figure SVG. No exact match exists in
 * Ionicons or SF Symbols. Best safe alternatives chosen:
 *   iOS:     SF Symbol  "figure.dance"      (exact semantic match, present in iOS 16+)
 *   Android: Ionicons   "body-outline"      (closer semantic than "musical-notes-outline")
 *   Web:     Ionicons   "body-outline"
 */

import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import colors from "@/constants/colors";
import CsIcon from "@/components/CsIcon";
import { useTabVisibility } from "@/contexts/TabVisibilityContext";

// ── Design tokens ────────────────────────────────────────────────────────────
const ACTIVE_TINT   = "#00B6D7"; // --cs-cyan-500
const INACTIVE_TINT = "#6B747F"; // --cs-ink-400
const TAB_BG_WEB    = "rgba(10,11,13,0.80)"; // glassmorphism bg for web
const TAB_HEIGHT    = 60; // unified height (design: 60px)

// ── Native Liquid Glass layout (iOS 26+ only) ────────────────────────────────
function NativeTabLayout({ hidden }: { hidden: boolean }) {
  if (hidden) return null;

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="classes">
        {/* "figure.dance" is the semantically correct SF Symbol for dance classes */}
        <Icon sf={{ default: "figure.dance", selected: "figure.dance" }} />
        <Label>Classes</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bookings">
        <Icon sf={{ default: "calendar", selected: "calendar.badge.checkmark" }} />
        <Label>Schedule</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// ── Classic layout (Android, Web, iOS < 26) ──────────────────────────────────
function ClassicTabLayout({ hidden }: { hidden: boolean }) {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        headerShown: false,
        tabBarStyle: {
          display: hidden ? "none" : "flex",
          position: "absolute",
          // iOS uses BlurView — background must be transparent
          backgroundColor: isIOS ? "transparent" : "transparent",
          // Design: no top border — gradient transition only
          borderTopWidth: 0,
          elevation: 0,
          height: TAB_HEIGHT,
        },
        tabBarBackground: () =>
          isWeb ? (
            // Web: semi-transparent dark glass
            <View style={[StyleSheet.absoluteFill, { backgroundColor: TAB_BG_WEB }]} />
          ) : (
            // iOS + Android: frosted glass (translucent blur)
            <BlurView
              intensity={isIOS ? 80 : 32}
              tint="dark"
              experimentalBlurMethod={isIOS ? undefined : "dimezisBlurView"}
              style={[StyleSheet.absoluteFill, isIOS ? null : { backgroundColor: "rgba(10,11,13,0.55)" }]}
            />
          ),
        tabBarLabelStyle: {
          fontFamily: "Archivo_600SemiBold",
          fontSize: 10,
          marginBottom: isWeb ? 10 : 2,
        },
      }}
    >
      {/* ── Home ── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <CsIcon name="home" size={24} stroke={focused ? 2.4 : 2} color={color} fill={focused ? "rgba(0,182,215,0.16)" : "none"} />
          ),
        }}
      />

      {/* ── Classes ── */}
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color, focused }) => (
            <CsIcon name="classes" size={24} stroke={focused ? 2.4 : 2} color={color} fill={focused ? "rgba(0,182,215,0.16)" : "none"} />
          ),
        }}
      />

      {/* ── Schedule (bookings route kept, label changed to "Schedule") ── */}
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color, focused }) => (
            <CsIcon name="calendar" size={24} stroke={focused ? 2.4 : 2} color={color} fill={focused ? "rgba(0,182,215,0.16)" : "none"} />
          ),
        }}
      />

      {/* ── Packages — hidden from tab bar, route still accessible ── */}
      <Tabs.Screen
        name="packages"
        options={{
          href: null, // removes from tab bar; router.push("/(tabs)/packages") still works
          title: "Packages",
        }}
      />

      {/* ── Profile ── */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <CsIcon name="user" size={24} stroke={focused ? 2.4 : 2} color={color} fill={focused ? "rgba(0,182,215,0.16)" : "none"} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function StudioTabLayout() {
  const { hideBottomTabs } = useTabVisibility();

  if (isLiquidGlassAvailable()) return <NativeTabLayout hidden={hideBottomTabs} />;
  return <ClassicTabLayout hidden={hideBottomTabs} />;
}
