/**
 * Central Studio — Tab Navigator
 *
 * Design: 4 tabs — Home · Classes · Schedule · Profile
 * (Fix Pack 1 — Visual Parity, 2026-06-22)
 *
 * Route safety notes
 * ──────────────────
 * • packages.tsx route file is NOT deleted — it remains accessible via
 *   router.push("/(tabs)/packages") from the Home screen PackagesSection
 *   and from profile.tsx menu item "/package-center" (a separate stack screen).
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

// ── Design tokens ────────────────────────────────────────────────────────────
const ACTIVE_TINT   = "#00B6D7"; // --cs-cyan-500
const INACTIVE_TINT = "#6B747F"; // --cs-ink-400
const TAB_BG_WEB    = "rgba(10,11,13,0.92)"; // glassmorphism bg for web
const TAB_HEIGHT    = 60; // unified height (design: 60px)

// ── Native Liquid Glass layout (iOS 26+ only) ────────────────────────────────
function NativeTabLayout() {
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
function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          // iOS uses BlurView — background must be transparent
          backgroundColor: isIOS ? "transparent" : "transparent",
          // Design: no top border — gradient transition only
          borderTopWidth: 0,
          elevation: 0,
          height: TAB_HEIGHT,
        },
        tabBarBackground: () =>
          isIOS ? (
            // iOS: native blur for glass effect
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            // Web: semi-transparent dark glass
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: TAB_BG_WEB },
              ]}
            />
          ) : (
            // Android: solid ink-900
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.studio.background },
              ]}
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
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={22} />
            ) : (
              <Ionicons name="home-outline" size={22} color={color} />
            ),
        }}
      />

      {/* ── Classes ── */}
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              // "figure.dance" — available iOS 16+, exact semantic match
              <SymbolView name="figure.dance" tintColor={color} size={22} />
            ) : (
              // "body-outline" — best Ionicons semantic match for a dancer figure
              // Note: "musical-notes-outline" (previous) had no relation to dance
              <Ionicons name="body-outline" size={22} color={color} />
            ),
        }}
      />

      {/* ── Schedule (bookings route kept, label changed to "Schedule") ── */}
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={22} />
            ) : (
              <Ionicons name="calendar-outline" size={22} color={color} />
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
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={22} />
            ) : (
              <Ionicons name="person-outline" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function StudioTabLayout() {
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
