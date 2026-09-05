/**
 * Central Studio — Tab Navigator
 *
 * Design: 4 tabs — Home · Classes · My Bookings · Profile
 * (Fix Pack 1 — Visual Parity, 2026-06-22)
 *
 * Route safety notes
 * ──────────────────
 * • packages.tsx route file is NOT deleted — it remains hidden/internal for
 *   direct package browsing fallbacks; Package Center is a separate stack screen.
 * • bookings.tsx route file is NOT deleted — it remains accessible via
 *   router.push("/(tabs)/bookings") from profile menu and booking confirmation.
 * • The "My Bookings" tab maps to the existing "bookings" route.
 * • NativeTabLayout (Liquid Glass / iOS 26+) also updated to 4 triggers.
 *
 * All four glyphs reproduce the supplied navigation SVG artwork.
 */

import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { useTabVisibility } from "@/contexts/TabVisibilityContext";

// ── Design tokens ────────────────────────────────────────────────────────────
const ACTIVE_TINT   = "#00B6D7"; // --cs-cyan-500
const INACTIVE_TINT = "#6B747F"; // --cs-ink-400
const TAB_BG_WEB    = "rgba(10,11,13,0.80)"; // glassmorphism bg for web
const TAB_HEIGHT    = 60; // unified height (design: 60px)

type NavGlyphName = "home" | "bookings" | "classes" | "profile";

