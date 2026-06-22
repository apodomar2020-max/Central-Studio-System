/**
 * BalletPageShell — shared scaffold for all Ballet sub-pages.
 *
 * Provides the ambient cyan glow background, the sticky sub-page header
 * (back + centered title), and a scroll container. Kept in components/ (not
 * app/) so expo-router never treats it as a route.
 *
 * Visual tokens are exported as `BAL` so every ballet sub-page shares one
 * source of truth for colors / radii.
 */

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

/* ─── Shared design tokens ───────────────────────────────────────── */
export const BAL = {
  BASE:    "#0A0B0D",
  CARD:    "#15171B",
  SURFACE: "#22262C",
  CYAN:    "#00B6D7",
  VIOLET:  "#7C3AED",
  MAGENTA: "#FF2E7E",
  AMBER:   "#FFB02E",
  SUCCESS: "#1FB871",
  INK_200: "#D1D5DB",
  INK_300: "#9CA3AF",
  INK_400: "#4B5563",
  R_MD: 12,
  R_LG: 16,
  R_PILL: 999,
} as const;

export function BalletPageShell({
  title,
  children,
  contentStyle,
}: {
  title: string;
  children: React.ReactNode;
  contentStyle?: object;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.screen}>
      {/* ambient cyan glow behind the header/top */}
      <LinearGradient
        colors={["rgba(0,182,215,0.20)", "rgba(0,182,215,0.06)", "transparent"]}
        locations={[0, 0.4, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.glow, { height: topPad + 320 }]}
        pointerEvents="none"
      />

      {/* sticky header */}
      <View style={[styles.header, { paddingTop: topPad + 14 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={BAL.CYAN} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          { paddingBottom: Platform.OS === "web" ? 120 : 80 },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BAL.BASE },
  glow: { position: "absolute", top: 0, left: 0, right: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.15)",
    backgroundColor: BAL.BASE,
    zIndex: 10,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 64 },
  backText: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: BAL.CYAN },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  headerSpacer: { minWidth: 64 },
});
