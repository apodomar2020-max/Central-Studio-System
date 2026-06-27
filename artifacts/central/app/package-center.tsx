/**
 * Package Center — student package history (design: PackageCenter).
 *
 * Active-package hero card + Active/Past tabs + package list. Uses the secure
 * /api/my/packages endpoint (student JWT scoped). All values are real
 * (packageName, credits, dates, status) — nothing faked.
 */
import { LinearGradient } from "expo-linear-gradient";
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

import { useGetMyPackages } from "@workspace/api-client-react";
import type { PackageOrder } from "@workspace/api-client-react";
import SBI from "@/components/SbIcon";

const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const SUCCESS = "#1FB871";
const INK_300 = "#8E97A2";
const INK_400 = "#6B747F";
const INK_800 = "#15171B";
const BORDER = "rgba(255,255,255,0.08)";

// ─── Status helpers (real data) ──────────────────────────────────────────────
function statusLabel(pkg: PackageOrder): string {
  if (pkg.status === "fullyUsed") return "Exhausted";
  if (pkg.status === "active") {
    if (pkg.expiresAt && new Date(pkg.expiresAt) < new Date()) return "Expired";
    return "Active";
  }
  if (pkg.status === "pendingPayment") return "Pending";
  if (pkg.status === "cancelled") return "Cancelled";
  return pkg.status;
}
function statusColor(label: string): string {
  if (label === "Active") return SUCCESS;
  if (label === "Expired") return "#FFB02E";
  if (label === "Pending") return "#3B82F6";
  if (label === "Exhausted") return "#FF3B47";
  return INK_400;
}
function isActivePkg(p: PackageOrder): boolean {
  return p.status === "active" && (!p.expiresAt || new Date(p.expiresAt) >= new Date());
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Expiry label. Validity starts at Admin activation (expiresAt = activatedAt +
// validityMonths). So:
//   • expiresAt set        → the real date
//   • not yet activated    → "Expiry starts after activation"
//   • activated, no expiry → "No expiry" (genuinely unlimited / no validity months)
function expiryText(pkg: PackageOrder): string {
  if (pkg.expiresAt) return `Expires ${fmtDate(pkg.expiresAt)}`;
  if (!pkg.activatedAt) return "Expiry starts after activation";
  return "No expiry";
}

// ─── Package list card (design parity) ───────────────────────────────────────
function PackageCard({ pkg }: { pkg: PackageOrder }) {
  const label = statusLabel(pkg);
  const color = statusColor(label);
  const remaining = label === "Active" ? pkg.remainingCredits : 0;
  const pct = pkg.totalCredits > 0 ? Math.round((remaining / pkg.totalCredits) * 100) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>{pkg.packageName}</Text>
          <Text style={styles.cardSub}>{pkg.totalCredits} classes · Order #{pkg.id}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: label === "Active" ? "rgba(31,184,113,0.16)" : "rgba(255,255,255,0.06)" }]}>
          <Text style={[styles.statusPillText, { color }]}>{label}</Text>
        </View>
      </View>
      <Text style={styles.cardDates}>Purchased {fmtDate(pkg.createdAt)} · {expiryText(pkg)}</Text>
      <View style={styles.barTrack}>
        <LinearGradient colors={[CYAN, CYAN_400]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function PackageCenterScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"active" | "past">("active");
  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;

  const { data, isLoading, isError, refetch } = useGetMyPackages();
  const packages = useMemo(() => data ?? [], [data]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const activeList = useMemo(() => packages.filter((p) => isActivePkg(p) || p.status === "pendingPayment"), [packages]);
  const pastList = useMemo(() => packages.filter((p) => !isActivePkg(p) && p.status !== "pendingPayment"), [packages]);
  const hero = useMemo(() => packages.find((p) => isActivePkg(p)), [packages]);
  const list = tab === "active" ? activeList : pastList;

  const heroPct = hero && hero.totalCredits > 0 ? Math.round((hero.remainingCredits / hero.totalCredits) * 100) : 0;
  const heroUsed = hero ? hero.totalCredits - hero.remainingCredits : 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.85}>
          <SBI name="back" size={18} stroke={2.2} color={CYAN} />
          <Text style={styles.headerBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Package Center</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={CYAN} colors={[CYAN]} />}
      >
        {isLoading && !refreshing ? (
          <View style={{ gap: 12 }}>{[1, 2].map((i) => <View key={i} style={styles.skeleton} />)}</View>
        ) : isError ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Couldn't load packages</Text>
            <Text style={styles.emptyDesc}>Pull down to try again</Text>
          </View>
        ) : packages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><SBI name="cal" size={30} stroke={1.6} color={CYAN} /></View>
            <Text style={styles.emptyTitle}>No packages yet</Text>
            <Text style={styles.emptyDesc}>Browse and purchase a class package to get started</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/packages" as any)} style={styles.emptyBtn} activeOpacity={0.88}>
              <Text style={styles.emptyBtnText}>Browse Packages</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Active package hero */}
            {hero && (
              <LinearGradient
                colors={["rgba(0,182,215,0.16)", "rgba(0,182,215,0.10)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                <View style={styles.heroTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroEyebrow}>ACTIVE PACKAGE</Text>
                    <Text style={styles.heroName} numberOfLines={1}>{hero.packageName}</Text>
                    <Text style={styles.heroSub}>{hero.totalCredits} classes · {expiryText(hero)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.heroCredits}>{hero.remainingCredits}</Text>
                    <Text style={styles.heroCreditsLabel}>credits left</Text>
                  </View>
                </View>
                <View style={styles.heroBarTrack}>
                  <LinearGradient colors={[CYAN, CYAN_400]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${heroPct}%` }]} />
                </View>
                <View style={styles.heroMetaRow}>
                  <Text style={styles.heroMeta}>{heroUsed} used</Text>
                  <Text style={styles.heroMeta}>{hero.remainingCredits}/{hero.totalCredits} remaining</Text>
                </View>
                <TouchableOpacity onPress={() => router.push("/(tabs)/packages" as any)} style={styles.buyBtn} activeOpacity={0.88}>
                  <Text style={styles.buyBtnText}>Buy New Package</Text>
                </TouchableOpacity>
              </LinearGradient>
            )}

            {/* Active / Past tabs */}
            <View style={styles.tabBar}>
              {(["active", "past"] as const).map((t) => {
                const on = tab === t;
                return (
                  <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, on && styles.tabActive]} activeOpacity={0.85}>
                    <Text style={[styles.tabText, on && styles.tabTextActive]}>{t === "active" ? "Active" : "Past"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* List */}
            {list.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>{tab === "active" ? "No active packages" : "No past packages"}</Text>
                <Text style={styles.emptyDesc}>{tab === "active" ? "Purchase a package to start booking classes." : "Completed and expired packages will show up here."}</Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {list.map((pkg) => <PackageCard key={pkg.id} pkg={pkg} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14 },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 2, width: 60 },
  headerBtnText: { fontSize: 15, fontFamily: "Archivo_600SemiBold", color: CYAN },
  headerTitle: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  // hero
  heroCard: { borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "rgba(0,182,215,0.38)", marginBottom: 22 },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 },
  heroEyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: CYAN_400, marginBottom: 5 },
  heroName: { fontFamily: "Archivo_800ExtraBold", fontSize: 20, color: "#FFFFFF" },
  heroSub: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK_300, marginTop: 2 },
  heroCredits: { fontFamily: "Anton_400Regular", fontSize: 44, lineHeight: 40, color: "#FFFFFF" },
  heroCreditsLabel: { fontFamily: "Archivo_700Bold", fontSize: 11.5, color: CYAN_400, marginTop: 4 },
  heroBarTrack: { height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 8 },
  heroMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  heroMeta: { fontFamily: "Archivo_600SemiBold", fontSize: 12, color: INK_400 },
  buyBtn: { backgroundColor: CYAN, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  buyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" },

  // tabs
  tabBar: { flexDirection: "row", gap: 4, padding: 4, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 999, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: "center" },
  tabActive: { backgroundColor: "#0A0B0D" },
  tabText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: INK_400 },
  tabTextActive: { color: "#FFFFFF" },

  // list card
  card: { padding: 16, borderRadius: 16, backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  cardName: { fontFamily: "Archivo_800ExtraBold", fontSize: 16, color: "#FFFFFF" },
  cardSub: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK_400, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontFamily: "Archivo_700Bold", fontSize: 11 },
  cardDates: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK_400, marginBottom: 8 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },

  // states
  skeleton: { height: 150, backgroundColor: INK_800, borderRadius: 16 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 56, paddingHorizontal: 30 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(0,182,215,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: "Archivo_700Bold", fontSize: 20, color: "#FFFFFF", textAlign: "center" },
  emptyDesc: { fontFamily: "Archivo_400Regular", fontSize: 14, color: INK_400, textAlign: "center", maxWidth: 240, lineHeight: 21 },
  emptyBtn: { marginTop: 8, backgroundColor: CYAN, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 13 },
  emptyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" },
});
