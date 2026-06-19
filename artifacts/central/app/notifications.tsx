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

type NotifType =
  | "booking_created"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_rejected"
  | "payment_paid"
  | "payment_failed"
  | "payment_refunded"
  | "package_created"
  | "package_activated"
  | "package_cancelled"
  | "package_credits_updated"
  | "credits_exhausted"
  | "attendance_checked_in"
  | "offer_published"
  | "schedule_changed"
  | "schedule_cancelled"
  | "booking"
  | "class_reminder"
  | "package"
  | "ballet"
  | "offer"
  | "system";

interface DisplayNotif {
  id: string;
  title: string;
  body: string;
  type: NotifType;
  isRead: boolean;
  createdAt: string | null;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
  /** "local" = generated in-app (AppContext); "api" = admin broadcast */
  source: "local" | "api";
}

type TypeConfig = {
  icon: string;
  color: string;
  badge: string;
};

type TypedApiNotification = ApiNotification & {
  type?: string | null;
  metadata?: Record<string, unknown> | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDateValue(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function resolveTimestamp(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    const parsed = parseDateValue(value);
    if (parsed != null) return parsed;
  }
  return Date.now();
}

function timeAgo(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-EG", { month: "short", day: "numeric" });
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function timelineGroup(timestamp: number): "today" | "yesterday" | "earlier" {
  const today = startOfDay(Date.now());
  const itemDay = startOfDay(timestamp);
  if (itemDay === today) return "today";
  if (itemDay === today - 86_400_000) return "yesterday";
  return "earlier";
}

/** Best-effort type inference from notification title/body for API broadcasts */
function inferType(n: Pick<TypedApiNotification, "title" | "body" | "type">): NotifType {
  if (isKnownType(n.type)) return n.type;
  const text = (n.title + " " + n.body).toLowerCase();
  if (text.includes("payment") && text.includes("confirm")) return "payment_paid";
  if (text.includes("payment") && text.includes("refund")) return "payment_refunded";
  if (text.includes("payment") && text.includes("fail")) return "payment_failed";
  if (text.includes("cancel")) {
    if (text.includes("package")) return "package_cancelled";
    if (text.includes("schedule") || text.includes("class")) return "schedule_cancelled";
    return "booking_cancelled";
  }
  if (text.includes("reject")) return "booking_rejected";
  if (text.includes("confirm") || text.includes("approved")) return "booking_confirmed";
  if (text.includes("checked in") || text.includes("attendance")) return "attendance_checked_in";
  if (text.includes("active") && text.includes("package")) return "package_activated";
  if (text.includes("used") && text.includes("credit")) return "credits_exhausted";
  if (text.includes("offer") || text.includes("discount") || text.includes("%")) return "offer_published";
  if (text.includes("schedule") && text.includes("changed")) return "schedule_changed";
  if (text.includes("book") || text.includes("reserv")) return "booking";
  if (text.includes("class") || text.includes("reminder")) return "class_reminder";
  if (text.includes("package") || text.includes("credit")) return "package";
  if (text.includes("ballet")) return "ballet";
  if (text.includes("offer") || text.includes("discount") || text.includes("%")) return "offer";
  return "system";
}

function isKnownType(value: unknown): value is NotifType {
  return typeof value === "string" && value in TYPE_CONFIG;
}

function asMetadata(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function metadataRows(metadata?: Record<string, unknown> | null): Array<{ label: string; value: string }> {
  if (!metadata) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const className = metadataText(metadata.className);
  const instructorName = metadataText(metadata.instructorName);
  const branch = metadataText(metadata.branch);
  const scheduleLabel = metadataText(metadata.scheduleLabel);
  const packageName = metadataText(metadata.packageName);
  const remainingCredits = metadataText(metadata.remainingCredits);
  const amount = metadataText(metadata.amount);
  const currency = metadataText(metadata.currency);

  if (className) rows.push({ label: "Class", value: className });
  if (instructorName) rows.push({ label: "Instructor", value: instructorName });
  if (branch) rows.push({ label: "Branch", value: branch });
  if (scheduleLabel) rows.push({ label: "Time", value: scheduleLabel });
  if (packageName) rows.push({ label: "Package", value: packageName });
  if (remainingCredits) rows.push({ label: "Credits", value: `${remainingCredits} remaining` });
  if (amount) rows.push({ label: "Amount", value: currency ? `${amount} ${currency}` : amount });

  return rows;
}

const READ_KEY = "api_notif_read_ids";

// ─── Icon/colour maps ─────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<NotifType, TypeConfig> = {
  booking_created: { icon: "calendar-outline", color: colors.studio.primary, badge: "Booking" },
  booking_confirmed: { icon: "checkmark-circle", color: "#22C55E", badge: "Confirmed" },
  booking_cancelled: { icon: "close-circle", color: "#EF4444", badge: "Cancelled" },
  booking_rejected: { icon: "ban", color: "#EF4444", badge: "Rejected" },
  payment_paid: { icon: "card", color: "#22C55E", badge: "Paid" },
  payment_failed: { icon: "alert-circle", color: "#EF4444", badge: "Payment Failed" },
  payment_refunded: { icon: "return-down-back", color: "#38BDF8", badge: "Refunded" },
  package_created: { icon: "albums", color: "#38BDF8", badge: "Package" },
  package_activated: { icon: "ribbon", color: "#10B981", badge: "Package Active" },
  package_cancelled: { icon: "close-circle", color: "#EF4444", badge: "Package Cancelled" },
  package_credits_updated: { icon: "swap-horizontal", color: "#F59E0B", badge: "Credits Updated" },
  credits_exhausted: { icon: "alert-circle", color: "#F59E0B", badge: "Credits Used" },
  attendance_checked_in: { icon: "log-in", color: colors.studio.primary, badge: "Checked In" },
  offer_published: { icon: "gift", color: "#A855F7", badge: "Offer" },
  schedule_changed: { icon: "calendar", color: "#F59E0B", badge: "Schedule Changed" },
  schedule_cancelled: { icon: "calendar-clear", color: "#EF4444", badge: "Schedule Cancelled" },
  booking: { icon: "calendar-outline", color: colors.studio.primary, badge: "Booking" },
  class_reminder: { icon: "time", color: "#F59E0B", badge: "Class" },
  package: { icon: "card", color: "#22C55E", badge: "Package" },
  ballet: { icon: "diamond", color: "#00B6D6", badge: "Ballet" },
  offer: { icon: "pricetag", color: "#EC4899", badge: "Offer" },
  system: { icon: "information-circle", color: "#6B7280", badge: "Info" },
};

// ─── NotifItem ────────────────────────────────────────────────────────────────

function NotifItem({
  notif,
  onPress,
}: {
  notif: DisplayNotif;
  onPress: (n: DisplayNotif) => void;
}) {
  const config = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.system;
  const rows = metadataRows(notif.metadata);

  return (
    <TouchableOpacity
      style={[styles.notifCard, !notif.isRead && styles.notifCardUnread]}
      activeOpacity={0.8}
      onPress={() => onPress(notif)}
    >
      {!notif.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.studio.primary }]} />}
      <View style={[styles.notifIconWrap, { backgroundColor: config.color + "20" }]}>
        <Ionicons name={config.icon as any} size={21} color={config.color} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifTopRow}>
          <Text style={styles.notifTitle} numberOfLines={1}>{notif.title}</Text>
          <Text style={styles.notifTime}>{timeAgo(notif.timestamp)}</Text>
        </View>
        <View style={[styles.eventBadge, { backgroundColor: config.color + "18", borderColor: config.color + "45" }]}>
          <Text style={[styles.eventBadgeText, { color: config.color }]}>{config.badge}</Text>
        </View>
        <Text style={styles.notifBody} numberOfLines={3}>{notif.body}</Text>
        {rows.length > 0 && (
          <View style={styles.metadataWrap}>
            {rows.map((row) => (
              <View key={`${row.label}-${row.value}`} style={styles.metadataRow}>
                <Text style={styles.metadataLabel}>{row.label}</Text>
                <Text style={styles.metadataValue} numberOfLines={1}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { notifications: localNotifs, markNotificationRead } = useAppContext();

  // Per-student + broadcast API notifications (fetched from /api/notifications/my)
  const [apiNotifs, setApiNotifs] = useState<TypedApiNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isApiError, setIsApiError] = useState(false);
  const [apiError, setApiError] = useState<unknown>(null);

  const loadApiNotifs = useCallback(async (refreshing = false) => {
    if (refreshing) setIsRefetching(true); else setIsLoading(true);
    setIsApiError(false);
    try {
      const data = await customFetch<TypedApiNotification[]>("/api/notifications/my");
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
	      .map((n) => {
	        const timestamp = resolveTimestamp(n.sentAt, n.createdAt);
	        return {
	          id: `api-${n.id}`,
	          title: n.title,
	          body: n.body,
	          type: inferType(n),
	          isRead: apiReadIds.has(`api-${n.id}`),
	          createdAt: n.sentAt ?? n.createdAt ?? null,
	          timestamp,
	          metadata: asMetadata(n.metadata),
	          source: "api" as const,
	        };
	      });

	    const localItems: DisplayNotif[] = localNotifs.map((n) => {
	      const timestamp = resolveTimestamp(n.createdAt);
	      return {
	        id: n.id,
	        title: n.title,
	        body: n.body,
	        type: isKnownType(n.type) ? n.type : "system",
	        isRead: n.isRead,
	        createdAt: n.createdAt ?? null,
	        timestamp,
	        source: "local" as const,
	      };
	    });

	    // Merge and sort newest first as a baseline; each group later puts unread
	    // items before read items while preserving recency.
	    return [...apiItems, ...localItems].sort(
	      (a, b) => b.timestamp - a.timestamp
	    );
	  }, [apiNotifs, apiReadIds, localNotifs]);

	  const grouped = React.useMemo(() => {
	    const sortGroup = (items: DisplayNotif[]) => [...items].sort((a, b) => {
	      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
	      return b.timestamp - a.timestamp;
	    });

	    return {
	      today: sortGroup(all.filter((n) => timelineGroup(n.timestamp) === "today")),
	      yesterday: sortGroup(all.filter((n) => timelineGroup(n.timestamp) === "yesterday")),
	      earlier: sortGroup(all.filter((n) => timelineGroup(n.timestamp) === "earlier")),
	    };
	  }, [all]);

	  const unreadCount = all.filter((n) => !n.isRead).length;

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
	              {grouped.today.length > 0 && (
	                <View style={styles.group}>
	                  <Text style={styles.groupLabel}>Today</Text>
	                  {grouped.today.map((n) => (
	                    <NotifItem key={n.id} notif={n} onPress={handlePress} />
	                  ))}
	                </View>
	              )}
	              {grouped.yesterday.length > 0 && (
	                <View style={styles.group}>
	                  <Text style={styles.groupLabel}>Yesterday</Text>
	                  {grouped.yesterday.map((n) => (
	                    <NotifItem key={n.id} notif={n} onPress={handlePress} />
	                  ))}
	                </View>
	              )}
	              {grouped.earlier.length > 0 && (
	                <View style={styles.group}>
	                  <Text style={styles.groupLabel}>Earlier</Text>
	                  {grouped.earlier.map((n) => (
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
  notifCardUnread: { borderColor: colors.studio.primary + "55", backgroundColor: "#001820" },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, position: "absolute", top: 14, left: 8 },
  notifIconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  notifContent: { flex: 1, gap: 6, minWidth: 0 },
  notifTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  notifTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flexShrink: 0 },
  notifBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  eventBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
  },
  metadataWrap: {
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "#1E2E38",
    paddingTop: 8,
    gap: 5,
  },
  metadataRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  metadataLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#6B7280",
    textTransform: "uppercase",
  },
  metadataValue: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#D1D5DB",
  },
});
