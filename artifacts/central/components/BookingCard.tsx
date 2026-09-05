import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { PriceTagIcon } from "@/components/DiscoveryClassCard";
import type { Booking } from "@/contexts/AppContext";
import { bookingOccurrenceStartMs } from "@/utils/bookingCancellationEligibility";
import {
  BOOKING_CARD_MAX_WIDTH,
  bookingCardHeightForWidth,
} from "@/utils/bookingCardLayout";

interface BookingCardProps {
  item: Booking;
  onPress?: () => void;
  classPhotoUrl?: string;
}

const GREEN = "#27C63F";
const PAYMENT_GREEN = "#269134";
const PAYMENT_AMBER = "#E2AA00";
const RED = "#FF101B";
const CYAN = "#00B6D7";

function CountdownIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 11 11" fill="none">
      <Path
        d="M10.475 5.465A5.01 5.01 0 0 0 5.465.455M5.465 2.733v2.732h1.822"
        stroke="#FFFFFF"
        strokeWidth={0.91}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={0.832} cy={3.545} r={0.455} fill="#FFFFFF" />
      <Circle cx={0.455} cy={5.465} r={0.455} fill="#FFFFFF" />
      <Circle cx={0.832} cy={7.385} r={0.455} fill="#FFFFFF" />
      <Circle cx={1.922} cy={1.916} r={0.455} fill="#FFFFFF" />
      <Circle cx={1.922} cy={9.014} r={0.455} fill="#FFFFFF" />
      <Circle cx={3.543} cy={0.838} r={0.455} fill="#FFFFFF" />
      <Circle cx={3.543} cy={10.092} r={0.455} fill="#FFFFFF" />
      <Circle cx={5.465} cy={10.475} r={0.455} fill="#FFFFFF" />
      <Circle cx={7.387} cy={10.092} r={0.455} fill="#FFFFFF" />
      <Circle cx={9.008} cy={9.014} r={0.455} fill="#FFFFFF" />
      <Circle cx={10.098} cy={7.385} r={0.455} fill="#FFFFFF" />
    </Svg>
  );
}

