import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useGetClass, useGetInstructor, useListSchedules } from "@workspace/api-client-react";

import { compareSchedulesByNextOccurrence, getScheduleLabel, mapApiClassWithScheduleToMobile, mapApiInstructorToMobile } from "@/data/apiAdapters";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { DEFAULT_SINGLE_CLASS_PRICE_EGP, fetchClassPricing } from "@/services/classPricingService";

function StatusBadge({ status }: { status: string }) {
  const cfg = {
    available: { label: "Available", color: colors.success },
    fewSeats: { label: "Few Seats Left", color: colors.warning },
    full: { label: "Full", color: colors.error },
    waitingList: { label: "Waiting List", color: colors.info },
  }[status] ?? { label: status, color: "#6B7280" };
  return (
    <View style={[{ backgroundColor: cfg.color + "22", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 }]}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: cfg.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {cfg.label}
      </Text>
    </View>
  );
}

export default function ClassDetailScreen() {
  const { id, scheduleId } = useLocalSearchParams<{ id: string; scheduleId?: string }>();
  const insets = useSafeAreaInsets();

  const numericId = Number(id);
  const classQuery = useGetClass(numericId, {
    query: { queryKey: ["class", numericId], enabled: !!id && !isNaN(numericId) },
  });
  const schedulesQuery = useListSchedules(
    { classId: numericId },
    { query: { queryKey: ["class-schedules", numericId], enabled: !!id && !isNaN(numericId) } },
  );
  const classPricingQuery = useQuery({
    queryKey: ["class-pricing"],
    queryFn: fetchClassPricing,
    staleTime: 5 * 60 * 1000,
  });
  const singleClassPriceEgp =
    classPricingQuery.data?.singleClassPriceEgp ?? DEFAULT_SINGLE_CLASS_PRICE_EGP;

  const primarySchedule = schedulesQuery.data
    ? schedulesQuery.data.find((schedule) => String(schedule.id) === scheduleId) ??
      [...schedulesQuery.data].sort((a, b) => compareSchedulesByNextOccurrence(a, b))[0]
    : undefined;
  const cls = classQuery.data
    ? mapApiClassWithScheduleToMobile(classQuery.data, primarySchedule, singleClassPriceEgp)
    : null;

  const instructorQuery = useGetInstructor(classQuery.data?.instructorId ?? 0, {
    query: { queryKey: ["instructor", classQuery.data?.instructorId ?? 0], enabled: !!classQuery.data?.instructorId },
  });
  const instructor = instructorQuery.data ? mapApiInstructorToMobile(instructorQuery.data) : null;

  // ── Loading ──
  if (classQuery.isLoading || schedulesQuery.isLoading) {
    return <DetailSkeleton />;
  }

  // ── Offline ──
  if ((classQuery.isError && isOfflineError(classQuery.error)) || (schedulesQuery.isError && isOfflineError(schedulesQuery.error))) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnAbsolute}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <OfflineState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} />
      </View>
    );
  }

  // ── Server error / not found ──
  if (classQuery.isError || schedulesQuery.isError || !cls) {
    return (
      <View style={[styles.container, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtnAbsolute}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        {classQuery.isError || schedulesQuery.isError ? (
          <ErrorState onRetry={() => { classQuery.refetch(); schedulesQuery.refetch(); }} message="Couldn't load class details." />
        ) : (
          <ErrorState title="Class not found" message="This class may no longer be available." onRetry={() => router.back()} />
        )}
      </View>
    );
  }

  const available = cls.capacity - cls.bookedCount;
  const hasSchedule = Boolean(cls.scheduleId && cls.dayOfWeek && cls.startTime);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#1A1200", "#0B0B0F"]}
        style={[
          styles.heroGradient,
          { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.heroCategoryRow}>
          <View style={[styles.categoryBadge, { backgroundColor: colors.studio.primary + "20" }]}>
            <Text style={[styles.categoryBadgeText, { color: colors.studio.primary }]}>
              {cls.categoryName}
            </Text>
          </View>
          <StatusBadge status={cls.status} />
        </View>

        <Text style={styles.heroTitle}>{cls.title}</Text>
        <Text style={styles.heroLevel}>{cls.level} · {cls.ageGroup}</Text>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 }]}
      >
        <View style={styles.quickStats}>
          {[
            { icon: "calendar-outline", label: getScheduleLabel(cls) },
            { icon: "timer-outline", label: cls.duration },
            { icon: "location-outline", label: cls.room || cls.location },
          ].map((s, i) => (
            <View key={i} style={[styles.statItem, { backgroundColor: "#1E1E26" }]}>
              <Ionicons name={s.icon as any} size={16} color={colors.studio.primary} />
              <Text style={styles.statText}>{s.label}</Text>
            </View>
          ))}
        </View>

        {!!cls.description && (
          <View style={[styles.descCard, { backgroundColor: "#14141A", borderColor: "#2A2A35" }]}>
            <Text style={styles.descTitle}>About This Class</Text>
            <Text style={styles.descText}>{cls.description}</Text>
          </View>
        )}

        {instructor && (
          <View style={[styles.instructorCard, { backgroundColor: "#14141A", borderColor: "#2A2A35" }]}>
            <Text style={styles.descTitle}>Instructor</Text>
            <View style={styles.instructorRow}>
              <View style={[styles.instructorAvatar, { backgroundColor: instructor.photoColor + "30" }]}>
                {instructor.photoUrl ? (
                  <Image source={{ uri: instructor.photoUrl }} style={styles.instructorAvatarImage} />
                ) : (
                  <Text style={[styles.instructorInitials, { color: instructor.photoColor }]}>
                    {instructor.initials}
                  </Text>
                )}
              </View>
              <View style={styles.instructorInfo}>
                <Text style={styles.instructorName}>{instructor.name}</Text>
                <Text style={styles.instructorBio} numberOfLines={2}>{instructor.bio}</Text>
                <View style={styles.instructorMeta}>
                  <Text style={styles.metaChipText2}>{instructor.totalClasses} yrs experience</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={[styles.detailsGrid, { backgroundColor: "#14141A", borderColor: "#2A2A35" }]}>
          <Text style={styles.descTitle}>Class Details</Text>
          {[
            { label: "Location", value: cls.location },
            { label: "Capacity", value: `${cls.capacity} students` },
            { label: "Available Seats", value: available > 0 ? `${available} remaining` : "Full" },
            { label: "Level", value: cls.level },
            { label: "Age Group", value: cls.ageGroup },
          ].map((row) => (
            <View key={row.label} style={[styles.detailRow, { borderBottomColor: "#2A2A35" }]}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 12 }]}>
        <View style={styles.footerPrice}>
          <Text style={[styles.priceLabel, { color: "#9CA3AF" }]}>Class Price</Text>
          <Text style={[styles.priceValue, { color: colors.studio.primary }]}>
            {cls.price > 0 ? `EGP ${cls.price}` : "Price TBC"}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          {cls.status === "full" ? (
            <AppButton
              title="Join Waiting List"
              onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)}
              variant="ghost"
              fullWidth
            />
          ) : !hasSchedule ? (
            <AppButton
              title="Schedule Not Set"
              onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)}
              disabled
              fullWidth
              size="lg"
            />
          ) : (
            <AppButton
              title="Book This Class"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push({ pathname: "/booking/flow", params: { classId: cls.id, scheduleId: cls.scheduleId } });
              }}
              fullWidth
              size="lg"
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0B0F" },
  centered: { justifyContent: "center", alignItems: "center" },
  backBtnAbsolute: {
    position: "absolute", top: 60, left: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  heroGradient: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  heroCategoryRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  categoryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  categoryBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  heroTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF", lineHeight: 34 },
  heroLevel: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  scroll: { paddingHorizontal: 20, gap: 14 },
  quickStats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  statText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#FFFFFF" },
  descCard: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  descTitle: {
    fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9CA3AF",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
  },
  descText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#FFFFFF", lineHeight: 20 },
  instructorCard: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 12 },
  instructorRow: { flexDirection: "row", gap: 14 },
  instructorAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  instructorAvatarImage: { width: "100%", height: "100%" },
  instructorInitials: { fontSize: 18, fontFamily: "Inter_700Bold" },
  instructorInfo: { flex: 1, gap: 4 },
  instructorName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  instructorBio: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  instructorMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  metaChipSep: { color: "#6B7280", fontSize: 12 },
  metaChipText2: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  detailsGrid: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: 1,
  },
  detailLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  detailValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF" },
  footer: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: "#2A2A35", backgroundColor: "#0B0B0F",
  },
  footerPrice: { gap: 2 },
  priceLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  priceValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
});
