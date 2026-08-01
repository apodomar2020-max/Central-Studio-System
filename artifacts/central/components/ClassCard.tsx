import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from "react-native";

import { DanceClass, Instructor } from "@/data/mockData";
import { classCapacityDisplay, getScheduleLabel, isClassCapacityDisplayEnabled } from "@/data/apiAdapters";
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
  variant?: "default" | "ballet";
  displayOnly?: boolean;
  imageUrl?: string | null;
  levelLabel?: string;
  scheduleLabelOverride?: string;
  style?: ViewStyle;
}

function getStatusConfig(status: DanceClass["status"]) {
  switch (status) {
    case "available":
      return { label: "Available", color: colors.success };
    case "fewSeats":
      return { label: "Few Seats Left", color: colors.warning };
    case "full":
      return { label: "Full", color: colors.error };
    case "cancelled":
      return { label: "Cancelled", color: colors.error };
    case "unavailable":
      return { label: "Unavailable", color: "#6B7280" };
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
  variant = "default",
  displayOnly = false,
  imageUrl,
  levelLabel,
  scheduleLabelOverride,
  style,
}: ClassCardProps) {
  const c = useColors();
  const { user } = useAppContext();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/class/[id]", params: { id: item.id, scheduleId: item.scheduleId } });
  }

  const statusConfig = getStatusConfig(item.status);
  // Display-only: full/completed reads as 0 available (real bookedCount kept).
  const availableSeats = classCapacityDisplay(item).available;
  const showCapacity = isClassCapacityDisplayEnabled(item);
  const scheduleLabel = getScheduleLabel(item);
  const hasSchedule = Boolean(item.scheduleId && item.dayOfWeek && item.startTime);
  const isBookable = hasSchedule && item.status !== "full" && item.status !== "cancelled" && item.status !== "unavailable";
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

  if (variant === "ballet") {
    const balletImageUrl = imageUrl ?? item.photoUrl;
    const balletScheduleLabel = scheduleLabelOverride ?? scheduleLabel;
    const CardShell = displayOnly ? View : TouchableOpacity;

    return (
      <CardShell
        {...(!displayOnly ? { onPress: handlePress, activeOpacity: 0.88 } : {})}
        style={[styles.balletCard, { backgroundColor: c.card, borderColor: c.border }, style]}
      >
        <View style={styles.balletImageWrap}>
          {balletImageUrl ? (
            <Image source={{ uri: balletImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#22262C" }]} />
          )}
          <LinearGradient
            colors={["rgba(5,6,8,0.08)", "rgba(5,6,8,0.72)"]}
            locations={[0, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.balletImageChips}>
            <View style={[styles.balletChip, { backgroundColor: colors.studio.primary + "22" }]}>
              <Text style={[styles.balletChipText, { color: colors.studio.primary }]}>Ballet</Text>
            </View>
            {!!levelLabel && (
              <View style={styles.balletChipDark}>
                <Text style={styles.balletChipDarkText} numberOfLines={1}>{levelLabel}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.balletBody}>
          <Text style={[styles.balletTitle, { color: c.foreground }]} numberOfLines={2}>
            {item.title}
          </Text>

          {!!item.description && (
            <Text style={[styles.balletDescription, { color: c.mutedForeground }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}

          <View style={styles.balletMetaWrap}>
            <View style={styles.balletMetaItemWide}>
              <Ionicons name="calendar-outline" size={14} color={colors.studio.primary} />
              <Text style={[styles.balletMetaText, { color: c.mutedForeground }]} numberOfLines={2}>
                {balletScheduleLabel}
              </Text>
            </View>
            {!!item.duration && (
              <View style={styles.balletMetaItem}>
                <Ionicons name="timer-outline" size={14} color={c.mutedForeground} />
                <Text style={[styles.balletMetaText, { color: c.mutedForeground }]} numberOfLines={1}>
                  {item.duration}
                </Text>
              </View>
            )}
            {!!item.location && (
              <View style={styles.balletMetaItemWide}>
                <Ionicons name="location-outline" size={14} color={c.mutedForeground} />
                <Text style={[styles.balletMetaText, { color: c.mutedForeground }]} numberOfLines={1}>
                  {item.location}
                </Text>
              </View>
            )}
          </View>

          {instructor && (
            <View style={styles.balletInstructorRow}>
              <View style={[styles.avatar, { backgroundColor: colors.studio.primary + "33" }]}>
                {instructor.photoUrl ? (
                  <Image source={{ uri: instructor.photoUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={[styles.avatarText, { color: colors.studio.primary }]}>
                    {instructor.initials}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.balletInstructorName, { color: c.foreground }]} numberOfLines={1}>
                  {instructor.name}
                </Text>
                <Text style={[styles.balletInstructorRole, { color: c.mutedForeground }]} numberOfLines={1}>
                  Ballet Instructor
                </Text>
              </View>
            </View>
          )}
        </View>
      </CardShell>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}
    >
      <View style={[styles.categoryStrip, { backgroundColor: colors.studio.primary + "22" }]}>
        <Text style={[styles.categoryLabel, { color: colors.studio.primary }]}>
          {item.categoryName}
        </Text>
        {(showCapacity || item.status === "cancelled" || item.status === "unavailable" || !hasSchedule) && <View style={[styles.statusBadge, { backgroundColor: badgeColor + "22" }]}>
          <Text style={[styles.statusText, { color: badgeColor }]}>
            {badgeLabel}
          </Text>
        </View>}
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
        {!!item.location && (
          <View style={styles.metaRow}>
            <View style={styles.metaItemWide}>
              <Ionicons name="location-outline" size={13} color={c.mutedForeground} />
              <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>{item.location}</Text>
            </View>
          </View>
        )}

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
            {showCapacity && <View style={styles.seatsRow}>
              <Feather name="users" size={11} color={c.mutedForeground} />
              <Text style={[styles.seatsText, { color: c.mutedForeground }]}>
                {availableSeats} seats
              </Text>
            </View>}
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
              {item.status === "cancelled" ? "Cancelled" : hasSchedule ? "Book" : "Not available"}
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
  balletCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  balletImageWrap: {
    height: 154,
    backgroundColor: "#22262C",
  },
  balletImageChips: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  balletChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  balletChipText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  balletChipDark: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(5,6,8,0.68)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  balletChipDarkText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#FFFFFF",
  },
  balletBody: {
    padding: 14,
    gap: 9,
  },
  balletTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    lineHeight: 23,
  },
  balletDescription: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  balletMetaWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  balletMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  balletMetaItemWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    maxWidth: "100%",
  },
  balletMetaText: {
    flexShrink: 1,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
    lineHeight: 17,
  },
  balletInstructorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 2,
  },
  balletInstructorName: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  balletInstructorRole: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
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
