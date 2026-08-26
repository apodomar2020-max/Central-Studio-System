import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useMemo, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  normalizeMediaUrl,
  useGetClass,
  useGetInstructor,
  useGetSchedule,
  useListDanceTypes,
} from "@workspace/api-client-react";

import type { Booking } from "@/contexts/AppContext";
import CentralBackButton from "@/components/CentralBackButton";
import CategoryIcon from "@/components/CategoryIcon";
import { PriceTagIcon } from "@/components/DiscoveryClassCard";
import SBI from "@/components/SbIcon";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { isBookingSelfCancellableClientSide } from "@/utils/bookingCancellationEligibility";
import {
  BookingBellIcon,
  BookingCalendarIcon,
  BookingLocationIcon,
  BookingWatchIcon,
} from "@/components/BookingDetailsIcons";

const CYAN = "#03B6D7";
const INK = "#050607";
const CARD = "#012329";
const MUTED = "#B6BDC6";
const GREEN = "#24C65A";
const AMBER = "#FFC400";
const RED = "#FF101B";

type Props = {
  booking: Booking;
  participantImage?: string;
  onClose: () => void;
  onCancel?: () => void;
};

function paymentState(status: Booking["paymentStatus"]) {
  switch (status) {
    case "pending_payment": return { label: "Pending Payment", color: AMBER };
    case "failed": return { label: "Payment Failed", color: RED };
    case "refunded": return { label: "Refunded", color: CYAN };
    default: return { label: "Paid", color: GREEN };
  }
}

function dateDisplay(raw?: string) {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: "Date", date: "TBD" };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return {
    day: date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    date: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }),
  };
}

function firstClock(raw?: string | null) {
  const match = raw?.match(/(\d{1,2}):(\d{2})/);
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

function secondClock(raw?: string | null) {
  const matches = [...(raw ?? "").matchAll(/(\d{1,2}):(\d{2})/g)];
  const match = matches[1];
  return match ? `${String(Number(match[1])).padStart(2, "0")}:${match[2]}` : "";
}

function addMinutes(date: string, time: string, minutes: number) {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})/);
  if (!dateMatch || !timeMatch) return { date, time };
  const value = new Date(Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]) + minutes,
  ));
  return {
    date: value.toISOString().slice(0, 10),
    time: value.toISOString().slice(11, 16),
  };
}

function calendarStamp(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function normalizedName(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function levelColor(level: string) {
  if (/beginner/i.test(level)) return "#D800D8";
  if (/intermediate/i.test(level)) return AMBER;
  if (/advanced/i.test(level)) return RED;
  return "#7C3AED";
}

function ageColor(age: string) {
  if (/kid/i.test(age)) return "#075CE5";
  if (/teen/i.test(age)) return "#7C3AED";
  if (/adult/i.test(age)) return "#FF6B2C";
  return CYAN;
}

function PersonAvatar({ image, name, size = 31 }: { image?: string; name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Text style={styles.avatarInitial}>{name.trim().charAt(0).toUpperCase() || "?"}</Text>
      )}
    </View>
  );
}

