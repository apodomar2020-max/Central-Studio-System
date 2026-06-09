import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useState } from "react";
import { FlatList, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import BookingCard from "@/components/BookingCard";
import EmptyState from "@/components/EmptyState";
import { Booking } from "@/contexts/AppContext";

const TABS = ["Upcoming", "Past", "Cancelled"] as const;

export default function BookingsScreen() {
  const { bookings, user, refreshUserPackages } = useAppContext();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Upcoming");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshUserPackages();
    setIsRefreshing(false);
  }, [refreshUserPackages]);

  function filterBookings(tab: typeof activeTab): Booking[] {
    switch (tab) {
      case "Upcoming":
        return bookings.filter(
          (b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment"
        );
      case "Past":
        return bookings.filter(
          (b) => b.bookingStatus === "attended" || b.bookingStatus === "noShow"
        );
      case "Cancelled":
        return bookings.filter(
          (b) => b.bookingStatus === "cancelled" || b.bookingStatus === "refunded"
        );
    }
  }

  const filtered = filterBookings(activeTab);

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
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

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
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
                activeTab === tab && { backgroundColor: colors.studio.primary },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab ? { color: "#000", fontFamily: "Inter_700Bold" } : { color: "#9CA3AF" },
                ]}
              >
                {tab}
              </Text>
              {tab === "Upcoming" && bookings.filter((b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment").length > 0 && activeTab !== "Upcoming" && (
                <View style={[styles.tabBadge, { backgroundColor: colors.studio.primary }]}>
                  <Text style={styles.tabBadgeText}>
                    {bookings.filter((b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment").length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title={activeTab === "Upcoming" ? "No upcoming bookings" : activeTab === "Past" ? "No past bookings" : "No cancelled bookings"}
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
          contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === "web" ? 120 : 90 }]}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  headerSimple: { paddingHorizontal: 20, paddingTop: 80, paddingBottom: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#000" },
  list: { paddingHorizontal: 20, paddingTop: 8 },
});
