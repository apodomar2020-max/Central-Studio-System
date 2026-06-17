import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import { Booking } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import BookingCard from "@/components/BookingCard";
import EmptyState from "@/components/EmptyState";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { ListSkeleton } from "@/components/SkeletonLoader";
import {
  fetchStudentBookings,
  mapApiStatusToLocal,
} from "@/services/bookingsRepository";
import { isOfflineError } from "@/services/connectivity";
import {
  fetchMyApplications,
  ACTIVE_APPLICATION_STATUSES,
  type BalletApplication,
} from "@/services/balletAssessmentService";

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ["Upcoming", "Past", "Cancelled"] as const;

// ─── Ballet Assessment card ───────────────────────────────────────────────────

const BALLET_COLOR = "#A78BFA";

interface BalletStatusInfo {
  label: string;
  color: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}

function getBalletStatusInfo(status: string): BalletStatusInfo {
  switch (status) {
    case "submitted":       return { label: "Under Review",         color: "#F59E0B", icon: "time-outline" };
    case "pendingAssessment": return { label: "Assessment Scheduled", color: "#60A5FA", icon: "calendar-outline" };
    case "needsFollowUp":   return { label: "Follow-up Required",   color: "#F59E0B", icon: "chatbubble-ellipses-outline" };
    case "accepted":        return { label: "Accepted",             color: "#22C55E", icon: "checkmark-circle" };
    case "assignedToLevel": return { label: "Level Assigned",       color: BALLET_COLOR, icon: "ribbon-outline" };
    case "activeBallet":    return { label: "Active Student",       color: BALLET_COLOR, icon: "star-outline" };
    case "rejected":        return { label: "Not Accepted",         color: "#EF4444", icon: "close-circle-outline" };
    case "cancelled":       return { label: "Cancelled",            color: "#6B7280", icon: "ban-outline" };
    default:                return { label: status,                 color: "#9CA3AF", icon: "information-circle-outline" };
  }
}

function BalletAssessmentCard({ app }: { app: BalletApplication }) {
  const info = getBalletStatusInfo(app.status);

  const dateStr = app.slotLabel
    ? app.slotLabel
    : new Date(app.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <TouchableOpacity
      onPress={() => router.push("/ballet/application-status" as any)}
      style={balletCardStyles.card}
      activeOpacity={0.85}
    >
      {/* Left accent bar */}
      <View style={[balletCardStyles.accent, { backgroundColor: BALLET_COLOR }]} />

      <View style={balletCardStyles.body}>
        {/* Header row */}
        <View style={balletCardStyles.headerRow}>
          <View style={[balletCardStyles.iconWrap, { backgroundColor: BALLET_COLOR + "1A" }]}>
            <Ionicons name="musical-notes-outline" size={14} color={BALLET_COLOR} />
          </View>
          <Text style={balletCardStyles.className}>Ballet Assessment</Text>
          <View style={[balletCardStyles.badge, { backgroundColor: info.color + "1A", borderColor: info.color + "40" }]}>
            <Ionicons name={info.icon} size={10} color={info.color} />
            <Text style={[balletCardStyles.badgeText, { color: info.color }]}>{info.label}</Text>
          </View>
        </View>

        {/* Child row */}
        <View style={balletCardStyles.row}>
          <Ionicons name="person-outline" size={13} color="#6B7280" />
          <Text style={balletCardStyles.meta}>{app.childName}</Text>
        </View>

        {/* Date / slot row */}
        <View style={balletCardStyles.row}>
          <Ionicons name="calendar-outline" size={13} color="#6B7280" />
          <Text style={balletCardStyles.meta}>{dateStr}</Text>
        </View>

        {/* Footer */}
        <View style={balletCardStyles.footer}>
          <Text style={balletCardStyles.noCharge}>No class credits deducted</Text>
          <Ionicons name="chevron-forward" size={14} color={BALLET_COLOR + "80"} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const balletCardStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BALLET_COLOR + "30",
    backgroundColor: "#1A0D2D",
    overflow: "hidden",
    marginBottom: 10,
  },
  accent: { width: 4 },
  body: { flex: 1, padding: 12, gap: 7 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  className: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  noCharge: { fontSize: 10, fontFamily: "Inter_400Regular", color: BALLET_COLOR + "80", fontStyle: "italic" },
});

// ─── Union list item type ─────────────────────────────────────────────────────

