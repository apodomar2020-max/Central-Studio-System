/**
 * app/ballet/performances.tsx — Performance Opportunities
 *
 * Source of truth:
 *   GET /api/ballet/performances → active upcoming ballet performance opportunities.
 *
 * Display-only catalogue. Cards may open an admin-managed external CTA URL,
 * but they do not create an internal detail page, booking flow, or application flow.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchBalletPerformances, type BalletPerformance } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const SUCCESS = "#10B981";
const R_MD = 12;

const FALLBACK_IMAGE = require("@/assets/images/ballet_hero.png");

function performanceImageUri(performance: BalletPerformance): string | null {
  return normalizeMediaUrl(performance.imageUrl, "image")?.trim() || null;
}

function formatEventDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  if (Number.isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minsStr} ${ampm}`;
}

function formatTimeRange(performance: BalletPerformance): string {
  return `${formatTime(performance.startTime)} - ${formatTime(performance.endTime)}`;
}

function BalletPerformanceCard({ performance }: { performance: BalletPerformance }) {
  const [imageFailed, setImageFailed] = useState(false);
  const remoteImageUri = performanceImageUri(performance);

  useEffect(() => {
    setImageFailed(false);
  }, [remoteImageUri]);

  const imageSource = remoteImageUri && !imageFailed ? { uri: remoteImageUri } : FALLBACK_IMAGE;
  const description = performance.description?.trim();
  const requirements = performance.requirements.map((item) => item.trim()).filter(Boolean).join(", ");
  const hasCta = Boolean(performance.externalCtaUrl?.trim());

  return (
    <View style={s.performanceCard}>
      <ImageBackground
        source={imageSource}
        style={StyleSheet.absoluteFill}
        imageStyle={s.performanceCardImage}
        onError={() => setImageFailed(true)}
      />
      <LinearGradient
        colors={["rgba(5,6,8,0.96)", "rgba(5,6,8,0.72)", "rgba(5,6,8,0.18)"]}
        locations={[0, 0.58, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(5,6,8,0.08)", "rgba(5,6,8,0.58)", "rgba(5,6,8,0.95)"]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={s.performanceContent}>
        <View style={s.performanceTopRow}>
          <View style={s.typePill}>
            <Ionicons name="sparkles-outline" size={13} color={CYAN} />
            <Text style={s.typePillText} numberOfLines={1}>{performance.eventType}</Text>
          </View>
        </View>

        <View style={s.performanceBody}>
          <Text style={s.performanceTitle} numberOfLines={2}>{performance.eventTitle}</Text>
          {!!description && (
            <Text style={s.performanceDescription} numberOfLines={2}>
              {description}
            </Text>
          )}

          <View style={s.metaList}>
            <View style={s.metaItem}>
              <Ionicons name="calendar-outline" size={15} color={CYAN} />
              <Text style={s.metaText} numberOfLines={1}>{formatEventDate(performance.eventDate)}</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="time-outline" size={15} color={INK_300} />
              <Text style={s.metaText} numberOfLines={1}>{formatTimeRange(performance)}</Text>
            </View>
            {!!performance.locationName && (
              <View style={s.metaItem}>
                <Ionicons name="location-outline" size={15} color={INK_300} />
                <Text style={s.metaText} numberOfLines={1}>{performance.locationName}</Text>
              </View>
            )}
            {!!requirements && (
              <View style={s.metaItem}>
                <Ionicons name="checkmark-circle-outline" size={15} color={SUCCESS} />
                <Text style={s.metaText} numberOfLines={2}>Requirements: {requirements}</Text>
              </View>
            )}
          </View>

          {hasCta && (
            <TouchableOpacity
              style={s.ctaButton}
              activeOpacity={0.84}
              onPress={() => Linking.openURL(performance.externalCtaUrl!.trim())}
            >
              <Text style={s.ctaText}>View Details →</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

export default function BalletPerformancesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [performances, setPerformances] = useState<BalletPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletPerformances(signal);
      if (signal?.aborted) return;
      setPerformances(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setPerformances([]);
      setErrorMessage("Unable to load Ballet performances right now.");
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
            <Text style={s.heroTitle}>{"BALLET\nPERFORMANCES"}</Text>
            <Text style={s.heroDesc}>
              Discover upcoming showcases, recitals, and performance opportunities.
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
              <Text style={s.emptyTitle}>Performances unavailable</Text>
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
          ) : performances.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="sparkles-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No performances scheduled yet</Text>
              <Text style={s.emptyDesc}>Upcoming showcases and competitions will appear here.</Text>
            </View>
          ) : (
            <View style={s.cardList}>
              {performances.map((performance) => (
                <BalletPerformanceCard key={performance.id} performance={performance} />
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
  cardList: {
    gap: 14,
  },
  performanceCard: {
    minHeight: 310,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#15171B",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.18)",
  },
  performanceCardImage: {
    borderRadius: 18,
  },
  performanceContent: {
    flex: 1,
    justifyContent: "space-between",
    padding: 14,
  },
  performanceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "82%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,182,215,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.3)",
  },
  typePillText: {
    flexShrink: 1,
    fontSize: 10,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  performanceBody: {
    gap: 9,
  },
  performanceTitle: {
    fontSize: 22,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
    lineHeight: 27,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  performanceDescription: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 19,
    maxWidth: "92%",
  },
  metaList: {
    gap: 6,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  metaText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: "Archivo_600SemiBold",
    color: INK_200,
    lineHeight: 18,
  },
  ctaButton: {
    alignSelf: "flex-start",
    marginTop: 3,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.16)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.45)",
  },
  ctaText: {
    fontSize: 13,
    fontFamily: "Archivo_800ExtraBold",
    color: CYAN,
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
