/**
 * Pick Styles — design `PickStyles` (signup-views2.jsx). Step 3 of 4.
 * The visual shell is replicated from the design; the style list + icons are
 * sourced from the CMS Dance Types (useListDanceTypes + CategoryIcon), not the
 * design's hardcoded sprite list.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useListDanceTypes } from "@workspace/api-client-react";
import CategoryIcon from "@/components/CategoryIcon";
import ProgressDots from "@/components/ProgressDots";
import { STORAGE_KEYS } from "@/constants/danceStyles";
import { BackBtn, CS, Eyebrow, Icon, PrimaryCTA, ScreenTitle } from "@/components/signup/SignupKit";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

const VibeGlow = React.memo(function VibeGlow() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="vGlow" cx="20%" cy="110%" rx="70%" ry="50%">
            <Stop offset="0%" stopColor={CS.cyan500} stopOpacity={0.09} />
            <Stop offset="60%" stopColor={CS.cyan500} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vGlow)" />
      </Svg>
    </View>
  );
});

function hexToRgb(hex?: string | null): string {
  if (!hex) return "45,205,236";
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return "45,205,236";
  const n = parseInt(h, 16);
  return Number.isNaN(n) ? "45,205,236" : `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function StylesPickerScreen() {
  const insets = useSafeAreaInsets();
  const { data: danceTypesRaw } = useListDanceTypes();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 14;

  const styles_ = useMemo(
    () =>
      (danceTypesRaw ?? [])
        .filter((dt) => dt.isActive !== false)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name)),
    [danceTypesRaw],
  );

  function toggle(id: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function persistAndContinue() {
    const chosen = styles_.filter((dt) => selected.has(dt.id)).map((dt) => dt.slug);
    await AsyncStorage.setItem(STORAGE_KEYS.danceStyles, JSON.stringify(chosen));
    // NOTE: saving to backend not yet supported — no student_dance_styles table exists.
    // This is documented as temporary local storage.
    // TODO: create student_dance_styles join table and PATCH /api/auth/profile endpoint
    // to accept selectedStyleIds, then migrate AsyncStorage data to server.
    router.push("/verify-email" as never);
  }

  const count = selected.size;

  return (
    <View style={styles.screen}>
      <VibeGlow />

      <View style={[styles.topRow, { paddingTop: topPad }]} pointerEvents="box-none">
        <BackBtn onPress={() => router.push("/auth/complete-profile")} />
        <ProgressDots total={5} current={2} />
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.intro}>
        <Eyebrow>Step 3 of 5</Eyebrow>
        <ScreenTitle text={"YOUR\nVIBE?"} />
        <Text style={styles.lead}>Pick all styles you love — we'll personalise your feed.</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.gridScroll}>
        <View style={styles.grid}>
          {styles_.map((dt) => {
            const on = selected.has(dt.id);
            const rgb = hexToRgb(dt.color);
            return (
              <TouchableOpacity key={dt.id} onPress={() => toggle(dt.id)} activeOpacity={0.85} style={[styles.tile, on ? styles.tileOn : null]}>
                {on && (
                  <View style={styles.check}>
                    <Icon name="check" size={11} stroke={3} color={CS.ink900} />
                  </View>
                )}
                <View style={[styles.iconBox, on ? { backgroundColor: `rgba(${rgb},0.20)` } : null]}>
                  <CategoryIcon iconSvg={dt.iconSvg} iconUrl={dt.iconUrl} name={dt.name} color={on ? CS.cyan400 : "rgba(255,255,255,0.55)"} size={14} />
                </View>
                <Text style={[styles.tileLabel, on ? styles.tileLabelOn : null]}>{dt.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        {count > 0 && <Text style={styles.count}>{count} style{count !== 1 ? "s" : ""} selected</Text>}
        <PrimaryCTA
          label={`Continue with ${count} style${count !== 1 ? "s" : ""}`}
          icon="arrow"
          onPress={persistAndContinue}
          disabled={count === 0}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  topRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56,
    zIndex: 50, elevation: 10,
  },
  intro: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 10 },
  title: { fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78, textTransform: "uppercase", color: "#FFFFFF", marginBottom: 6, includeFontPadding: false, paddingTop: 6 },
  lead: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, fontFamily: "Archivo_400Regular" },
  gridScroll: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 100, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" },
  tileOn: { borderColor: CS.cyan500, backgroundColor: "rgba(0,182,215,0.13)" },
  check: { width: 18, height: 18, borderRadius: 9, backgroundColor: CS.cyan500, alignItems: "center", justifyContent: "center", marginLeft: -4 },
  iconBox: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  tileLabel: { fontFamily: "Archivo_600SemiBold", fontSize: 14, color: "rgba(255,255,255,0.50)", textAlign: "center" },
  tileLabelOn: { color: "#FFFFFF" },
  footer: { paddingHorizontal: 24, paddingTop: 10, gap: 10 },
  count: { textAlign: "center", fontFamily: "Archivo_700Bold", fontSize: 13, color: CS.cyan400 },
});