type ListItem =
  | { kind: "booking"; data: Booking; id: string }
  | { kind: "ballet"; data: BalletApplication; id: string };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BookingsScreen() {
  const { bookings: localBookings, user, refreshUserPackages } = useAppContext();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Upcoming");

  // ── API sync state ─────────────────────────────────────────────────────────
  // The backend is the source of truth for booking STATUS.
  // localBookings carry the display data (class name, time, instructor, etc.)
  // because the current /api/bookings endpoint doesn't return those fields yet.
  // We MERGE: display metadata from local, status from API.
  //
  // See services/bookingsRepository.ts TODO-2 for the backend enrichment plan.
  const [syncState, setSyncState] = useState<
    "idle" | "loading" | "success" | "offline" | "error"
  >("idle");
  const [fromCache, setFromCache] = useState(false);
  // Map of String(apiBooking.id) → api status string
  const [apiStatuses, setApiStatuses] = useState<Map<string, string>>(new Map());

  // ── Ballet applications ────────────────────────────────────────────────────
  const [balletApps, setBalletApps] = useState<BalletApplication[]>([]);

  const syncWithApi = useCallback(async () => {
    if (!user?.email) return;
    setSyncState("loading");
    try {
      const result = await fetchStudentBookings(user.email);
      const statusMap = new Map(
        result.bookings.map((b) => [String(b.id), b.status])
      );
      setApiStatuses(statusMap);
      setFromCache(result.fromCache);
      setSyncState("success");
    } catch (err) {
      setSyncState(isOfflineError(err) ? "offline" : "error");
    }
  }, [user?.email]);

  useEffect(() => {
    syncWithApi();
  }, [syncWithApi]);

  // Fetch ballet applications in parallel (silently — doesn't gate the UI)
  useEffect(() => {
    if (!user?.email) return;
    const ctrl = new AbortController();
    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (!ctrl.signal.aborted) setBalletApps(apps);
      })
      .catch(() => {
        // Silently ignore — ballet items simply won't appear if fetch fails
      });
    return () => ctrl.abort();
  }, [user?.email]);

  const onRefresh = useCallback(async () => {
    const refreshBallet = fetchMyApplications()
      .then(setBalletApps)
      .catch(() => {});
    await Promise.all([syncWithApi(), refreshUserPackages(), refreshBallet]);
  }, [syncWithApi, refreshUserPackages]);

  // ── Merge: API status overlays local display data ─────────────────────────
  // Local booking ID = String(apiBooking.id) (set in booking/flow.tsx).
  // We apply any status updates the admin made via the dashboard.
  const mergedBookings = useMemo<Booking[]>(() => {
    if (apiStatuses.size === 0) return localBookings;
    return localBookings.map((b) => {
      const apiStatus = apiStatuses.get(b.id);
      if (!apiStatus) return b;
      return { ...b, bookingStatus: mapApiStatusToLocal(apiStatus) };
    });
  }, [localBookings, apiStatuses]);

  // ── Tab filter — returns union list ───────────────────────────────────────
  function filterItems(tab: (typeof TABS)[number]): ListItem[] {
    const bookingItems: ListItem[] = (() => {
      switch (tab) {
        case "Upcoming":
          return mergedBookings
            .filter((b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment")
            .map((b): ListItem => ({ kind: "booking", data: b, id: `b-${b.id}` }));
        case "Past":
          return mergedBookings
            .filter((b) => b.bookingStatus === "attended" || b.bookingStatus === "noShow")
            .map((b): ListItem => ({ kind: "booking", data: b, id: `b-${b.id}` }));
        case "Cancelled":
          return mergedBookings
            .filter((b) => b.bookingStatus === "cancelled" || b.bookingStatus === "refunded")
            .map((b): ListItem => ({ kind: "booking", data: b, id: `b-${b.id}` }));
      }
    })();

    const balletItems: ListItem[] = (() => {
      switch (tab) {
        case "Upcoming":
          return balletApps
            .filter((a) => ACTIVE_APPLICATION_STATUSES.has(a.status))
            .map((a): ListItem => ({ kind: "ballet", data: a, id: `ballet-${a.id}` }));
        case "Past":
          return balletApps
            .filter((a) => a.status === "rejected")
            .map((a): ListItem => ({ kind: "ballet", data: a, id: `ballet-${a.id}` }));
        case "Cancelled":
          return balletApps
            .filter((a) => a.status === "cancelled")
            .map((a): ListItem => ({ kind: "ballet", data: a, id: `ballet-${a.id}` }));
      }
    })();

    // Ballet items appear first so they're visually distinct at the top
    return [...balletItems, ...bookingItems];
  }

  const filtered = filterItems(activeTab);
  const upcomingCount =
    mergedBookings.filter((b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment").length +
    balletApps.filter((a) => ACTIVE_APPLICATION_STATUSES.has(a.status)).length;
  const isRefreshing = syncState === "loading";

  // ── Header (shared across states) ─────────────────────────────────────────
  const Header = (
    <View
      style={[
        styles.header,
        { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
      ]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>My Bookings</Text>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/(tabs)/classes");
          }}
          style={[styles.newBookingBtn, { backgroundColor: colors.studio.primary }]}
        >
          <Ionicons name="add" size={16} color="#000" />
          <Text style={styles.newBookingText}>New</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(tab);
            }}
            style={[
              styles.tab,
              activeTab === tab && {
                backgroundColor: colors.studio.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab
                  ? { color: "#000", fontFamily: "Inter_700Bold" }
                  : { color: "#9CA3AF" },
              ]}
            >
              {tab}
            </Text>
            {tab === "Upcoming" &&
              upcomingCount > 0 &&
              activeTab !== "Upcoming" && (
                <View
                  style={[
                    styles.tabBadge,
                    { backgroundColor: colors.studio.primary },
                  ]}
                >
                  <Text style={styles.tabBadgeText}>{upcomingCount}</Text>
                </View>
              )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ── Not signed in ──────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: Platform.OS === "web" ? 67 : insets.top },
        ]}
      >
        <View style={styles.headerSimple}>
          <Text style={styles.title}>My Bookings</Text>
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

  // ── Initial load — no local data yet ──────────────────────────────────────
  // Show skeletons only when we have NO local bookings AND the API is still
  // fetching. Once local bookings exist, we can show them immediately.
  if (syncState === "loading" && localBookings.length === 0) {
    return (
      <View style={styles.container}>
        {Header}
        <ListSkeleton count={3} />
      </View>
    );
  }

  // ── Offline — no local data to show ───────────────────────────────────────
  if (syncState === "offline" && localBookings.length === 0) {
    return (
      <View style={styles.container}>
        {Header}
        <OfflineState onRetry={syncWithApi} />
      </View>
    );
  }

  // ── Server error — no local data to show ──────────────────────────────────
  if (syncState === "error" && localBookings.length === 0) {
    return (
      <View style={styles.container}>
        {Header}
        <ErrorState
          onRetry={syncWithApi}
          message="Couldn't load your bookings from the server. Please try again."
        />
      </View>
    );
  }

  // ── Normal render (with merged data) ──────────────────────────────────────
  return (
    <View style={styles.container}>
      {Header}

      {/* Stale cache banner — device was offline, showing last-synced data */}
      {fromCache && (
        <View style={styles.cacheBanner}>
          <Ionicons name="cloud-offline-outline" size={13} color="#F59E0B" />
          <Text style={styles.cacheBannerText}>
            Showing last synced data · Connect to refresh
          </Text>
          <TouchableOpacity onPress={syncWithApi}>
            <Text style={styles.cacheBannerRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sync error with existing local data — subtle inline warning */}
      {(syncState === "error" || syncState === "offline") &&
        !fromCache &&
        localBookings.length > 0 && (
          <View style={styles.syncWarning}>
            <Ionicons
              name={
                syncState === "offline"
                  ? "wifi-outline"
                  : "alert-circle-outline"
              }
              size={13}
              color="#9CA3AF"
            />
            <Text style={styles.syncWarningText}>
              {syncState === "offline"
                ? "Offline — status may not be current"
                : "Sync error — status may not be current"}
            </Text>
            <TouchableOpacity onPress={syncWithApi}>
              <Text style={styles.syncWarningRetry}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title={
            activeTab === "Upcoming"
              ? "No upcoming bookings"
              : activeTab === "Past"
              ? "No past bookings"
              : "No cancelled bookings"
          }
          description={
            activeTab === "Upcoming"
              ? "Book a class to get started — browse available classes or use your package credits."
              : `Your ${activeTab.toLowerCase()} bookings will appear here`
          }
          actionLabel={activeTab === "Upcoming" ? "Book a Class" : undefined}
          onAction={
            activeTab === "Upcoming"
              ? () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/(tabs)/classes");
                }
              : undefined
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) =>
            item.kind === "ballet"
              ? <BalletAssessmentCard app={item.data} />
              : <BookingCard item={item.data} />
          }
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Platform.OS === "web" ? 120 : 90 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.studio.primary}
              colors={[colors.studio.primary]}
            />
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  headerSimple: { paddingHorizontal: 20, paddingTop: 80, paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  newBookingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  newBookingText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#000" },
  tabRow: { flexDirection: "row", gap: 8 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
  },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#000" },
  list: { paddingHorizontal: 20, paddingTop: 8 },
  // ── Status banners ─────────────────────────────────────────────────────────
  cacheBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F59E0B15",
    borderWidth: 1,
    borderColor: "#F59E0B30",
  },
  cacheBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#F59E0B",
  },
  cacheBannerRetry: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#F59E0B",
  },
  syncWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#1E1E26",
  },
  syncWarningText: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
  },
  syncWarningRetry: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: colors.studio.primary,
  },
});
