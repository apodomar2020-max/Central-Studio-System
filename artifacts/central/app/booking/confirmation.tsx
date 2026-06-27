import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect } from "react";
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

export default function ConfirmationScreen() {
  const { bookingNumber, classId } = useLocalSearchParams<{ bookingNumber: string; classId: string }>();
  const { bookings } = useAppContext();
  const insets = useSafeAreaInsets();

  const booking = bookings.find((b) => b.bookingNumber === bookingNumber);
  const scheduleLabel = booking?.scheduleLabel ?? (
    booking?.date || booking?.time ? `${booking.date}${booking.time ? ` • ${booking.time}` : ""}` : "Schedule not set"
  );
  const instructorInitials = booking?.instructorName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  const paymentLabel = booking?.bookingType === "package"
    ? "Package Credit"
    : booking?.paymentStatus === "not_required"
      ? "No payment required"
    : booking?.paymentStatus === "paid"
      ? `EGP ${booking.price} · Paid`
      : `EGP ${booking?.price ?? 0} · Pay at Studio`;
  const isCashPendingPayment = booking?.paymentMethod === "cash" && booking.paymentStatus === "pending_payment";
  const successTitle = isCashPendingPayment ? "Booking Request Submitted" : "Booking Confirmed!";

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <LinearGradient
        colors={["#0A1A00", "#0A0B0D"]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 40 + (Platform.OS === "web" ? 0 : insets.bottom) }]}
        showsVerticalScrollIndicator={false}
      >
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

        <Text style={styles.successTitle}>{successTitle}</Text>
        <Text style={[styles.successSubtitle, { color: "#8E97A2" }]}>
          {isCashPendingPayment
            ? "Booking request submitted. Please pay at the studio."
            : booking?.paymentMethod === "packageCredit"
              ? "Booking confirmed. Credit will be deducted at check-in."
            : "Your payment was successful. You are all set!"}
        </Text>

        <View style={[styles.card, { backgroundColor: "#15171B", borderColor: "rgba(255,255,255,0.08)" }]}>
          <View style={styles.bookingNumberRow}>
            <Text style={[styles.bookingNumberLabel, { color: "#8E97A2" }]}>Booking Ref</Text>
            <Text style={[styles.bookingNumber, { color: colors.studio.primary }]}>{bookingNumber}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />

          {booking && (
            <>
              <View style={styles.cardRow}>
                <Ionicons name="musical-notes-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Class</Text>
                <Text style={styles.cardValue}>{booking.className}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="calendar-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Schedule</Text>
                <Text style={styles.cardValue}>{scheduleLabel}</Text>
              </View>
              <View style={styles.cardRow}>
                <View style={[styles.instructorAvatar, { backgroundColor: colors.studio.primary + "25" }]}>
                  {booking.instructorImage ? (
                    <Image source={{ uri: booking.instructorImage }} style={styles.instructorAvatarImage} />
                  ) : (
                    <Text style={[styles.instructorInitials, { color: colors.studio.primary }]}>{instructorInitials}</Text>
                  )}
                </View>
                <Text style={styles.cardLabel}>Teacher</Text>
                <Text style={styles.cardValue}>{booking.instructorName}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="timer-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Duration</Text>
                <Text style={styles.cardValue}>{booking.duration}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="pricetag-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Type</Text>
                <Text style={styles.cardValue}>{booking.danceType}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="person-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>For</Text>
                <Text style={styles.cardValue}>{booking.participantName}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="location-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Where</Text>
                <Text style={styles.cardValue}>{booking.location}</Text>
              </View>
              <View style={styles.cardRow}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Status</Text>
                <Text style={styles.cardValue}>
                  {booking.bookingStatus === "pending" ? "Waiting for confirmation" : "Booking confirmed"}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
              <View style={styles.cardRow}>
                <Ionicons name="card-outline" size={16} color="#6B747F" />
                <Text style={styles.cardLabel}>Payment</Text>
                <View style={[styles.payBadge, {
                  backgroundColor: booking.paymentStatus === "paid" || booking.paymentStatus === "not_required" ? colors.success + "20" : colors.warning + "20",
                  }]}>
                  <Text style={[styles.payBadgeText, {
                    color: booking.paymentStatus === "paid" || booking.paymentStatus === "not_required" ? colors.success : colors.warning,
                  }]}>
                    {paymentLabel}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={[styles.reminderBanner, { backgroundColor: colors.info + "10", borderColor: colors.info + "30" }]}>
          <Ionicons name="notifications-outline" size={16} color={colors.info} />
          <Text style={[styles.reminderText, { color: "#8E97A2" }]}>
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
              router.replace("/(tabs)/" as any);
            }}
            variant="ghost"
            fullWidth
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  content: {
    // flexGrow (not flex:1) so the ScrollView centers content when it fits and
    // scrolls when it's taller than the viewport — never overflows on small phones.
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
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
    fontSize: 40,
    fontFamily: "Anton_400Regular",
    color: "#FFFFFF",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    lineHeight: 40,
  },
  successSubtitle: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
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
  bookingNumberLabel: { fontSize: 13, fontFamily: "Archivo_400Regular" },
  bookingNumber: { fontSize: 18, fontFamily: "SpaceMono_700Bold", letterSpacing: 1 },
  divider: { height: 1 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardLabel: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B747F", width: 56 },
  cardValue: { fontSize: 13, fontFamily: "Archivo_500Medium", color: "#FFFFFF", flex: 1 },
  instructorAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  instructorAvatarImage: { width: "100%", height: "100%" },
  instructorInitials: { fontSize: 8, fontFamily: "Archivo_700Bold" },
  payBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  payBadgeText: { fontSize: 12, fontFamily: "Archivo_600SemiBold" },
  reminderBanner: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  reminderText: { fontSize: 13, fontFamily: "Archivo_400Regular", flex: 1, lineHeight: 18 },
  buttonsRow: { width: "100%", gap: 10 },
});
