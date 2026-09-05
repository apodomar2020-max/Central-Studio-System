import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Animated,
  TextInput,
  Image
} from "react-native";

import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { normalizeMediaUrl, useListClasses } from "@workspace/api-client-react";

import { useAppContext } from "@/contexts/AppContext";
import { Booking } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import BookingCard from "@/components/BookingCard";
import CentralBackButton from "@/components/CentralBackButton";
import SBI from "@/components/SbIcon";
import EmptyState from "@/components/EmptyState";
import { ListSkeleton } from "@/components/SkeletonLoader";
import {
  type BalletApplication,
} from "@/services/balletAssessmentService";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { scheduleLocationLabel } from "@/utils/scheduleLocation";
import { bookingOccurrenceStartMs, isBookingSelfCancellableClientSide } from "@/utils/bookingCancellationEligibility";
import { isVisibleUpcomingMyBooking } from "@/utils/myBookingsVisibility";
import { presentUserFacingError } from "@/utils/userFacingError";

const EMPTY_BOOKINGS_ANIMATION = require("@/assets/animations/calendar-error.json");

const BALLET_COLOR = "#A78BFA";
type BalletStatusInfo = { label: string; color: string; icon: any };
function getBalletStatusInfo(status: string): BalletStatusInfo {
  switch (status) {
    case "pending":         return { label: "Under Review",         color: "#F59E0B", icon: "time-outline" };
    case "needsFollowUp":   return { label: "Follow-up Required",   color: "#F59E0B", icon: "chatbubble-ellipses-outline" };
    case "accepted":        return { label: "Accepted",             color: "#22C55E", icon: "checkmark-circle" };
    case "assignedToLevel": return { label: "Level Assigned",       color: BALLET_COLOR, icon: "ribbon-outline" };
    case "active":          return { label: "Active Student",       color: BALLET_COLOR, icon: "star-outline" };
    case "rejected":        return { label: "Not Accepted",         color: "#EF4444", icon: "close-circle-outline" };
    case "cancelled":       return { label: "Cancelled",            color: "#6B7280", icon: "ban-outline" };
    default:                return { label: status,                 color: "#9CA3AF", icon: "information-circle-outline" };
  }
}

// A4: real schedule/instructor display for active, grouped students.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
function formatDay(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? "?";
}

type BalletActiveDisplay = {
  isActiveGrouped: boolean;   // active status + assigned group (backend resolved)
  hasSchedule: boolean;
  hasInstructor: boolean;
  daysLabel: string;          // e.g. "Mon, Wed"
  timesLabel: string;         // e.g. "16:00–17:00"
  instructorLabel: string;    // e.g. "Ms. Nour"
  locationLabel: string;
};

// Derives the real schedule/instructor strings for an active, grouped student.
// resolvedSchedules/resolvedInstructors are non-null ONLY when the backend
// considers the application active + grouped (see GET /ballet/applications/my),
// so their presence is the source of truth — never the placeholder path.
function getBalletActiveDisplay(app: BalletApplication): BalletActiveDisplay {
  const isActiveGrouped = app.status === "active" && app.resolvedSchedules != null;
  const schedules = app.resolvedSchedules ?? [];
  const instructors = app.resolvedInstructors ?? [];

  const days = [...new Set(schedules.map((s) => formatDay(s.dayOfWeek)))];
  const times = [...new Set(schedules.map((s) => `${s.startTime}–${s.endTime}`))];
  const locations = [...new Set(schedules
    .map((s) => scheduleLocationLabel({ branch: s.branch, room: s.room }))
    .filter((value): value is string => value != null))];

  return {
    isActiveGrouped,
    hasSchedule: schedules.length > 0,
    hasInstructor: instructors.length > 0,
    daysLabel: days.join(", "),
    timesLabel: times.join(", "),
    instructorLabel: instructors.join(", "),
    locationLabel: locations.join(", "),
  };
}

type ListItem =
  | { kind: "ballet"; data: BalletApplication; timestamp: number }
  | { kind: "booking"; data: Booking; timestamp: number };

