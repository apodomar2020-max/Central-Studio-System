/**
 * app/ballet/classes.tsx — My Ballet Classes
 *
 * Source of truth:
 *   GET /api/ballet/classes/my → authenticated account children, lifecycle
 *   state, and operational Classes/Schedules for each entitled child.
 *
 * The public programme catalogue is intentionally not used here.
 */

import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ClassCard from "@/components/ClassCard";
import { useAppContext } from "@/contexts/AppContext";
import {
  fetchMyBalletClasses,
  resolveBalletChildSelection,
  selectedBalletChild,
  type BalletClass,
  type BalletMyClassesChild,
  type BalletMyClassesEntitlementState,
} from "@/services/balletAssessmentService";
import type { DanceClass, Instructor } from "@/data/mockData";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";
import { scheduleLocationLabel } from "@/utils/scheduleLocation";

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

function scheduleSummary(item: BalletClass): string {
  const schedules = item.schedules;
  if (schedules.length === 0) return "Schedule TBC";
  return schedules
    .map((schedule) => `${DAY_NAMES[schedule.dayOfWeek] ?? "Weekly"} · ${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}`)
    .join("\n");
}

function durationLabel(item: BalletClass): string {
  const schedules = item.schedules;
  if (schedules.length === 0) return "";
  const uniqueDurations = [...new Set(schedules.map((schedule) => schedule.durationMins).filter((mins): mins is number => mins != null))];
  if (uniqueDurations.length === 1) return `${uniqueDurations[0]} min`;
  return schedules.length === 1 ? "" : `${schedules.length} weekly sessions`;
}

function levelLabelForClass(item: BalletClass, child: BalletMyClassesChild): string {
  const levelName = item.level?.name ?? child.level?.name ?? "Ballet";
  const groupName = item.group?.name ?? child.group?.name;
  return groupName ? `${levelName} · ${groupName}` : levelName;
}

function toDanceClass(item: BalletClass, child: BalletMyClassesChild): DanceClass {
  const firstScheduleForCard = item.schedules[0];
  return {
    id: `ballet-${item.id}`,
    scheduleId: firstScheduleForCard?.id != null ? `ballet-schedule-${firstScheduleForCard.id}` : undefined,
    scheduleType: "weekly",
    scheduleStatus: firstScheduleForCard ? "active" : undefined,
    packageEligible: false,
    categoryId: "ballet",
    categoryName: levelLabelForClass(item, child),
    instructorId: item.instructor ? `ballet-instructor-${item.instructor.id}` : "",
    title: item.title,
    description: "",
    photoUrl: normalizeMediaUrl(item.classImageUrl, "image"),
    classVideoUrl: normalizeMediaUrl(item.classVideoUrl, "video"),
    date: "",
    dayOfWeek: firstScheduleForCard ? DAY_NAMES[firstScheduleForCard.dayOfWeek] ?? "" : "",
    startTime: firstScheduleForCard ? formatTime(firstScheduleForCard.startTime) : "",
    endTime: firstScheduleForCard ? formatTime(firstScheduleForCard.endTime) : "",
    scheduleLabel: scheduleSummary(item),
    duration: durationLabel(item),
    location: firstScheduleForCard
      ? scheduleLocationLabel({ branch: firstScheduleForCard.branch, room: firstScheduleForCard.room }) ?? ""
      : "",
    room: "",
    price: 0,
    capacity: 0,
    bookedCount: 0,
    classCapacityEnabled: false,
    level: "All Levels",
    ageGroup: "Kids",
    status: firstScheduleForCard ? "available" : "unavailable",
    policy: "",
    featured: false,
    isBallet: true,
  };
}

type EmptyStateCopy = { title: string; body: string; actionLabel?: string; action: "login" | "apply" | "status" | null };

