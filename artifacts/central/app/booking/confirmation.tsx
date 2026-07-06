/**
 * Booking Request Submitted — redesigned to match the Claude Design "SuccessScreen"
 * (home-booking.jsx). Adapted for the real booking policy: a new booking is
 * PENDING (Admin confirms), so the copy says "Booking Request Submitted" unless the
 * returned status is actually "confirmed".
 *
 * Layout: a scrollable details area (icon + title + message + details card) with a
 * FIXED bottom action bar (two equal-width buttons, safe-area aware).
 */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAppContext } from "@/contexts/AppContext";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

// Design tokens (Claude Design CSS variables)
const CYAN = "#00B6D7"; // --cs-cyan-500
const CYAN_400 = "#2DCDEC"; // --cs-cyan-400
const INK_900 = "#0A0B0D"; // --cs-ink-900
const INK_800 = "#15171B"; // --cs-ink-800
const INK_300 = "#8E97A2"; // --cs-ink-300
const INK_400 = "#6B747F"; // --cs-ink-400
const SUCCESS = "#1FB871"; // --cs-success-500
const AMBER = "#FFB02E"; // --cs-amber-500

function Row({ label, value, accent, mono }: { label: string; value: string; accent?: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          accent ? { color: accent } : null,
          mono ? { fontFamily: "SpaceMono_700Bold" } : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export default function ConfirmationScreen() {
  const { bookingNumber } = useLocalSearchParams<{ bookingNumber: string; classId: string }>();
  const { bookings } = useAppContext();
  const insets = useSafeAreaInsets();

  const booking = bookings.find((b) => b.bookingNumber === bookingNumber);
  const isConfirmed = booking?.bookingStatus === "confirmed";

  const scheduleLabel = booking?.scheduleLabel ?? (
    booking?.date || booking?.time ? `${booking.date}${booking.time ? ` • ${booking.time}` : ""}` : "Schedule not set"
  );
  const paymentLabel = booking?.bookingType === "package"
    ? "Package Credit"
    : booking?.paymentStatus === "not_required"
      ? "No payment required"
    : booking?.paymentStatus === "paid"
      ? `EGP ${booking.price} · Paid`
      : `EGP ${booking?.price ?? 0} · Pay at Studio`;

  const firstName = (booking?.participantName ?? "").trim().split(/\s+/)[0] || "there";

  // Pending-aware copy: only say "Confirmed" when the booking actually is.
  const title = isConfirmed ? "Booking\nConfirmed!" : "Booking Request\nSubmitted";
  const message = isConfirmed
    ? "You're all set!"
    : "Your booking request has been sent to the studio team. You will be notified once it is confirmed.";
  const statusLabel = isConfirmed ? "Confirmed" : "Pending confirmation";
  const statusColor = isConfirmed ? SUCCESS : AMBER;

  // ── Entrance animation (design: circle pop + glow pulse) ──────────────────
  const pop = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    ).start();
  }, [glow, pop]);

  const popScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.95] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#04161B", "#0A0B0D"]} style={StyleSheet.absoluteFill} />

      {/* Scrollable content */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: (Platform.OS === "web" ? 40 : insets.top) + 30 }]}
      >
        {/* Animated success icon */}
        <View style={styles.iconWrap}>
          <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
          <Animated.View style={[styles.iconCircle, { transform: [{ scale: popScale }] }]}>
            {/* Bold check (design stroke width 3.5) */}
            <Svg width={42} height={42} viewBox="0 0 24 24" fill="none">
              <Path d="M20 6 9 17l-5-5" stroke={INK_900} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Animated.View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.seeYou}>
          See you on the floor, <Text style={styles.seeYouName}>{firstName}</Text>!
        </Text>

        {/* Details card */}
        <View style={styles.card}>
          <Row label="Booking Ref" value={bookingNumber ?? "—"} accent={CYAN_400} mono />
          <Row label="Status" value={statusLabel} accent={statusColor} />
          {booking && (
            <>
              <Row label="Class" value={booking.className || "—"} />
              <Row label="Schedule" value={scheduleLabel} />
              <Row label="Teacher" value={booking.instructorName || "—"} />
              <Row label="For" value={booking.participantName || "—"} />
              <Row label="Where" value={booking.location || "Central Studio"} />
              <Row label="Payment" value={paymentLabel} />
            </>
          )}
        </View>
      </ScrollView>

      {/* Fixed bottom action bar — two equal-width buttons, safe-area aware */}
      <View style={[styles.bottomBar, { paddingBottom: (Platform.OS === "web" ? 20 : insets.bottom) + 14 }]}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          activeOpacity={0.88}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.replace("/(tabs)/bookings");
          }}
        >
          <Ionicons name="calendar-outline" size={17} color={INK_900} />
          <Text style={[styles.btnText, { color: INK_900 }]}>View My Bookings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          activeOpacity={0.88}
          onPress={() => router.replace("/(tabs)/" as never)}
        >
          <Ionicons name="home-outline" size={17} color="#FFFFFF" />
          <Text style={[styles.btnText, { color: "#FFFFFF" }]}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK_900 },
  scroll: { paddingHorizontal: 20, paddingBottom: 28, alignItems: "center" },

  // Icon (design: 80px cyan circle + radial glow halo)
  iconWrap: { width: 80, height: 80, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  glow: {
    position: "absolute", width: 108, height: 108, borderRadius: 54,
    backgroundColor: "rgba(0,182,215,0.22)",
  },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: CYAN,
    alignItems: "center", justifyContent: "center",
  },

  // Title (design: font-display 44 / lineHeight 0.88 / uppercase / white)
  title: {
    fontFamily: "Anton_400Regular", fontSize: 40, lineHeight: 38,
    ...iosDisplayTextStyle(40, 38),
    textTransform: "uppercase", color: "#FFFFFF", textAlign: "center", letterSpacing: 0.5,
    marginBottom: 12 - iosCapGuard(40, 38),
  },
  message: {
    fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 21,
    color: INK_300, textAlign: "center", marginBottom: 8, maxWidth: 320,
  },
  seeYou: {
    fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 21,
    color: INK_300, textAlign: "center", marginBottom: 24,
  },
  seeYouName: { color: "#FFFFFF", fontFamily: "Archivo_700Bold" },

  // Details card (design: ink-800 + cyan/0.28 border, radius-lg)
  card: {
    width: "100%", backgroundColor: INK_800,
    borderWidth: 1, borderColor: "rgba(0,182,215,0.28)", borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 2,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowLabel: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: INK_400 },
  rowValue: { fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF", textAlign: "right", maxWidth: "58%" },

  // Fixed bottom action bar
  bottomBar: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)",
    backgroundColor: "rgba(10,11,13,0.92)",
  },
  btn: {
    flex: 1, height: 50, borderRadius: 12,
    flexDirection: "row", gap: 8,
    alignItems: "center", justifyContent: "center",
  },
  btnPrimary: { backgroundColor: CYAN },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  btnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14 },
});
