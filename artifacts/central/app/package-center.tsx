/**
 * Package Center — student package history (design: PackageCenter).
 *
 * Active-package hero card + Active/Past tabs + package list. Uses the secure
 * /api/my/packages endpoint (student JWT scoped). All values are real
 * (packageName, credits, dates, status) — nothing faked.
 */
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
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
import { formatApiDate, isApiDatePast } from "@/utils/dateTime";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";
import { useAppContext } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const SUCCESS = "#1FB871";
const DANGER = "#FF3B47";
const INK_300 = "#8E97A2";
const INK_400 = "#6B747F";
const INK_800 = "#15171B";
const BORDER = "rgba(255,255,255,0.08)";

type PackageStatusKind = "active" | "pending" | "expired" | "exhausted" | "cancelled" | "rejected" | "other";
type Dateish = string | Date | null | undefined;

// ─── Status helpers (real data) ──────────────────────────────────────────────
function isPastDate(iso?: Dateish): boolean {
  return isApiDatePast(iso);
}

function packageStatusKind(pkg: PackageOrderWithDateAliases): PackageStatusKind {
  if (pkg.status === "active") {
    if (isPastDate(expiresAtOf(pkg))) return "expired";
    if (pkg.remainingCredits <= 0) return "exhausted";
    return "active";
  }
  if (pkg.status === "fullyUsed") return "exhausted";
  if (pkg.status === "expired") return "expired";
  if (pkg.status === "pendingPayment" || pkg.status === "pending") return "pending";
  if (pkg.status === "rejected") return "rejected";
  if (pkg.status === "cancelled") return "cancelled";
  return "other";
}

function statusLabel(pkg: PackageOrderWithDateAliases): string {
  const kind = packageStatusKind(pkg);
  if (kind === "active") return "Active";
  if (kind === "pending") return "Pending Request";
  if (kind === "expired") return "Expired";
  if (kind === "exhausted") return "Fully Used";
  if (kind === "cancelled") return activatedAtOf(pkg) ? "Cancelled" : "Cancelled Request";
  if (kind === "rejected") return "Rejected Request";
  return pkg.status;
}
function statusColor(label: string): string {
  if (label === "Active") return SUCCESS;
  if (label === "Expired") return "#FFB02E";
  if (label === "Pending Request") return "#3B82F6";
  if (label === "Fully Used") return "#FF3B47";
  if (label === "Rejected Request") return "#FF3B47";
  if (label === "Cancelled Request") return "#6B7280";
  return INK_400;
}
function isActivePkg(pkg: PackageOrderWithDateAliases): boolean {
  return packageStatusKind(pkg) === "active";
}
function isPendingRequest(pkg: PackageOrderWithDateAliases): boolean {
  return packageStatusKind(pkg) === "pending";
}
function isRejectedRequest(pkg: PackageOrderWithDateAliases): boolean {
  const kind = packageStatusKind(pkg);
  return kind === "rejected" || (kind === "cancelled" && !activatedAtOf(pkg));
}
function isPastPkg(pkg: PackageOrderWithDateAliases): boolean {
  const kind = packageStatusKind(pkg);
  return kind === "expired" || kind === "exhausted" || (kind === "cancelled" && Boolean(activatedAtOf(pkg)));
}
function fmtDate(iso?: Dateish): string | null {
  const formatted = formatApiDate(iso, "", { day: "numeric", month: "short", year: "numeric" });
  return formatted || null;
}

type PackageOrderWithDateAliases = PackageOrder & {
  created_at?: Dateish;
  activated_at?: Dateish;
  expires_at?: Dateish;
  priceEgp?: number | null;
  price_egp?: number | null;
  packagePrice?: number | null;
  package_price?: number | null;
  amount?: number | null;
};

function createdAtOf(pkg: PackageOrderWithDateAliases): Dateish {
  return pkg.createdAt ?? pkg.created_at ?? null;
}

function activatedAtOf(pkg: PackageOrderWithDateAliases): Dateish {
  return pkg.activatedAt ?? pkg.activated_at ?? null;
}

function expiresAtOf(pkg: PackageOrderWithDateAliases): Dateish {
  return pkg.expiresAt ?? pkg.expires_at ?? null;
}

function requestDateValue(pkg: PackageOrderWithDateAliases, isRequest: boolean): string {
  const formatted = fmtDate(createdAtOf(pkg));
  if (formatted) return formatted;
  return isRequest ? "Requested recently" : "Purchased recently";
}

