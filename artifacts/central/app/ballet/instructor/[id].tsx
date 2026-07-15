/**
 * app/ballet/instructor/[id].tsx — Ballet instructor detail
 *
 * Loads one active Ballet instructor from GET /api/ballet/instructors/:id.
 * Uses only real fields from ballet_instructors.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchBalletInstructor, type BalletInstructor } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const R_MD = 12;

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <Text style={s.mutedText}>Not specified</Text>;
  return (
    <View style={s.chipWrap}>
      {items.map((item) => (
        <View key={item} style={s.chip}>
          <Text style={s.chipText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function BalletInstructorDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const routeId = Array.isArray(id) ? id[0] : id;
  const instructorId = Number(routeId);

  const [instructor, setInstructor] = useState<BalletInstructor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!Number.isInteger(instructorId) || instructorId <= 0) {
      setInstructor(null);
      setErrorMessage("Invalid instructor.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletInstructor(instructorId, signal);
      if (signal?.aborted) return;
      setInstructor(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setInstructor(null);
      setErrorMessage("Unable to load this instructor right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [instructorId]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const photoUrl = normalizeMediaUrl(instructor?.photoUrl, "image");

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  return (
    <View style={s.screen}>
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

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={CYAN} />
        </View>
      ) : errorMessage || !instructor ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
          </View>
          <Text style={s.emptyTitle}>Instructor unavailable</Text>
          <Text style={s.emptyDesc}>{errorMessage ?? "Instructor not found."}</Text>
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
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} bounces>
          <View style={[s.hero, { minHeight: topPad + 360 }]}>
            {photoUrl && !imageFailed ? (
              <Image
                source={{ uri: photoUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <LinearGradient
                colors={[CYAN + "BB", CYAN + "33", BASE]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFill}
              >
                <View style={s.initialsWrap}>
                  <Text style={s.initials}>{initialsFromName(instructor.name)}</Text>
                </View>
              </LinearGradient>
            )}
            <LinearGradient
              colors={["rgba(5,6,8,0.1)", "rgba(5,6,8,0.56)", "rgba(5,6,8,0.97)"]}
              locations={[0, 0.5, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View style={[s.heroContent, { paddingTop: topPad + 128 }]}>
              <Text style={s.heroEyebrow}>Ballet Instructor</Text>
              <Text style={s.name}>{instructor.name}</Text>
              <View style={s.metaRow}>
                {instructor.experienceYears > 0 && (
                  <Text style={s.metaPill}>{instructor.experienceYears} yrs experience</Text>
                )}
                {!!instructor.teachingLevel && (
                  <Text style={s.metaPill}>{instructor.teachingLevel}</Text>
                )}
              </View>
            </View>
          </View>

          <View style={s.content}>
            <Section title="Bio">
              <Text style={s.bodyText}>{instructor.bio || "No biography provided."}</Text>
            </Section>

            <Section title="Dance Styles">
              <ChipList items={instructor.specialties} />
            </Section>

            <Section title="Teaching Philosophy">
              <Text style={s.bodyText}>{instructor.teachingPhilosophy || "Not specified"}</Text>
            </Section>

            <Section title="Achievements">
              {instructor.achievements.length > 0 ? (
                <View style={s.list}>
                  {instructor.achievements.map((item) => (
                    <Text key={item} style={s.listItem}>• {item}</Text>
                  ))}
                </View>
              ) : (
                <Text style={s.mutedText}>Not specified</Text>
              )}
            </Section>

            <Section title="Professional Experience">
              {instructor.professionalExperience.length > 0 ? (
                <View style={s.list}>
                  {instructor.professionalExperience.map((item) => (
                    <Text key={item} style={s.listItem}>• {item}</Text>
                  ))}
                </View>
              ) : (
                <Text style={s.mutedText}>Not specified</Text>
              )}
            </Section>
          </View>

          <View style={{ height: Platform.OS === "web" ? 120 : 80 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BASE },
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  hero: {
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
  },
  initialsWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontSize: 76,
    fontFamily: "Archivo_800ExtraBold",
    color: "rgba(255,255,255,0.9)",
  },
  heroContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 26,
  },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 8,
  },
  name: {
    fontSize: 48,
    fontFamily: "Anton_400Regular",
    textTransform: "uppercase",
    lineHeight: 46,
    letterSpacing: 0.5,
    color: "#FFFFFF",
    ...iosDisplayTextStyle(48, 46),
    marginTop: -iosCapGuard(48, 46),
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  metaPill: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,182,215,0.16)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.32)",
    fontSize: 11,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  section: {
    padding: 16,
    borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Archivo_800ExtraBold",
    color: CYAN,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 22,
  },
  mutedText: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    lineHeight: 20,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,182,215,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
  },
  chipText: {
    fontSize: 12,
    fontFamily: "Archivo_700Bold",
    color: CYAN,
  },
  list: { gap: 8 },
  listItem: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: INK_300,
    lineHeight: 21,
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
