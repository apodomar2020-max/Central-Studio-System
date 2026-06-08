import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { DanceClass, Instructor } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface ClassCardProps {
  item: DanceClass;
  instructor?: Instructor;
  compact?: boolean;
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

export default function ClassCard({ item, instructor, compact = false }: ClassCardProps) {
  const c = useColors();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/class/${item.id}`);
  }

  const statusConfig = getStatusConfig(item.status);
  const availableSeats = item.capacity - item.bookedCount;

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
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + "22" }]}>
          <Text style={[styles.statusText, { color: statusConfig.color }]}>
            {statusConfig.label}
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
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {item.dayOfWeek}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {item.startTime}
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
              <View style={[styles.avatar, { backgroundColor: instructor.photoColor + "33" }]}>
                <Text style={[styles.avatarText, { color: instructor.photoColor }]}>
                  {instructor.initials}
                </Text>
              </View>
              <Text style={[styles.instructorName, { color: c.mutedForeground }]}>
                {instructor.name}
              </Text>
            </View>
          )}
          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: colors.studio.primary }]}>
              EGP {item.price}
            </Text>
            <View style={styles.seatsRow}>
              <Feather name="users" size={11} color={c.mutedForeground} />
              <Text style={[styles.seatsText, { color: c.mutedForeground }]}>
                {availableSeats} seats
              </Text>
            </View>
          </View>
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
