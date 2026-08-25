import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import CentralBackButton from "@/components/CentralBackButton";
import { customFetch } from "@workspace/api-client-react";
import type { Notification as ApiNotification } from "@workspace/api-client-react";

import { ChildProfile, useAppContext } from "@/contexts/AppContext";
import { formatRelativeOrCalendarTime, parseApiDate } from "@/utils/dateTime";
import { registerPushNotificationsForCurrentUser } from "@/services/pushNotifications";

const HERO_IMAGE = require("@/assets/images/notifications-hero.png");

type NotifType = "booking_created" | "booking_confirmed" | "booking_cancelled" | "booking_rejected" | "payment_paid" | "payment_failed" | "payment_refunded" | "package_created" | "package_activated" | "package_cancelled" | "package_credits_updated" | "credits_exhausted" | "attendance_checked_in" | "offer_published" | "schedule_changed" | "schedule_cancelled" | "booking" | "class_reminder" | "package" | "ballet" | "offer" | "system";
type ApiItem = ApiNotification & { type?: string | null; metadata?: Record<string, unknown> | null; isRead?: boolean; readAt?: string | null; sent_at?: string | null; created_at?: string | null };
type DisplayNotif = { id: string; title: string; body: string; type: NotifType; isRead: boolean; timestamp: number | null; source: "api" | "local"; metadata?: Record<string, unknown> | null };

const TYPE_STYLE: Record<NotifType, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  booking_confirmed: { color: "#22C55E", icon: "checkmark" }, payment_paid: { color: "#22C55E", icon: "checkmark" }, package_activated: { color: "#22C55E", icon: "checkmark" }, attendance_checked_in: { color: "#22C55E", icon: "checkmark" },
  booking_cancelled: { color: "#FF3030", icon: "close" }, booking_rejected: { color: "#FF3030", icon: "close" }, payment_failed: { color: "#FF3030", icon: "close" }, package_cancelled: { color: "#FF3030", icon: "close" }, schedule_cancelled: { color: "#FF3030", icon: "close" },
  class_reminder: { color: "#FFB800", icon: "warning" }, credits_exhausted: { color: "#FFB800", icon: "warning" }, schedule_changed: { color: "#FFB800", icon: "warning" }, package_credits_updated: { color: "#FFB800", icon: "warning" },
  booking_created: { color: "#03B6D7", icon: "information" }, payment_refunded: { color: "#03B6D7", icon: "information" }, package_created: { color: "#03B6D7", icon: "information" }, offer_published: { color: "#03B6D7", icon: "information" }, booking: { color: "#03B6D7", icon: "information" }, package: { color: "#03B6D7", icon: "information" }, ballet: { color: "#03B6D7", icon: "information" }, offer: { color: "#03B6D7", icon: "information" }, system: { color: "#03B6D7", icon: "information" },
};


function isKnownType(value: unknown): value is NotifType { return typeof value === "string" && value in TYPE_STYLE; }
function timestamp(...values: Array<string | null | undefined>) { for (const value of values) { const parsed = parseApiDate(value)?.getTime(); if (parsed != null) return parsed; } return null; }
function inferType(item: Pick<ApiItem, "title" | "body" | "type">): NotifType { if (isKnownType(item.type)) return item.type; const text = `${item.title} ${item.body}`.toLowerCase(); if (text.includes("cancel") || text.includes("reject") || text.includes("fail") || text.includes("absent")) return "booking_cancelled"; if (text.includes("confirm") || text.includes("accept") || text.includes("approved") || text.includes("checked")) return "booking_confirmed"; if (text.includes("remind") || text.includes("credit")) return "class_reminder"; return "system"; }
function groupFor(time: number | null) { if (!time) return "earlier"; const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); const day = new Date(new Date(time).getFullYear(), new Date(time).getMonth(), new Date(time).getDate()).getTime(); return day === today ? "today" : day === today - 86400000 ? "yesterday" : "earlier"; }

function metadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) { const value = metadata?.[key]; if (typeof value === "string" && value.trim()) return value.trim(); }
  return null;
}

function notificationRecipient(notif: DisplayNotif, children: ChildProfile[], accountAvatar?: string) {
  const childId = metadataString(notif.metadata, "childId", "participantChildId", "studentId");
  const childName = metadataString(notif.metadata, "childName", "participantName", "studentName");
  const child = children.find((item) => (childId && item.id === childId) || (childName && item.fullName.trim().toLowerCase() === childName.toLowerCase()));
  const photoUrl = metadataString(notif.metadata, "childPhotoUrl", "childAvatarUrl", "photoUrl", "avatarUrl");
  if (child || childName) return { imageUrl: photoUrl, initial: (child?.fullName ?? childName ?? "?").trim().charAt(0).toUpperCase(), isChild: true };
  return { imageUrl: accountAvatar, initial: "", isChild: false };
}

