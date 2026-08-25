import * as Haptics from "expo-haptics";
import { GlassView } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { normalizeMediaUrl } from "@workspace/api-client-react";
import { BookingBellIcon } from "@/components/BookingDetailsIcons";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import type { BalletClass, BalletClassSchedule } from "@/services/balletAssessmentService";
import { bookingOccurrenceStartMs } from "@/utils/bookingCancellationEligibility";
import { getNextCairoScheduleDate } from "@/utils/cairoDate";
import { scheduleLocationLabel } from "@/utils/scheduleLocation";

const CYAN = "#00B6D7";
const GREEN = "#27C63F";

function CountdownIcon() {
  return (
    <Svg width={13} height={13} viewBox="0 0 11 11" fill="none">
      <Path d="M10.475 5.465A5.01 5.01 0 0 0 5.465.455M5.465 2.733v2.732h1.822" stroke="#FFFFFF" strokeWidth={0.91} strokeLinecap="round" strokeLinejoin="round" />
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
    <Svg width={11} height={14} viewBox="0 0 9 11" fill="none">
      <Path d="M4.75 3.02074C4.6687 3.0071 4.5852 3 4.5 3C3.67155 3 3 3.67158 3 4.5C3 5.32845 3.67155 6 4.5 6C5.32845 6 6 5.32845 6 4.5C6 4.41482 5.9929 4.3313 5.97925 4.25" stroke="#FFFFFF" strokeLinecap="round" />
      <Path d="M1 7.10806C0.67627 6.28111 0.5 5.40066 0.5 4.57165C0.5 2.32294 2.29086 0.5 4.5 0.5C6.70916 0.5 8.50001 2.32294 8.50001 4.57165C8.50001 6.80276 7.22336 9.40621 5.23146 10.3372C4.76716 10.5543 4.23285 10.5543 3.76855 10.3372C3.13237 10.0399 2.56916 9.57196 2.09719 9.00001" stroke="#FFFFFF" strokeLinecap="round" />
    </Svg>
  );
}

function avatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function dateLabel(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "DATE TBC";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return match[3] + " " + date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
}

function twentyFourHourTime(raw: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  return match ? String(Number(match[1])).padStart(2, "0") + ":" + match[2] : "--:--";
}

function countdownLabel(date: string, startTime: string, now: number) {
  const start = bookingOccurrenceStartMs({ occurrenceDate: date, startTime });
  if (start == null) return "Class time confirmed";
  const remaining = start - now;
  if (remaining <= 0) return "Class time reached";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  if (days > 0 && hours > 0) return days + " " + (days === 1 ? "day" : "days") + " · " + hours + " " + (hours === 1 ? "hour" : "hours") + " left";
  if (days > 0) return days + " " + (days === 1 ? "day" : "days") + " left";
  if (hours > 0) return hours + " " + (hours === 1 ? "hour" : "hours") + " left";
  return "Less than 1 hour left";
}

function calendarStamp(date: string, time: string) {
  return date.replaceAll("-", "") + "T" + time.replace(":", "") + "00";
}

