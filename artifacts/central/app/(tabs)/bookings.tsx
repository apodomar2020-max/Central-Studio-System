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

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ["Upcoming", "Past", "Cancelled"] as const;

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

  const onRefresh = useCallback(async () => {
    await Promise.all([syncWithApi(), refreshUserPackages()]);
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

  // ── Tab filter ─────────────────────────────────────────────────────────────
  function filterBookings(tab: (typeof TABS)[number]): Booking[] {
    switch (tab) {
      case "Upcoming":
        return mergedBookings.filter(
          (b) =>
            b.bookingStatus === "confirmed" ||
            b.bookingStatus === "pendingPayment"
        );
      case "Past":
        return mergedBookings.filter(
          (b) => b.bookingStatus === "attended" || b.bookingStatus === "noShow"
        );
      case "Cancelled":
        return mergedBookings.filter(
          (b) =>
            b.bookingStatus === "cancelled" || b.bookingStatus === "refunded"
        );
    }
  }

  const filtered = filterBookings(activeTab);
  const upcomingCount = mergedBookings.filter(
    (b) =>
      b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment"
  ).length;
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
          renderItem={({ item }) => <BookingCard item={item} />}
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