function NotificationCard({ notif, avatarUrl, children, onRead }: { notif: DisplayNotif; avatarUrl?: string | null; children: ChildProfile[]; onRead: (item: DisplayNotif) => void }) {
  const [expanded, setExpanded] = useState(false); const state = TYPE_STYLE[notif.type] ?? TYPE_STYLE.system;
  const recipient = notificationRecipient(notif, children, avatarUrl ?? undefined);
  const toggle = () => { if (!notif.isRead) onRead(notif); setExpanded((current) => !current); };
  return <TouchableOpacity style={[styles.card, !notif.isRead && styles.cardUnread]} activeOpacity={0.85} onPress={toggle}>
    <View style={styles.avatarWrap}>{recipient.imageUrl ? <Image source={{ uri: recipient.imageUrl }} style={styles.avatar} contentFit="cover" /> : recipient.isChild ? <Text style={styles.childInitial}>{recipient.initial}</Text> : <Ionicons name="person" color="#9BA4A5" size={25} />}<View style={[styles.statusIcon, { backgroundColor: state.color }]}><Ionicons name={state.icon} color="#FFFFFF" size={11} /></View></View>
    <View style={styles.cardCopy}><Text style={[styles.cardTitle, { color: state.color }]} numberOfLines={expanded ? undefined : 1}>{notif.title}</Text><Text style={[styles.cardBody, expanded && styles.cardBodyExpanded]} numberOfLines={expanded ? undefined : 2}>{notif.body}</Text><Text style={styles.cardTime}>{formatRelativeOrCalendarTime(notif.timestamp, "")}</Text></View>
    <View style={[styles.cardChevron, expanded && styles.cardChevronOpen]}><Ionicons name="chevron-down" color="#FFFFFF" size={22} /></View>
  </TouchableOpacity>;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets(); const { notifications: localNotifs, markNotificationRead, user, children } = useAppContext();
  const [apiNotifs, setApiNotifs] = useState<ApiItem[]>([]); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [permissionGranted, setPermissionGranted] = useState(true); const [askingPermission, setAskingPermission] = useState(false);
  const load = useCallback(async (refresh = false) => { refresh ? setRefreshing(true) : setLoading(true); try { setApiNotifs(await customFetch<ApiItem[]>("/api/notifications/my?limit=50&offset=0")); } catch { /* local notifications remain available */ } finally { setLoading(false); setRefreshing(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (Platform.OS === "web") return; Notifications.getPermissionsAsync().then((result) => setPermissionGranted(result.granted)).catch(() => setPermissionGranted(true)); }, []);
  const all = useMemo<DisplayNotif[]>(() => [...apiNotifs.filter((item) => !item.isDraft).map((item) => ({ id: `api-${item.id}`, title: item.title, body: item.body, type: inferType(item), isRead: Boolean(item.isRead), timestamp: timestamp(item.sentAt, item.createdAt, item.sent_at, item.created_at), metadata: item.metadata, source: "api" as const })), ...localNotifs.map((item) => ({ id: item.id, title: item.title, body: item.body, type: isKnownType(item.type) ? item.type : "system", isRead: item.isRead, timestamp: timestamp(item.createdAt), source: "local" as const }))].sort((a, b) => Number(a.isRead) - Number(b.isRead) || (b.timestamp ?? 0) - (a.timestamp ?? 0)), [apiNotifs, localNotifs]);
  const groups = useMemo(() => ({ today: all.filter((item) => groupFor(item.timestamp) === "today"), yesterday: all.filter((item) => groupFor(item.timestamp) === "yesterday"), earlier: all.filter((item) => groupFor(item.timestamp) === "earlier") }), [all]);
  const markRead = useCallback(async (item: DisplayNotif) => { if (item.isRead) return; if (item.source === "local") { markNotificationRead(item.id); return; } const id = Number(item.id.replace("api-", "")); setApiNotifs((items) => items.map((entry) => entry.id === id ? { ...entry, isRead: true } : entry)); try { await customFetch(`/api/notifications/${id}/read`, { method: "POST" }); } catch { void load(true); } }, [load, markNotificationRead]);
  const markAll = async () => { await Promise.all(all.filter((item) => !item.isRead).map(markRead)); };
  const enableNotifications = async () => { setAskingPermission(true); try { const result = await Notifications.requestPermissionsAsync(); setPermissionGranted(result.granted); if (result.granted) await registerPushNotificationsForCurrentUser(); } finally { setAskingPermission(false); } };
  const renderGroup = (label: string, items: DisplayNotif[]) => items.length ? <View style={styles.group}><View style={styles.groupHeader}><Text style={styles.groupTitle}>{label}</Text><TouchableOpacity onPress={() => void markAll()}><Text style={styles.markAll}>Mark All As Read</Text></TouchableOpacity></View>{items.map((item) => <NotificationCard key={item.id} notif={item} avatarUrl={user?.avatarUrl} children={children} onRead={markRead} />)}</View> : null;

  return <View style={styles.container}>
    <View style={[styles.hero, { paddingTop: Platform.OS === "web" ? 18 : insets.top + 10 }]}><CentralBackButton style={styles.backButton} /><Text style={styles.heroTitle}>Notifications</Text><Image source={HERO_IMAGE} style={styles.heroImage} contentFit="contain" /></View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#03B6D7" />}>
      {!permissionGranted ? <View style={styles.permissionCard}><View style={styles.bell}><Ionicons name="notifications" size={31} color="#03B6D7" /></View><View style={styles.permissionCopy}><Text style={styles.permissionTitle}>Turn On The Notification</Text><Text style={styles.permissionText}>Get notification working to remind you the classes and more our updates of the app and the offers</Text></View><TouchableOpacity style={styles.setNow} onPress={() => void enableNotifications()} disabled={askingPermission}><Text style={styles.setNowText}>{askingPermission ? "Setting..." : "Set Now"}</Text></TouchableOpacity></View> : null}
      {loading && all.length === 0 ? <View style={styles.loading}><ActivityIndicator color="#03B6D7" /></View> : all.length === 0 ? <View style={styles.empty}><Ionicons name="notifications-off-outline" color="#718080" size={46} /><Text style={styles.emptyText}>No notifications yet</Text></View> : <>{renderGroup("Today", groups.today)}{renderGroup("Yesterday", groups.yesterday)}{renderGroup("Earlier", groups.earlier)}</>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0D1110" }, hero: { height: 127, backgroundColor: "#08B4D3", borderBottomLeftRadius: 31, borderBottomRightRadius: 31, position: "relative" }, backButton: { position: "absolute", left: 16, top: Platform.OS === "web" ? 19 : 54, zIndex: 2 }, heroTitle: { textAlign: "center", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 29, textTransform: "uppercase" }, heroImage: { position: "absolute", right: 22, bottom: -13, width: 112, height: 95 },
  scroll: { paddingHorizontal: 19, paddingTop: 18, paddingBottom: Platform.OS === "web" ? 45 : 32 }, permissionCard: { minHeight: 126, borderRadius: 10, backgroundColor: "#FFFFFF", padding: 15, flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 4, marginBottom: 16 }, bell: { width: 65, alignItems: "center" }, permissionCopy: { flex: 1, paddingRight: 4 }, permissionTitle: { color: "#03B6D7", fontFamily: "Anton_400Regular", fontSize: 14, lineHeight: 17, textTransform: "uppercase" }, permissionText: { color: "#03B6D7", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 11, marginTop: 4 }, setNow: { width: "100%", height: 28, marginTop: 9, borderRadius: 16, backgroundColor: "#03B6D7", alignItems: "center", justifyContent: "center" }, setNowText: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 11 },
  group: { gap: 6, marginBottom: 21 }, groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }, groupTitle: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 16 }, markAll: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 10, textDecorationLine: "underline" }, card: { minHeight: 87, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, gap: 10 }, cardUnread: { backgroundColor: "#093438" }, avatarWrap: { width: 49, height: 49, borderRadius: 25, backgroundColor: "#172020", alignItems: "center", justifyContent: "center" }, avatar: { width: 49, height: 49, borderRadius: 25 }, childInitial: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 28 }, statusIcon: { width: 21, height: 21, borderRadius: 11, position: "absolute", right: -4, bottom: -2, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#0D1110" }, cardCopy: { flex: 1, minWidth: 0 }, cardTitle: { fontFamily: "Archivo_700Bold", fontSize: 16, lineHeight: 19 }, cardBody: { color: "#A9B3B3", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 15, marginTop: 3 }, cardBodyExpanded: { marginTop: 7 }, cardTime: { color: "#CFD5D5", fontFamily: "Archivo_400Regular", fontSize: 11, lineHeight: 13, marginTop: 1 }, cardChevron: { width: 20, alignItems: "center" }, cardChevronOpen: { transform: [{ rotate: "180deg" }] }, loading: { height: 190, alignItems: "center", justifyContent: "center" }, empty: { alignItems: "center", paddingTop: 120, gap: 12 }, emptyText: { color: "#FFFFFF", fontFamily: "Archivo_600SemiBold", fontSize: 15 },
});