function lifecycleCopy(state: BalletMyClassesEntitlementState): EmptyStateCopy {
  switch (state) {
    case "no_application":
      return {
        title: "No Ballet Classes Yet",
        body: "Your child's classes will appear here after submitting a Ballet application, completing the assessment, receiving a Level and Group assignment, completing payment, and becoming active.",
        actionLabel: "Apply for Ballet",
        action: "apply",
      };
    case "application_pending":
      return { title: "Application Pending", body: "This application is being reviewed. Follow its progress in Application Status.", actionLabel: "Application Status", action: "status" };
    case "assessment_pending":
      return { title: "Assessment In Progress", body: "Classes will appear after the assessment and placement process is complete.", actionLabel: "Application Status", action: "status" };
    case "assignment_pending":
      return { title: "Placement In Progress", body: "A Level and Group must be assigned before this child's classes can appear.", actionLabel: "Application Status", action: "status" };
    case "payment_pending":
      return { title: "Payment Pending", body: "Classes will appear after the Ballet subscription payment is active.", actionLabel: "Application Status", action: "status" };
    case "activation_pending":
      return { title: "Activation Pending", body: "Placement and payment are ready. The enrollment must be activated before classes appear.", actionLabel: "Application Status", action: "status" };
    case "schedule_pending":
      return { title: "Schedule Not Assigned Yet", body: "This child is active, but their weekly Ballet schedule has not been configured yet. It will appear here automatically once assigned.", actionLabel: "Application Status", action: "status" };
    case "rejected":
      return { title: "Application Not Accepted", body: "This application is no longer active. You can review its status or apply again when appropriate.", actionLabel: "Application Status", action: "status" };
    case "cancelled":
      return { title: "Application Cancelled", body: "This child does not currently have an active Ballet entitlement.", actionLabel: "Apply for Ballet", action: "apply" };
    case "withdrawn":
      return { title: "Enrollment Ended", body: "This child's Ballet enrollment is no longer active.", actionLabel: "Apply for Ballet", action: "apply" };
    case "active":
      return { title: "Schedule Not Assigned Yet", body: "No active weekly Ballet schedule is currently available for this child.", action: null };
  }
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
  const { user, isLoading: authLoading } = useAppContext();

  const [children, setChildren] = useState<BalletMyClassesChild[]>([]);
  const [selectedChildKey, setSelectedChildKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, refreshing = false) => {
    if (authLoading) return;
    if (refreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);
    if (!user) {
      setChildren([]);
      setSelectedChildKey(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    try {
      const response = await fetchMyBalletClasses(signal);
      if (signal?.aborted) return;
      setChildren(response.children);
      setSelectedChildKey((current) => resolveBalletChildSelection(response.children, current));
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setChildren([]);
      setSelectedChildKey(null);
      setErrorMessage("Unable to load Ballet classes right now.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [authLoading, user]);

  useFocusEffect(useCallback(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]));

  const onRefresh = useCallback(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal, true);
  }, [load]);

  const selectedChild = useMemo(
    () => selectedBalletChild(children, selectedChildKey),
    [children, selectedChildKey],
  );
  const visibleClasses = selectedChild?.entitlementState === "active" ? selectedChild.classes : [];
  const visibleWeeklyScheduleCount = selectedChild?.entitlementState === "active" ? selectedChild.weeklyScheduleCount : 0;

  const runEmptyAction = useCallback((copy: EmptyStateCopy, child: BalletMyClassesChild | null) => {
    if (copy.action === "login") router.push("/auth/login");
    else if (copy.action === "apply") router.push("/ballet/assessment" as any);
    else if (copy.action === "status" && child?.applicationId != null) {
      router.push({ pathname: "/ballet/application-status" as any, params: { id: String(child.applicationId) } });
    }
  }, []);

  const emptyCopy: EmptyStateCopy = !user
    ? { title: "Sign In to View Classes", body: "My Ballet Classes is available to authenticated Central Studio accounts.", actionLabel: "Sign In", action: "login" }
    : selectedChild
      ? lifecycleCopy(selectedChild.entitlementState)
      : lifecycleCopy("no_application");

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

      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={CYAN} colors={[CYAN]} />}
      >
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
            <Text style={s.heroTitle}>{"MY BALLET\nCLASSES"}</Text>
            <Text style={s.heroDesc}>
              Weekly classes and schedules for each child on your account.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          {!isLoading && !errorMessage && children.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterScroll}>
              {children.map((child) => {
                const isActive = selectedChildKey === child.selectorKey;
                return (
                  <TouchableOpacity
                    key={child.selectorKey}
                    style={[s.filterChip, isActive && s.filterChipActive]}
                    onPress={() => setSelectedChildKey(child.selectorKey)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                  >
                    <View style={s.filterAvatar}>
                      <Text style={s.filterAvatarText}>{child.childName.slice(0, 2).toUpperCase()}</Text>
                    </View>
                    <Text style={[s.filterChipText, isActive && s.filterChipTextActive]} numberOfLines={1}>
                      {child.childName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          {!isLoading && !errorMessage && selectedChild ? (
            <Text style={s.weeklySessionCount} testID="ballet-weekly-session-count">
              {visibleWeeklyScheduleCount} weekly session{visibleWeeklyScheduleCount === 1 ? "" : "s"}
            </Text>
          ) : null}

          {isLoading || authLoading ? (
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
              <Text style={s.emptyTitle}>{emptyCopy.title}</Text>
              <Text style={s.emptyDesc}>{emptyCopy.body}</Text>
              {emptyCopy.actionLabel ? (
                <TouchableOpacity onPress={() => runEmptyAction(emptyCopy, selectedChild)} style={s.retryButton} activeOpacity={0.82}>
                  <Text style={s.retryText}>{emptyCopy.actionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            visibleClasses.map((item) => {
              const mappedClass = toDanceClass(item, selectedChild!);
              return (
                <ClassCard
                  key={item.id}
                  item={mappedClass}
                  instructor={toInstructor(item)}
                  variant="ballet"
                  displayOnly
                  imageUrl={mappedClass.photoUrl}
                  levelLabel={levelLabelForClass(item, selectedChild!)}
                  scheduleLabelOverride={scheduleSummary(item)}
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
  weeklySessionCount: { color: INK_200, fontSize: 13, marginBottom: 14 },
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
  filterScroll: { gap: 8, paddingBottom: 20 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 13, paddingLeft: 7, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", marginRight: 8 },
  filterChipActive: { backgroundColor: "#0A0B0D", borderColor: "rgba(0,182,215,0.5)" },
  filterAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  filterAvatarText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10, color: "#FFFFFF" },
  filterChipText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" },
  filterChipTextActive: { color: "#FFFFFF" },
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
