/**
 * app/ballet/requirements.tsx — Program Requirements
 *
 * Source of truth:
 *   GET /api/ballet/program-requirements → active admin-managed sections/items.
 *
 * No hardcoded production requirement records are rendered here.
 */

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchBalletProgramRequirements,
  type BalletProgramRequirementSection,
} from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const R_MD = 12;

function RequirementSectionCard({ section }: { section: BalletProgramRequirementSection }) {
  return (
    <View style={s.reqCard}>
      <LinearGradient
        colors={["rgba(0,182,215,0.12)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0.015)"]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={s.reqHeader}>
        <View style={s.reqIcon}>
          <Ionicons name="ribbon-outline" size={18} color={CYAN} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.reqTitle}>{section.title}</Text>
          {!!section.description?.trim() && (
            <Text style={s.reqDescription} numberOfLines={3}>{section.description.trim()}</Text>
          )}
        </View>
      </View>

      {section.items.length === 0 ? (
        <Text style={s.emptySectionText}>No active items in this section.</Text>
      ) : (
        <View style={s.itemList}>
          {section.items.map((item) => (
            <View key={item.id} style={s.itemRow}>
              <Ionicons name="checkmark" size={15} color={CYAN} style={s.itemBullet} />
              <Text style={s.itemText}>{item.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function BalletRequirementsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [sections, setSections] = useState<BalletProgramRequirementSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletProgramRequirements(signal);
      if (signal?.aborted) return;
      setSections(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setSections([]);
      setErrorMessage("Unable to load Ballet requirements right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return (
    <View style={s.screen}>
      <LinearGradient
        colors={["rgba(0,182,215,0.22)", "rgba(0,182,215,0.08)", "transparent"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[s.atmosphericGlow, { height: topPad + 240 }]}
        pointerEvents="none"
      />

      <View style={s.headerWrap}>
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0)"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[s.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces>
        <View style={[s.heroSection, { minHeight: topPad + 222 }]}>
          <LinearGradient
            colors={[BASE, "rgba(0,182,215,0.12)", BASE]}
            locations={[0, 0.48, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[
              "rgba(5,6,8,0.12)",
              "rgba(5,6,8,0.34)",
              "rgba(5,6,8,0.78)",
              "rgba(5,6,8,0.96)",
            ]}
            locations={[0, 0.3, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={[s.heroContent, { paddingTop: topPad + 54 }]}>
            <Text style={s.heroEyebrow}>Central Studio</Text>
            <Text style={s.heroTitle}>{"BALLET\nREQUIREMENTS"}</Text>
            <Text style={s.heroDesc}>
              Review program expectations, preparation notes, and participation guidelines.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          {isLoading ? (
            <View style={s.center}>
              <ActivityIndicator color={CYAN} />
            </View>
          ) : errorMessage ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>Requirements unavailable</Text>
              <Text style={s.emptyDesc}>{errorMessage}</Text>
              <TouchableOpacity
                onPress={() => {
                  const ctrl = new AbortController();
                  load(ctrl.signal);
                }}
                style={s.retryButton}
                activeOpacity={0.82}
              >
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : sections.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="list-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No requirements listed yet</Text>
              <Text style={s.emptyDesc}>Ballet program requirements will appear here soon.</Text>
            </View>
          ) : (
            <View style={s.sectionList}>
              {sections.map((section) => (
                <RequirementSectionCard key={section.id} section={section} />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: Platform.OS === "web" ? 120 : 80 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BASE },
  atmosphericGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: CYAN,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSection: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 44,
    fontFamily: "Anton_400Regular",
    textTransform: "uppercase",
    lineHeight: 40,
    letterSpacing: 0.5,
    color: "#FFFFFF",
    marginBottom: 8,
    ...iosDisplayTextStyle(44, 40),
    marginTop: -iosCapGuard(44, 40),
  },
  heroDesc: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 21,
    maxWidth: 330,
  },
  heroDivider: {
    height: 1,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  sectionList: {
    gap: 14,
  },
  reqCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#15171B",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.18)",
  },
  reqHeader: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  reqIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,182,215,0.14)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.24)",
  },
  reqTitle: {
    fontSize: 17,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  reqDescription: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_300,
    lineHeight: 19,
  },
  itemList: {
    gap: 9,
  },
  itemRow: {
    flexDirection: "row",
    gap: 9,
  },
  itemBullet: {
    marginTop: 2,
  },
  itemText: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 20,
  },
  emptySectionText: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    fontStyle: "italic",
  },
  center: {
    paddingVertical: 54,
    alignItems: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Archivo_700Bold",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    textAlign: "center",
    lineHeight: 19,
  },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.35)",
  },
  retryText: {
    fontSize: 13,
    fontFamily: "Archivo_700Bold",
    color: CYAN,
  },
});