function priceOf(pkg: PackageOrderWithDateAliases): number | null {
  return pkg.priceEgp ?? pkg.price_egp ?? pkg.packagePrice ?? pkg.package_price ?? pkg.amount ?? null;
}

function priceText(pkg: PackageOrderWithDateAliases): string {
  const price = priceOf(pkg);
  if (typeof price !== "number" || !Number.isFinite(price)) return "Price unavailable";
  return `EGP ${price.toLocaleString()}`;
}

// Expiry label. Validity starts at Admin activation (expiresAt = activatedAt +
// validityMonths). So:
//   • expiresAt set        → the real date
//   • not yet activated    → "Expiry starts after activation"
//   • activated, no expiry → "No expiry" (genuinely unlimited / no validity months)
function expiryText(pkg: PackageOrderWithDateAliases): string {
  const expiresAt = expiresAtOf(pkg);
  const activatedAt = activatedAtOf(pkg);
  if (expiresAt) return `Expires ${fmtDate(expiresAt) ?? "Expiry not set"}`;
  if (!activatedAt) return "Expiry starts after activation";
  return "No expiry";
}

function DateRow({ label, value, valueColor = "#FFFFFF" }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.dateRow}>
      <Text style={[styles.dateValue, { color: valueColor }]}>
        {label ? <Text style={styles.dateLabel}>{label} </Text> : null}
        {value}
      </Text>
    </View>
  );
}

