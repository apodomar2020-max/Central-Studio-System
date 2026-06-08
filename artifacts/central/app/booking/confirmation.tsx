import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import { getClassById } from "@/data/mockData";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

export default function ConfirmationScreen() {
  const { bookingNumber, classId } = useLocalSearchParams<{ bookingNumber: string; classId: string }>();
  const { bookings } = useAppContext();
  const insets = useSafeAreaInsets();

  const booking = bookings.find((b) => b.bookingNumber === bookingNumber);
  const cls = getClassById(classId ?? "");

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <LinearGradient
        colors={["#0A1A00", "#0B0B0F"]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.content}>
        <View style={styles.successIconWrap}>
          <LinearGradient
            colors={[colors.success + "40", colors.success + "10"]}
            style={styles.successRing}
          >
            <View style={[styles.successCircle, { backgroundColor: colors.success }]}>
              <Ionicons name="checkmark" size={40} color="#FFFFFF" />
            </View>
          </LinearGradient>
        </View>

        <Text style={styles.successTitle}>Booking Confirmed!</Text>
        <Text style={[styles.successSubtitle, { color: "#9CA3AF" }]}>
          {booking?.paymentMethod === "cash"
            ? "Your seat is reserved. Please pay at the studio before the class."
            : "Your payment was successful. You are all set!"}
        </Text>

        <View style={[styles.card, { backgroundColor: "#14141A", borderColor: "#2A2A35" }]}>
          <View style={styles.bookingNumberRow}>
            <Text style={[styles.bookingNumberLabel, { color: "#9CA3AF" }]}>Booking Ref</Text>
            <Text style={[styles.bookingNumber, { color: colors.studio.primary }]}>{bookingNumber}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: "#2A2A35" }]} />

          {booking && (
            <>
              <View style={styles.cardRow}>
                <Ionicons name="musical-notes-outline" size={16} color="#6B7280" />
                <Text style={styles.cardLabel}>Class</Text>
                <Text style={styles.cardValue}>{booking.className}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="calendar-outline" size={16} color="#6B7280" />
                <Text style={styles.cardLabel}>Day</Text>
                <Text style={styles.cardValue}>{booking.date}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="time-outline" size={16} color="#6B7280" />
                <Text style={styles.cardLabel}>Time</Text>
                <Text style={styles.cardValue}>{booking.time}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="location-outline" size={16} color="#6B7280" />
                <Text style={styles.cardLabel}>Where</Text>
                <Text style={styles.cardValue}>{booking.location}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: "#2A2A35" }]} />
              <View style={styles.cardRow}>
                <Ionicons name="card-outline" size={16} color="#6B7280" />
                <Text style={styles.cardLabel}>Payment</Text>
                <View style={[styles.payBadge, {
                  backgroundColor: booking.paymentStatus === "paid" ? colors.success + "20" : colors.warning + "20",
                }]}>
                  <Text style={[styles.payBadgeText, {
                    color: booking.paymentStatus === "paid" ? colors.success : colors.warning,
                  }]}>
                    {booking.paymentStatus === "paid" ? `EGP ${booking.price} · Paid` : `EGP ${booking.price} · Pay at Studio`}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={[styles.reminderBanner, { backgroundColor: colors.info + "10", borderColor: colors.info + "30" }]}>
          <Ionicons name="notifications-outline" size={16} color={colors.info} />
          <Text style={[styles.reminderText, { color: "#9CA3AF" }]}>
            You will receive a reminder 2 hours before your class starts.
          </Text>
        </View>

        <View style={styles.buttonsRow}>
          <AppButton
            title="View My Bookings"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.replace("/(tabs)/bookings");
            }}
            fullWidth
            size="lg"
          />
          <AppButton
            title="Back to Home"
            onPress={() => {
              router.replace("/(tabs)/");
            }}
            variant="ghost"
            fullWidth
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0B0F" },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
    gap: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  successIconWrap: { marginBottom: 8 },
  successRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginTop: -8,
  },
  card: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  bookingNumberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  bookingNumberLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  bookingNumber: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  divider: { height: 1 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", width: 56 },
  cardValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF", flex: 1 },
  payBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  payBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  reminderBanner: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  reminderText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  buttonsRow: { width: "100%", gap: 10 },
});
