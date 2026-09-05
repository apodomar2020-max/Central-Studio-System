/**
 * app/ballet/instructors.tsx — Ballet Instructors
 *
 * Source of truth:
 *   GET /api/ballet/instructors → active ballet_instructors records.
 *
 * Display-only roster: no booking actions, no generic studio instructor data,
 * and no mock fallback records.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CentralBackButton from "@/components/CentralBackButton";

import { fetchBalletInstructors, type BalletInstructor } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_400 = "#6B7280";
const R_MD = 12;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function BalletInstructorCard({
  instructor,
  width,
  height,
}: {
  instructor: BalletInstructor;
  width: number;
  height: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const photoUrl = normalizeMediaUrl(instructor.photoUrl, "image");

  useEffect(() => setImgFailed(false), [photoUrl]);

  return (
    <TouchableOpacity
      style={[s.instCard, { width, height }]}
      activeOpacity={0.86}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        pushOnce(`/ballet/instructor/${instructor.id}` as any);
      }}
    >
      {photoUrl && !imgFailed ? (
        <Image
          source={{ uri: photoUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <LinearGradient
          colors={[CYAN + "CC", CYAN + "33", BASE]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        >
          <View style={s.instInitialsBg}>
            <Text style={s.instInitials}>{initialsFromName(instructor.name)}</Text>
          </View>
        </LinearGradient>
      )}

      <LinearGradient
        colors={["transparent", "rgba(6,7,8,0.9)"]}
        style={s.instOverlay}
      >
        <Text style={s.instName} numberOfLines={1}>{instructor.name}</Text>
        {instructor.experienceYears > 0 && (
          <Text style={s.instMeta} numberOfLines={1}>{instructor.experienceYears} yrs experience</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default function BalletInstructorsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const cardGap = 12;
  const horizontalPadding = 16;
  const cardWidth = Math.floor((width - horizontalPadding * 2 - cardGap) / 2);
  const cardHeight = Math.round(cardWidth * 16 / 9);

  const [instructors, setInstructors] = useState<BalletInstructor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletInstructors(signal);
      if (signal?.aborted) return;
      setInstructors(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setInstructors([]);
      setErrorMessage("Unable to load Ballet instructors right now.");
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
          <CentralBackButton style={s.backBtn} activeOpacity={0.7} />
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
            <Text style={s.heroTitle}>{"BALLET\nINSTRUCTORS"}</Text>
            <Text style={s.heroDesc}>
              Meet the Ballet faculty guiding technique, artistry, and growth.
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
              <Text style={s.emptyTitle}>Instructors unavailable</Text>
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
          ) : instructors.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="people-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No faculty listed yet</Text>
              <Text style={s.emptyDesc}>Our Ballet faculty will appear here soon.</Text>
            </View>
          ) : (
            <View style={s.grid}>
              {instructors.map((instructor) => (
                <BalletInstructorCard
                  key={instructor.id}
                  instructor={instructor}
                  width={cardWidth}
                  height={cardHeight}
                />
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
    maxWidth: 320,
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  instCard: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#15171B",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.18)",
  },
  instInitialsBg: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  instInitials: {
    fontSize: 34,
    fontFamily: "Archivo_800ExtraBold",
    color: "rgba(255,255,255,0.92)",
    letterSpacing: 1,
  },
  instOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 38,
    paddingBottom: 12,
  },
  instName: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: "#fff",
  },
  instMeta: {
    fontSize: 11.5,
    fontFamily: "Archivo_600SemiBold",
    color: INK_200,
    marginTop: 2,
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
