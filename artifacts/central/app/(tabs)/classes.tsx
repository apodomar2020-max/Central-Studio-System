import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
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
import { useListClasses, useListInstructors } from "@workspace/api-client-react";
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
import { mapApiClassToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import ClassCard from "@/components/ClassCard";
import EmptyState from "@/components/EmptyState";
import { ListSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";

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

const BALLET_PILLS = ["Professional Instructors", "Level Assessment", "Performance Opportunities"] as const;

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

  const isLoading = classesQuery.isLoading || instructorsQuery.isLoading;
  const isError = classesQuery.isError || instructorsQuery.isError;
  // Prefer the classes error for offline detection (it's the primary data source)
  const queryError = classesQuery.error ?? instructorsQuery.error;
  const isOffline = isOfflineError(queryError);

  const isRefreshing = classesQuery.isRefetching || instructorsQuery.isRefetching;
  const onRefresh = useCallback(() => {
    classesQuery.refetch();
    instructorsQuery.refetch();
  }, [classesQuery, instructorsQuery]);

  // Map API rows to the mobile data model. Return empty arrays when data isn't
  // loaded yet — loading/error states are handled separately in the render.
  const instructors: Instructor[] = useMemo(
    () => (instructorsQuery.data ?? []).map(mapApiInstructorToMobile),
    [instructorsQuery.data],
  );

  const classes: DanceClass[] = useMemo(
    () => (classesQuery.data ?? []).filter((c) => c.isActive).map(mapApiClassToMobile),
    [classesQuery.data],
  );

  const instructorById = useMemo(() => {
    const map = new Map<string, Instructor>();
    instructors.forEach((i) => map.set(i.id, i));
    return map;
  }, [instructors]);

  const nonBalletCats = DANCE_CATEGORIES.filter((c) => !c.isBallet);

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
        const ctaLabel = isDetailMode ? "View Details" : "Apply for\nAssessment";
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
              source={require("@/assets/images/studio_hero.png")}
              style={styles.balletCard}
              imageStyle={styles.balletCardImage}
            >
              {/* Dark overlay */}
              <View style={styles.balletOverlay} />

              {/* Status badge — top-right corner, only if an application exists */}
              {balletStatus && (
                <View style={styles.balletStatusBadge}>
                  <Text style={styles.balletStatusBadgeText}>
                    {getStatusBadgeLabel(balletStatus)}
                  </Text>
                </View>
              )}

              {/* Card body */}
              <View style={styles.balletCardContent}>
                {/* Left: icon + text + pills */}
                <View style={styles.balletCardLeft}>
                  <View style={styles.balletIconCircle}>
                    <Ionicons name="musical-notes" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={styles.balletTitle}>Ballet Program</Text>
                  <Text style={styles.balletSubtitle}>
                    Classical Ballet Program{"\n"}For ages 4–12 years
                  </Text>
                  <View style={styles.balletPills}>
                    {BALLET_PILLS.map((pill) => (
                      <View key={pill} style={styles.balletPill}>
                        <Text style={styles.balletPillText}>{pill}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Right: CTA button */}
                <View style={styles.balletCtaWrap}>
                  <View style={styles.balletCtaBtn}>
                    <Text style={styles.balletCtaBtnText}>{ctaLabel}</Text>
                  </View>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        );
      })()}

      <FlatList
        data={nonBalletCats.filter((c) => activeAge === "All" || c.ageGroups.includes(activeAge))}
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
  balletCard: { borderRadius: 18, minHeight: 160, overflow: "hidden" },
  balletCardImage: { borderRadius: 18 },
  balletOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 14, 22, 0.78)",
    borderRadius: 18,
  },
  balletStatusBadge: {
    position: "absolute",
    top: 10,
    right: 12,
    backgroundColor: "rgba(0,182,214,0.18)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(0,182,214,0.4)",
  },
  balletStatusBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
    letterSpacing: 0.6,
  },
  balletCardContent: {
    flexDirection: "row",
    padding: 14,
    paddingTop: 16,
    alignItems: "center",
    gap: 10,
  },
  balletCardLeft: { flex: 1, gap: 4 },
  balletIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  balletTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  balletSubtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
    lineHeight: 16,
  },
  balletPills: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  balletPill: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  balletPillText: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.8)",
  },
  balletCtaWrap: { alignItems: "center", justifyContent: "center" },
  balletCtaBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
    maxWidth: 96,
  },
  balletCtaBtnText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
    textAlign: "center",
    lineHeight: 15,
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
