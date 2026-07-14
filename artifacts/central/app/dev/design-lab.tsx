/**
 * 🔬 Mobile Design Lab — /dev/design-lab
 *
 * DEV-ONLY screen for previewing all mobile UI components.
 * Not linked from any tab or navigation — navigate directly via
 * Expo Go or dev build by typing the route.
 *
 * To open: in your JS console or a quick Link somewhere during dev,
 * do: router.push("/dev/design-lab")
 *
 * Components shown:
 *  - BalletCard in all 9 states
 *  - BookingCard (confirmed, pending, cancelled variants)
 *  - ClassCard (available, fewSeats, full)
 *  - Profile header
 *  - Status badges
 *  - Date / time picker fields
 *  - AppButton variants
 */

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  TextInput,
} from "react-native";

import BookingCard from "@/components/BookingCard";
import ClassCard from "@/components/ClassCard";
import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { Booking } from "@/contexts/AppContext";
import { type DanceClass, type Instructor } from "@/data/mockData";

// ─── Constants ────────────────────────────────────────────────────────────────

const BALLET_COLOR = "#00B6D6";

const DETAIL_MODE_STATUSES = new Set([
  "submitted", "pendingAssessment", "needsFollowUp",
  "accepted", "assignedToLevel", "activeBallet",
]);

const STATUS_BADGE_LABELS: Record<string, string> = {
  submitted: "UNDER REVIEW",
  pendingAssessment: "SCHEDULED",
  needsFollowUp: "FOLLOW-UP",
  accepted: "ACCEPTED",
  assignedToLevel: "LEVEL ASSIGNED",
  activeBallet: "ACTIVE",
  rejected: "NOT ACCEPTED",
  cancelled: "CANCELLED",
};

const BALLET_PILLS = [
  "Professional Instructors",
  "Level Assessment",
  "Performance Opportunities",
] as const;

// ─── Sample data ──────────────────────────────────────────────────────────────

const SAMPLE_INSTRUCTOR: Instructor = {
  id: "i1",
  name: "Lara Mansour",
  title: "Senior Ballet Instructor",
  bio: "",
  danceStyles: ["Ballet"],
  rating: 4.9,
  totalClasses: 120,
  photoColor: "#EC4899",
  initials: "LM",
};

const makeClass = (
  status: DanceClass["status"],
  title: string,
  category: string,
): DanceClass => ({
  id: `c-${status}`,
  categoryId: "ballet",
  categoryName: category,
  instructorId: "i1",
  title,
  description: "A structured program covering technique, expression, and musicality.",
  date: "2025-03-10",
  dayOfWeek: "Monday",
  startTime: "10:00 AM",
  endTime: "11:00 AM",
  duration: "60 min",
  location: "Studio A",
  room: "Room 1",
  price: 350,
  capacity: 12,
  bookedCount: status === "full" ? 12 : status === "fewSeats" ? 10 : 4,
  level: "Beginner",
  ageGroup: "Kids",
  status,
  policy: "24h cancellation",
  featured: false,
});

const makeBooking = (
  bookingStatus: Booking["bookingStatus"],
  paymentStatus: Booking["paymentStatus"],
): Booking => ({
  id: `b-${bookingStatus}`,
  classId: "c1",
  bookingNumber: `BK-00${Math.abs(bookingStatus.length * 37)}`,
  className: "Ballet Foundations",
  danceType: "Ballet",
  instructorName: "Lara Mansour",
  date: "Mon, 10 Mar 2025",
  time: "10:00 – 11:00 AM",
  duration: "60 min",
  location: "Central Studio — Room A",
  price: 350,
  participantType: "child",
  participantName: "Layla Ahmed",
  paymentMethod: "cash",
  bookingStatus,
  paymentStatus,
  bookingType: "single",
  attendanceStatus: "booked",
  createdAt: new Date().toISOString(),
});

// ─── Component: Ballet Card ───────────────────────────────────────────────────