function LocationIcon() {
  return (
    <Svg width={15} height={18} viewBox="0 0 9 11" fill="none">
      <Path
        d="M4.75 3.02074C4.6687 3.0071 4.5852 3 4.5 3C3.67155 3 3 3.67158 3 4.5C3 5.32845 3.67155 6 4.5 6C5.32845 6 6 5.32845 6 4.5C6 4.41482 5.9929 4.3313 5.97925 4.25"
        stroke="#FFFFFF"
        strokeLinecap="round"
      />
      <Path
        d="M1 7.10806C0.67627 6.28111 0.5 5.40066 0.5 4.57165C0.5 2.32294 2.29086 0.5 4.5 0.5C6.70916 0.5 8.50001 2.32294 8.50001 4.57165C8.50001 6.80276 7.22336 9.40621 5.23146 10.3372C4.76716 10.5543 4.23285 10.5543 3.76855 10.3372C3.13237 10.0399 2.56916 9.57196 2.09719 9.00001"
        stroke="#FFFFFF"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function paymentState(status: Booking["paymentStatus"]) {
  switch (status) {
    case "pending_payment": return { label: "Pending Payment", color: PAYMENT_AMBER };
    case "failed": return { label: "Payment Failed", color: RED };
    case "refunded": return { label: "Refunded", color: CYAN };
    case "paid":
    case "not_required":
    default:
      return { label: "Paid", color: PAYMENT_GREEN };
  }
}

function bookingState(status: Booking["bookingStatus"]) {
  if (status === "cancelled" || status === "rejected") {
    return { label: "Cancelled", color: RED, bg: "rgba(255,16,27,0.22)" };
  }
  return { label: "Available", color: GREEN, bg: "rgba(39,198,63,0.25)" };
}

function dateParts(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { weekday: "DATE", date: "TBD" };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase(),
    date: `${match[3]} ${date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()} ${match[1]}`,
  };
}

function twentyFourHourTime(raw?: string | null, fallback?: string) {
  const source = raw || fallback || "";
  const match = source.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (!match) return "--:--";
  let hour = Number(match[1]);
  const suffix = match[3]?.toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function countdownLabel(item: Booking, now = Date.now()) {
  const start = bookingOccurrenceStartMs({
    occurrenceDate: item.occurrenceDate ?? item.date,
    startTime: item.scheduleStartTime,
  });
  if (start == null) return "Class time confirmed";
  const remaining = start - now;
  if (remaining <= 0) return "Class time reached";

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  if (days > 0 && hours > 0) return `${days} ${days === 1 ? "day" : "days"} · ${hours} ${hours === 1 ? "hour" : "hours"} left`;
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} left`;
  if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  return "Less than 1 hour left";
}

function PersonRow({ label, name, image }: { label: string; name: string; image?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={styles.personRow}>
      <View style={styles.avatar}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={styles.initial}>{initial}</Text>}
      </View>
      <View style={styles.personCopy}>
        <Text style={styles.personLabel}>{label}</Text>
        <Text style={styles.personName} numberOfLines={1}>{name || "TBD"}</Text>
      </View>
    </View>
  );
}

export function bookingStatusConfig(status: Booking["bookingStatus"]) {
  return bookingState(status);
}

export function paymentStatusConfig(status: Booking["paymentStatus"]) {
  const state = paymentState(status);
  return { label: state.label, c: state.color, ic: status === "pending_payment" ? "!" : "✓" };
}

export default function BookingCard({ item, onPress, classPhotoUrl }: BookingCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [cardWidth, setCardWidth] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const payment = paymentState(item.paymentStatus);
  const status = item.sourceUnavailable
    ? { label: "Unavailable", color: "#B6BDC6", bg: "rgba(255,255,255,0.12)" }
    : bookingState(item.bookingStatus);
  const date = useMemo(() => dateParts(item.occurrenceDate ?? item.date), [item.occurrenceDate, item.date]);
  const countdown = useMemo(() => countdownLabel(item, now), [item.occurrenceDate, item.date, item.scheduleStartTime, now]);
  const time = twentyFourHourTime(item.scheduleStartTime, item.time);
  const cardHeight = bookingCardHeightForWidth(cardWidth);
  return (
    <View
      testID="my-booking-card"
      style={[styles.rail, { height: cardHeight, backgroundColor: payment.color }]}
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        setCardWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
      }}
    >
      <View pointerEvents="none" style={styles.paymentRailContent}>
        <View style={styles.paymentRailInner}>
          <PriceTagIcon />
          <Text style={styles.paymentRailText} numberOfLines={1}>{payment.label}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>
        <View style={styles.imageArea}>
          {classPhotoUrl || item.classPhotoUrl ? (
            <Image source={{ uri: classPhotoUrl || item.classPhotoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={["#30343A", "#101214"]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.02)", "rgba(0,0,0,0.18)", "rgba(5,6,7,0.98)"]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>

        <View style={[styles.countdownPill, { backgroundColor: payment.color }]}>
          <CountdownIcon />
          <Text style={styles.countdownText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
            {countdown} · {date.date.replace(/\s\d{4}$/, "")}
          </Text>
        </View>

        <View style={styles.panelShell}>
          <GlassView
            glassEffectStyle="clear"
            tintColor="rgba(3,21,24,0.20)"
            colorScheme="dark"
            pointerEvents="none"
            style={styles.glassBackdrop}
          />
          <View style={styles.panelContent}>
            <View style={styles.upperRow}>
              <View style={styles.classInfoColumn}>
                <Text style={styles.className} numberOfLines={1}>{item.className}</Text>
                <PersonRow label="Instructor" name={item.instructorName || "Instructor"} image={item.instructorImage} />
                <View style={styles.venueRow}>
                  <View style={styles.locationIconSlot}><LocationIcon /></View>
                  <View style={styles.personCopy}>
                    <Text style={styles.personLabel}>Venue</Text>
                    <Text style={styles.personName} numberOfLines={1}>{item.location || "Central Studio"}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.timeColumn}>
                <Text style={styles.classDate} numberOfLines={1} adjustsFontSizeToFit>{date.date}</Text>
                <Text style={styles.classTime} numberOfLines={1} adjustsFontSizeToFit>{time}</Text>
              </View>
            </View>
          </View>
          <View pointerEvents="none" style={styles.panelBottomHighlight} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: "100%", maxWidth: BOOKING_CARD_MAX_WIDTH, alignSelf: "center", borderRadius: 17, marginBottom: 12, position: "relative", overflow: "hidden" },
  paymentRailContent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 26, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  paymentRailInner: { width: 176, height: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, transform: [{ rotate: "-90deg" }] },
  paymentRailText: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 12, lineHeight: 15, textTransform: "uppercase" },
  card: { position: "absolute", top: 0, right: 0, bottom: 0, left: 26, borderRadius: 17, overflow: "hidden", backgroundColor: "#050607", borderWidth: 1, borderColor: "rgba(255,255,255,0.88)", shadowColor: "#000", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.38, shadowRadius: 9, elevation: 6 },
  imageArea: { width: "100%", height: "61%", backgroundColor: "#17191D" },
  statusPill: { position: "absolute", top: 11, right: 11, zIndex: 8, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Archivo_700Bold", fontSize: 12, lineHeight: 15 },
  countdownPill: { position: "absolute", left: "8%", right: "8%", bottom: 10, height: 30, zIndex: 9, borderTopLeftRadius: 15, borderTopRightRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 14, shadowColor: "#000000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 5, elevation: 3 },
  countdownText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 13, lineHeight: 16 },
  panelShell: { position: "absolute", left: 12, right: 12, bottom: 10, height: "52%", zIndex: 7, borderRadius: 15, overflow: "hidden", backgroundColor: "rgba(2,25,29,0.62)" },
  glassBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent" },
  panelBottomHighlight: { position: "absolute", left: 14, right: 14, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.16)" },
  panelContent: { flex: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 },
  upperRow: { flex: 1, minHeight: 0, flexDirection: "row" },
  classInfoColumn: { width: "56%", minWidth: 0, paddingRight: 8 },
  className: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 27, lineHeight: 31, marginBottom: 7 },
  personRow: { flexDirection: "row", alignItems: "center", minHeight: 27 },
  venueRow: { flexDirection: "row", alignItems: "center", minHeight: 27 },
  avatar: { width: 25, height: 25, borderRadius: 12.5, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,182,215,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.42)" },
  initial: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12 },
  locationIconSlot: { width: 25, height: 25, alignItems: "center", justifyContent: "center" },
  personCopy: { flex: 1, minWidth: 0, marginLeft: 8 },
  personLabel: { color: "#AEB5BE", fontFamily: "SpaceMono_400Regular", fontSize: 9.5, lineHeight: 11, textTransform: "uppercase" },
  personName: { color: "#FFFFFF", fontFamily: "Archivo_600SemiBold", fontSize: 13, lineHeight: 15 },
  timeColumn: { flex: 1, minWidth: 0, alignItems: "flex-end", justifyContent: "flex-start", paddingLeft: 6 },
  classDate: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 16, lineHeight: 20, textAlign: "right", width: "100%" },
  classTime: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 56, lineHeight: 60, textAlign: "right", width: "100%" },
});
