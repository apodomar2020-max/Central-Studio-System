import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Booking } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface BookingCardProps {
  item: Booking;
}

function bookingStatusConfig(status: Booking["bookingStatus"]) {
  switch (status) {
    case "pending": return { label: "Pending", color: colors.warning };
    case "confirmed": return { label: "Confirmed", color: colors.success };
    case "rejected": return { label: "Rejected", color: colors.error };
    case "cancelled": return { label: "Cancelled", color: colors.error };
    case "attended": return { label: "Attended", color: colors.info };
    case "completed": return { label: "Completed", color: colors.info };
    case "noShow": return { label: "No-show", color: "#6B7280" };
  }
}

function paymentStatusConfig(status: Booking["paymentStatus"]) {
  switch (status) {
    case "not_required": return { label: "Package", color: colors.info };
    case "pending_payment": return { label: "Payment Pending", color: colors.warning };
    case "paid": return { label: "Paid", color: colors.success };
    case "refunded": return { label: "Refunded", color: colors.info };
    case "failed": return { label: "Failed", color: colors.error };
  }
}

export default function BookingCard({ item }: BookingCardProps) {
  const c = useColors();
  const bs = bookingStatusConfig(item.bookingStatus);
  const ps = paymentStatusConfig(item.paymentStatus);
  const instructorInitials = item.instructorName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  const priceLabel = item.bookingType === "package"
    ? "Package Credit"
    : item.paymentMethod === "cash"
      ? `Studio Pay • EGP ${item.price}`
      : `EGP ${item.price}`;
  const scheduleLabel = item.scheduleLabel ?? (
    item.date || item.time ? `${item.date}${item.time ? ` • ${item.time}` : ""}` : "Schedule not set"
  );

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={[styles.className, { color: c.foreground }]} numberOfLines={1}>
            {item.className}
          </Text>
          <Text style={[styles.danceType, { color: colors.studio.primary }]}>
            {item.danceType}
          </Text>
        </View>
        <Text style={[styles.bookingNum, { color: c.mutedForeground }]}>
          #{item.bookingNumber}
        </Text>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>
            {scheduleLabel}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <View style={[styles.instructorAvatar, { backgroundColor: colors.studio.primary + "25" }]}>
            {item.instructorImage ? (
              <Image source={{ uri: item.instructorImage }} style={styles.instructorAvatarImage} />
            ) : (
              <Text style={[styles.instructorInitials, { color: colors.studio.primary }]}>{instructorInitials}</Text>
            )}
          </View>
          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{item.instructorName}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="timer-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>{item.duration}</Text>
        </View>
        <View style={styles.metaItemWide}>
          <Ionicons name="location-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>{item.location}</Text>
        </View>
        {item.participantType === "child" && (
          <View style={styles.metaItemWide}>
            <Ionicons name="person-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>{item.participantName}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: bs.color + "22" }]}>
            <Text style={[styles.badgeText, { color: bs.color }]}>{bs.label}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: ps.color + "22" }]}>
            <Text style={[styles.badgeText, { color: ps.color }]}>{ps.label}</Text>
          </View>
        </View>
        <Text style={[styles.price, { color: c.foreground }]}>{priceLabel}</Text>
      </View>

      {item.paymentStatus === "pending_payment" && (
        <View style={[styles.warning, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "40" }]}>
          <Ionicons name="warning-outline" size={13} color={colors.warning} />
          <Text style={[styles.warningText, { color: colors.warning }]}>
            Seat not guaranteed until payment is completed at studio.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleBlock: { flex: 1, gap: 2 },
  className: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  danceType: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  bookingNum: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginLeft: 8,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: "47%",
  },
  metaItemWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: "100%",
  },
  instructorAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  instructorAvatarImage: {
    width: "100%",
    height: "100%",
  },
  instructorInitials: {
    fontSize: 7,
    fontFamily: "Inter_700Bold",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 8,
  },
  badges: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: "100%",
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  price: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  warningText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 16,
  },
});
