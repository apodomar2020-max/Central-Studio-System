import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { DanceClass, Instructor } from "@/data/mockData";
import { getScheduleLabel } from "@/data/apiAdapters";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";
import { useAppContext } from "@/contexts/AppContext";
import { showAuthRequiredPrompt } from "@/utils/authRequired";

interface ClassCardProps {
  item: DanceClass;
  instructor?: Instructor;
  compact?: boolean;
  purchaseMode?: "single" | "package";
  packageCreditsRemaining?: number;
}

function getStatusConfig(status: DanceClass["status"]) {
  switch (status) {
    case "available":
      return { label: "Available", color: colors.success };
    case "fewSeats":
      return { label: "Few Seats Left", color: colors.warning };
    case "full":
      return { label: "Full", color: colors.error };
    case "waitingList":
      return { label: "Waiting List", color: colors.info };
  }
}

export default function ClassCard({
  item,
  instructor,
  compact = false,
  purchaseMode = "single",
  packageCreditsRemaining = 0,
}: ClassCardProps) {
  const c = useColors();
  const { user } = useAppContext();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
  }

  const statusConfig = getStatusConfig(item.status);
  const availableSeats = item.capacity - item.bookedCount;
  const scheduleLabel = getScheduleLabel(item);
  const hasSchedule = Boolean(item.scheduleId && item.dayOfWeek && item.startTime);
  const isBookable = hasSchedule && item.status !== "full";
  const canUsePackageCredits = item.packageEligible !== false && packageCreditsRemaining > 0;
  const priceLabel = purchaseMode === "package"
    ? "Uses 1 credit"
    : item.price > 0
      ? `EGP ${item.price}`
      : "Price TBC";
  const badgeLabel = hasSchedule ? statusConfig.label : "Schedule not set";
  const badgeColor = hasSchedule ? statusConfig.color : "#6B7280";
  const packageLabel = canUsePackageCredits
    ? `Package • ${packageCreditsRemaining} left`
    : "No package credits";

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
    >
      <View style={[styles.categoryStrip, { backgroundColor: colors.studio.primary + "22" }]}>
        <Text style={[styles.categoryLabel, { color: colors.studio.primary }]}>
          {item.categoryName}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: badgeColor + "22" }]}>
          <Text style={[styles.statusText, { color: badgeColor }]}>
            {badgeLabel}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
          {item.title}
        </Text>

        {!compact && (
          <Text style={[styles.description, { color: c.mutedForeground }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaItemWide}>
            <Ionicons name="calendar-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>
              {scheduleLabel}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="timer-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {item.duration}
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          {instructor && (
            <View style={styles.instructorRow}>
              <View style={[styles.avatar, { backgroundColor: colors.studio.primary + "33" }]}>
                {instructor.photoUrl ? (
                  <Image source={{ uri: instructor.photoUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={[styles.avatarText, { color: colors.studio.primary }]}>
                    {instructor.initials}
                  </Text>
                )}
              </View>
              <Text style={[styles.instructorName, { color: c.mutedForeground }]}>
                {instructor.name}
              </Text>
            </View>
          )}
          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: colors.studio.primary }]}>
              {priceLabel}
            </Text>
            <View style={styles.seatsRow}>
              <Feather name="users" size={11} color={c.mutedForeground} />
              <Text style={[styles.seatsText, { color: c.mutedForeground }]}>
                {availableSeats} seats
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.actionRow}>
          {canUsePackageCredits && (
            <TouchableOpacity
              onPress={() => {
                if (!isBookable) return;
                if (!user) {
                  showAuthRequiredPrompt();
                  return;
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId, usePackage: "true" } });
              }}
              disabled={!isBookable}
              style={[
                styles.packageBtn,
                { borderColor: colors.studio.primary + "60", backgroundColor: colors.studio.primary + "12" },
                !isBookable && styles.disabledBtn,
              ]}
            >
              <Ionicons name="add" size={16} color={isBookable ? colors.studio.primary : "#6B7280"} />
              <Text style={[styles.packageBtnText, { color: isBookable ? colors.studio.primary : "#6B7280" }]}>
                {packageLabel}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              if (!isBookable) return;
              if (!user) {
                showAuthRequiredPrompt();
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push({ pathname: "/booking/flow", params: { classId: item.id, scheduleId: item.scheduleId } });
            }}
            disabled={!isBookable}
            style={[
              styles.bookBtn,
              isBookable
                ? { borderColor: colors.studio.primary }
                : { borderColor: "#2A2A35", backgroundColor: "#1E1E26" },
            ]}
          >
            <Text style={[styles.bookBtnText, { color: isBookable ? colors.studio.primary : "#6B7280" }]}>
              {hasSchedule ? "Book" : "Not available"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  categoryStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  body: {
    padding: 14,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    gap: 14,
    flexWrap: "wrap",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaItemWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "68%",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  instructorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  instructorName: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  priceRow: {
    alignItems: "flex-end",
    gap: 2,
  },
  price: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  packageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  packageBtnText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  bookBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
  },
  bookBtnText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  disabledBtn: {
    opacity: 0.5,
  },
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  seatsText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
