import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import { NOTIFICATIONS, AppNotification } from "@/data/mockData";
import colors from "@/constants/colors";

const TYPE_ICONS: Record<string, string> = {
  booking: "calendar",
  class_reminder: "time",
  package: "card",
  ballet: "diamond",
  offer: "pricetag",
  system: "information-circle",
};

const TYPE_COLORS: Record<string, string> = {
  booking: colors.studio.primary,
  class_reminder: "#F59E0B",
  package: "#22C55E",
  ballet: "#A78BFA",
  offer: "#EC4899",
  system: "#6B7280",
};

function NotifItem({ notif }: { notif: AppNotification }) {
  const iconName = TYPE_ICONS[notif.type] ?? "notifications";
  const iconColor = TYPE_COLORS[notif.type] ?? "#9CA3AF";

  return (
    <TouchableOpacity
      style={[styles.notifCard, !notif.isRead && styles.notifCardUnread]}
      activeOpacity={0.8}
    >
      {!notif.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.studio.primary }]} />}
      <View style={[styles.notifIconWrap, { backgroundColor: iconColor + "20" }]}>
        <Ionicons name={iconName as any} size={20} color={iconColor} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifTopRow}>
          <Text style={styles.notifTitle} numberOfLines={1}>{notif.title}</Text>
          <Text style={styles.notifTime}>{notif.timeAgo}</Text>
        </View>
        <Text style={styles.notifBody} numberOfLines={3}>{notif.body}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { unreadNotifications } = useAppContext();

  const all = NOTIFICATIONS;
  const unread = all.filter((n) => !n.isRead);
  const read = all.filter((n) => n.isRead);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerRight}>
          {unreadNotifications > 0 && (
            <View style={[styles.countBadge, { backgroundColor: colors.studio.primary + "20" }]}>
              <Text style={[styles.countText, { color: colors.studio.primary }]}>{unreadNotifications} new</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        {all.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color="#4B5563" />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyDesc}>You'll be notified about bookings, class reminders, and special offers here.</Text>
          </View>
        ) : (
          <>
            {unread.length > 0 && (
              <View style={styles.group}>
                <Text style={styles.groupLabel}>New</Text>
                {unread.map((n) => <NotifItem key={n.id} notif={n} />)}
              </View>
            )}
            {read.length > 0 && (
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Earlier</Text>
                {read.map((n) => <NotifItem key={n.id} notif={n} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: colors.studio.background,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  headerRight: { width: 60, alignItems: "flex-end" },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  group: { marginBottom: 24, gap: 8 },
  groupLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#6B7280", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  notifCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "#0E1619", borderRadius: 14, borderWidth: 1,
    borderColor: "#1E2E38", padding: 14,
  },
  notifCardUnread: { borderColor: colors.studio.primary + "40", backgroundColor: "#001820" },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, position: "absolute", top: 14, left: 8 },
  notifIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  notifContent: { flex: 1, gap: 4 },
  notifTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  notifTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flexShrink: 0 },
  notifBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
});
