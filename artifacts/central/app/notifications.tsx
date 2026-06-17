import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";
import type { Notification as ApiNotification } from "@workspace/api-client-react";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { NotifCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";

// ─── Types ───────────────────────────────────────────────────────────────────

type NotifType = "booking" | "class_reminder" | "package" | "ballet" | "offer" | "system";

interface DisplayNotif {
  id: string;
  title: string;
  body: string;
  type: NotifType;
  isRead: boolean;
  createdAt: string;
  /** "local" = generated in-app (AppContext); "api" = admin broadcast */
  source: "local" | "api";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString("en-EG", { month: "short", day: "numeric" });
}

/** Best-effort type inference from notification title/body for API broadcasts */
function inferType(n: ApiNotification): NotifType {
  const text = (n.title + " " + n.body).toLowerCase();
  if (text.includes("book") || text.includes("reserv")) return "booking";
  if (text.includes("class") || text.includes("reminder")) return "class_reminder";
  if (text.includes("package") || text.includes("credit")) return "package";
  if (text.includes("ballet")) return "ballet";
  if (text.includes("offer") || text.includes("discount") || text.includes("%")) return "offer";
  return "system";
}

const READ_KEY = "api_notif_read_ids";

// ─── Icon/colour maps ─────────────────────────────────────────────────────────

const TYPE_ICONS: Record<NotifType, string> = {
  booking: "calendar",
  class_reminder: "time",
  package: "card",
  ballet: "diamond",
  offer: "pricetag",
  system: "information-circle",
};

const TYPE_COLORS: Record<NotifType, string> = {
  booking: colors.studio.primary,
  class_reminder: "#F59E0B",
  package: "#22C55E",
  ballet: "#00B6D6",
  offer: "#EC4899",
  system: "#6B7280",
};

// ─── NotifItem ────────────────────────────────────────────────────────────────

function NotifItem({
  notif,
  onPress,
}: {
  notif: DisplayNotif;
  onPress: (n: DisplayNotif) => void;
}) {
  const iconName = TYPE_ICONS[notif.type] ?? "notifications";
  const iconColor = TYPE_COLORS[notif.type] ?? "#9CA3AF";

  return (
    <TouchableOpacity
      style={[styles.notifCard, !notif.isRead && styles.notifCardUnread]}
      activeOpacity={0.8}
      onPress={() => onPress(notif)}
    >
      {!notif.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.studio.primary }]} />}
      <View style={[styles.notifIconWrap, { backgroundColor: iconColor + "20" }]}>
        <Ionicons name={iconName as any} size={20} color={iconColor} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifTopRow}>
          <Text style={styles.notifTitle} numberOfLines={1}>{notif.title}</Text>
          <Text style={styles.notifTime}>{timeAgo(notif.createdAt)}</Text>
        </View>
        <Text style={styles.notifBody} numberOfLines={3}>{notif.body}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { notifications: localNotifs, markNotificationRead } = useAppContext();

  // Per-student + broadcast API notifications (fetched from /api/notifications/my)
  const [apiNotifs, setApiNotifs] = useState<ApiNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isApiError, setIsApiError] = useState(false);
  const [apiError, setApiError] = useState<unknown>(null);

  const loadApiNotifs = useCallback(async (refreshing = false) => {
    if (refreshing) setIsRefetching(true); else setIsLoading(true);
    setIsApiError(false);
    try {
      const data = await customFetch<ApiNotification[]>("/api/notifications/my");
      setApiNotifs(data);
    } catch (e) {
      setIsApiError(true);
      setApiError(e);
    } finally {
      setIsLoading(false);
      setIsRefetching(false);
    }
  }, []);

  useEffect(() => { loadApiNotifs(); }, [loadApiNotifs]);

  const refetch = useCallback(() => loadApiNotifs(true), [loadApiNotifs]);
  const onRefresh = refetch;

  // Locally-persisted set of read API notification IDs
  const [apiReadIds, setApiReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    AsyncStorage.getItem(READ_KEY).then((raw) => {
      if (raw) {
        try { setApiReadIds(new Set(JSON.parse(raw))); } catch {}
      }
    });
  }, []);

  const markApiRead = useCallback(async (id: string) => {
    setApiReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      AsyncStorage.setItem(READ_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Build merged, sorted notification list
  const all: DisplayNotif[] = React.useMemo(() => {
    const apiItems: DisplayNotif[] = (apiNotifs ?? [])
      .filter((n) => !n.isDraft)
      .map((n) => ({
        id: `api-${n.id}`,
        title: n.title,
        body: n.body,
        type: inferType(n),
        isRead: apiReadIds.has(`api-${n.id}`),
        createdAt: n.sentAt ?? n.createdAt,
        source: "api" as const,
      }));

    const localItems: DisplayNotif[] = localNotifs.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt,
      source: "local" as const,
    }));

    // Merge and sort newest first
    return [...apiItems, ...localItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [apiNotifs, apiReadIds, localNotifs]);

  const unread = all.filter((n) => !n.isRead);
  const read = all.filter((n) => n.isRead);
  const unreadCount = unread.length;

  const handlePress = useCallback((notif: DisplayNotif) => {
    if (notif.isRead) return;
    if (notif.source === "api") {
      markApiRead(notif.id);
    } else {
      markNotificationRead(notif.id);
    }
  }, [markApiRead, markNotificationRead]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={styles.headerRight}>
          {unreadCount > 0 && (
            <View style={[styles.countBadge, { backgroundColor: colors.studio.primary + "20" }]}>
              <Text style={[styles.countText, { color: colors.studio.primary }]}>{unreadCount} new</Text>
            </View>
          )}
        </View>
      </View>

      {isLoading && all.length === 0 ? (
        <View style={{ paddingTop: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => <NotifCardSkeleton key={i} />)}
        </View>
      ) : isApiError && all.length === 0 ? (
        // Offline with no local notifications to show
        isOfflineError(apiError) ? (
          <OfflineState onRetry={refetch} />
        ) : (
          <ErrorState onRetry={refetch} message="Couldn't load notifications. Please try again." />
        )
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={onRefresh}
              tintColor={colors.studio.primary}
              colors={[colors.studio.primary]}
            />
          }
        >
          {all.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={48} color="#4B5563" />
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptyDesc}>
                You'll be notified about bookings, class reminders, and special offers here.
              </Text>
            </View>
          ) : (
            <>
              {unread.length > 0 && (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>New</Text>
                  {unread.map((n) => (
                    <NotifItem key={n.id} notif={n} onPress={handlePress} />
                  ))}
                </View>
              )}
              {read.length > 0 && (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Earlier</Text>
                  {read.map((n) => (
                    <NotifItem key={n.id} notif={n} onPress={handlePress} />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  group: { marginBottom: 24, gap: 8 },
  groupLabel: {
    fontSize: 12, fontFamily: "Inter_700Bold", color: "#6B7280",
    letterSpacing: 1, textTransform: "uppercase", marginBottom: 4,
  },
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
