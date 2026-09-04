import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, Animated } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";

import BookingFlowIcon from "@/components/booking/BookingFlowIcon";
import BookingSuccessActionIcon from "@/components/booking/BookingSuccessActionIcon";
import CategoryIcon from "@/components/CategoryIcon";
import ParticipantAvatar from "@/components/ParticipantAvatar";
import { BookingWatchIcon } from "@/components/BookingDetailsIcons";
import { SuccessConfetti, useSuccessPopHaptic } from "@/components/success/SuccessCelebration";
import { useAppContext } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

const CYAN = "#00B6D7";
const BLACK = "#050607";
const CARD = "#012C31";
const SUMMARY_GRADIENT = ["#026071", "#03B6D7"] as const;

function dateLabel(raw?: string): string {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "Date TBC";
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return value.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" });
}

function calendarStamp(date: string, time: string): string {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const value = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(value.getTime())) return { date, time };
  value.setUTCMinutes(value.getUTCMinutes() + minutes);
  return { date: value.toISOString().slice(0, 10), time: value.toISOString().slice(11, 16) };
}

function MiniTag({ label, color }: { label: string; color: string }): React.ReactElement {
  return <View style={[styles.tag, { backgroundColor: color }]}><Text style={styles.tagText}>{label}</Text></View>;
}

