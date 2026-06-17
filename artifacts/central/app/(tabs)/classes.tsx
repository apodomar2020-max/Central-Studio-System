import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
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

// ─── Ballet card meta ─────────────────────────────────────────────────────────

const BALLET_COLOR = "#A78BFA";

interface BalletCardMeta {
  title: string;
  desc: string;
  badge: string;
  badgeColor: string;
  cta: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}

function getBalletMeta(status: string | null): BalletCardMeta {
  switch (status) {
    case "submitted":
      return { title: "Application Submitted", desc: "Your application is under review", badge: "UNDER REVIEW", badgeColor: "#F59E0B", cta: "View Status", icon: "time-outline" };
    case "pendingAssessment":
      return { title: "Assessment Scheduled", desc: "Your appointment is confirmed", badge: "SCHEDULED", badgeColor: "#60A5FA", cta: "View Status", icon: "calendar-outline" };
    case "needsFollowUp":
      return { title: "Follow-up Required", desc: "Our team needs more information", badge: "FOLLOW-UP", badgeColor: "#F59E0B", cta: "View Status", icon: "chatbubble-ellipses-outline" };
    case "accepted":
      return { title: "Accepted!", desc: "Your child has been accepted into ballet", badge: "ACCEPTED", badgeColor: "#22C55E", cta: "View Details", icon: "checkmark-circle" };
    case "assignedToLevel":
      return { title: "Level Assigned", desc: "Your child has been assigned a ballet level", badge: "LEVEL ASSIGNED", badgeColor: BALLET_COLOR, cta: "View Details", icon: "ribbon-outline" };
    case "activeBallet":
      return { title: "Active Ballet Student", desc: "Your child is an active ballet student", badge: "ACTIVE", badgeColor: BALLET_COLOR, cta: "View Details", icon: "star-outline" };
    case "rejected":
      return { title: "Not Accepted", desc: "You may submit a new application", badge: "NOT ACCEPTED", badgeColor: "#EF4444", cta: "Apply Again", icon: "close-circle-outline" };
    case "cancelled":
      return { title: "Application Cancelled", desc: "Submit a new application at any time", badge: "CANCELLED", badgeColor: "#6B7280", cta: "Apply Again", icon: "ban-outline" };
    default:
      return { title: "Ballet Programme", desc: "By assessment only — apply to join our classes", badge: "ASSESSMENT", badgeColor: BALLET_COLOR, cta: "Apply Now", icon: "musical-notes-outline" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [activeAge, setActiveAge] = useState<AgeGroup | "All">("All");
  const [activeCat, setActiveCat] = useState<string>("all");

  // ── Ballet application status ──────────────────────────────────────────────
  const [balletStatus, setBalletStatus] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (ctrl.signal.aborted) return;
        const active = apps.find((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));
        setBalletStatus(active?.status ?? apps[0]?.status ?? null);
      })
      .catch(() => {
        // silently ignore — card defaults to "Apply Now" state
      });
    return () => ctrl.abort();
  }, []);

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
        const meta = getBalletMeta(balletStatus);
        return (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/ballet" as any);
            }}
            activeOpacity={0.88}
            style={styles.balletCardWrap}
          >
            <LinearGradient
              colors={["#1F0F3D", "#120820", "#0A0514"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.balletCard, { borderColor: meta.badgeColor + "30" }]}
            >
              {/* Top row */}
              <View style={styles.balletCardTop}>
                <View style={[styles.balletIconCircle, { backgroundColor: meta.badgeColor + "1A" }]}>
                  <Ionicons name={meta.icon} size={22} color={meta.badgeColor} />
                </View>
                <View style={styles.balletCardText}>
                  <Text style={styles.balletCardTitle}>{meta.title}</Text>
                  <Text style={styles.balletCardDesc}>{meta.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={meta.badgeColor + "99"} />
              </View>

              {/* Bottom row */}
              <View style={styles.balletCardBottom}>
                <View style={[styles.balletStatusBadge, { backgroundColor: meta.badgeColor + "1A", borderColor: meta.badgeColor + "40" }]}>
                  <Text style={[styles.balletStatusBadgeText, { color: meta.badgeColor }]}>
                    {meta.badge}
                  </Text>
                </View>
                <View style={[styles.balletCtaBtn, { backgroundColor: meta.badgeColor + "15" }]}>
                  <Text style={[styles.balletCtaText, { color: meta.badgeColor }]}>{meta.cta}</Text>
                  <Ionicons name="arrow-forward" size={11} color={meta.badgeColor} />
                </View>
              </View>
            </LinearGradient>
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
  balletCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  balletCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  balletIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  balletCardText: { flex: 1 },
  balletCardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  balletCardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  balletCardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balletStatusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  balletStatusBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  balletCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  balletCtaText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
