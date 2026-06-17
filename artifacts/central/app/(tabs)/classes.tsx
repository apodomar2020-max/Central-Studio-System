import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlatList,
  ImageBackground,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useListClasses, useListInstructors, useListSchedules } from "@workspace/api-client-react";
import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
} from "@/services/balletAssessmentService";

import {
  DANCE_CATEGORIES,
  AgeGroup,
  type DanceClass,
  type Instructor,
} from "@/data/mockData";
import { mapApiClassWithScheduleToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import ClassCard from "@/components/ClassCard";
import EmptyState from "@/components/EmptyState";
import { ListSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";

const AGE_GROUPS: { key: AgeGroup | "All"; label: string; icon: string }[] = [
  { key: "All", label: "All Ages", icon: "people-outline" },
  { key: "Kids", label: "Kids", icon: "happy-outline" },
  { key: "Teens", label: "Teens", icon: "person-outline" },
  { key: "Adults", label: "Adults", icon: "people-circle-outline" },
];

const BALLET_CATEGORY = DANCE_CATEGORIES.find((c) => c.isBallet);

// ─── Ballet card ──────────────────────────────────────────────────────────────

const BALLET_COLOR = "#00B6D6";

// Statuses that mean the parent has an active/pending application → Details mode
const DETAIL_MODE_STATUSES = new Set([
  "submitted", "pendingAssessment", "needsFollowUp",
  "accepted", "assignedToLevel", "activeBallet",
]);

function getStatusBadgeLabel(status: string): string {
  switch (status) {
    case "submitted":         return "UNDER REVIEW";
    case "pendingAssessment": return "SCHEDULED";
    case "needsFollowUp":     return "FOLLOW-UP";
    case "accepted":          return "ACCEPTED";
    case "assignedToLevel":   return "LEVEL ASSIGNED";
    case "activeBallet":      return "ACTIVE";
    case "rejected":          return "NOT ACCEPTED";
    case "cancelled":         return "CANCELLED";
    default:                  return status.toUpperCase();
  }
}

/** Matches the color palette used in ballet/application-status.tsx */
function getStatusBadgeColor(status: string): string {
  switch (status) {
    case "submitted":         return "#F59E0B";
    case "pendingAssessment": return "#60A5FA";
    case "needsFollowUp":     return "#F59E0B";
    case "accepted":          return "#22C55E";
    case "assignedToLevel":   return BALLET_COLOR;
    case "activeBallet":      return BALLET_COLOR;
    case "rejected":          return "#EF4444";
    case "cancelled":         return "#6B7280";
    default:                  return "#9CA3AF";
  }
}

const BALLET_PILLS = ["Professional Instructors", "Level Assessment", "Performance Opportunities"] as const;

/** Ballerina shoe SVG icon — used in the ballet program card */
function BalletShoeIcon({ size = 22, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Path fill={color} d="M197.6 14.67c.5 4.53 1.1 9.7 1.5 16.34 1.1 15.45 1.7 35.77.8 56.37-.8 18.22-2.7 36.52-6.8 52.22 20 6.5 40.9 15.4 58.2 24.8.3-8.8.6-17.6 1-26.2-17.5-39.52-35-79.46-43.4-123.53zm29.7.12c11.2 55.18 38 105.41 60.3 159.61 15.1-5.3 30.4-9.4 45.7-12.9l-.6-1v-2.8c.7-45.5 2.6-97.35-6.4-142.91zM187.2 156.7c-.1.2-.2.4-.3.7 8.6 7.4 18.1 16.7 28 26.8 11.9 12.3 24 25.6 34.4 38.1.6-12.5 1-25 1.3-37.4-17-10.1-41.1-20.8-63.4-28.2zm-10.9 15.5c-2.5 2.2-5.2 4-8.2 5.4-1.3 39.3 5.1 75.5 17 107.8 25.6-9.6 45.5-24.1 59.9-39.6-11.2-14.8-27.3-33-43-49-9-9.3-18-17.8-25.7-24.6zm166.8 5.5c-16.7 3.8-33 8-49 13.5l-.1 1.7c-.7 8.3-1.3 16.6-1.8 24.9 6.6 6.6 13.9 12.8 21.7 18.6l.1-.1c9.3-14.2 19-28 27.4-38.8 2.5-3.1 4.9-5.9 7.2-8.5-1.7-3.8-3.6-7.5-5.5-11.3zm-195.9 1.2c-28.7-.1-49.28 6.3-51.95 30.9-3.35 30.8 75.55 202 69.25 261.7-2.9 27.8 42.5 25.5 58.3-2.8 11.6-20.8 13.1-48.2 11.6-74.1l-8-8.5c-46.8-49.3-78.6-121.9-76.4-207.2zm208.7 29.4c-.1.2-.2.3-.3.4-8 10-17.4 23.5-26.6 37.4-.1.2-.2.3-.3.5 11.6 7.3 24.3 13.9 37.8 19.4-1.4-20.1-4.8-39.4-10.6-57.7zm22.3 13.8c9.1 39.7 8.5 82.5 4.3 126.4-3.8 38.5-74.2 55.5-97.3-.2-8.3 58.5 10.2 88.8 37.3 127 14 19.6 52.3 24 64.8 4.2 27.1-43 18.5-85.7 12.7-134-5-41.3-1.4-87.8-21.8-123.4zm-87 19.2c-.2 10.4-.2 20.7.2 31 3.9-6.5 8.2-13.5 12.7-20.7-4.4-3.3-8.8-6.7-12.9-10.3zm27.8 20.5c-5.4 8.6-10.6 17-14.8 24.3-4.4 7.5-7.9 14.1-10.2 18.5 1 8.1 2.3 16.2 4 24.2 13 62.3 65.2 32.3 66.5 17.9 2.1-21 3.2-41.4 2.9-61.1-17.5-6.5-33.7-14.5-48.4-23.8zm-72.7 7.8c-14.5 12.8-32.7 24.3-54.4 32.4 10 22.6 22.8 42.8 37.5 60.4 9.1-29 14.1-60.6 16.9-92.8z" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [activeAge, setActiveAge] = useState<AgeGroup | "All">("All");
  const [activeCat, setActiveCat] = useState<string>("all");

  // ── Ballet application status ──────────────────────────────────────────────
  const [balletStatus, setBalletStatus] = useState<string | null>(null);

  // Re-fetch on every focus so the card stays accurate after returning from assessment/status screens
  useFocusEffect(
    useCallback(() => {
      const ctrl = new AbortController();
      fetchMyApplications(ctrl.signal)
        .then((apps) => {
          if (ctrl.signal.aborted) return;
          const active = apps.find((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
          setBalletStatus(active?.status ?? apps[0]?.status ?? null);
        })
        .catch(() => {
          // silently ignore — card defaults to Apply mode
        });
      return () => ctrl.abort();
    }, [])
  );

  // Live data from the backend API. Categories are not yet exposed by the API,
  // so the mock category list still drives the section grouping below.
  const classesQuery = useListClasses();
  const instructorsQuery = useListInstructors();
  const schedulesQuery = useListSchedules();
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;

  const isLoading = classesQuery.isLoading || instructorsQuery.isLoading || schedulesQuery.isLoading;
  const isError = classesQuery.isError || instructorsQuery.isError || schedulesQuery.isError;
  // Prefer the classes error for offline detection (it's the primary data source)
  const queryError = classesQuery.error ?? instructorsQuery.error ?? schedulesQuery.error;
  const isOffline = isOfflineError(queryError);

  const isRefreshing = classesQuery.isRefetching || instructorsQuery.isRefetching || schedulesQuery.isRefetching;
  const onRefresh = useCallback(() => {
    classesQuery.refetch();
    instructorsQuery.refetch();
    schedulesQuery.refetch();
    classPricingQuery.refetch();
  }, [classesQuery, instructorsQuery, schedulesQuery, classPricingQuery]);

  // Map API rows to the mobile data model. Return empty arrays when data isn't
  // loaded yet — loading/error states are handled separately in the render.
  const instructors: Instructor[] = useMemo(
    () => (instructorsQuery.data ?? []).map(mapApiInstructorToMobile),
    [instructorsQuery.data],
  );

  const classes: DanceClass[] = useMemo(
    () => {
      const schedulesByClassId = new Map<number, NonNullable<typeof schedulesQuery.data>[number]>();
      [...(schedulesQuery.data ?? [])]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
        .forEach((schedule) => {
          if (!schedulesByClassId.has(schedule.classId)) {
            schedulesByClassId.set(schedule.classId, schedule);
          }
        });

      return (classesQuery.data ?? [])
        .filter((c) => c.isActive)
        .map((c) => mapApiClassWithScheduleToMobile(
          c,
          schedulesByClassId.get(c.id),
          singleClassPriceEgp,
        ));
    },
    [classesQuery.data, schedulesQuery.data, singleClassPriceEgp],
  );

  const instructorById = useMemo(() => {
    const map = new Map<string, Instructor>();
    instructors.forEach((i) => map.set(i.id, i));
    return map;
  }, [instructors]);

  const nonBalletCats = DANCE_CATEGORIES.filter((c) => !c.isBallet);
  // Known category ids set — used to detect truly unmatched classes
  const knownCatIds = useMemo(() => new Set(nonBalletCats.map((c) => c.id)), [nonBalletCats]);

  const filtered = classes.filter((cls) => {
    if (cls.isBallet) return false;
    const matchAge = activeAge === "All" || cls.ageGroup === activeAge;
    const matchCat = activeCat === "all" || cls.categoryId === activeCat;
    const matchSearch =
      !search ||
      cls.title.toLowerCase().includes(search.toLowerCase()) ||
      cls.categoryName.toLowerCase().includes(search.toLowerCase());
    return matchAge && matchCat && matchSearch;
  });

  function handleAgeFilter(age: AgeGroup | "All") {
    Haptics.selectionAsync();
    setActiveAge(age);
    setActiveCat("all");
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <Text style={styles.title}>Classes</Text>

        <View style={[styles.searchRow, { backgroundColor: "#1E1E26", borderColor: "#2A2A35" }]}>
          <Ionicons name="search-outline" size={16} color="#6B7280" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search classes..."
            placeholderTextColor="#6B7280"
            style={styles.searchInput}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.ageRow}>
          {AGE_GROUPS.map((ag) => (
            <TouchableOpacity
              key={ag.key}
              onPress={() => handleAgeFilter(ag.key)}
              style={[
                styles.agePill,
                activeAge === ag.key && {
                  backgroundColor: colors.studio.primary,
                  borderColor: colors.studio.primary,
                },
              ]}
              activeOpacity={0.8}
            >
              <Ionicons
                name={ag.icon as any}
                size={14}
                color={activeAge === ag.key ? "#000" : "#9CA3AF"}
              />
              <Text
                style={[
                  styles.agePillText,
                  activeAge === ag.key && { color: "#000", fontFamily: "Inter_700Bold" },
                ]}
              >
                {ag.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading ? (
        <ListSkeleton count={4} />
      ) : isError ? (
        isOffline ? (
          <OfflineState onRetry={onRefresh} />
        ) : (
          <ErrorState onRetry={onRefresh} />
        )
      ) : (
        <>
      {BALLET_CATEGORY && (() => {
        const isDetailMode = balletStatus !== null && DETAIL_MODE_STATUSES.has(balletStatus);
        const ctaLabel = isDetailMode ? "View Details" : "Apply for Assessment";
        const ctaRoute = isDetailMode ? "/ballet/application-status" : "/ballet/assessment";

        return (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push(ctaRoute as any);
            }}
            activeOpacity={0.88}
            style={styles.balletCardWrap}
          >
            <ImageBackground
              source={require("@/assets/images/ballet_hero.png")}
              style={styles.balletCard}
              imageStyle={styles.balletCardImage}
            >
              {/* Dark overlay */}
              <View style={styles.balletOverlay} />

              {/* Card body */}
              <View style={styles.balletCardContent}>
                {/* TOP ROW: icon · title+subtitle · status badge (right-aligned with CTA) */}
                <View style={styles.balletTopRow}>
                  <View style={styles.balletIconCircle}>
                    <BalletShoeIcon size={22} color={BALLET_COLOR} />
                  </View>
                  <View style={styles.balletTitleGroup}>
                    <Text style={styles.balletTitle}>Ballet Program</Text>
                    <Text style={styles.balletSubtitle}>
                      Classical Ballet Program · For ages 4–12 years
                    </Text>
                  </View>
                  {/* Badge sits here — right-aligned with CTA button below */}
                  <View style={styles.balletCtaWrap}>
                    {balletStatus ? (
                      <View style={[
                        styles.balletStatusBadge,
                        {
                          backgroundColor: getStatusBadgeColor(balletStatus) + "28",
                          borderColor:     getStatusBadgeColor(balletStatus) + "60",
                        },
                      ]}>
                        <Text style={[
                          styles.balletStatusBadgeText,
                          { color: getStatusBadgeColor(balletStatus) },
                        ]}>
                          {getStatusBadgeLabel(balletStatus)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* BOTTOM ROW: features (left, flex 1) + CTA button (right, bottom-aligned) */}
                <View style={styles.balletBottomRow}>
                  <View style={styles.balletPills}>
                    {BALLET_PILLS.map((pill) => (
                      <View key={pill} style={styles.balletPill}>
                        <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                        <Text style={styles.balletPillText}>{pill}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.balletCtaWrap}>
                    <View style={styles.balletCtaBtn}>
                      <Text style={styles.balletCtaBtnText}>{ctaLabel}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        );
      })()}

      {/* Only show category sections that have at least one matching class.
          Derived from `filtered` so the list reacts to age/search/cat changes
          without relying on the static DANCE_CATEGORIES.ageGroups config. */}
      <FlatList
        data={nonBalletCats.filter((c) => filtered.some((cls) => cls.categoryId === c.id))}
        keyExtractor={(i) => i.id}
        renderItem={({ item: cat }) => {
          const catClasses = filtered.filter((c) => c.categoryId === cat.id);
          if (catClasses.length === 0) return null;
          return (
            <View style={styles.catGroup}>
              <TouchableOpacity
                onPress={() => setActiveCat(activeCat === cat.id ? "all" : cat.id)}
                style={styles.catGroupHeader}
                activeOpacity={0.8}
              >
                <View style={[styles.catDot, { backgroundColor: colors.studio.primary }]} />
                <Text style={styles.catGroupTitle}>{cat.name}</Text>
                <Text style={styles.catGroupCount}>{catClasses.length} class{catClasses.length !== 1 ? "es" : ""}</Text>
                <Ionicons
                  name={activeCat === cat.id ? "chevron-up" : "chevron-down"}
                  size={14}
                  color="#6B7280"
                />
              </TouchableOpacity>
              {(activeCat === "all" || activeCat === cat.id) &&
                catClasses.map((cls) => (
                  <ClassCard key={cls.id} item={cls} instructor={instructorById.get(cls.instructorId)} />
                ))}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="musical-notes-outline"
            title="No classes found"
            description="Try adjusting your filters or search term"
            actionLabel="Clear filters"
            onAction={() => { setSearch(""); setActiveAge("All"); setActiveCat("all"); }}
          />
        }
        ListHeaderComponent={
          filtered.length > 0 ? (
            <Text style={styles.resultCount}>{filtered.length} class{filtered.length !== 1 ? "es" : ""}</Text>
          ) : null
        }
        ListFooterComponent={() => {
          // Classes that didn't match any known category after fuzzy normalization
          const otherClasses = filtered.filter((cls) => !knownCatIds.has(cls.categoryId));
          if (otherClasses.length === 0) return null;
          return (
            <View style={styles.catGroup}>
              <View style={styles.catGroupHeader}>
                <View style={[styles.catDot, { backgroundColor: "#6B7280" }]} />
                <Text style={styles.catGroupTitle}>Other</Text>
                <Text style={styles.catGroupCount}>{otherClasses.length} class{otherClasses.length !== 1 ? "es" : ""}</Text>
              </View>
              {otherClasses.map((cls) => (
                <ClassCard key={cls.id} item={cls} instructor={instructorById.get(cls.instructorId)} />
              ))}
            </View>
          );
        }}
        contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === "web" ? 120 : 90 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.studio.primary}
            colors={[colors.studio.primary]}
          />
        }
      />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 10,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  ageRow: { flexDirection: "row", gap: 8 },
  agePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    borderWidth: 1,
    borderColor: "#2A2A35",
  },
  agePillText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#9CA3AF",
  },
  balletCardWrap: { marginHorizontal: 20, marginBottom: 12 },
  balletCard: { borderRadius: 18, overflow: "hidden" },
  balletCardImage: { borderRadius: 18 },
  balletOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 14, 22, 0.78)",
    borderRadius: 18,
  },
  balletStatusBadge: {
    /* bg + border set dynamically via getStatusBadgeColor() inline style */
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    alignSelf: "center",
  },
  balletStatusBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    /* color set dynamically via getStatusBadgeColor() inline style */
    letterSpacing: 0.6,
  },
  balletCardContent: {
    flexDirection: "column",
    padding: 16,
    gap: 14,
  },
  /* TOP ROW — icon beside title+subtitle */
  balletTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  balletTitleGroup: {
    flex: 1,
    gap: 4,
  },
  /* BOTTOM ROW — pills fill left, CTA anchors bottom-right */
  balletBottomRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  balletIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  balletTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  balletSubtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
    lineHeight: 16,
  },
  balletPills: { flex: 1, flexDirection: "column", gap: 6 },
  balletPill: {
    backgroundColor: "rgba(0, 182, 214, 0.22)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
  },
  balletPillText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#FFFFFF",
  },
  balletCtaWrap: { alignItems: "flex-end", justifyContent: "center", flexShrink: 0 },
  balletCtaBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  balletCtaBtnText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
    textAlign: "center",
  },
  resultCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  list: { paddingHorizontal: 20 },
  catGroup: { marginBottom: 8 },
  catGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
  },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catGroupTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  catGroupCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
});