function BalletCardPreview({ status }: { status: string | null }) {
  const isDetailMode = status !== null && DETAIL_MODE_STATUSES.has(status);
  const ctaLabel = isDetailMode ? "View Details" : "Apply for\nAssessment";

  return (
    <TouchableOpacity activeOpacity={0.88} style={styles.balletCardWrap}>
      <ImageBackground
        source={require("@/assets/images/studio_hero.png")}
        style={styles.balletCard}
        imageStyle={styles.balletCardImage}
      >
        <View style={styles.balletOverlay} />
        {status && (
          <View style={styles.balletStatusBadge}>
            <Text style={styles.balletStatusBadgeText}>
              {STATUS_BADGE_LABELS[status] ?? status.toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.balletCardContent}>
          <View style={styles.balletCardLeft}>
            <View style={styles.balletIconCircle}>
              <Ionicons name="musical-notes" size={20} color="#FFFFFF" />
            </View>
            <Text style={styles.balletTitle}>Ballet Program</Text>
            <Text style={styles.balletSubtitle}>
              Classical Ballet Program{"\n"}For ages 4–12 years
            </Text>
            <View style={styles.balletPills}>
              {BALLET_PILLS.map((pill) => (
                <View key={pill} style={styles.balletPill}>
                  <Text style={styles.balletPillText}>{pill}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.balletCtaWrap}>
            <View style={styles.balletCtaBtn}>
              <Text style={styles.balletCtaBtnText}>{ctaLabel}</Text>
            </View>
          </View>
        </View>
      </ImageBackground>
    </TouchableOpacity>
  );
}

// ─── Component: Section header ────────────────────────────────────────────────

function SectionHeader({ title, file }: { title: string; file?: string }) {
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.line} />
      <View style={sectionStyles.labelWrap}>
        <Text style={sectionStyles.label}>{title}</Text>
        {file && <Text style={sectionStyles.file}>{file}</Text>}
      </View>
      <View style={sectionStyles.line} />
    </View>
  );
}

// ─── Component: Status badge (mobile style) ───────────────────────────────────

type BadgeStatus =
  | "submitted" | "pendingAssessment" | "needsFollowUp"
  | "accepted" | "assignedToLevel" | "activeBallet"
  | "rejected" | "cancelled";

const BADGE_CONFIGS: Record<BadgeStatus, { label: string; color: string }> = {
  submitted:          { label: "Under Review",          color: "#F59E0B" },
  pendingAssessment:  { label: "Assessment Scheduled",  color: "#60A5FA" },
  needsFollowUp:      { label: "Follow-up Required",    color: "#F59E0B" },
  accepted:           { label: "Accepted",              color: "#22C55E" },
  assignedToLevel:    { label: "Level Assigned",        color: BALLET_COLOR },
  activeBallet:       { label: "Active Student",        color: BALLET_COLOR },
  rejected:           { label: "Not Accepted",          color: "#EF4444" },
  cancelled:          { label: "Cancelled",             color: "#6B7280" },
};

function StatusBadgeRow() {
  return (
    <View style={{ gap: 8 }}>
      {(Object.entries(BADGE_CONFIGS) as [BadgeStatus, { label: string; color: string }][]).map(
        ([key, { label, color }]) => (
          <View
            key={key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: color + "18",
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: color + "40",
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <Text style={{ color, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
            <Text style={{ color: "#6B7280", fontSize: 11, marginLeft: "auto", fontFamily: "Inter_400Regular" }}>
              {key}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

// ─── Component: Date / time picker fields ────────────────────────────────────

function DateTimeFields() {
  const [dateVal, setDateVal] = useState("2025-03-10");
  const [hour, setHour] = useState("10");
  const [minute, setMinute] = useState("00");
  const [ampm, setAmpm] = useState<"AM" | "PM">("AM");

  return (
    <View style={{ gap: 12 }}>
      {/* Date field */}
      <View style={fieldStyles.group}>
        <Text style={fieldStyles.label}>Date</Text>
        <TextInput
          style={fieldStyles.input}
          value={dateVal}
          onChangeText={setDateVal}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#6B7280"
          keyboardType="numeric"
        />
      </View>

      {/* Time segmented */}
      <View style={fieldStyles.group}>
        <Text style={fieldStyles.label}>Start Time</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {/* Hour */}
          <View style={{ flex: 1 }}>
            <Text style={fieldStyles.sublabel}>Hour</Text>
            <View style={fieldStyles.segPicker}>
              <TouchableOpacity
                onPress={() => {
                  const h = parseInt(hour);
                  setHour(String(h <= 1 ? 12 : h - 1));
                }}
                style={fieldStyles.segBtn}
              >
                <Ionicons name="chevron-back" size={14} color="#9CA3AF" />
              </TouchableOpacity>
              <Text style={fieldStyles.segVal}>{hour}</Text>
              <TouchableOpacity
                onPress={() => {
                  const h = parseInt(hour);
                  setHour(String(h >= 12 ? 1 : h + 1));
                }}
                style={fieldStyles.segBtn}
              >
                <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Minute */}
          <View style={{ flex: 1 }}>
            <Text style={fieldStyles.sublabel}>Minute</Text>
            <View style={fieldStyles.segPicker}>
              <TouchableOpacity
                onPress={() => {
                  const opts = ["00", "15", "30", "45"];
                  const idx = opts.indexOf(minute);
                  setMinute(opts[(idx - 1 + opts.length) % opts.length]);
                }}
                style={fieldStyles.segBtn}
              >
                <Ionicons name="chevron-back" size={14} color="#9CA3AF" />
              </TouchableOpacity>
              <Text style={fieldStyles.segVal}>{minute}</Text>
              <TouchableOpacity
                onPress={() => {
                  const opts = ["00", "15", "30", "45"];
                  const idx = opts.indexOf(minute);
                  setMinute(opts[(idx + 1) % opts.length]);
                }}
                style={fieldStyles.segBtn}
              >
                <Ionicons name="chevron-forward" size={14} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </View>

          {/* AM/PM */}
          <View style={{ flex: 1 }}>
            <Text style={fieldStyles.sublabel}>AM/PM</Text>
            <TouchableOpacity
              onPress={() => setAmpm((p) => (p === "AM" ? "PM" : "AM"))}
              style={[fieldStyles.segPicker, { justifyContent: "center" }]}
            >
              <Text style={[fieldStyles.segVal, { color: BALLET_COLOR }]}>{ampm}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={{ color: "#6B7280", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 }}>
          Result: {hour}:{minute} {ampm}
        </Text>
      </View>
    </View>
  );
}

// ─── Component: Profile header ────────────────────────────────────────────────

function ProfileHeaderPreview() {
  return (
    <View style={profileStyles.wrap}>
      <View style={profileStyles.avatar}>
        <Text style={profileStyles.avatarText}>SA</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={profileStyles.name}>Sara Ahmed</Text>
        <Text style={profileStyles.phone}>+20 100 123 4567</Text>
        <View style={profileStyles.badgeRow}>
          <View style={profileStyles.badge}>
            <Ionicons name="star" size={10} color={BALLET_COLOR} />
            <Text style={[profileStyles.badgeText, { color: BALLET_COLOR }]}>Active Ballet</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={profileStyles.editBtn}>
        <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );
}

// ─── AppButton variants ───────────────────────────────────────────────────────

function AppButtonSection() {
  return (
    <View style={{ gap: 12 }}>
      <AppButton title="Primary (default)" onPress={() => {}} />
      <AppButton title="Ghost / outline variant" onPress={() => {}} variant="ghost" />
      <AppButton title="Loading state" onPress={() => {}} loading />
      <AppButton title="Disabled" onPress={() => {}} disabled />
      <AppButton title="Stage / Ballet teal" onPress={() => {}} variant="stage" />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const BALLET_STATES: Array<{ label: string; status: string | null }> = [
  { label: "Apply Mode (no application)", status: null },
  { label: "Under Review (submitted)", status: "submitted" },
  { label: "Assessment Scheduled (pendingAssessment)", status: "pendingAssessment" },
  { label: "Needs Follow-up (needsFollowUp)", status: "needsFollowUp" },
  { label: "Accepted", status: "accepted" },
  { label: "Level Assigned (assignedToLevel)", status: "assignedToLevel" },
  { label: "Active Student (activeBallet)", status: "activeBallet" },
  { label: "Not Accepted (rejected)", status: "rejected" },
  { label: "Cancelled", status: "cancelled" },
];

export default function DesignLabScreen() {
  const { top } = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: colors.studio.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#9CA3AF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>🔬 Design Lab</Text>
          <Text style={styles.headerSub}>Mobile component preview · DEV ONLY</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Ballet Card States ─────────────────────────────────────────── */}
        <SectionHeader
          title="BALLET CARD — ALL 9 STATES"
          file="app/(tabs)/classes.tsx"
        />
        {BALLET_STATES.map(({ label, status }) => (
          <View key={label ?? "apply"} style={styles.stateBlock}>
            <Text style={styles.stateLabel}>{label}</Text>
            <BalletCardPreview status={status} />
          </View>
        ))}

        {/* ── Booking Cards ──────────────────────────────────────────────── */}
        <SectionHeader
          title="BOOKING CARD"
          file="components/BookingCard.tsx"
        />
        <BookingCard item={makeBooking("confirmed", "paid")} />
        <BookingCard item={makeBooking("pending", "pending_payment")} />
        <BookingCard item={makeBooking("attended", "paid")} />
        <BookingCard item={makeBooking("cancelled", "refunded")} />
        <BookingCard item={makeBooking("noShow", "paid")} />

        {/* ── Class Cards ────────────────────────────────────────────────── */}
        <SectionHeader
          title="CLASS CARD"
          file="components/ClassCard.tsx"
        />
        <ClassCard
          item={makeClass("available", "Ballet Foundations", "Ballet")}
          instructor={SAMPLE_INSTRUCTOR}
        />
        <ClassCard
          item={makeClass("fewSeats", "Intermediate Ballet", "Ballet")}
          instructor={SAMPLE_INSTRUCTOR}
        />
        <ClassCard
          item={makeClass("full", "Hip Hop Basics", "Hip Hop")}
        />
        <ClassCard
          item={makeClass("waitingList", "Adult Contemporary", "Contemporary")}
          compact
        />

        {/* ── Profile Header ─────────────────────────────────────────────── */}
        <SectionHeader
          title="PROFILE HEADER"
          file="app/(tabs)/profile.tsx"
        />
        <View style={[styles.card]}>
          <ProfileHeaderPreview />
        </View>

        {/* ── Status Badges ──────────────────────────────────────────────── */}
        <SectionHeader
          title="STATUS BADGES"
          file="app/(tabs)/bookings.tsx → getBalletStatusInfo"
        />
        <View style={styles.card}>
          <StatusBadgeRow />
        </View>

        {/* ── Date / Time Fields ─────────────────────────────────────────── */}
        <SectionHeader
          title="DATE & TIME FIELDS"
          file="admin/BalletSchedulesPage.tsx"
        />
        <View style={styles.card}>
          <DateTimeFields />
        </View>

        {/* ── AppButton ──────────────────────────────────────────────────── */}
        <SectionHeader
          title="APP BUTTON"
          file="components/AppButton.tsx"
        />
        <View style={styles.card}>
          <AppButtonSection />
        </View>

        {/* ── Typography ─────────────────────────────────────────────────── */}
        <SectionHeader title="TYPOGRAPHY" />
        <View style={styles.card}>
          {([
            { size: 24, weight: "Inter_700Bold", label: "Heading H1" },
            { size: 20, weight: "Inter_700Bold", label: "Heading H2" },
            { size: 16, weight: "Inter_600SemiBold", label: "Title" },
            { size: 14, weight: "Inter_500Medium", label: "Body Medium" },
            { size: 13, weight: "Inter_400Regular", label: "Body Regular" },
            { size: 11, weight: "Inter_600SemiBold", label: "Label / Badge" },
            { size: 10, weight: "Inter_500Medium", label: "Caption" },
          ] as const).map(({ size, weight, label }) => (
            <View key={label} style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: size, fontFamily: weight, color: "#FFFFFF", minWidth: 120 }}>
                {label}
              </Text>
              <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280" }}>
                {size}px · {weight.replace("Inter_", "").replace(/([A-Z])/g, " $1").trim()}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Colour palette ─────────────────────────────────────────────── */}
        <SectionHeader title="COLOUR PALETTE" file="constants/colors.ts" />
        <View style={styles.card}>
          {([
            { color: "#00B6D6", label: "BALLET_COLOR / teal" },
            { color: "#00B6D7", label: "colors.studio.primary" },
            { color: "#33C8E0", label: "colors.stage.accent" },
            { color: "#22C55E", label: "colors.success" },
            { color: "#F59E0B", label: "colors.warning" },
            { color: "#EF4444", label: "colors.error" },
            { color: "#3B82F6", label: "colors.info" },
            { color: "#9CA3AF", label: "mutedForeground" },
            { color: "#1E2E38", label: "colors.studio.border" },
            { color: "#0E1619", label: "colors.studio.card" },
          ]).map(({ color, label }) => (
            <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: color, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }} />
              <Text style={{ color: "#FFFFFF", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{color}</Text>
              <Text style={{ color: "#6B7280", fontSize: 11, fontFamily: "Inter_400Regular" }}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Bottom spacer */}
        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.studio.border,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.studio.card,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    marginTop: 1,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  stateBlock: {
    marginBottom: 16,
  },
  stateLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.studio.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.studio.border,
    padding: 14,
    marginBottom: 16,
  },

  // Ballet card
  balletCardWrap: { marginBottom: 0 },
  balletCard: { borderRadius: 18, minHeight: 160, overflow: "hidden" },
  balletCardImage: { borderRadius: 18 },
  balletOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 14, 22, 0.78)",
    borderRadius: 18,
  },
  balletStatusBadge: {
    position: "absolute",
    top: 10,
    right: 12,
    backgroundColor: "rgba(0,182,214,0.18)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(0,182,214,0.4)",
  },
  balletStatusBadgeText: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
    letterSpacing: 0.6,
  },
  balletCardContent: {
    flexDirection: "row",
    padding: 14,
    paddingTop: 16,
    alignItems: "center",
    gap: 10,
  },
  balletCardLeft: { flex: 1, gap: 4 },
  balletIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  balletTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  balletSubtitle: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.65)",
    lineHeight: 16,
  },
  balletPills: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 8 },
  balletPill: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  balletPillText: {
    fontSize: 9,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.8)",
  },
  balletCtaWrap: { alignItems: "center", justifyContent: "center" },
  balletCtaBtn: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
    maxWidth: 96,
  },
  balletCtaBtnText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
    textAlign: "center",
    lineHeight: 15,
  },
});

const sectionStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 24,
    marginBottom: 12,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.studio.border,
  },
  labelWrap: { alignItems: "center", gap: 2 },
  label: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#6B7280",
    letterSpacing: 1.2,
  },
  file: {
    fontSize: 8,
    fontFamily: "Inter_400Regular",
    color: BALLET_COLOR + "99",
  },
});

const fieldStyles = StyleSheet.create({
  group: { gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sublabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#1A2535",
    borderWidth: 1,
    borderColor: colors.studio.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    color: "#FFFFFF",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  segPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1A2535",
    borderWidth: 1,
    borderColor: colors.studio.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  segBtn: {
    padding: 4,
  },
  segVal: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
});

const profileStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BALLET_COLOR + "22",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: BALLET_COLOR + "50",
  },
  avatarText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: BALLET_COLOR,
  },
  name: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  phone: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: BALLET_COLOR + "18",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.studio.card,
    borderWidth: 1,
    borderColor: colors.studio.border,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
});
