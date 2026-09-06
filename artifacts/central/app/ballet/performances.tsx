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
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
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
import CentralBackButton from "@/components/CentralBackButton";

import { fetchBalletPerformances, type BalletPerformance } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_400 = "#6B7280";
const R_MD = 12;

const FALLBACK_IMAGE = require("@/assets/images/ballet_hero.png");
const EMPTY_PERFORMANCE_ANIMATION = require("@/assets/animations/empty-performance.json");

function performanceImageUri(performance: BalletPerformance): string | null {
  return normalizeMediaUrl(performance.imageUrl, "image")?.trim() || null;
}

function eventDateParts(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { weekday: "DATE", day: "--", month: "TBC" };
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase(),
    day: String(date.getDate()).padStart(2, "0"),
    month: date.toLocaleDateString("en-US", { month: "long" }).toUpperCase(),
  };
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
  const hasCta = Boolean(performance.externalCtaUrl?.trim());
  const date = eventDateParts(performance.eventDate);

  return (
    <View style={s.performanceCard}>
      <View style={s.performanceImageArea}>
        <ImageBackground
          source={imageSource}
          style={StyleSheet.absoluteFill}
          imageStyle={s.performanceCardImage}
          onError={() => setImageFailed(true)}
        />
        <LinearGradient
          colors={["rgba(0,0,0,0.02)", "rgba(0,0,0,0.18)", "rgba(5,6,7,0.98)"]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      <View style={s.performanceStatusPill}>
        <View style={s.performanceStatusDot} />
        <Text style={s.performanceStatusText} numberOfLines={1}>{performance.eventType}</Text>
      </View>

      <View style={s.performancePanelShell}>
        <GlassView
          glassEffectStyle="clear"
          tintColor="rgba(255,255,255,0.08)"
          colorScheme="dark"
          pointerEvents="none"
          style={s.performanceGlassBackdrop}
        />
        <View style={s.performancePanelContent}>
          <View style={s.performanceDetailsRow}>
            <View style={s.performanceCopyColumn}>
              <Text style={s.performanceTitle} numberOfLines={1}>{performance.eventTitle}</Text>
              {!!description && <Text style={s.performanceDescription} numberOfLines={3}>{description}</Text>}
              {!!performance.locationName && (
                <View style={s.performanceLocationRow}>
                  <Ionicons name="location-outline" size={17} color="#FFFFFF" />
                  <Text style={s.performanceLocationText} numberOfLines={1}>{performance.locationName}</Text>
                </View>
              )}
            </View>

            <View style={s.performanceDateColumn}>
              <Text style={s.performanceWeekday} numberOfLines={1}>{date.weekday}</Text>
              <View style={s.performanceDayRow}>
                <Text style={s.performanceDay}>{date.day}</Text>
                <Text style={s.performanceMonth}>{date.month}</Text>
              </View>
              <Text style={s.performanceTimeRange} numberOfLines={1}>{formatTimeRange(performance)}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[s.ctaButton, !hasCta && s.ctaButtonDisabled]}
            activeOpacity={0.84}
            disabled={!hasCta}
            onPress={() => void Linking.openURL(performance.externalCtaUrl!.trim())}
          >
            <Text style={s.ctaText}>View Details</Text>
          </TouchableOpacity>
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
              <LottieView
                source={EMPTY_PERFORMANCE_ANIMATION}
                autoPlay
                loop
                style={s.emptyAnimation}
              />
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
    height: 348,
    position: "relative",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#050607",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.58)",
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  performanceImageArea: { width: "100%", height: 238, backgroundColor: "#17191D" },
  performanceCardImage: {
    resizeMode: "cover",
    borderRadius: 16,
  },
  performanceStatusPill: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "44%",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(39,198,63,0.25)",
  },
  performanceStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#27C63F" },
  performanceStatusText: { flexShrink: 1, color: "#27C63F", fontFamily: "Archivo_700Bold", fontSize: 15, lineHeight: 18 },
  performancePanelShell: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 16,
    height: 192,
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  performanceGlassBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(1,8,10,0.40)",
  },
  performancePanelContent: { flex: 1, paddingHorizontal: 14, paddingTop: 15, paddingBottom: 11 },
  performanceDetailsRow: { flex: 1, minHeight: 0, flexDirection: "row", gap: 6 },
  performanceCopyColumn: { width: "59%", minWidth: 0 },
  performanceTitle: {
    fontSize: 27,
    lineHeight: 31,
    fontFamily: "Anton_400Regular",
    color: "#FFFFFF",
  },
  performanceDescription: {
    marginTop: 3,
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: "rgba(255,255,255,0.86)",
    lineHeight: 17,
  },
  performanceLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
  },
  performanceLocationText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Archivo_600SemiBold",
    color: "#FFFFFF",
    lineHeight: 16,
  },
  performanceDateColumn: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  performanceWeekday: { width: "100%", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 20, lineHeight: 23, textAlign: "right" },
  performanceDayRow: { width: "100%", flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 4 },
  performanceDay: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 64, lineHeight: 66 },
  performanceMonth: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 18, lineHeight: 29 },
  performanceTimeRange: { width: "100%", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 13, lineHeight: 16, textAlign: "right" },
  ctaButton: {
    width: "100%",
    minHeight: 46,
    marginTop: 7,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaButtonDisabled: { opacity: 0.55 },
  ctaText: {
    fontSize: 24,
    lineHeight: 28,
    fontFamily: "Anton_400Regular",
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
  emptyAnimation: {
    width: 92,
    height: 92,
    marginBottom: 10,
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