export default function BalletScheduleCard({
  item,
  schedule,
}: {
  item: BalletClass;
  schedule: BalletClassSchedule;
}) {
  const alert = useCentralAlert();
  const [now, setNow] = useState(() => Date.now());
  const [imageFailed, setImageFailed] = useState(false);
  const occurrenceDate = getNextCairoScheduleDate(schedule.dayOfWeek, schedule.startTime, new Date(now));
  const instructorImage = normalizeMediaUrl(item.instructor.photoUrl, "image");
  const classImage = normalizeMediaUrl(item.classImageUrl, "image");
  const venue = scheduleLocationLabel({ branch: schedule.branch, room: schedule.room }) ?? "Central Studio";
  const weekday = new Date(occurrenceDate + "T00:00:00.000Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const countdown = useMemo(
    () => countdownLabel(occurrenceDate, schedule.startTime, now),
    [now, occurrenceDate, schedule.startTime],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  async function addReminder() {
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: item.title,
      dates: calendarStamp(occurrenceDate, schedule.startTime) + "/" + calendarStamp(occurrenceDate, schedule.endTime),
      details: item.title + " with " + item.instructor.name,
      location: venue,
      ctz: "Africa/Cairo",
    });
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Linking.openURL("https://calendar.google.com/calendar/render?" + params.toString());
    } catch {
      alert.show({
        tone: "error",
        title: "Couldn't open your calendar",
        message: "Please add this Ballet class to your calendar manually.",
      });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.imageArea}>
        {classImage && !imageFailed ? (
          <Image
            source={{ uri: classImage }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <LinearGradient colors={["#30343A", "#101214"]} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0.02)", "rgba(0,0,0,0.18)", "rgba(5,6,7,0.98)"]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.statusPill}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>Available</Text>
      </View>

      <View style={styles.countdownPill}>
        <CountdownIcon />
        <Text style={styles.countdownText} numberOfLines={1}>{countdown} · {dateLabel(occurrenceDate)}</Text>
      </View>

      <View style={styles.panelShell}>
        <GlassView
          glassEffectStyle="clear"
          tintColor="rgba(255,255,255,0.08)"
          colorScheme="dark"
          pointerEvents="none"
          style={styles.glassBackdrop}
        />
        <View style={styles.panelContent}>
          <View style={styles.detailsRow}>
            <View style={styles.classInfoColumn}>
              <Text style={styles.className} numberOfLines={1}>{item.title}</Text>
              <View style={styles.infoRow}>
                <View style={styles.avatar}>
                  {instructorImage ? (
                    <Image source={{ uri: instructorImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <Text style={styles.avatarInitial}>{avatarInitial(item.instructor.name)}</Text>
                  )}
                </View>
                <View style={styles.infoCopy}>
                  <Text style={styles.infoLabel}>Instructor</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{item.instructor.name}</Text>
                </View>
              </View>
              <View style={styles.infoRow}>
                <View style={styles.locationSlot}><LocationIcon /></View>
                <View style={styles.infoCopy}>
                  <Text style={styles.infoLabel}>Venue</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{venue}</Text>
                </View>
              </View>
            </View>

            <View style={styles.timeColumn}>
              <Text style={styles.weekday} numberOfLines={1}>EACH {weekday.toUpperCase()}</Text>
              <Text style={styles.time} numberOfLines={1}>{twentyFourHourTime(schedule.startTime)}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.reminderButton} onPress={addReminder} activeOpacity={0.84}>
            <BookingBellIcon size={19} />
            <Text style={styles.reminderText}>Remind Me</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    height: 306,
    marginBottom: 12,
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#050607",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  imageArea: { width: "100%", height: 214, backgroundColor: "#17191D" },
  statusPill: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: "rgba(39,198,63,0.25)",
  },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GREEN },
  statusText: { color: GREEN, fontFamily: "Archivo_700Bold", fontSize: 12 },
  countdownPill: {
    position: "absolute",
    top: 110,
    left: "50%",
    width: 246,
    height: 30,
    marginLeft: -123,
    zIndex: 8,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    backgroundColor: GREEN,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 3,
  },
  countdownText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12, lineHeight: 16 },
  panelShell: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    height: 154,
    zIndex: 7,
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  glassBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(1,8,10,0.38)" },
  panelContent: { flex: 1, paddingHorizontal: 12, paddingTop: 15, paddingBottom: 10 },
  detailsRow: { flex: 1, minHeight: 0, flexDirection: "row" },
  classInfoColumn: { width: "56%", minWidth: 0, paddingRight: 6 },
  className: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 27, marginBottom: 1 },
  infoRow: { minHeight: 27, flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 23,
    height: 23,
    borderRadius: 11.5,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
  },
  avatarInitial: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 9 },
  locationSlot: { width: 23, height: 23, alignItems: "center", justifyContent: "center" },
  infoCopy: { flex: 1, minWidth: 0, marginLeft: 6 },
  infoLabel: { color: "#AEB5BE", fontFamily: "SpaceMono_400Regular", fontSize: 9, lineHeight: 11, textTransform: "uppercase" },
  infoValue: { color: "#FFFFFF", fontFamily: "Archivo_600SemiBold", fontSize: 12, lineHeight: 14 },
  timeColumn: { flex: 1, minWidth: 0, alignItems: "flex-end", paddingTop: 1 },
  weekday: { width: "100%", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 13, lineHeight: 16, textAlign: "right" },
  time: { width: "100%", color: CYAN, fontFamily: "Anton_400Regular", fontSize: 52, lineHeight: 55, textAlign: "right" },
  reminderButton: {
    width: "100%",
    minHeight: 42,
    marginTop: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  reminderText: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 20, lineHeight: 23, textTransform: "capitalize" },
});
