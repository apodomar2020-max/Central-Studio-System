import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Booking } from "@/contexts/AppContext";
import { useColors } from "@/hooks/useColors";
import colors from "@/constants/colors";

interface BookingCardProps {
  item: Booking;
}

function bookingStatusConfig(status: Booking["bookingStatus"]) {
  switch (status) {
    case "confirmed": return { label: "Confirmed", color: colors.success };
    case "pendingPayment": return { label: "Pending Payment", color: colors.warning };
    case "cancelled": return { label: "Cancelled", color: colors.error };
    case "attended": return { label: "Attended", color: colors.info };
    case "noShow": return { label: "No-show", color: "#6B7280" };
    case "refunded": return { label: "Refunded", color: "#A78BFA" };
  }
}

function paymentStatusConfig(status: Booking["paymentStatus"]) {
  switch (status) {
    case "paid": return { label: "Paid", color: colors.success };
    case "unpaid": return { label: "Unpaid", color: colors.warning };
    case "refunded": return { label: "Refunded", color: colors.info };
  }
}

export default function BookingCard({ item }: BookingCardProps) {
  const c = useColors();
  const bs = bookingStatusConfig(item.bookingStatus);
  const ps = paymentStatusConfig(item.paymentStatus);

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
          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{item.date}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{item.time}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="person-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]}>{item.instructorName}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.metaText, { color: c.mutedForeground }]} numberOfLines={1}>{item.location}</Text>
        </View>
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
        <Text style={[styles.price, { color: c.foreground }]}>EGP {item.price}</Text>
      </View>

      {item.paymentStatus === "unpaid" && (
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
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badges: { flexDirection: "row", gap: 6 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  price: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