// ─── AssessmentCard (matching design) ──────────────────────────────────────────
function AssessmentCard({ app, onPress }: { app: BalletApplication, onPress?: () => void }) {
  const info = getBalletStatusInfo(app.status);
  const active = getBalletActiveDisplay(app);
  // Active + grouped students see their real class schedule/instructor; every
  // other status keeps the assessment placeholders (A4).
  const dateStr = active.isActiveGrouped && active.hasSchedule
    ? `${active.daysLabel} · ${active.timesLabel}`
    : app.assessmentDate || new Date(app.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const cardTitle = active.isActiveGrouped ? "Ballet Class" : "Ballet Level Assessment";
  const assessorLabel = active.isActiveGrouped ? "Instructor" : "Assessor";
  const assessorName = active.isActiveGrouped && active.hasInstructor ? active.instructorLabel : "TBD";
  const assessorInitials = assessorName !== "TBD"
    ? assessorName.split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
    : "TBD";

  const childInitials = app.childName
    .split(/\s+/)
    .filter(Boolean)
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  return (
    <View style={acStyles.card}>
      {/* gradient header */}
      <LinearGradient colors={["rgba(0,182,215,0.18)", "rgba(0,182,215,0.12)"]} style={acStyles.header}>
        <View style={acStyles.headerRow}>
          <View style={acStyles.typeBadge}>
            <Text style={acStyles.typeText}>Ballet Assessment</Text>
          </View>
          <View style={[acStyles.statusBadge, { backgroundColor: info.color + "1A" }]}>
            <Ionicons name={info.icon} size={10} color={info.color} />
            <Text style={[acStyles.statusText, { color: info.color }]}>{info.label}</Text>
          </View>
        </View>
        <Text style={acStyles.className}>{cardTitle}</Text>

        <View style={acStyles.metaRow}>
          <View style={acStyles.slot}>
            <View style={acStyles.slotAvatar}>
              <Text style={acStyles.slotInitials}>{childInitials}</Text>
            </View>
            <View>
              <Text style={acStyles.slotLabel}>Student</Text>
              <Text style={acStyles.slotName} numberOfLines={1}>{app.childName}</Text>
            </View>
          </View>

          <View style={acStyles.levelBlock}>
            <Text style={acStyles.levelLabel}>Status</Text>
            <Text style={acStyles.levelValue}>{info.label}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* body */}
      <View style={acStyles.body}>
        <View style={acStyles.scheduleRow}>
          <View style={acStyles.metaItem}>
            <SBI name="cal" size={14} stroke={2} color="#00B6D7" />
            <Text style={acStyles.metaText}>{dateStr}</Text>
          </View>
        </View>

        {/* C4/D3: current-month hours for an active, subscribed student.
            attendanceSummary is now also populated when the student is
            active but NOT subscribed this month (D3, so the full status
            screen can show its own message) — this compact card explicitly
            checks hasActiveSubscription so it keeps hiding in that case,
            never showing "nullh left of nullh". */}
        {app.attendanceSummary?.hasActiveSubscription && (
          <View style={acStyles.hoursRow}>
            <SBI name="clock" size={14} stroke={2} color="#1FB871" />
            <Text style={acStyles.hoursText}>
              {app.attendanceSummary.remainingHours}h left of {app.attendanceSummary.monthlyHours}h · {app.attendanceSummary.billingMonth}
            </Text>
          </View>
        )}

        <View style={acStyles.instructorRow}>
          <View style={acStyles.slot}>
            <View style={acStyles.slotAvatar}>
              <Text style={acStyles.slotInitials}>{assessorInitials}</Text>
            </View>
            <View>
              <Text style={acStyles.slotLabel}>{assessorLabel}</Text>
              <Text style={acStyles.slotName} numberOfLines={1}>{assessorName}</Text>
            </View>
          </View>
          <View>
            <Text style={acStyles.slotLabel}>Branch</Text>
            <Text style={acStyles.slotName}>Main Branch</Text>
          </View>
        </View>

        <View style={acStyles.payStatus}>
          <View style={acStyles.payIconWrap}>
            <Text style={acStyles.payIconText}>✓</Text>
          </View>
          <Text style={acStyles.payStatusText}>Free</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={acStyles.actionsScroll}>
          <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={acStyles.actionBtn}>
            <SBI name="eye" size={14} stroke={2.4} color="#B6BDC6" />
            <Text style={acStyles.actionBtnText}>View Details</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  );
}

