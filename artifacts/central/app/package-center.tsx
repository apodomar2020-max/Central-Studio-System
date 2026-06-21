/**
 * Package Center — full student package history with credit details.
 *
 * Uses the secure /api/my/packages endpoint (student JWT scoped) rather than
 * the old insecure pattern of fetching all orders and filtering client-side.
 */
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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

import { useGetMyPackages } from "@workspace/api-client-react";
import type { PackageOrder } from "@workspace/api-client-react";
import colors from "@/constants/colors";

// ─── Status helpers ──────────────────────────────────────────────────────────

function statusLabel(pkg: PackageOrder): string {
  if (pkg.status === "fullyUsed") return "Exhausted";
  if (pkg.status === "active") {
    if (pkg.expiresAt && new Date(pkg.expiresAt) < new Date()) return "Expired";
    return "Active";
  }
  if (pkg.status === "pendingPayment") return "Pending Activation";
  if (pkg.status === "cancelled") return "Cancelled";
  return pkg.status;
}

function statusColor(pkg: PackageOrder): string {
  const label = statusLabel(pkg);
  if (label === "Active") return "#22C55E";
  if (label === "Expired") return "#F59E0B";
  if (label === "Pending Activation") return "#3B82F6";
  if (label === "Exhausted") return "#EF4444";
  return "#6B7280";
}

function usedCredits(pkg: PackageOrder): number {
  return pkg.totalCredits - pkg.remainingCredits;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Package card ─────────────────────────────────────────────────────────────

function PackageDetailCard({ pkg }: { pkg: PackageOrder }) {
  const label = statusLabel(pkg);
  const color = statusColor(pkg);
  const used = usedCredits(pkg);
  const progress = pkg.totalCredits > 0 ? pkg.remainingCredits / pkg.totalCredits : 0;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.packageName} numberOfLines={2}>{pkg.packageName}</Text>
          <Text style={styles.packageId}>Order #{pkg.id}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: color + "20", borderColor: color + "40" }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.statusText, { color }]}>{label}</Text>
        </View>
      </View>

      {/* Credits progress */}
      <View style={styles.creditsSection}>
        <View style={styles.creditsSummary}>
          <View style={styles.creditItem}>
            <Text style={[styles.creditValue, { color: "#22C55E" }]}>{pkg.remainingCredits}</Text>
            <Text style={styles.creditLabel}>Remaining</Text>
          </View>
          <View style={styles.creditDivider} />
          <View style={styles.creditItem}>
            <Text style={[styles.creditValue, { color: "#F59E0B" }]}>{used}</Text>
            <Text style={styles.creditLabel}>Used</Text>
          </View>
          <View style={styles.creditDivider} />
          <View style={styles.creditItem}>
            <Text style={[styles.creditValue, { color: "#9CA3AF" }]}>{pkg.totalCredits}</Text>
            <Text style={styles.creditLabel}>Total</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <LinearGradient
            colors={["#22C55E", "#16A34A"]}
            style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </View>
        <Text style={styles.progressLabel}>
          {Math.round(progress * 100)}% remaining
        </Text>
      </View>

      {/* Dates */}
      <View style={styles.datesRow}>
        <View style={styles.dateItem}>
          <Text style={styles.dateLabel}>Purchased</Text>
          <Text style={styles.dateValue}>{formatDate(pkg.createdAt)}</Text>
        </View>
        {pkg.activatedAt && (
          <View style={styles.dateItem}>
            <Text style={styles.dateLabel}>Activated</Text>
            <Text style={styles.dateValue}>{formatDate(pkg.activatedAt)}</Text>
          </View>
        )}
        <View style={styles.dateItem}>
          <Text style={styles.dateLabel}>Expires</Text>
          <Text style={[styles.dateValue, !pkg.expiresAt && { color: "#4B5563" }]}>
            {pkg.expiresAt ? formatDate(pkg.expiresAt) : "No expiry"}
          </Text>
        </View>
      </View>

      {pkg.notes ? (
        <View style={styles.notesRow}>
          <Ionicons name="document-text-outline" size={13} color="#6B7280" />
          <Text style={styles.notesText} numberOfLines={2}>{pkg.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PackageCenterScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useGetMyPackages();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const packages = data ?? [];

  // Split by status groups
  const active = packages.filter((p) => p.status === "active" && (!p.expiresAt || new Date(p.expiresAt) >= new Date()));
  const pending = packages.filter((p) => p.status === "pendingPayment");
  const past = packages.filter((p) => !active.includes(p) && !pending.includes(p));

  function renderGroup(title: string, items: PackageOrder[], accent: string) {
    if (items.length === 0) return null;
    return (
      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Text style={[styles.groupTitle, { color: accent }]}>{title}</Text>
          <Text style={styles.groupCount}>{items.length}</Text>
        </View>
        {items.map((pkg) => <PackageDetailCard key={pkg.id} pkg={pkg} />)}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Package Center</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 40 : 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#00B6D7" />}
      >
        {isLoading && !refreshing ? (
          <View style={styles.loadingState}>
            {[1, 2].map((i) => <View key={i} style={styles.skeletonCard} />)}
          </View>
        ) : isError ? (
          <View style={styles.emptyState}>
            <Ionicons name="alert-circle-outline" size={40} color="#EF4444" />
            <Text style={styles.emptyTitle}>Couldn't load packages</Text>
            <Text style={styles.emptyDesc}>Pull down to try again</Text>
          </View>
        ) : packages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="card-outline" size={48} color="#4B5563" />
            <Text style={styles.emptyTitle}>No packages yet</Text>
            <Text style={styles.emptyDesc}>Browse and purchase a class package to get started</Text>
          </View>
        ) : (
          <>
            {renderGroup("Active", active, "#22C55E")}
            {renderGroup("Pending Activation", pending, "#3B82F6")}
            {renderGroup("Past Packages", past, "#6B7280")}
          </>
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
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  group: { marginBottom: 24 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  groupTitle: { fontSize: 11, fontFamily: "SpaceMono_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  groupCount: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#6B747F", backgroundColor: "#15171B", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  card: {
    backgroundColor: "#15171B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  packageName: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF", lineHeight: 22 },
  packageId: { fontSize: 11, fontFamily: "Archivo_400Regular", color: "#6B747F", marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Archivo_700Bold" },
  creditsSection: { gap: 8 },
  creditsSummary: { flexDirection: "row", alignItems: "center" },
  creditItem: { flex: 1, alignItems: "center" },
  creditValue: { fontSize: 24, fontFamily: "Anton_400Regular" },
  creditLabel: { fontSize: 11, fontFamily: "Archivo_400Regular", color: "#9CA3AF", marginTop: 2 },
  creditDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.08)" },
  progressTrack: { height: 7, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  progressLabel: { fontSize: 11, fontFamily: "Archivo_400Regular", color: "#6B747F", textAlign: "right" },
  datesRow: { flexDirection: "row", gap: 8 },
  dateItem: { flex: 1, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10, gap: 3 },
  dateLabel: { fontSize: 10, fontFamily: "SpaceMono_700Bold", color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.5 },
  dateValue: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  notesRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  notesText: { flex: 1, fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B747F", lineHeight: 16 },
  loadingState: { gap: 12 },
  skeletonCard: { height: 220, backgroundColor: "#15171B", borderRadius: 16 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 80 },
  emptyTitle: { fontSize: 16, fontFamily: "Archivo_600SemiBold", color: "#9CA3AF" },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B747F", textAlign: "center" },
});
