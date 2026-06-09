import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  DANCE_CATEGORIES,
  DANCE_CLASSES,
  INSTRUCTORS,
  AgeGroup,
  type DanceClass,
  type Instructor,
} from "@/data/mockData";
import { mapApiClassToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import ClassCard from "@/components/ClassCard";
import EmptyState from "@/components/EmptyState";

const AGE_GROUPS: { key: AgeGroup | "All"; label: string; icon: string }[] = [
  { key: "All", label: "All Ages", icon: "people-outline" },
  { key: "Kids", label: "Kids", icon: "happy-outline" },
  { key: "Teens", label: "Teens", icon: "person-outline" },
  { key: "Adults", label: "Adults", icon: "people-circle-outline" },
];

const BALLET_CATEGORY = DANCE_CATEGORIES.find((c) => c.isBallet);

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [activeAge, setActiveAge] = useState<AgeGroup | "All">("All");
  const [activeCat, setActiveCat] = useState<string>("all");

  // Live data from the backend API. Categories are not yet exposed by the API,
  // so the mock category list still drives the section grouping below.
  const classesQuery = useListClasses();
  const instructorsQuery = useListInstructors();

  const isLoading = classesQuery.isLoading || instructorsQuery.isLoading;
  const isError = classesQuery.isError || instructorsQuery.isError;
  const isRefreshing = classesQuery.isRefetching || instructorsQuery.isRefetching;
  const onRefresh = useCallback(() => {
    classesQuery.refetch();
    instructorsQuery.refetch();
  }, [classesQuery, instructorsQuery]);

  // Map API rows to the mobile data model. Fall back to mockData only when the
  // API request failed (data is undefined); an empty-but-successful response
  // shows the normal empty state rather than mock content.
  const instructors: Instructor[] = useMemo(
    () =>
      instructorsQuery.data
        ? instructorsQuery.data.map(mapApiInstructorToMobile)
        : INSTRUCTORS,
    [instructorsQuery.data],
  );

  const classes: DanceClass[] = useMemo(
    () =>
      classesQuery.data
        ? classesQuery.data.filter((c) => c.isActive).map(mapApiClassToMobile)
        : DANCE_CLASSES,
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

      {isError && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
          <Text style={styles.errorBannerText}>
            Couldn't reach the server — showing saved classes.
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.studio.primary} />
        </View>
      ) : (
        <>
      {BALLET_CATEGORY && (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/ballet/assessment");
          }}
          style={[styles.balletBanner, { borderColor: BALLET_CATEGORY.color + "40" }]}
          activeOpacity={0.85}
        >
          <View style={[styles.balletIcon, { backgroundColor: BALLET_CATEGORY.color + "20" }]}>
            <Ionicons name={BALLET_CATEGORY.icon as any} size={20} color={BALLET_CATEGORY.color} />
          </View>
          <View style={styles.balletText}>
            <Text style={styles.balletTitle}>Ballet</Text>
            <Text style={styles.balletDesc}>Requires assessment — apply now</Text>
          </View>
          <View style={[styles.balletBadge, { backgroundColor: BALLET_CATEGORY.color + "20" }]}>
            <Text style={[styles.balletBadgeText, { color: BALLET_CATEGORY.color }]}>ASSESSMENT</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={BALLET_CATEGORY.color} />
        </TouchableOpacity>
      )}

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
                <View style={[styles.catDot, { backgroundColor: cat.color }]} />
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
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.warning + "1A",
    borderWidth: 1,
    borderColor: colors.warning + "40",
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: colors.warning,
  },
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
  balletBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    backgroundColor: "#1A0D2D",
  },
  balletIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  balletText: { flex: 1 },
  balletTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  balletDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  balletBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  balletBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
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
