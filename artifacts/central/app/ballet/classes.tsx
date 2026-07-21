/**
 * app/ballet/classes.tsx — Ballet Classes
 *
 * Source of truth:
 *   GET /api/ballet/classes → active ballet_classes with instructor, levels,
 *   groups, and active weekly schedules.
 *   GET /api/ballet/levels → active ballet_levels used for dynamic level tabs.
 *
 * This screen is display-only. Ballet classes belong to the fixed Ballet
 * program, so generic search, age filters, capacity, booking, and package
 * actions are intentionally omitted.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

import ClassCard from "@/components/ClassCard";
import {
  fetchBalletClasses,
  fetchBalletLevels,
  type BalletClass,
  type BalletClassSchedule,
  type BalletLevel,
} from "@/services/balletAssessmentService";
import type { DanceClass, Instructor } from "@/data/mockData";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_400 = "#6B7280";
const R_MD = 12;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minsStr} ${ampm}`;
}

function scheduleSummary(schedule: BalletClassSchedule | null): string {
  if (!schedule) return "Schedule TBC";
  return `${DAY_NAMES[schedule.dayOfWeek] ?? "Weekly"} · ${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`;
}

function durationLabel(schedule: BalletClassSchedule | null): string {
  const mins = schedule?.durationMins;
  return mins != null ? `${mins} min` : "";
}

function levelLabelForClass(item: BalletClass, levelNameById: Map<number, string>): string {
  return levelNameById.get(item.levelId) ?? "Ballet";
}

function toDanceClass(item: BalletClass, levelNameById: Map<number, string>): DanceClass {
  const firstSchedule = item.schedule;
  return {
    id: `ballet-${item.id}`,
    scheduleId: firstSchedule ? `ballet-schedule-${firstSchedule.id}` : undefined,
    scheduleType: "weekly",
    scheduleStatus: firstSchedule ? "active" : undefined,
    packageEligible: false,
    categoryId: "ballet",
    categoryName: levelLabelForClass(item, levelNameById),
    instructorId: item.instructor ? `ballet-instructor-${item.instructor.id}` : "",
    title: item.title,
    description: "",
    photoUrl: normalizeMediaUrl(item.classImageUrl, "image"),
    classVideoUrl: normalizeMediaUrl(item.classVideoUrl, "video"),
    date: "",
    dayOfWeek: firstSchedule ? DAY_NAMES[firstSchedule.dayOfWeek] ?? "" : "",
    startTime: firstSchedule ? formatTime(firstSchedule.startTime) : "",
    endTime: firstSchedule ? formatTime(firstSchedule.endTime) : "",
    scheduleLabel: scheduleSummary(item.schedule),
    duration: durationLabel(item.schedule),
    location: "",
    room: "",
    price: 0,
    capacity: 0,
    bookedCount: 0,
    classCapacityEnabled: false,
    level: "All Levels",
    ageGroup: "Kids",
    status: firstSchedule ? "available" : "unavailable",
    policy: "",
    featured: false,
    isBallet: true,
  };
}

function toInstructor(item: BalletClass): Instructor | undefined {
  if (!item.instructor) return undefined;
  const name = item.instructor.name;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return {
    id: `ballet-instructor-${item.instructor.id}`,
    name,
    title: "Ballet Instructor",
    bio: "",
    danceStyles: ["Ballet"],
    rating: 0,
    totalClasses: 0,
    photoColor: CYAN,
    initials,
    photoUrl: normalizeMediaUrl(item.instructor.photoUrl, "image"),
  };
}

export default function BalletClassesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [classes, setClasses] = useState<BalletClass[]>([]);
  const [levels, setLevels] = useState<BalletLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<number | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [classesData, levelsData] = await Promise.all([
        fetchBalletClasses(signal),
        fetchBalletLevels(signal),
      ]);
      if (signal?.aborted) return;
      setClasses(classesData);
      setLevels(levelsData);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setClasses([]);
      setLevels([]);
      setErrorMessage("Unable to load Ballet classes right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const levelNameById = useMemo(() => {
    const m = new Map<number, string>();
    levels.forEach((level) => m.set(level.id, level.name));
    return m;
  }, [levels]);

  const visibleClasses = useMemo(() => {
    if (selectedLevelId === "all") return classes;
    return classes.filter((item) => item.levelId === selectedLevelId);
  }, [classes, selectedLevelId]);

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
            <Text style={s.heroTitle}>{"BALLET\nCLASSES"}</Text>
            <Text style={s.heroDesc}>
              Browse the weekly Ballet program classes assigned to each level.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabsContent}
          >
            <TouchableOpacity
              onPress={() => setSelectedLevelId("all")}
              style={[s.levelTab, selectedLevelId === "all" && s.levelTabActive]}
              activeOpacity={0.85}
            >
              <Text style={[s.levelTabText, selectedLevelId === "all" && s.levelTabTextActive]}>All</Text>
            </TouchableOpacity>
            {levels.map((level) => (
              <TouchableOpacity
                key={level.id}
                onPress={() => setSelectedLevelId(level.id)}
                style={[s.levelTab, selectedLevelId === level.id && s.levelTabActive]}
                activeOpacity={0.85}
              >
                <Text style={[s.levelTabText, selectedLevelId === level.id && s.levelTabTextActive]} numberOfLines={1}>
                  {level.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {isLoading ? (
            <View style={s.center}>
              <ActivityIndicator color={CYAN} />
            </View>
          ) : errorMessage ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>Classes unavailable</Text>
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
          ) : visibleClasses.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="calendar-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No Ballet classes available.</Text>
              <Text style={s.emptyDesc}>
                Classes will appear here when they are added for the selected level.
              </Text>
            </View>
          ) : (
            visibleClasses.map((item) => {
              const mappedClass = toDanceClass(item, levelNameById);
              return (
                <ClassCard
                  key={item.id}
                  item={mappedClass}
                  instructor={toInstructor(item)}
                  variant="ballet"
                  displayOnly
                  imageUrl={mappedClass.photoUrl}
                  levelLabel={levelLabelForClass(item, levelNameById)}
                  scheduleLabelOverride={scheduleSummary(item.schedule)}
                />
              );
            })
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
  },
  tabsContent: {
    gap: 8,
    paddingBottom: 14,
  },
  levelTab: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: R_MD,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxWidth: 170,
  },
  levelTabActive: {
    backgroundColor: "rgba(0,182,215,0.14)",
    borderColor: "rgba(0,182,215,0.42)",
  },
  levelTabText: {
    fontSize: 12,
    fontFamily: "Archivo_700Bold",
    color: INK_400,
  },
  levelTabTextActive: {
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
