/**
 * Credit History — student's immutable credit ledger.
 *
 * Shows all credit transactions for the authenticated student.
 * Data sourced from GET /api/my/credits (student JWT scoped).
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

import { useGetMyCredits } from "@workspace/api-client-react";
import type { CreditTransaction } from "@workspace/api-client-react";
import colors from "@/constants/colors";

// ─── Transaction helpers ──────────────────────────────────────────────────────

function txLabel(type: string): string {
  switch (type) {
    case "package_activated":   return "Package Activated";
    case "attendance_deduction": return "Class Attended";
    case "manual_adjustment":   return "Manual Adjustment";
    case "package_bonus":       return "Bonus Credits";
    case "package_refund":      return "Refund";
    default:                    return type.replace(/_/g, " ");
  }
}

function txIcon(type: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (type) {
    case "package_activated":    return { name: "checkmark-circle",      color: "#22C55E" };
    case "attendance_deduction": return { name: "fitness",               color: "#EF4444" };
    case "manual_adjustment":    return { name: "settings",              color: "#3B82F6" };
    case "package_bonus":        return { name: "gift",                  color: "#8B5CF6" };
    case "package_refund":       return { name: "arrow-undo-circle",     color: "#22C55E" };
    default:                     return { name: "swap-horizontal",       color: "#9CA3AF" };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function TransactionRow({ tx }: { tx: CreditTransaction }) {
  const { name: iconName, color: iconColor } = txIcon(tx.type);
  const isPositive = tx.delta > 0;

  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + "20" }]}>
        <Ionicons name={iconName} size={18} color={iconColor} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{txLabel(tx.type)}</Text>
        {tx.notes ? <Text style={styles.rowNotes} numberOfLines={1}>{tx.notes}</Text> : null}
        <Text style={styles.rowDate}>{formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowDelta, { color: isPositive ? "#22C55E" : "#EF4444" }]}>
          {isPositive ? "+" : ""}{tx.delta}
        </Text>
        <Text style={styles.rowBalance}>{tx.balanceAfter} left</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

export default function CreditHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useGetMyCredits({ page, limit: PAGE_SIZE });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const transactions = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Credit History</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 40 : 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#00B6D7" />}
      >
        {total > 0 && (
          <View style={styles.totalRow}>
            <Ionicons name="layers-outline" size={14} color="#6B7280" />
            <Text style={styles.totalText}>{total} transaction{total !== 1 ? "s" : ""}</Text>
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
        ) : transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color="#4B5563" />
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyDesc}>Your credit history will appear here after you activate a package or attend a class</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}
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
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 54,
  },
  headerButtonText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: colors.studio.primary,
  },
  headerButtonPlaceholder: { minWidth: 54 },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 12 },
  totalText: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B747F" },
  list: { backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14.5, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  rowNotes: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  rowDate: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B747F" },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowDelta: { fontSize: 15, fontFamily: "Archivo_800ExtraBold" },
  rowBalance: { fontSize: 11.5, fontFamily: "Archivo_400Regular", color: "#6B747F" },
  loadMoreBtn: {
    alignItems: "center",
    paddingVertical: 14,
  },
  loadMoreText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#00B6D7" },
  loadingState: { gap: 4 },
  skeletonRow: { height: 62, backgroundColor: "#15171B", borderRadius: 12, marginBottom: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 80 },
  emptyTitle: { fontSize: 16, fontFamily: "Archivo_600SemiBold", color: "#9CA3AF" },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B747F", textAlign: "center", maxWidth: 260 },
});
