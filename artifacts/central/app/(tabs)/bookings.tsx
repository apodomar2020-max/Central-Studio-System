import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Animated,
  Modal,
  TextInput,
  Image
} from "react-native";

import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { useAppContext } from "@/contexts/AppContext";
import { Booking } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import BookingCard from "@/components/BookingCard";
import SBI from "@/components/SbIcon";
import EmptyState from "@/components/EmptyState";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { ListSkeleton } from "@/components/SkeletonLoader";
import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplication,
} from "@/services/balletAssessmentService";
import { isOfflineError } from "@/services/connectivity";

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

const TABS = ["Upcoming", "Past", "Cancelled"] as const;

type ListItem =
  | { kind: "ballet"; data: BalletApplication; timestamp: number }
  | { kind: "booking"; data: Booking; timestamp: number };

// ─── AssessmentCard (matching design) ──────────────────────────────────────────
function AssessmentCard({ app, onPress }: { app: BalletApplication, onPress?: () => void }) {
  const info = getBalletStatusInfo(app.status);
  const dateStr = app.slotLabel || new Date(app.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

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
        <Text style={acStyles.className}>Ballet Level Assessment</Text>

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
            <Text style={acStyles.levelValue}>Pending review</Text>
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

        <View style={acStyles.instructorRow}>
          <View style={acStyles.slot}>
            <View style={acStyles.slotAvatar}>
              <Text style={acStyles.slotInitials}>TBD</Text>
            </View>
            <View>
              <Text style={acStyles.slotLabel}>Assessor</Text>
              <Text style={acStyles.slotName}>TBD</Text>
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
function BookingDetailOverlay({ item, onClose, topPad }: { item: ListItem; onClose: () => void; topPad: number }) {
  const isBallet = item.kind === "ballet";
  const b = item.data as any;

  const tc = { label: isBallet ? "Assessment" : (b.danceType || "Class"), color: "#00B6D7", rgb: isBallet ? "167,139,250" : "45,205,236" };
  const title = isBallet ? "Ballet Assessment" : b.className;
  const ref = isBallet ? b.id : b.bookingNumber;
  const statusLabel = isBallet ? getBalletStatusInfo(b.status).label : b.bookingStatus;
  const statusColor = isBallet ? getBalletStatusInfo(b.status).color : "#1FB871";

  const dayDate = isBallet ? (b.slotLabel || "Pending") : (b.date ? b.date : "TBD");
  const time = isBallet ? "TBD" : (b.time ? `${b.time} (${b.duration})` : b.duration);
  const branch = isBallet ? "Main Branch" : b.location;

  const studentName = isBallet ? b.childName : b.participantName;
  const instName = isBallet ? "Assigned Instructor" : b.instructorName;

  const isPast = isBallet ? (b.status === "rejected" || b.status === "cancelled") : (b.bookingStatus === "attended" || b.bookingStatus === "completed" || b.bookingStatus === "noShow");
  const isCancelled = isBallet ? (b.status === "cancelled") : (b.bookingStatus === "cancelled" || b.bookingStatus === "rejected");
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
          <TouchableOpacity onPress={onClose} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <SBI name="back" size={20} stroke={2.2} color="#8E97A2" />
            <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: "#8E97A2" }}>Back</Text>
          </TouchableOpacity>

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
        {!isPast && !isCancelled && (
          <View style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, opacity: 0.6 }}>
            <SBI name="cancel" size={16} stroke={2.2} color="#6B747F" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" }}>Cancel (Soon)</Text>
          </View>
        )}
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
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Upcoming");
  const [studentFilter, setStudentFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<ListItem | null>(null);

  const [balletApps, setBalletApps] = useState<BalletApplication[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const loadBalletApps = useCallback(async () => {
    if (!user) return;
    try {
      setErrorMsg("");
      setIsOffline(false);
      const apps = await fetchMyApplications();
      setBalletApps(apps);
    } catch (err: any) {
      if (isOfflineError(err)) {
        setIsOffline(true);
      } else {
        setErrorMsg(err.message || "Failed to load assessments");
      }
    }
  }, [user]);

  const onRefresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    await Promise.all([loadBalletApps(), refreshUserPackages?.(), refreshBookings?.()]);
    setRefreshing(false);
  }, [user, loadBalletApps, refreshUserPackages, refreshBookings]);

  useEffect(() => {
    loadBalletApps();
  }, [loadBalletApps]);

  // Backend is the source of truth for booking status — re-sync every time the
  // Schedule comes into focus so admin changes (confirm / reject / cancel /
  // attended) and check-ins are reflected without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (user) refreshBookings?.();
    }, [user, refreshBookings]),
  );

  useEffect(() => {
    if (user && isOffline) {
      // Offline sync logic typically goes here if supported
    }
  }, [user, isOffline]);

  const mergedBookings = useMemo(() => {
    return localBookings.map((b) => {
      let isPast = false;
      if (b.date) {
        const bd = new Date(b.date);
        bd.setHours(23, 59, 59, 999);
        isPast = bd.getTime() < Date.now();
      }
      if (b.bookingStatus === "attended" || b.bookingStatus === "noShow" || b.bookingStatus === "completed") {
        isPast = true;
      }
      return { ...b, _isPast: isPast };
    });
  }, [localBookings]);


  // Student selector, grouped in a stable order:
  //   1) "All Students" (default overview filter, first)
  //   2) Owner account
  //   3) Children (saved order)
  //   4) Any other participants (alphabetical)
  // Only names with activity show.
  const students = useMemo(() => {
    const names = new Set<string>();
    mergedBookings.forEach(b => b.participantName && names.add(b.participantName));
    balletApps.forEach(a => a.childName && names.add(a.childName));

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
    return ["All", ...ordered];
  }, [mergedBookings, balletApps, user, childProfiles]);

  function filterItems(tab: (typeof TABS)[number]): ListItem[] {
    let bookingItems: ListItem[] = [];
    switch (tab) {
      case "Upcoming":
        bookingItems = mergedBookings.filter((b) => !b._isPast && b.bookingStatus !== "cancelled" && b.bookingStatus !== "rejected").map((b) => ({ kind: "booking", data: b, timestamp: new Date(b.date || 0).getTime() }));
        break;
      case "Past":
        bookingItems = mergedBookings.filter((b) => b._isPast && b.bookingStatus !== "cancelled" && b.bookingStatus !== "rejected").map((b) => ({ kind: "booking", data: b, timestamp: new Date(b.date || 0).getTime() }));
        break;
      case "Cancelled":
        bookingItems = mergedBookings.filter((b) => b.bookingStatus === "cancelled" || b.bookingStatus === "rejected").map((b) => ({ kind: "booking", data: b, timestamp: new Date(b.date || 0).getTime() }));
        break;
    }

    let balletItems: ListItem[] = [];
    switch (tab) {
      case "Upcoming":
        balletItems = balletApps.filter((a) => a.status === "Pending" || a.status === "Scheduled" || a.status === "Accepted").map((a) => ({ kind: "ballet", data: a, timestamp: new Date(a.createdAt).getTime() }));
        break;
      case "Past":
        balletItems = balletApps.filter((a) => a.status === "Completed").map((a) => ({ kind: "ballet", data: a, timestamp: new Date(a.createdAt).getTime() }));
        break;
      case "Cancelled":
        balletItems = balletApps.filter((a) => a.status === "Rejected").map((a) => ({ kind: "ballet", data: a, timestamp: new Date(a.createdAt).getTime() }));
        break;
    }

    let allItems = [...balletItems, ...bookingItems];

    if (studentFilter !== "All") {
      allItems = allItems.filter((i) => {
        if (i.kind === "booking") return i.data.participantName === studentFilter;
        if (i.kind === "ballet") return i.data.childName === studentFilter;
        return false;
      });
    }

    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      allItems = allItems.filter((i) => {
        if (i.kind === "booking") {
          return [i.data.className, i.data.danceType, i.data.bookingNumber, i.data.instructorName, i.data.participantName].some(s => s?.toLowerCase().includes(q));
        }
        if (i.kind === "ballet") {
          return [i.data.childName, "Ballet Assessment"].some(s => s?.toLowerCase().includes(q));
        }
        return false;
      });
    }

    return allItems;
  }

  // Build all three tab lists from the SAME filterItems() used for rendering, so
  // each tab's count is exactly the length of the list shown when it's selected
  // (ballet + bookings, with the active student/search filters applied). A
  // booking falls into exactly one of upcoming/past/cancelled, so nothing is
  // double-counted.
  const itemsByTab = {
    Upcoming: filterItems("Upcoming"),
    Past: filterItems("Past"),
    Cancelled: filterItems("Cancelled"),
  } as const;
  const filtered = itemsByTab[activeTab];

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
          onAction={() => router.push("/auth/login")}
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
              <View>
                <Text style={styles.heroEyebrow}>My Account</Text>
                <Text style={styles.heroTitle}>MY{"\n"}BOOKINGS</Text>
              </View>
              <TouchableOpacity style={styles.newBtn} onPress={() => router.push("/(tabs)/classes")}>
                <SBI name="plus" size={16} stroke={2.6} color="#0A0B0D" />
                <Text style={styles.newBtnText}>New</Text>
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchWrap}>
              <View style={styles.searchIcon}><SBI name="search" size={17} stroke={2.2} color="#6B747F" /></View>
              <TextInput
                style={styles.searchInput}
                placeholder="Search bookings, classes, refs…"
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

            {/* Phase Tabs (Segmented Container) */}
            <View style={styles.tabContainer}>
              {TABS.map((tab) => {
                const isActive = activeTab === tab;
                // Count = length of that tab's rendered list (same source array).
                const count = itemsByTab[tab].length;
                return (
                  <TouchableOpacity key={tab} style={[styles.tabBtn, isActive && styles.tabBtnActive]} onPress={() => setActiveTab(tab)}>
                    <Text style={[styles.tabBtnText, isActive && styles.tabBtnTextActive]}>{tab}</Text>
                    <View style={[styles.tabBtnCounter, isActive ? { backgroundColor: "#00B6D7" } : { backgroundColor: "rgba(255,255,255,0.08)" }]}>
                      <Text style={[styles.tabBtnCounterText, isActive ? { color: "#0A0B0D" } : { color: "#6B747F" }]}>{count}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Student Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {students.map((st) => {
                const isActive = studentFilter === st;
                return (
                  <TouchableOpacity
                    key={st}
                    style={[styles.filterChip, st === "All" && styles.filterChipAll, isActive && styles.filterChipActive]}
                    onPress={() => setStudentFilter(st)}
                  >
                    {st !== "All" && (
                      <View style={styles.filterAvatar}>
                        <Text style={styles.filterAvatarText}>{st.slice(0, 2).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                      {st === "All" ? "All Students" : st}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {isOffline && <OfflineState />}
            {errorMsg ? <ErrorState message={errorMsg} onRetry={loadBalletApps} /> : null}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === "ballet" ? (
            <AssessmentCard app={item.data} onPress={() => setSelectedItem(item)} />
          ) : (
            <BookingCard
              item={item.data}
              onPress={() => setSelectedItem(item)}
              onCancel={() => {
                Alert.alert(
                  "Cancel booking?",
                  `Cancel your booking for ${item.data.className}? This frees up your seat.`,
                  [
                    { text: "Keep booking", style: "cancel" },
                    {
                      text: "Cancel booking",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await cancelBooking(item.data.id);
                        } catch (e) {
                          Alert.alert("Couldn't cancel", e instanceof Error ? e.message : "Please try again.");
                        }
                      },
                    },
                  ],
                );
              }}
              onPayNow={() => {
                Alert.alert(
                  "Pay at the studio",
                  "Your booking is pending. Please complete payment at the studio — your booking is confirmed once payment is received.",
                );
              }}
            />
          )
        }
        ListEmptyComponent={
          !refreshing ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <SBI name="cal" size={34} stroke={1.6} color="#00B6D7" />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === "Upcoming" ? "No upcoming bookings" : activeTab === "Past" ? "No booking history yet" : "No cancelled bookings"}
              </Text>
              <Text style={styles.emptySub}>
                {activeTab === "Upcoming" ? "Your next dance adventure is waiting for you." : activeTab === "Past" ? "Completed bookings and attendance will show up here." : "Looks like you've kept every appointment."}
              </Text>
              {activeTab === "Upcoming" && (
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push("/(tabs)/classes")}>
                  <Text style={styles.emptyBtnText}>Book a Class</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <ListSkeleton count={4} />
          )
        }
      />
      {selectedItem && <BookingDetailOverlay item={selectedItem} onClose={() => setSelectedItem(null)} topPad={Platform.OS === "web" ? 67 : insets.top} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  headerSimple: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  simpleTitle: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  list: { paddingHorizontal: 20 },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  heroEyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 6 },
  // marginBottom cancels the iOS cap-guard inset from the block footprint so the
  // hero row stays bottom-aligned with the "+ New" button as on Android. No-op on Android.
  heroTitle: { fontFamily: "Anton_400Regular", fontSize: 52, lineHeight: 46, ...iosDisplayTextStyle(52, 46), marginBottom: -iosCapGuard(52, 46), textTransform: "uppercase", color: "#FFFFFF" },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, backgroundColor: "#00B6D7", width: 134, marginBottom: 6 },
  newBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 13, color: "#0A0B0D" },
  searchWrap: { position: "relative", flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)", borderRadius: 24, marginBottom: 14 },
  searchIcon: { position: "absolute", left: 14 },
  // paddingTop/Bottom come AFTER the input-style spread so they override its
  // paddingTop:0/paddingBottom:0 on iOS and keep the field's original height.
  searchInput: { flex: 1, paddingLeft: 42, paddingRight: 42, fontSize: 14.5, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(14.5, 18), paddingTop: 12, paddingBottom: 12 },
  clearSearch: { position: "absolute", right: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  tabContainer: { flexDirection: "row", padding: 4, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 24, marginBottom: 14 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: 20 },
  tabBtnActive: { backgroundColor: "#0A0B0D" },
  tabBtnText: { fontFamily: "Archivo_700Bold", fontSize: 12.5, color: "#6B747F" },
  tabBtnTextActive: { color: "#FFFFFF" },
  tabBtnCounter: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabBtnCounterText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10 },
  filterScroll: { gap: 8, paddingBottom: 20 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 13, paddingLeft: 7, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", marginRight: 8 },
  // "All Students" has no avatar → symmetric padding + centered text.
  filterChipAll: { paddingLeft: 16, paddingRight: 16, justifyContent: "center" },
  filterChipActive: { backgroundColor: "#0A0B0D", borderColor: "rgba(0,182,215,0.5)" },
  filterAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  filterAvatarText: { fontFamily: "Archivo_800ExtraBold", fontSize: 10, color: "#FFFFFF" },
  filterChipText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: "#6B747F" },
  filterChipTextActive: { color: "#FFFFFF" },
  emptyWrap: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 30 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(0,182,215,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 18 },
  emptyTitle: { fontFamily: "Archivo_800ExtraBold", fontSize: 21, color: "#FFFFFF", marginBottom: 8, textAlign: "center" },
  emptySub: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "#8E97A2", textAlign: "center", maxWidth: 230, lineHeight: 21, marginBottom: 20 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 13, borderRadius: 24, backgroundColor: "#00B6D7" },
  emptyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" }
});