export default function ConfirmationScreen(): React.ReactElement {
  const params = useLocalSearchParams<{
    bookingNumber: string; className?: string; categoryName?: string; level?: string; ageLabel?: string;
    participantName?: string; participantType?: "self" | "child"; paymentMethod?: "cash" | "packageCredit";
    scheduleDate?: string; startTime?: string; endTime?: string; duration?: string;
    location?: string; instructorName?: string; finalPrice?: string; creditsBefore?: string; creditsUsed?: string;
  }>();
  const { bookings, user, children } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const pop = useSuccessPopHaptic();
  const booking = bookings.find((item) => item.bookingNumber === params.bookingNumber);

  const participantName = params.participantName || booking?.participantName || "Student";
  const participantType = params.participantType || booking?.participantType || "self";
  const selectedChild = participantType === "child"
    ? children.find((child) => String(child.id) === String(booking?.participantChildId ?? ""))
    : undefined;
  const scheduleDate = params.scheduleDate || booking?.occurrenceDate || booking?.date || "";
  const startTime = params.startTime || booking?.scheduleStartTime || booking?.time?.match(/\d{1,2}:\d{2}/)?.[0] || "";
  const endTime = params.endTime || booking?.time?.match(/\d{1,2}:\d{2}/g)?.[1] || "";
  const durationMinutes = Number.parseInt(params.duration || booking?.duration || "60", 10) || 60;
  const paymentMethod = params.paymentMethod || booking?.paymentMethod || "cash";
  const isCredit = paymentMethod === "packageCredit";
  const finalPrice = Number(params.finalPrice ?? booking?.price ?? 0);
  const location = params.location || booking?.location || "Central Studio";
  const category = params.categoryName || booking?.danceType || "Class";
  const className = params.className || booking?.className || "Class Booking";

  async function addReminder(): Promise<void> {
    if (!scheduleDate || !startTime) {
      alert.show({ tone: "warning", title: "Schedule unavailable", message: "This class does not have a valid date and time yet." });
      return;
    }
    const fallbackEnd = addMinutes(scheduleDate, startTime, durationMinutes);
    const end = endTime || fallbackEnd.time;
    const calendarUrl = new URLSearchParams({
      action: "TEMPLATE", text: className,
      dates: `${calendarStamp(scheduleDate, startTime)}/${calendarStamp(fallbackEnd.date, end)}`,
      details: `Central Studio booking ${params.bookingNumber}`, location, ctz: "Africa/Cairo",
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Linking.openURL(`https://calendar.google.com/calendar/render?${calendarUrl.toString()}`);
    } catch {
      alert.show({ tone: "error", title: "Couldn't open your calendar", message: "Please add this class to your calendar manually." });
    }
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#17191B", BLACK]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={["rgba(0,182,215,0.50)", "rgba(0,182,215,0.03)", "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.05, y: 0.75 }} style={styles.topGlow} />
      <SuccessConfetti />
      <ScrollView
        showsVerticalScrollIndicator={false}
        bounces
        contentContainerStyle={[styles.canvas, { paddingTop: (Platform.OS === "web" ? 42 : insets.top) + 6, paddingBottom: Math.max(insets.bottom, 10) }]}
      >
        <Animated.View style={[styles.successIcon, { transform: [{ scale: pop }] }]}><Ionicons name="checkmark" size={28} color={BLACK} /></Animated.View>
        <Text style={styles.titleWhite}>BOOKING</Text>
        <Text style={styles.titleCyan}>SUBMITTED</Text>

        <View style={styles.referenceRow}>
          <View style={styles.referenceCopy}><Text style={styles.referenceLabel}>Class</Text><Text style={styles.referenceValue}>{className}</Text></View>
          <View style={[styles.referenceCopy, styles.referenceCopyRight]}><Text style={[styles.referenceLabel, styles.referenceTextRight]}>Booking Ref</Text><Text style={[styles.referenceValue, styles.referenceTextRight]}>{params.bookingNumber || "—"}</Text></View>
        </View>

        <View style={styles.summaryCard}>
          <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.typeRow}>
            <View style={styles.typeCopy}>
              <CategoryIcon name={category} color="#FFFFFF" size={29} />
              <View><Text style={styles.typeTitle}>{category.toUpperCase()}</Text><Text style={styles.typeSub}>Dance Type</Text></View>
            </View>
            <View style={styles.tags}><MiniTag label={params.level || "All Levels"} color="#D800D8" /><MiniTag label={params.ageLabel || "All Ages"} color="#075CE5" /></View>
          </LinearGradient>

          <View style={styles.primaryGrid}>
            <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.timeTile}>
              <View style={styles.tileHeading}><BookingWatchIcon size={26} /><Text style={styles.tileTitle}>Time</Text></View>
              <Text style={styles.tileDate}>{dateLabel(scheduleDate)}</Text>
              <Text style={styles.tileTime}>{startTime || "TBC"}</Text>
              <Text style={styles.tileMeta}>{durationMinutes} Min</Text>
            </LinearGradient>
            <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.studentTile}>
              <View style={styles.tileHeading}>
                {participantType === "self" ? <ParticipantAvatar type="self" name={participantName} avatarUrl={user?.avatarUrl} size={27} /> : <ParticipantAvatar type="child" name={participantName} gender={selectedChild?.gender} size={27} />}
                <Text style={styles.tileTitle}>Student</Text>
              </View>
              <Text style={styles.studentName}>{participantName.toUpperCase()}</Text>
            </LinearGradient>
          </View>

          <View style={styles.secondaryGrid}>
            <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.smallTile}><BookingFlowIcon name={isCredit ? "credit" : "cash"} size={34} /><Text style={styles.smallLabel}>Payment Method</Text><Text style={styles.smallValue}>{isCredit ? "CREDIT" : "CASH"}</Text></LinearGradient>
            <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.smallTile}><BookingFlowIcon name="location" size={34} /><Text style={styles.smallLabel}>Location</Text><Text style={styles.smallValue}>{location.toUpperCase()}</Text></LinearGradient>
            <LinearGradient colors={SUMMARY_GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.smallTile}><Ionicons name="pricetag" size={29} color="#FFFFFF" /><Text style={styles.smallLabel}>Price</Text><Text style={styles.smallValue}>{isCredit ? "1 CREDIT" : `${finalPrice} EGP`}</Text></LinearGradient>
          </View>
        </View>

        <View style={styles.closingCard}>
          <Text style={styles.closingTitle}>See You On The Floor,</Text>
          <Text style={styles.closingText}>Your booking request has been sent to the studio team.{"\n"}You will be notified once it is confirmed.</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.outlineButton} onPress={() => { void addReminder(); }}><BookingSuccessActionIcon name="bell" size={23} /><Text style={styles.outlineText}>Remind Me</Text></TouchableOpacity>
            <TouchableOpacity style={styles.outlineButton} onPress={() => router.replace("/(tabs)/bookings")}><BookingSuccessActionIcon name="calendar" size={23} /><Text style={styles.outlineText}>My Bookings</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.homeButton} onPress={() => router.replace("/(tabs)/" as never)}><BookingSuccessActionIcon name="home" size={23} /><Text style={styles.homeText}>Back to home</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BLACK },
  topGlow: { position: "absolute", top: -45, right: -10, width: "90%", height: 180, transform: [{ rotate: "-9deg" }] },
  canvas: { width: "100%", maxWidth: 430, alignSelf: "center", paddingHorizontal: 15 },
  successIcon: { alignSelf: "center", width: 50, height: 50, borderRadius: 25, backgroundColor: CYAN, alignItems: "center", justifyContent: "center", marginBottom: 7 },
  titleWhite: { alignSelf: "center", fontSize: 36, lineHeight: 36, fontFamily: "Anton_400Regular", color: "#FFFFFF", ...iosDisplayTextStyle(36, 36) },
  titleCyan: { alignSelf: "center", marginTop: -3, fontSize: 36, lineHeight: 36, fontFamily: "Anton_400Regular", color: CYAN, ...iosDisplayTextStyle(36, 36) },
  referenceRow: { marginTop: 14, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", gap: 16, paddingHorizontal: 12 },
  referenceCopy: { flex: 1 },
  referenceCopyRight: { alignItems: "flex-end" },
  referenceTextRight: { textAlign: "right" },
  referenceLabel: { fontSize: 15, lineHeight: 18, fontFamily: "Archivo_500Medium", color: "#FFFFFF" },
  referenceValue: { fontSize: 20, lineHeight: 23, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  summaryCard: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.55)", padding: 9, backgroundColor: "rgba(1,35,41,0.62)" },
  typeRow: { minHeight: 70, borderRadius: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  typeCopy: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }, typeTitle: { fontSize: 22, fontFamily: "Anton_400Regular", color: "#FFFFFF" }, typeSub: { fontSize: 11, fontFamily: "Archivo_500Medium", color: "#FFFFFF" },
  tags: { flexDirection: "row", alignItems: "center", gap: 5 }, tag: { paddingHorizontal: 12, height: 28, borderRadius: 14, justifyContent: "center" }, tagText: { fontSize: 11, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  primaryGrid: { marginTop: 6, minHeight: 127, flexDirection: "row", gap: 6 }, timeTile: { flex: 1.08, borderRadius: 13, padding: 13 }, studentTile: { flex: 1, borderRadius: 13, padding: 13 },
  tileHeading: { flexDirection: "row", alignItems: "center", gap: 8 }, tileTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#FFFFFF" }, tileDate: { marginTop: 12, fontSize: 14, fontFamily: "Archivo_500Medium", color: "#FFFFFF" }, tileTime: { fontSize: 34, lineHeight: 36, fontFamily: "Anton_400Regular", color: "#FFFFFF", ...iosDisplayTextStyle(34, 36) }, tileMeta: { fontSize: 13, fontFamily: "Archivo_500Medium", color: "#FFFFFF" }, studentName: { marginTop: 18, fontSize: 32, lineHeight: 31, fontFamily: "Anton_400Regular", color: "#FFFFFF", ...iosDisplayTextStyle(32, 31) },
  secondaryGrid: { marginTop: 6, minHeight: 129, flexDirection: "row", gap: 6 }, smallTile: { flex: 1, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", justifyContent: "space-between" }, smallLabel: { fontSize: 11, lineHeight: 13, fontFamily: "Archivo_700Bold", color: "#FFFFFF", textAlign: "center" }, smallValue: { fontSize: 20, lineHeight: 22, fontFamily: "Anton_400Regular", color: "#FFFFFF", textAlign: "center", ...iosDisplayTextStyle(20, 22) },
  closingCard: { marginTop: 8, borderRadius: 40, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, backgroundColor: CARD }, closingTitle: { fontSize: 28, fontFamily: "Anton_400Regular", color: "#FFFFFF", textAlign: "center", ...iosDisplayTextStyle(28, 32) }, closingText: { marginTop: 3, marginBottom: 12, fontSize: 13, lineHeight: 17, fontFamily: "Archivo_400Regular", color: "#FFFFFF", textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10 }, outlineButton: { flex: 1, height: 50, borderRadius: 25, borderWidth: 1, borderColor: CYAN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, outlineText: { fontSize: 15, fontFamily: "Archivo_600SemiBold", color: CYAN }, homeButton: { marginTop: 10, height: 52, borderRadius: 26, backgroundColor: CYAN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, homeText: { fontSize: 16, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
});
