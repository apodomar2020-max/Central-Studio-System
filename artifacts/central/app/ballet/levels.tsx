/**
 * app/ballet/levels.tsx — Ballet Levels
 *
 * Production source of truth:
 *   GET /api/ballet/levels → ballet_levels rows managed by Admin.
 *
 * The screen intentionally renders only fields that exist on ballet_levels:
 * name, description, requirements, ageMin, ageMax, isActive, and imageUrl.
 * No local hardcoded curriculum metadata is used for production display.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ACTIVE_APPLICATION_STATUSES,
  fetchBalletLevels,
  fetchMyApplications,
  type BalletLevel,
} from "@/services/balletAssessmentService";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt, showParentAccountRequiredPrompt } from "@/utils/authRequired";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const R_MD = 12;

const FALLBACK_IMAGE = require("@/assets/images/ballet_hero.png");

function formatAgeRange(level: BalletLevel): string {
  if (level.ageMin != null && level.ageMax != null) return `${level.ageMin}–${level.ageMax} years`;
  if (level.ageMin != null) return `${level.ageMin}+ years`;
  if (level.ageMax != null) return `Up to ${level.ageMax} years`;
  return "All eligible ages";
}

function levelImageUri(level: BalletLevel): string | null {
  return normalizeMediaUrl(level.imageUrl, "image")?.trim() || null;
}

function BalletLevelCard({ level }: { level: BalletLevel }) {
  const [imageFailed, setImageFailed] = useState(false);
  const remoteImageUri = levelImageUri(level);

  useEffect(() => {
    setImageFailed(false);
  }, [remoteImageUri]);

  const imageSource = remoteImageUri && !imageFailed ? { uri: remoteImageUri } : FALLBACK_IMAGE;
  const requirements = level.requirements?.trim() || "No special requirements";
  const description = level.description?.trim() || "Level details coming soon.";

  return (
    <View style={s.levelCard}>
      <ImageBackground
        source={imageSource}
        style={StyleSheet.absoluteFill}
        imageStyle={s.levelCardImage}
        onError={() => setImageFailed(true)}
      />
      <LinearGradient
        colors={["rgba(5,6,8,0.96)", "rgba(5,6,8,0.78)", "rgba(5,6,8,0.24)"]}
        locations={[0, 0.58, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(5,6,8,0)", "rgba(5,6,8,0.72)", "rgba(5,6,8,0.96)"]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={s.levelContent}>
        <View style={s.levelTopRow}>
          <Text style={s.levelName} numberOfLines={2}>{level.name}</Text>
          <View style={[s.statusBadge, level.isActive ? s.statusActive : s.statusInactive]}>
            <Text style={[s.statusText, level.isActive ? s.statusTextActive : s.statusTextInactive]}>
              {level.isActive ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>

        <Text style={s.levelDescription} numberOfLines={2}>
          {description}
        </Text>

        <View style={s.levelInfo}>
          <View style={s.infoRow}>
            <Ionicons name="person-outline" size={15} color={CYAN} />
            <Text style={s.infoText} numberOfLines={1}>Age: {formatAgeRange(level)}</Text>
          </View>
          <View style={s.infoRow}>
            <Ionicons name="ribbon-outline" size={15} color={CYAN} />
            <Text style={s.infoText} numberOfLines={2}>Requirements: {requirements}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function LevelSkeleton() {
  return (
    <View style={s.skeletonCard}>
      <View style={s.skeletonHeader} />
      <View style={s.skeletonLineWide} />
      <View style={s.skeletonLine} />
      <ActivityIndicator color={CYAN} style={s.skeletonSpinner} />
    </View>
  );
}

export default function BalletLevelsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { user } = useAppContext();

  const [levels, setLevels] = useState<BalletLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasActiveApplication, setHasActiveApplication] = useState<boolean | null>(null);

  const loadLevels = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletLevels(signal);
      if (signal?.aborted) return;
      setLevels(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setLevels([]);
      setErrorMessage("Unable to load Ballet levels right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadLevels(ctrl.signal);
    return () => ctrl.abort();
  }, [loadLevels]);

  useEffect(() => {
    if (!user) {
      setHasActiveApplication(false);
      return;
    }

    setHasActiveApplication(null);
    const ctrl = new AbortController();
    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (ctrl.signal.aborted) return;
        setHasActiveApplication(apps.some((app) => ACTIVE_APPLICATION_STATUSES.has(app.status)));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setHasActiveApplication(null);
      });
    return () => ctrl.abort();
  }, [user]);

  function handleApply() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    if (user.accountType !== "parent") {
      showParentAccountRequiredPrompt();
      return;
    }
    if (hasActiveApplication) {
      router.push("/ballet/application-status" as any);
    } else {
      router.push("/ballet/assessment" as any);
    }
  }

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
            <Text style={s.heroTitle}>{"BALLET\nLEVELS"}</Text>
            <Text style={s.heroDesc}>
              Explore our Ballet program levels and find the right stage for every dancer.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          {isLoading ? (
            <>
              <LevelSkeleton />
              <LevelSkeleton />
              <LevelSkeleton />
            </>
          ) : errorMessage ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>Levels unavailable</Text>
              <Text style={s.emptyDesc}>{errorMessage}</Text>
              <TouchableOpacity
                onPress={() => {
                  const ctrl = new AbortController();
                  loadLevels(ctrl.signal);
                }}
                style={s.retryButton}
                activeOpacity={0.82}
              >
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : levels.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="ribbon-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No Ballet levels are available right now.</Text>
            </View>
          ) : (
            <>
              {levels.map((level) => (
                <BalletLevelCard key={level.id} level={level} />
              ))}

              {(!user || hasActiveApplication === false) && (
                <TouchableOpacity
                  onPress={handleApply}
                  style={s.applyCTA}
                  activeOpacity={0.88}
                >
                  <Text style={s.applyCTAText}>✦ Apply Now</Text>
                </TouchableOpacity>
              )}
            </>
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
    paddingTop: 10,
    paddingBottom: 16,
    gap: 10,
  },
  levelCard: {
    minHeight: 166,
    borderRadius: R_MD,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.26)",
    backgroundColor: "#111827",
  },
  levelCardImage: {
    resizeMode: "cover",
    borderRadius: R_MD,
  },
  levelContent: {
    flex: 1,
    padding: 13,
    justifyContent: "space-between",
  },
  levelTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  levelName: {
    flex: 1,
    fontSize: 18,
    lineHeight: 21,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: CYAN,
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  statusActive: {
    backgroundColor: "rgba(0,182,215,0.18)",
    borderColor: "rgba(0,182,215,0.45)",
  },
  statusInactive: {
    backgroundColor: "rgba(107,114,128,0.18)",
    borderColor: "rgba(156,163,175,0.24)",
  },
  statusText: {
    fontSize: 9,
    fontFamily: "Archivo_800ExtraBold",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  statusTextActive: { color: CYAN },
  statusTextInactive: { color: INK_300 },
  levelDescription: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 18,
    maxWidth: "82%",
    marginTop: 10,
    marginBottom: 10,
  },
  levelInfo: {
    gap: 5,
    maxWidth: "92%",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Archivo_600SemiBold",
    color: INK_200,
    lineHeight: 16,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  skeletonCard: {
    minHeight: 150,
    borderRadius: R_MD,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.16)",
  },
  skeletonHeader: {
    width: "46%",
    height: 22,
    borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginBottom: 16,
  },
  skeletonLineWide: {
    width: "74%",
    height: 14,
    borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 7,
  },
  skeletonLine: {
    width: "54%",
    height: 14,
    borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonSpinner: {
    alignSelf: "flex-start",
    marginTop: 18,
  },
  applyCTA: {
    marginTop: 4,
    paddingVertical: 15,
    backgroundColor: CYAN,
    borderRadius: R_MD,
    alignItems: "center",
    shadowColor: CYAN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  applyCTAText: {
    fontSize: 15,
    fontFamily: "Archivo_800ExtraBold",
    color: "#fff",
    letterSpacing: 0.3,
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
