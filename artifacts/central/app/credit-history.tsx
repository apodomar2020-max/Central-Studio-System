/**
 * Credit History — student's immutable credit ledger (design parity:
 * home-profile-pages.jsx CreditHistory).
 *
 * Data: GET /api/my/credits (ledger, student-scoped) + GET /api/my/packages
 * (for the "Available Credits" hero). Nothing faked.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useGetMyCredits, useGetMyPackages } from "@workspace/api-client-react";
import type { CreditTransaction, PackageOrder } from "@workspace/api-client-react";
import { formatApiDate, parseApiDate } from "@/utils/dateTime";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

// Design tokens
const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const SUCCESS = "#1FB871";
const DANGER = "#FF3B47";
const INK_300 = "#8E97A2";
const INK_400 = "#6B747F";
const INK_500 = "#565E68";
const INK_800 = "#15171B";

type Category = "added" | "used" | "refunded" | "expired";
type Filter = "all" | Category;

// Derive a design category from the ledger transaction (robust to exact type names).
function txCategory(tx: CreditTransaction): Category {
  if (tx.type === "package_refund") return "refunded";
  if (tx.type.includes("expired")) return "expired";
  return tx.delta > 0 ? "added" : "used";
}

function catIcon(cat: Category): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (cat) {
    case "added":    return { name: "arrow-up",        color: SUCCESS };
    case "used":     return { name: "arrow-down",      color: DANGER };
    case "refunded": return { name: "arrow-undo",      color: CYAN_400 };
    case "expired":  return { name: "close",           color: INK_400 };
  }
}

function txLabel(tx: CreditTransaction): string {
  // For attendance deductions, prefer the resolved class name (backend) so the row
  // reads as the class, not a raw note like "QR check-in for booking #29".
  if (tx.type === "attendance_deduction") {
    return tx.className || "Class Attended";
  }
  if (tx.notes) return tx.notes;
  switch (tx.type) {
    case "package_activated":    return "Package Activated";
    case "manual_adjustment":    return "Manual Adjustment";
    case "package_bonus":        return "Bonus Credits";
    case "package_refund":       return "Refund";
    default:                     return tx.type.replace(/_/g, " ");
  }
}

function fmtDate(iso?: string | null, withYear = false): string {
  return formatApiDate(iso, "—", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

function pkgExpiry(pkg?: PackageOrder): string {
  if (!pkg) return "";
  if (pkg.expiresAt) return `Expires ${fmtDate(pkg.expiresAt, true)}`;
  if (!pkg.activatedAt) return "Expiry starts after activation";
  return "No expiry";
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "added", label: "Added" },
  { key: "used", label: "Used" },
  { key: "refunded", label: "Refunded" },
  { key: "expired", label: "Expired" },
];

function TransactionRow({ tx, last }: { tx: CreditTransaction; last: boolean }) {
  const cat = txCategory(tx);
  const { name, color } = catIcon(cat);
  const positive = tx.delta > 0;
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <View style={styles.rowIcon}>
        <Ionicons name={name} size={17} color={color} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} numberOfLines={1}>{txLabel(tx)}</Text>
        <Text style={styles.rowDate}>{fmtDate(tx.createdAt)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowDelta, { color }]}>{positive ? `+${tx.delta}` : `${tx.delta}`}</Text>
        <Text style={styles.rowBalance}>bal {tx.balanceAfter}</Text>
      </View>
    </View>
  );
}

const PAGE_SIZE = 30;

export default function CreditHistoryScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");

  const { data, isLoading, isError, refetch } = useGetMyCredits({ page, limit: PAGE_SIZE });
  const { data: packages, refetch: refetchPackages } = useGetMyPackages();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    await Promise.all([refetch(), refetchPackages()]);
    setRefreshing(false);
  }, [refetch, refetchPackages]);

  const transactions = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  // Available Credits hero: sum of remaining credits across active packages.
  // Use parseApiDate for the expiry check — a raw `new Date(p.expiresAt)` would be
  // Invalid Date on Hermes and wrongly drop active packages (undercounting credits).
  const activePackages = useMemo(
    () => (packages ?? []).filter((p) => {
      if (p.status !== "active") return false;
      const exp = parseApiDate(p.expiresAt);
      return !exp || exp >= new Date();
    }),
    [packages],
  );
  const availableCredits = useMemo(() => activePackages.reduce((s, p) => s + p.remainingCredits, 0), [activePackages]);
  const heroPkg = activePackages[0];

  const visible = useMemo(
    () => (filter === "all" ? transactions : transactions.filter((t) => txCategory(t) === filter)),
    [transactions, filter],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 12 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={CYAN} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Credit History</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 40 : insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={CYAN} colors={[CYAN]} />}
      >
        {/* Available Credits hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>AVAILABLE CREDITS</Text>
          <Text style={styles.heroNumber}>{availableCredits}</Text>
          <Text style={styles.heroSub}>
            {heroPkg ? `${heroPkg.packageName}${pkgExpiry(heroPkg) ? ` · ${pkgExpiry(heroPkg)}` : ""}` : "No active package"}
          </Text>
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, on && styles.chipOn]} activeOpacity={0.85}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {isLoading && !refreshing ? (
          <View style={styles.loadingState}>
            {[1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.skeletonRow} />)}
          </View>
        ) : isError ? (
          <View style={styles.emptyState}>
            <Ionicons name="alert-circle-outline" size={40} color={DANGER} />
            <Text style={styles.emptyTitle}>Couldn't load history</Text>
            <Text style={styles.emptyDesc}>Pull down to try again</Text>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="receipt-outline" size={48} color="#4B5563" />
            <Text style={styles.emptyTitle}>{filter === "all" ? "No transactions yet" : "Nothing here"}</Text>
            <Text style={styles.emptyDesc}>
              {filter === "all"
                ? "Your credit history will appear here after you activate a package or attend a class"
                : "No transactions match this filter."}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {visible.map((tx, i) => <TransactionRow key={tx.id} tx={tx} last={i === visible.length - 1 && !hasMore} />)}
            {hasMore && filter === "all" && (
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 54 },
  headerButtonText: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: CYAN },
  headerButtonPlaceholder: { minWidth: 54 },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 18 },

  // Available Credits hero (design parity)
  hero: {
    borderRadius: 16, padding: 18, marginBottom: 20, alignItems: "center",
    backgroundColor: "rgba(0,182,215,0.10)",
    borderWidth: 1, borderColor: "rgba(0,182,215,0.35)",
  },
  heroEyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: CYAN_400, marginBottom: 6 },
  heroNumber: { fontFamily: "Anton_400Regular", fontSize: 56, lineHeight: 52, ...iosDisplayTextStyle(56, 52), color: "#FFFFFF", marginBottom: -iosCapGuard(56, 52) },
  heroSub: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK_300, marginTop: 8, textAlign: "center" },

  // Filter chips
  chipsRow: { gap: 8, paddingBottom: 16 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)",
  },
  chipOn: { backgroundColor: "#0A0B0D", borderColor: "rgba(255,255,255,0.3)" },
  chipText: { fontFamily: "Archivo_700Bold", fontSize: 12.5, color: INK_400 },
  chipTextOn: { color: "#FFFFFF" },

  // Transactions card
  list: { backgroundColor: INK_800, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14.5, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  rowDate: { fontSize: 12, fontFamily: "Archivo_400Regular", color: INK_400 },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowDelta: { fontSize: 15, fontFamily: "Archivo_800ExtraBold" },
  rowBalance: { fontSize: 11.5, fontFamily: "Archivo_400Regular", color: INK_500 },

  loadMoreBtn: { alignItems: "center", paddingVertical: 14 },
  loadMoreText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: CYAN },
  loadingState: { gap: 4 },
  skeletonRow: { height: 62, backgroundColor: INK_800, borderRadius: 12, marginBottom: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 70 },
  emptyTitle: { fontSize: 16, fontFamily: "Archivo_600SemiBold", color: "#9CA3AF" },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_400, textAlign: "center", maxWidth: 260 },
});
