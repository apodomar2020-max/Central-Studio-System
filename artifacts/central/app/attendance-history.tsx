/**
 * Attendance History — student's full class attendance record.
 *
 * Shows class name, instructor (resolved via server-side JOIN), date, time,
 * and status for every check-in. Data sourced from GET /api/my/attendance
 * (student JWT scoped).
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useGetMyAttendance } from "@workspace/api-client-react";
import type { MyAttendanceRecord } from "@workspace/api-client-react";
import colors from "@/constants/colors";

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusLabel(status?: string | null): string {
  switch (status) {
    case "checked_in": return "Checked In";
    case "late":       return "Late";
    case "absent":     return "Absent";
    case "cancelled":  return "Cancelled";
    default:           return "Checked In";
  }
}

function statusConfig(status?: string | null): { color: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (status) {
    case "checked_in": return { color: "#22C55E", icon: "checkmark-circle" };
    case "late":       return { color: "#F59E0B", icon: "time" };
    case "absent":     return { color: "#EF4444", icon: "close-circle" };
    case "cancelled":  return { color: "#6B7280", icon: "ban" };
    default:           return { color: "#22C55E", icon: "checkmark-circle" };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Attendance row ───────────────────────────────────────────────────────────

function AttendanceRow({ record }: { record: MyAttendanceRecord }) {
  const { color, icon } = statusConfig(record.status);

  return (
    <View style={styles.row}>
      <View style={[styles.rowIconWrap, { backgroundColor: color + "20" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.className} numberOfLines={1}>
          {record.classTitle ?? "Class"}
        </Text>
        {record.instructorName ? (
          <Text style={styles.instructor} numberOfLines={1}>
            <Ionicons name="person-outline" size={11} color="#6B7280" /> {record.instructorName}
          </Text>
        ) : null}
        <Text style={styles.datetime}>
          {formatDate(record.checkedInAt)} · {formatTime(record.checkedInAt)}
        </Text>
      </View>

      <View style={styles.rowRight}>
        <View style={[styles.statusBadge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
          <Text style={[styles.statusText, { color }]}>{statusLabel(record.status)}</Text>
        </View>
        {record.creditDeducted && (
          <Text style={styles.creditDeducted}>−1 credit</Text>
        )}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

export default function AttendanceHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useGetMyAttendance({ page, limit: PAGE_SIZE });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const records = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Attendance History</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 40 : 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#00B6D7" />}
      >
        {total > 0 && (
          <View style={styles.totalRow}>
            <Ionicons name="barbell-outline" size={14} color="#6B7280" />
            <Text style={styles.totalText}>{total} class{total !== 1 ? "es" : ""} attended</Text>
          </View>
        )}

        {isLoading && !refreshing ? (
          <View style={styles.loadingState}>
            {[1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.skeletonRow} />)}
          </View>
        ) : isError ? (
          <View style={styles.emptyState}>
            <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
            <Text style={styles.emptyTitle}>Couldn't load history</Text>
            <Text style={styles.emptyDesc}>Pull down to try again</Text>
          </View>
        ) : records.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="barbell-outline" size={48} color="#4B5563" />
            <Text style={styles.emptyTitle}>No classes attended yet</Text>
            <Text style={styles.emptyDesc}>Your attendance history will appear here after your first check-in</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {records.map((r) => <AttendanceRow key={r.id} record={r} />)}
            {hasMore && (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setPage((p) => p + 1)}>
                <Text style={styles.loadMoreText}>Load more</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E2E38",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 16, paddingTop: 12 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12 },
  totalText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  list: { gap: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
  },
  rowIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 3 },
  className: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  instructor: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  datetime: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#4B5563" },
  rowRight: { alignItems: "flex-end", gap: 4 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  creditDeducted: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  loadMoreBtn: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  loadMoreText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#00B6D7" },
  loadingState: { gap: 4 },
  skeletonRow: { height: 66, backgroundColor: "#1E2E38", borderRadius: 12, marginBottom: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 80 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563", textAlign: "center", maxWidth: 260 },
});