// ─── Package list card (design parity) ───────────────────────────────────────
// Wave 3.1 (Gap 3): onCancel/cancelling are only ever passed for a
// pendingPayment package request — see isPendingRequest below, the only
// caller that supplies them. An active/paid package never receives these
// props, so it never renders the Cancel affordance.
function PackageCard({ pkg, onCancel, cancelling }: { pkg: PackageOrderWithDateAliases; onCancel?: () => void; cancelling?: boolean }) {
  const label = statusLabel(pkg);
  const color = statusColor(label);
  const kind = packageStatusKind(pkg);
  const remaining = kind === "active" ? pkg.remainingCredits : 0;
  const pct = pkg.totalCredits > 0 ? Math.round((remaining / pkg.totalCredits) * 100) : 0;
  const isRequest = kind === "pending" || kind === "rejected" || (kind === "cancelled" && !activatedAtOf(pkg));
  const purchaseDate = requestDateValue(pkg, isRequest);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName} numberOfLines={1}>{pkg.packageName}</Text>
          <Text style={styles.cardSub}>{pkg.totalCredits} classes · {priceText(pkg)}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: label === "Active" ? "rgba(31,184,113,0.16)" : "rgba(255,255,255,0.06)" }]}>
          <Text style={[styles.statusPillText, { color }]}>{label}</Text>
        </View>
      </View>
      <View style={styles.dateBox}>
        <DateRow label={isRequest ? "Requested" : "Purchased"} value={purchaseDate} />
        <DateRow label="" value={expiryText(pkg)} valueColor={DANGER} />
      </View>
      <View style={styles.barTrack}>
        <LinearGradient colors={[CYAN, CYAN_400]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      {onCancel && (
        <TouchableOpacity
          onPress={onCancel}
          disabled={cancelling}
          style={styles.cardCancelBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.cardCancelBtnText}>{cancelling ? "Cancelling…" : "Cancel Request"}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function PackageCenterScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"active" | "past">("active");
  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;
  const { cancelPackage } = useAppContext();
  const alert = useCentralAlert();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useGetMyPackages();
  const packages = useMemo(() => data ?? [], [data]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // Wave 3.1 (Gap 3): pendingPayment-only self-service cancellation. No
  // payment was ever collected for a pendingPayment request, so this never
  // fabricates a refund — the server itself scopes this to pendingPayment
  // only (409 otherwise), matching the approved policy exactly.
  const confirmCancelPackage = useCallback((pkg: PackageOrderWithDateAliases) => {
    alert.show({
      tone: "destructive",
      title: "Cancel package request?",
      message: `Cancel your request for ${pkg.packageName}? This removes the request before any payment is processed.`,
      actions: [
        { label: "Keep request", tone: "neutral" },
        {
          label: "Cancel request",
          tone: "danger",
          onPress: async () => {
            setCancellingId(String(pkg.id));
            try {
              await cancelPackage(String(pkg.id));
            } catch (e) {
              alert.show({
                tone: "error",
                title: "Couldn't cancel",
                message: e instanceof Error ? e.message : "Please try again.",
              });
            } finally {
              setCancellingId(null);
            }
          },
        },
      ],
    });
  }, [alert, cancelPackage]);

  // Finance Batch 1 (Part B2): refetch on every screen focus, not only app
  // foreground — same rationale as credit-history.tsx.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const pendingRequests = useMemo(() => packages.filter(isPendingRequest), [packages]);
  const rejectedRequests = useMemo(() => packages.filter(isRejectedRequest), [packages]);
  const activeList = useMemo(() => packages.filter(isActivePkg), [packages]);
  const pastList = useMemo(() => packages.filter(isPastPkg), [packages]);
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
            <TouchableOpacity onPress={() => router.push("/(tabs)" as any)} style={styles.emptyBtn} activeOpacity={0.88}>
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
                    <Text style={styles.heroSub}>{hero.totalCredits} classes · {priceText(hero)}</Text>
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
                <View style={styles.heroDateBox}>
                  <DateRow label="Purchased" value={requestDateValue(hero, false)} />
                  <DateRow label="" value={expiryText(hero)} valueColor={DANGER} />
                </View>
                <TouchableOpacity onPress={() => router.push("/(tabs)" as any)} style={styles.buyBtn} activeOpacity={0.88}>
                  <Text style={styles.buyBtnText}>Buy New Package</Text>
                </TouchableOpacity>
              </LinearGradient>
            )}

            {pendingRequests.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={[styles.sectionLabel, { color: "#3B82F6" }]}>Pending Requests</Text>
                <View style={{ gap: 12 }}>
                  {pendingRequests.map((pkg) => (
                    <PackageCard
                      key={pkg.id}
                      pkg={pkg}
                      onCancel={() => confirmCancelPackage(pkg)}
                      cancelling={cancellingId === String(pkg.id)}
                    />
                  ))}
                </View>
              </View>
            )}

            {rejectedRequests.length > 0 && (
              <View style={styles.sectionBlock}>
                <Text style={[styles.sectionLabel, { color: "#FF3B47" }]}>Request History</Text>
                <View style={{ gap: 12 }}>
                  {rejectedRequests.map((pkg) => <PackageCard key={pkg.id} pkg={pkg} />)}
                </View>
              </View>
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
                <Text style={styles.emptyDesc}>{tab === "active" ? "Approved packages with usable credits will show here." : "Expired and fully used packages will show up here."}</Text>
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
  heroCredits: { fontFamily: "Anton_400Regular", fontSize: 44, lineHeight: 40, ...iosDisplayTextStyle(44, 40), color: "#FFFFFF", marginBottom: -iosCapGuard(44, 40) },
  heroCreditsLabel: { fontFamily: "Archivo_700Bold", fontSize: 11.5, color: CYAN_400, marginTop: 4 },
  heroBarTrack: { height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 8 },
  heroMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  heroMeta: { fontFamily: "Archivo_600SemiBold", fontSize: 12, color: INK_400 },
  heroDateBox: { gap: 7, padding: 12, borderRadius: 12, backgroundColor: "rgba(10,11,13,0.36)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", marginBottom: 14 },
  buyBtn: { backgroundColor: CYAN, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  buyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" },

  sectionBlock: { marginBottom: 18 },
  sectionLabel: { fontFamily: "SpaceMono_700Bold", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 },

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
  dateBox: { gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.045)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", marginBottom: 10 },
  dateRow: { gap: 3 },
  dateLabel: { fontFamily: "Archivo_700Bold", fontSize: 12, color: INK_300 },
  dateValue: { fontFamily: "Archivo_700Bold", fontSize: 13, lineHeight: 18 },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },
  cardCancelBtn: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,59,71,0.35)", backgroundColor: "rgba(255,59,71,0.08)", paddingVertical: 11, alignItems: "center" },
  cardCancelBtnText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: DANGER },

  // states
  skeleton: { height: 150, backgroundColor: INK_800, borderRadius: 16 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 56, paddingHorizontal: 30 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(0,182,215,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: "Archivo_700Bold", fontSize: 20, color: "#FFFFFF", textAlign: "center" },
  emptyDesc: { fontFamily: "Archivo_400Regular", fontSize: 14, color: INK_400, textAlign: "center", maxWidth: 240, lineHeight: 21 },
  emptyBtn: { marginTop: 8, backgroundColor: CYAN, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 13 },
  emptyBtnText: { fontFamily: "Archivo_800ExtraBold", fontSize: 14, color: "#0A0B0D" },
});