const acStyles = StyleSheet.create({
  card: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(0,182,215,0.30)", marginBottom: 12 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "rgba(0,182,215,0.18)" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  typeBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12, backgroundColor: "rgba(0,182,215,0.22)" },
  typeText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10, letterSpacing: 0.7, textTransform: "uppercase", color: "#00B6D7" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontFamily: "Archivo_700Bold", fontSize: 11 },
  className: { fontFamily: "Archivo_800ExtraBold", fontSize: 17, color: "#FFFFFF", marginBottom: 6 },
  metaRow: { flexDirection: "row", gap: 16 },
  slot: { flexDirection: "row", alignItems: "center", gap: 7 },
  slotAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  slotInitials: { fontFamily: "Archivo_700Bold", fontSize: 10, color: "#FFFFFF" },
  slotLabel: { fontFamily: "SpaceMono_700Bold", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#6B747F" },
  slotName: { fontFamily: "Archivo_700Bold", fontSize: 13.5, color: "#FFFFFF" },
  levelBlock: { justifyContent: "center" },
  levelLabel: { fontFamily: "SpaceMono_700Bold", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#6B747F" },
  levelValue: { fontFamily: "Archivo_700Bold", fontSize: 13.5, color: "#8E97A2" },
  body: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#15171B" },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#8E97A2" },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  hoursText: { fontFamily: "Archivo_600SemiBold", fontSize: 12.5, color: "#1FB871" },
  instructorRow: { flexDirection: "row", gap: 18, marginBottom: 12 },
  payStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  payIconWrap: { width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center" },
  payIconText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10, color: "#FFFFFF" },
  payStatusText: { fontFamily: "Archivo_700Bold", fontSize: 11.5, color: "#1FB871" },
  actionsScroll: { flexDirection: "row", gap: 8, marginTop: 12, paddingBottom: 2 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8, minHeight: 40, backgroundColor: "rgba(255,255,255,0.07)" },
  actionBtnText: { fontFamily: "Archivo_700Bold", fontSize: 12.5, color: "#B6BDC6" }
});

// ─── BookingDetailOverlay ───────────────────────────────────────────────────
function BookingDetailOverlay({
  item,
  onClose,
  topPad,
  onCancel,
}: {
  item: ListItem;
  onClose: () => void;
  topPad: number;
  /** Reuses the SAME cancellation operation BookingCard's Cancel action
   *  calls (PATCH /api/bookings/:id/cancel via cancelBooking) — this is
   *  the same capability shown from a second surface, not a second
   *  implementation. Undefined for a Ballet item because Ballet
   *  cancellation is handled only by the studio system. */
  onCancel?: () => void;
}) {
  const isBallet = item.kind === "ballet";
  const b = item.data as any;

  // A4: for an active, grouped ballet student, replace the assessment
  // placeholders with the real class schedule/instructor resolved by the
  // backend. Every other status keeps the original placeholder rendering.
  const balletActive = isBallet ? getBalletActiveDisplay(item.data as BalletApplication) : null;
  const balletIsClass = !!balletActive?.isActiveGrouped;

  const tc = { label: isBallet ? (balletIsClass ? "Class" : "Assessment") : (b.danceType || "Class"), color: "#00B6D7", rgb: isBallet ? "167,139,250" : "45,205,236" };
  const title = isBallet ? (balletIsClass ? "Ballet Class" : "Ballet Assessment") : b.className;
  const ref = isBallet ? b.id : b.bookingNumber;
  const statusLabel = isBallet ? getBalletStatusInfo(b.status).label : b.bookingStatus;
  const statusColor = isBallet ? getBalletStatusInfo(b.status).color : "#1FB871";

  const dayDate = isBallet
    ? (balletIsClass && balletActive?.hasSchedule ? balletActive.daysLabel : (b.assessmentDate || "Pending"))
    : (b.date ? b.date : "TBD");
  const time = isBallet
    ? (balletIsClass && balletActive?.hasSchedule ? balletActive.timesLabel : "TBD")
    : (b.time ? `${b.time} (${b.duration})` : b.duration);
  const branch = isBallet ? (balletActive?.locationLabel || "—") : b.location;

  const studentName = isBallet ? b.childName : b.participantName;
  const instName = isBallet
    ? (balletIsClass && balletActive?.hasInstructor ? balletActive.instructorLabel : "Assigned Instructor")
    : b.instructorName;

  // F-08: an unrecognized backend status ("unknown", e.g. attendance_reversed)
  // is treated as non-actionable/past — never as an active upcoming booking —
  // so it can never surface a live Cancel action. See utils/bookingStatus.ts.
  const isPast = isBallet ? (b.status === "rejected" || b.status === "cancelled") : (b.bookingStatus === "attended" || b.bookingStatus === "completed" || b.bookingStatus === "noShow" || b.bookingStatus === "unknown");
  const isCancelled = isBallet ? (b.status === "cancelled") : (b.bookingStatus === "cancelled" || b.bookingStatus === "rejected");
  // Mirrors BookingCard's isUpcomingActive + Wave 3 2-hour cutoff gate
  // exactly, so a booking is never cancellable from one surface and not
  // the other, and never past the same self-cancellation cutoff.
  const canCancel = !isBallet && !isPast && !isCancelled && !b.sourceUnavailable
    && isBookingSelfCancellableClientSide({ occurrenceDate: b.occurrenceDate ?? null, startTime: b.scheduleStartTime ?? null });
  const timeline = !isPast && !isCancelled
    ? [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Payment Confirmed", done: b.paymentStatus === "paid" || b.paymentStatus === "not_required", date: b.paymentStatus === "paid" ? new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") : "—" },
        { label: "Class Date", done: false, date: dayDate }
      ]
    : isPast
    ? [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Payment Confirmed", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: isBallet ? "Assessment Completed" : "Attended", done: true, date: dayDate }
      ]
    : [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Cancelled", done: true, date: dayDate }
      ];

  return (
    <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0A0B0D", zIndex: 100 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <LinearGradient
          colors={[`rgba(${tc.rgb},0.18)`, "rgba(10,11,13,0)"]}
          style={{ paddingTop: topPad + 10, paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" }}
        >
          <CentralBackButton onPress={onClose} style={{ marginBottom: 16 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <View style={{ backgroundColor: `rgba(${tc.rgb},0.16)`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
              <Text style={{ fontFamily: "Archivo_800ExtraBold", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: tc.color }}>{tc.label}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 11, color: statusColor }}>{statusLabel}</Text>
            </View>
          </View>

          <Text style={[{ fontFamily: "Anton_400Regular", fontSize: 36, lineHeight: 36, textTransform: "uppercase", color: "#FFFFFF", marginBottom: 6 }, iosDisplayTextStyle(36, 36)]}>{title}</Text>
          <Text style={{ fontFamily: "SpaceMono_400Regular", fontSize: 12.5, color: "#4C545E" }}>Booking #{ref}</Text>
        </LinearGradient>

        <View style={{ padding: 20 }}>
          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>Schedule</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <SBI name="cal" size={14} stroke={2} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Day & Date</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{dayDate}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <SBI name="clock" size={14} stroke={2} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Time</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{time}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <SBI name="pin" size={14} stroke={2} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Branch</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{branch}</Text>
            </View>
          </View>

          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>People</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, marginBottom: 20, flexDirection: "row", gap: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person" size={16} color="#6B747F" />
              </View>
              <View>
                <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 9, color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.6 }}>Student</Text>
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>{studentName}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person" size={16} color="#6B747F" />
              </View>
              <View>
                <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 9, color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.6 }}>Instructor</Text>
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>{instName}</Text>
              </View>
            </View>
          </View>

          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>Booking Timeline</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, paddingBottom: 0, marginBottom: 20 }}>
            {timeline.map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingBottom: 14 }}>
                <View style={{ alignItems: "center", width: 20 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: step.done ? "#00B6D7" : "rgba(255,255,255,0.07)", borderWidth: step.done ? 0 : 1.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
                    {step.done && <SBI name="check" size={12} stroke={3} color="#0A0B0D" />}
                  </View>
                  {i < timeline.length - 1 && <View style={{ width: 1, height: 22, backgroundColor: step.done ? "rgba(0,182,215,0.35)" : "rgba(255,255,255,0.08)", marginVertical: 4 }} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14.5, color: step.done ? "#FFFFFF" : "#6B747F" }}>{step.label}</Text>
                  <Text style={{ fontFamily: "Archivo_400Regular", fontSize: 12, color: "#4C545E", marginTop: 2 }}>{step.date}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <LinearGradient
        colors={["rgba(10,11,13,0)", "#0A0B0D"]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, height: 80, flexDirection: "row", gap: 10, justifyContent: "space-evenly" }}
      >
        {canCancel ? (
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.85}
            style={{ flex: 1, height: 48, backgroundColor: "rgba(255,59,71,0.10)", borderWidth: 1, borderColor: "rgba(255,59,71,0.30)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}
          >
            <SBI name="cancel" size={16} stroke={2.2} color="#FF3B47" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FF3B47" }}>Cancel Booking</Text>
          </TouchableOpacity>
        ) : null}
        {(isPast || b.paymentStatus === "paid") && (
          <View style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, opacity: 0.6 }}>
            <SBI name="download" size={16} stroke={2.2} color="#6B747F" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" }}>Receipt (Soon)</Text>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function BookingsScreen() {
  const { user, bookings: localBookings, refreshUserPackages, refreshBookings, children: childProfiles, cancelBooking } = useAppContext();
  const { data: bookingClasses, refetch: refetchBookingClasses } = useListClasses();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const [studentFilter, setStudentFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const bookingNavigationLockedRef = React.useRef(false);
  const classPhotoById = useMemo(() => {
    const photos = new Map<string, string>();
    (bookingClasses ?? []).forEach((danceClass) => {
      const normalized = normalizeMediaUrl(danceClass.photoUrl, "image");
      if (normalized) photos.set(String(danceClass.id), normalized);
    });
    return photos;
  }, [bookingClasses]);

  // Single shared cancel operation for a general (non-Ballet) booking —
  // used identically from the list card and from the detail overlay, so
  // the same booking is never cancellable from one surface and not the
  // other (F-09). Calls the same cancelBooking() the card always did;
  // no new backend contract, no new confirmation UX.
  const confirmCancelBooking = useCallback((booking: Booking) => {
    alert.show({
      tone: "destructive",
      title: "Cancel booking?",
      message: `Cancel your booking for ${booking.className}? This frees up your seat.`,
      actions: [
        { label: "Keep booking", tone: "neutral" },
        {
          label: "Cancel booking",
          tone: "danger",
          onPress: async () => {
            try {
              await cancelBooking(booking.id);
            } catch (e) {
              alert.show({
                tone: "error",
                title: "Couldn't cancel",
                message: presentUserFacingError(e, "We couldn’t cancel this booking. Please try again."),
              });
            }
          },
        },
      ],
    });
  }, [alert, cancelBooking]);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      await Promise.all([refetchBookingClasses(), refreshUserPackages?.(), refreshBookings?.()]);
    } finally {
      setRefreshing(false);
    }
  }, [user, refetchBookingClasses, refreshUserPackages, refreshBookings]);

  // Backend is the source of truth for booking status — re-sync every time the
  // Schedule comes into focus so admin changes (confirm / reject / cancel /
  // attended) and check-ins are reflected without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      bookingNavigationLockedRef.current = false;
      if (user) refreshBookings?.();
      return () => {
        bookingNavigationLockedRef.current = true;
      };
    }, [user, refreshBookings]),
  );

  const openBookingDetails = useCallback((bookingId: Booking["id"]) => {
    if (bookingNavigationLockedRef.current) return;
    bookingNavigationLockedRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pushOnce({ pathname: "/booking/[id]", params: { id: String(bookingId) } });
  }, []);

  const mergedBookings = useMemo(() => {
    return localBookings.map((b) => {
      let isPast = false;
      const occurrenceStart = bookingOccurrenceStartMs({
        occurrenceDate: b.occurrenceDate ?? b.date,
        startTime: b.scheduleStartTime,
      });
      if (occurrenceStart != null) {
        isPast = occurrenceStart < Date.now();
      } else if (b.date) {
        const bd = new Date(b.date);
        bd.setHours(23, 59, 59, 999);
        isPast = bd.getTime() < Date.now();
      }
      // F-08: an unrecognized backend status ("unknown", e.g.
      // attendance_reversed) is forced into Past — never left to fall into
      // Upcoming by date alone — so it never renders as an active,
      // cancellable booking. See utils/bookingStatus.ts.
      if (b.bookingStatus === "attended" || b.bookingStatus === "noShow" || b.bookingStatus === "completed" || b.bookingStatus === "unknown") {
        isPast = true;
      }
      return { ...b, _isPast: isPast };
    });
  }, [localBookings]);

  const visibleGeneralBookings = useMemo(
    () => mergedBookings.filter((booking) => isVisibleUpcomingMyBooking(booking)),
    [mergedBookings],
  );


  // Student selector, grouped in a stable order:
  //   1) "All Students" (default overview filter, first)
  //   2) Owner account
  //   3) Children (saved order)
  //   4) Any other participants (alphabetical)
  // Only names with activity show.
  const students = useMemo(() => {
    const names = new Set<string>();
    visibleGeneralBookings.forEach(b => b.participantName && names.add(b.participantName));

    const ordered: string[] = [];
    // 2) Owner account
    const ownerName = user?.fullName;
    if (ownerName && names.has(ownerName)) { ordered.push(ownerName); names.delete(ownerName); }
    // 3) Children, in their saved order
    for (const c of childProfiles) {
      if (c.fullName && names.has(c.fullName)) { ordered.push(c.fullName); names.delete(c.fullName); }
    }
    // 4) Any remaining participant names, alphabetical
    for (const n of Array.from(names).sort((a, b) => a.localeCompare(b))) ordered.push(n);
    // 1) "All Students" stays first (default overview)
    return [
      { key: "All", name: "All Students", image: undefined },
      ...ordered.map((name) => ({
        key: name,
        name,
        image: name === user?.fullName || visibleGeneralBookings.some((booking) => booking.participantType === "self" && booking.participantName === name)
          ? user?.avatarUrl
          : undefined,
      })),
    ];
  }, [visibleGeneralBookings, user, childProfiles]);

  function filterUpcomingItems(): ListItem[] {
    let allItems: ListItem[] = visibleGeneralBookings
      .map((b) => ({ kind: "booking", data: b, timestamp: new Date(b.date || 0).getTime() }));

    if (studentFilter !== "All") {
      allItems = allItems.filter((i) => {
        if (i.kind === "booking") return i.data.participantName === studentFilter;
        return false;
      });
    }

    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      allItems = allItems.filter((i) => {
        if (i.kind === "booking") {
          return [i.data.className, i.data.danceType, i.data.bookingNumber, i.data.instructorName, i.data.participantName].some(s => s?.toLowerCase().includes(q));
        }
        return false;
      });
    }

    return allItems;
  }

  const filtered = filterUpcomingItems();

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.headerSimple}>
          <Text style={styles.simpleTitle}>My Bookings</Text>
        </View>
        <EmptyState
          icon="calendar-outline"
          title="Sign in to view bookings"
          description="Log in to track your classes and booking history"
          actionLabel="Sign In"
          onAction={() => pushOnce("/auth/login")}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Exact design background glows (full-bleed radials):
          amber  → radial-gradient(85% 120% at 10% -8%,  rgba(255,176,46,0.16) 0%, transparent 50%)
          magenta→ radial-gradient(65% 75%  at 100% 90%, rgba(255,46,126,0.12) 0%, transparent 55%) */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="schedGlowAmber" cx="10%" cy="-8%" rx="85%" ry="120%">
            <Stop offset="0%" stopColor="#FFB02E" stopOpacity={0.16} />
            <Stop offset="50%" stopColor="#FFB02E" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="schedGlowMagenta" cx="100%" cy="90%" rx="65%" ry="75%">
            <Stop offset="0%" stopColor="#FF2E7E" stopOpacity={0.12} />
            <Stop offset="55%" stopColor="#FF2E7E" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#schedGlowAmber)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#schedGlowMagenta)" />
      </Svg>

      <FlatList
        data={filtered}
        keyExtractor={(i) => (i.kind === "ballet" ? `ballet-${i.data.id}` : `booking-${i.data.id}`)}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00B6D7" />}
        ListHeaderComponent={
          <View style={{ paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 20, zIndex: 1 }}>
            {/* Hero Section */}
            <View style={styles.heroRow}>
              <Text style={styles.heroEyebrow}>My Account</Text>
              <Text style={styles.heroTitle}>MY{"\n"}BOOKINGS</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchWrap}>
              <View style={styles.searchIcon}><SBI name="search" size={17} stroke={2.2} color="#6B747F" /></View>
              <TextInput
                style={styles.searchInput}
                placeholder="Search Classes, Instructors, Styles..."
                placeholderTextColor="#6B747F"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.clearSearch}>
                  <SBI name="x" size={13} stroke={2.4} color="#FFFFFF" />
                </TouchableOpacity>
              )}
            </View>

            {/* Student Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {students.map((st) => {
                const isActive = studentFilter === st.key;
                return (
                  <TouchableOpacity
                    key={st.key}
                    style={[styles.filterChip, st.key === "All" && styles.filterChipAll, isActive && styles.filterChipActive]}
                    onPress={() => setStudentFilter(st.key)}
                  >
                    {st.key !== "All" && (
                      <View style={styles.filterAvatar}>
                        {st.image ? (
                          <Image source={{ uri: st.image }} style={styles.filterAvatarImage} />
                        ) : (
                          <Text style={styles.filterAvatarText}>{st.name.trim().charAt(0).toUpperCase()}</Text>
                        )}
                      </View>
                    )}
                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                      {st.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

          </View>
        }
        renderItem={({ item }) =>
          item.kind === "ballet" ? (
            <AssessmentCard app={item.data} />
          ) : (
            <BookingCard
              item={item.data}
              onPress={() => openBookingDetails(item.data.id)}
              classPhotoUrl={item.data.classPhotoUrl ?? classPhotoById.get(item.data.classId)}
            />
          )
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={styles.emptyWrap}>
              <View accessible accessibilityRole="image" accessibilityLabel="No upcoming bookings" style={styles.emptyAnimation}>
                <LottieView source={EMPTY_BOOKINGS_ANIMATION} autoPlay loop style={StyleSheet.absoluteFill} />
              </View>
              <Text style={styles.emptyTitle}>No upcoming bookings</Text>
              <Text style={styles.emptySub}>Your next dance adventure is waiting for you.</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => pushOnce("/(tabs)/classes")}>
                <Text style={styles.emptyBtnText}>Book a Class</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ListSkeleton count={4} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  headerSimple: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  simpleTitle: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  list: { paddingHorizontal: 17 },
  heroRow: { alignItems: "flex-start", marginBottom: 12 },
  heroEyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 6 },
  // marginBottom cancels the iOS cap-guard inset from the block footprint.
  heroTitle: { fontFamily: "Anton_400Regular", fontSize: 52, lineHeight: 46, ...iosDisplayTextStyle(52, 46), marginBottom: -iosCapGuard(52, 46), textTransform: "uppercase", color: "#FFFFFF" },
  searchWrap: { position: "relative", flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)", borderRadius: 24, marginBottom: 14 },
  searchIcon: { position: "absolute", left: 14 },
  // paddingTop/Bottom come AFTER the input-style spread so they override its
  // paddingTop:0/paddingBottom:0 on iOS and keep the field's original height.
  searchInput: { flex: 1, paddingLeft: 42, paddingRight: 42, fontSize: 14.5, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(14.5, 18), paddingTop: 12, paddingBottom: 12 },
  clearSearch: { position: "absolute", right: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  filterScroll: { gap: 8, paddingBottom: 18 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 13, paddingLeft: 7, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", marginRight: 8 },
  // "All Students" has no avatar → symmetric padding + centered text.
  filterChipAll: { paddingLeft: 16, paddingRight: 16, justifyContent: "center" },
  filterChipActive: { backgroundColor: "#0A0B0D", borderColor: "rgba(0,182,215,0.5)" },
  filterAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  filterAvatarImage: { width: "100%", height: "100%" },
  filterAvatarText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10, color: "#FFFFFF" },
  filterChipText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" },
  filterChipTextActive: { color: "#FFFFFF" },
  emptyWrap: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 30 },
  emptyAnimation: { width: 140, height: 140, marginBottom: 8 },
  emptyTitle: { fontFamily: "Archivo_800ExtraBold", fontSize: 21, color: "#FFFFFF", marginBottom: 8, textAlign: "center" },
  emptySub: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "#8E97A2", textAlign: "center", maxWidth: 230, lineHeight: 21, marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, backgroundColor: "#00B6D7" },
  emptyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" }
});