function NavGlyph({ name, color, size = 24 }: { name: NavGlyphName; color: string; size?: number }) {
  const strokeProps = { stroke: color, strokeLinecap: "round" as const, fill: "none" };
  const dimensions = name === "bookings"
    ? { width: size * 22 / 21, viewBox: "0 0 22 21" }
    : name === "classes"
      ? { width: size * 19 / 22, viewBox: "0 0 19 22" }
      : name === "profile"
        ? { width: size * 16 / 21, viewBox: "0 0 16 21" }
        : { width: size, viewBox: "0 0 21 21" };

  return (
    <View style={{ width: size + 4, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={dimensions.width} height={size} viewBox={dimensions.viewBox} fill="none">
        {name === "home" ? <>
          <Path d="M20.5 10.7039V12.225C20.5 16.1258 20.5 18.0763 19.3284 19.2881C18.1569 20.5 16.2712 20.5 12.5 20.5H8.5C4.72876 20.5 2.84315 20.5 1.67157 19.2881C0.5 18.0763 0.5 16.1258 0.5 12.225V10.7039C0.5 8.41549 0.5 7.27128 1.0192 6.32274C1.5384 5.37421 2.48695 4.78551 4.38403 3.60813L6.38403 2.36687C8.38939 1.12229 9.3921 0.5 10.5 0.5C11.6079 0.5 12.6106 1.12229 14.616 2.36687L16.616 3.60812C18.5131 4.78551 19.4616 5.37421 19.9808 6.32274" {...strokeProps} />
          <Path d="M13.4999 16.5H7.49994" {...strokeProps} />
        </> : null}
        {name === "bookings" ? <>
          <Path d="M12.8077 20.5001H8.70513C4.83719 20.5001 2.90323 20.5001 1.70161 19.2985C0.5 18.0969 0.5 16.1629 0.5 12.295V10.2437C0.5 6.37576 0.5 4.4418 1.70161 3.24018C2.90323 2.03857 4.83719 2.03857 8.70513 2.03857H12.8077C16.6756 2.03857 18.6096 2.03857 19.8112 3.24018C21.0128 4.4418 21.0128 6.37576 21.0128 10.2437V12.295C21.0128 16.1629 21.0128 18.0969 19.8112 19.2985C19.1412 19.9684 18.2437 20.2648 16.9103 20.396" {...strokeProps} />
          <Path d="M5.62817 2.03846V0.5M15.8846 2.03846V0.5M20.5 7.16675H15.5H9.47436M0.5 7.16675H4.47436" {...strokeProps} />
          {[5.62818, 10.7564, 15.8845].flatMap((cx) => [11.2693, 15.3718].map((cy) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.0256} fill={color} />))}
        </> : null}
        {name === "classes" ? <>
          <Path d="M12.0643 3.55806C12.0643 5.24698 10.7068 6.61612 9.03214 6.61612C7.35749 6.61612 6 5.24698 6 3.55806C6 1.86914 7.35749 0.5 9.03214 0.5C10.7068 0.5 12.0643 1.86914 12.0643 3.55806Z" {...strokeProps} />
          <Path d="M18.2572 7.73218C18.2572 7.73218 16.5 10.5 9 10.5C1 10.5 0.5 16 0.5 16" {...strokeProps} />
          <Path d="M9.16077 10.7903V13.0107M9.16077 13.0107C9.16077 13.8904 9.41152 14.7514 9.88317 15.4913L13.709 21.4935M9.16077 13.0107C9.16077 13.8904 8.91001 14.7514 8.43836 15.4913L4.61255 21.4935" {...strokeProps} />
        </> : null}
        {name === "profile" ? <>
          <Path d="M7.80595 8.92106C10.1117 8.92106 11.9808 7.03594 11.9808 4.71053C11.9808 2.38512 10.1117 0.5 7.80595 0.5C5.50025 0.5 3.6311 2.38512 3.6311 4.71053C3.6311 7.03594 5.50025 8.92106 7.80595 8.92106Z" {...strokeProps} />
          <Path d="M10.9371 20.0948C9.98807 20.3545 8.92651 20.4999 7.80598 20.4999C3.771 20.4999 0.5 18.6148 0.5 16.2894C0.5 13.964 3.771 12.0789 7.80598 12.0789C11.841 12.0789 15.112 13.964 15.112 16.2894C15.112 16.6529 15.032 17.0056 14.8818 17.342" {...strokeProps} />
        </> : null}
      </Svg>
    </View>
  );
}

// ── Native Liquid Glass layout (iOS 26+ only) ────────────────────────────────
function NativeTabLayout({ hidden }: { hidden: boolean }) {
  if (hidden) return null;

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon src={<NavGlyph name="home" color="#FFFFFF" />} selectedColor={ACTIVE_TINT} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="classes">
        <Icon src={<NavGlyph name="classes" color="#FFFFFF" />} selectedColor={ACTIVE_TINT} />
        <Label>Classes</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="bookings">
        <Icon src={<NavGlyph name="bookings" color="#FFFFFF" />} selectedColor={ACTIVE_TINT} />
        <Label>My Bookings</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon src={<NavGlyph name="profile" color="#FFFFFF" />} selectedColor={ACTIVE_TINT} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// ── Classic layout (Android, Web, iOS < 26) ──────────────────────────────────
function ClassicTabLayout({ hidden }: { hidden: boolean }) {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const bottomInset = isWeb ? 0 : insets.bottom;

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
          // Preserve the 60px design area, then reserve only the space the
          // current device reports for Android navigation buttons / gestures
          // or the iOS home indicator. A device with no bottom inset remains
          // exactly 60px high and stays flush with the bottom edge.
          height: TAB_HEIGHT + bottomInset,
          paddingBottom: bottomInset,
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
          tabBarIcon: ({ color }) => (
            <NavGlyph name="home" size={24} color={color} />
          ),
        }}
      />

      {/* ── Classes ── */}
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color }) => (
            <NavGlyph name="classes" size={24} color={color} />
          ),
        }}
      />

      {/* ── My Bookings (existing bookings route) ── */}
      <Tabs.Screen
        name="bookings"
        options={{
          title: "My Bookings",
          tabBarIcon: ({ color }) => (
            <NavGlyph name="bookings" size={24} color={color} />
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
          tabBarIcon: ({ color }) => (
            <NavGlyph name="profile" size={24} color={color} />
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