export default function BookingDetailsView({ booking, participantImage, onClose, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const alert = useCentralAlert();
  const [heroFailed, setHeroFailed] = useState(false);
  const classId = Number(booking.classId);
  const scheduleId = Number(booking.scheduleId);

  const classQuery = useGetClass(classId, {
    query: { queryKey: ["booking-detail-class", classId], enabled: Number.isInteger(classId) && classId > 0 },
  });
  const scheduleQuery = useGetSchedule(scheduleId, {
    query: { queryKey: ["booking-detail-schedule", scheduleId], enabled: Number.isInteger(scheduleId) && scheduleId > 0 },
  });
  const instructorId = classQuery.data?.instructorId ?? 0;
  const instructorQuery = useGetInstructor(instructorId, {
    query: { queryKey: ["booking-detail-instructor", instructorId], enabled: Number.isInteger(instructorId) && instructorId > 0 },
  });
  const danceTypesQuery = useListDanceTypes();

  const cls = classQuery.data;
  const schedule = scheduleQuery.data;
  const instructor = instructorQuery.data;
  const payment = paymentState(booking.paymentStatus);
  const occurrenceDate = booking.occurrenceDate || booking.date;
  const displayDate = dateDisplay(occurrenceDate);
  const startTime = firstClock(booking.scheduleStartTime || booking.time) || "--:--";
  const endTime = firstClock(schedule?.endTime) || secondClock(booking.time);
  const durationMinutes = (cls?.durationMins ?? Number.parseInt(booking.duration, 10)) || 60;
  const timeRange = endTime ? `${startTime} - ${endTime}` : startTime;
  const durationLabel = `${durationMinutes} Min`;
  const branchName = schedule?.branch?.name || booking.location || "Central Studio";
  const mapsLink = schedule?.branch?.googleMapsLink || "";
  const instructorName = instructor?.name || booking.instructorName || "Instructor";
  const instructorPhoto = normalizeMediaUrl(instructor?.photoUrl, "image") || booking.instructorImage;
  const title = cls?.title || booking.className;
  const description = cls?.description?.trim() || "Your class schedule and booking details are confirmed below.";
  const classType = cls?.category || booking.danceType || "Class";
  const level = cls?.level || "All Levels";
  const age = cls?.ageRangeLabel || cls?.ageGroup || "All Ages";
  const heroImage = normalizeMediaUrl(cls?.photoUrl, "image") || booking.classPhotoUrl;
  const isCancelled = booking.bookingStatus === "cancelled" || booking.bookingStatus === "rejected";
  const canCancel = !isCancelled && !booking.sourceUnavailable && isBookingSelfCancellableClientSide({
    occurrenceDate,
    startTime: booking.scheduleStartTime,
  });

  const danceType = useMemo(() => {
    const types = danceTypesQuery.data ?? [];
    if (cls?.danceTypeId != null) {
      const exact = types.find((item) => item.id === cls.danceTypeId);
      if (exact) return exact;
    }
    const target = normalizedName(classType);
    return types.find((item) => normalizedName(item.name) === target || normalizedName(item.slug) === target);
  }, [classType, cls?.danceTypeId, danceTypesQuery.data]);

  async function openUrl(url: string, errorMessage: string) {
    try {
      await Linking.openURL(url);
    } catch {
      alert.show({ tone: "error", title: "Couldn't open this link", message: errorMessage });
    }
  }

  async function addReminder() {
    const start = firstClock(booking.scheduleStartTime || booking.time);
    if (!occurrenceDate || !start) {
      alert.show({ tone: "warning", title: "Schedule unavailable", message: "This booking doesn't have a valid date and time yet." });
      return;
    }
    const fallbackEnd = addMinutes(occurrenceDate, start, durationMinutes);
    const finalEndDate = fallbackEnd.date;
    const finalEndTime = endTime || fallbackEnd.time;
    const dates = `${calendarStamp(occurrenceDate, start)}/${calendarStamp(finalEndDate, finalEndTime)}`;
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates,
      details: `${description}\nBooking: ${booking.bookingNumber}`,
      location: branchName,
      ctz: "Africa/Cairo",
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await openUrl(`https://calendar.google.com/calendar/render?${params.toString()}`, "Please open your calendar and add the class manually.");
  }

  async function findLocation() {
    const fallbackQuery = schedule?.branch?.address || branchName;
    const url = mapsLink || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await openUrl(url, "The branch location couldn't be opened.");
  }

  function openInstructor() {
    if (!instructorId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/instructor/[id]", params: { id: String(instructorId) } });
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = (Platform.OS === "web" ? 24 : insets.bottom) + 28;

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: bottomPad }}>
        <View style={styles.hero}>
          {heroImage && !heroFailed ? (
            <Image source={{ uri: heroImage }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setHeroFailed(true)} />
          ) : (
            <LinearGradient colors={["#283038", "#090B0D"]} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={["rgba(0,0,0,0.22)", "rgba(0,0,0,0.02)", "rgba(5,6,7,0.68)"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          <CentralBackButton onPress={onClose} style={[styles.back, { top: topPad + 12 }]} />
        </View>

        <View style={styles.mainCard}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <View style={[styles.paymentPill, { backgroundColor: payment.color }]}>
              <PriceTagIcon />
              <Text style={styles.paymentText}>{payment.label}</Text>
            </View>
          </View>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.schedulePanel}>
            <GlassView glassEffectStyle="clear" tintColor="rgba(255,255,255,0.08)" colorScheme="dark" pointerEvents="none" style={StyleSheet.absoluteFill} />
            <View style={styles.scheduleContent}>
              <View style={styles.scheduleCell}>
                <BookingCalendarIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{displayDate.day}</Text>
                <Text style={styles.scheduleLabel} numberOfLines={1}>{displayDate.date}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.scheduleCell}>
                <BookingWatchIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{timeRange}</Text>
                <Text style={styles.scheduleLabel}>{durationLabel}</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.scheduleCell}>
                <BookingLocationIcon />
                <Text style={styles.scheduleValue} numberOfLines={1}>{branchName}</Text>
                <Text style={styles.scheduleLabel}>Branch</Text>
              </View>
              <View style={styles.separator} />
              <View style={styles.scheduleCell}>
                <PersonAvatar image={participantImage} name={booking.participantName} size={24} />
                <Text style={styles.scheduleValue} numberOfLines={1}>{booking.participantName}</Text>
                <Text style={styles.scheduleLabel}>Student</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.instructorAndTags}>
          <TouchableOpacity style={styles.instructor} onPress={openInstructor} disabled={!instructorId} activeOpacity={0.82}>
            <PersonAvatar image={instructorPhoto} name={instructorName} size={38} />
            <View style={styles.instructorCopy}>
              <Text style={styles.instructorLabel}>Instructor</Text>
              <Text style={styles.instructorName} numberOfLines={1}>{instructorName}</Text>
            </View>
          </TouchableOpacity>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tags}>
            <View style={[styles.tag, styles.styleTag]}>
              <CategoryIcon iconSvg={danceType?.iconSvg} iconUrl={danceType?.iconUrl} name={classType} color={danceType?.color || CYAN} size={13} />
              <Text style={[styles.tagText, styles.styleTagText]} numberOfLines={1}>{classType}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: levelColor(level) }]}><Text style={styles.tagText}>{level}</Text></View>
            <View style={[styles.tag, { backgroundColor: ageColor(age) }]}><Text style={styles.tagText}>{age}</Text></View>
          </ScrollView>
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.actionTitle}>Before Your Class</Text>
          <Text style={styles.actionDescription}>
            Come ready to move in comfortable clothing, bring water, and follow any class-specific guidance shared by your instructor.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.outlineButton} onPress={addReminder} activeOpacity={0.82}>
              <BookingBellIcon size={19} />
              <Text style={styles.outlineText}>Remind Me</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.outlineButton} onPress={findLocation} activeOpacity={0.82}>
              <BookingLocationIcon size={19} />
              <Text style={styles.outlineText}>Find Location</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.cancelButton, !canCancel && styles.cancelDisabled]}
            disabled={!canCancel}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onCancel?.();
            }}
            activeOpacity={0.84}
          >
            <SBI name="x" size={18} stroke={2} color="#FFFFFF" />
            <Text style={styles.cancelText}>{isCancelled ? "Booking Cancelled" : canCancel ? "Cancel Booking" : "Cancellation Closed"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, zIndex: 100, backgroundColor: INK },
  hero: { height: 246, position: "relative", backgroundColor: "#17191D" },
  back: { position: "absolute", left: 16, zIndex: 10 },
  mainCard: { marginTop: -35, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 25, borderBottomRightRadius: 25, backgroundColor: CARD, paddingHorizontal: 19, paddingTop: 30, paddingBottom: 38, zIndex: 3 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 34, lineHeight: 38, textTransform: "uppercase" },
  paymentPill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 30, paddingHorizontal: 13, borderRadius: 999, marginTop: 2 },
  paymentText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 11.5 },
  description: { marginTop: 4, color: "#D2D7DC", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20 },
  schedulePanel: { height: 80, borderRadius: 15, overflow: "hidden", marginTop: 20, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  scheduleContent: { flex: 1, flexDirection: "row", paddingHorizontal: 7, paddingVertical: 9 },
  scheduleCell: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 2 },
  separator: { width: 1, marginVertical: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  scheduleValue: { width: "100%", textAlign: "center", color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12, lineHeight: 15 },
  scheduleLabel: { width: "100%", textAlign: "center", color: "#AEB5BE", fontFamily: "Archivo_400Regular", fontSize: 9.5, lineHeight: 11 },
  avatar: { overflow: "hidden", backgroundColor: "rgba(0,182,215,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.52)", alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 11 },
  instructorAndTags: { minHeight: 68, paddingHorizontal: 19, flexDirection: "row", alignItems: "center", gap: 12 },
  instructor: { flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 120 },
  instructorCopy: { marginLeft: 8, flexShrink: 1 },
  instructorLabel: { color: "#7F8892", fontFamily: "Archivo_400Regular", fontSize: 9, lineHeight: 11 },
  instructorName: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 17, lineHeight: 20 },
  tags: { alignItems: "center", gap: 5, paddingRight: 4 },
  tag: { height: 28, minWidth: 58, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  styleTag: { backgroundColor: "#FFFFFF", flexDirection: "row", gap: 4 },
  tagText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 9.5 },
  styleTagText: { color: CYAN },
  actionCard: { borderTopLeftRadius: 46, borderTopRightRadius: 46, backgroundColor: CARD, paddingHorizontal: 19, paddingTop: 36, paddingBottom: 22 },
  actionTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 16, lineHeight: 21 },
  actionDescription: { color: "#D2D7DC", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20, marginTop: 7, marginBottom: 28 },
  actionRow: { flexDirection: "row", gap: 12 },
  outlineButton: { flex: 1, height: 52, borderRadius: 26, borderWidth: 1.3, borderColor: CYAN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  outlineText: { color: CYAN, fontFamily: "Archivo_700Bold", fontSize: 14 },
  cancelButton: { height: 52, marginTop: 14, borderRadius: 26, backgroundColor: RED, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cancelDisabled: { backgroundColor: "rgba(255,16,27,0.34)" },
  cancelText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 15 },
});
