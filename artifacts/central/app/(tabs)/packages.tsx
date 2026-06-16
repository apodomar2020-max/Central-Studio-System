import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useListPricePackages } from "@workspace/api-client-react";
import type { PricePackage } from "@workspace/api-client-react";
import { useAppContext, type UserPackage } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import { PackageCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";

function PackageCard({
  pkg,
  onBuy,
  owned,
}: {
  pkg: PricePackage;
  onBuy: () => void;
  owned?: boolean;
}) {
  const accent = pkg.isFeatured ? colors.studio.primary : "#8B5CF6";
  const credits = pkg.sessions ?? 1;
  const perClassPrice =
    pkg.singleClassPriceEgp ?? (credits > 0 ? Math.round(pkg.priceEgp / credits) : 0);
  const danceLabel =
    pkg.allowedDanceTypes.length > 0
      ? pkg.allowedDanceTypes.join(", ")
      : "Any dance style";

  return (
    <View style={[styles.pkgCard, pkg.isFeatured && { borderColor: colors.studio.primary + "60" }]}>
      {pkg.isFeatured && (
        <View style={[styles.popularBadge, { backgroundColor: colors.studio.primary }]}>
          <Text style={styles.popularBadgeText}>MOST POPULAR</Text>
        </View>
      )}
      <LinearGradient
        colors={[`${accent}12`, colors.studio.card]}
        style={styles.pkgCardInner}
      >
        <View style={styles.pkgTop}>
          <View style={[styles.pkgCreditsCircle, { backgroundColor: `${accent}20`, borderColor: `${accent}40` }]}>
            <Text style={[styles.pkgCreditsNum, { color: accent }]}>{credits}</Text>
            <Text style={[styles.pkgCreditsLabel, { color: accent }]}>classes</Text>
          </View>
          <View style={styles.pkgInfo}>
            <Text style={styles.pkgTitle}>{pkg.name}</Text>
            {pkg.description ? (
              <Text style={styles.pkgDesc}>{pkg.description}</Text>
            ) : null}
            <View style={styles.pkgTags}>
              <View style={[styles.pkgTag, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name="time-outline" size={11} color="#9CA3AF" />
                <Text style={styles.pkgTagText}>{pkg.validityMonths} months validity</Text>
              </View>
              <View style={[styles.pkgTag, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name="infinite-outline" size={11} color="#9CA3AF" />
                <Text style={styles.pkgTagText}>{danceLabel}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.pkgFooter}>
          <View>
            <Text style={styles.pkgPriceLabel}>Price</Text>
            <Text style={[styles.pkgPrice, { color: accent }]}>
              EGP {pkg.priceEgp.toLocaleString()}
            </Text>
            <Text style={styles.pkgPerClass}>
              EGP {perClassPrice.toLocaleString()} / class
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onBuy();
            }}
            style={[styles.buyBtn, { backgroundColor: owned ? "#1E1E26" : accent }]}
          >
            <Text style={[styles.buyBtnText, { color: owned ? "#9CA3AF" : "#000" }]}>
              {owned ? "Owned" : "Buy Now"}
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

function ActivePackageCard({
  pkg,
  onUse,
}: {
  pkg: UserPackage;
  onUse: () => void;
}) {
  const pct = Math.round((pkg.remainingCredits / pkg.totalCredits) * 100);
  const isExpired = pkg.expiryDate ? new Date(pkg.expiryDate) < new Date() : false;
  const statusColor = isExpired ? "#EF4444" : pkg.status === "fullyUsed" ? "#6B7280" : "#22C55E";
  const statusLabel = isExpired ? "Expired" : pkg.status === "fullyUsed" ? "Fully Used" : "Active";

  return (
    <View style={[styles.activeCard, { borderColor: isExpired ? "#2A1A1A" : "#1A2A22" }]}>
      <View style={styles.activeCardHeader}>
        <View style={styles.activeCardTitleRow}>
          <Text style={styles.activeCardTitle}>{pkg.packageTitle}</Text>
          <View style={[styles.activeBadge, { backgroundColor: statusColor + "20" }]}>
            <View style={[styles.activeDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.activeBadgeText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.progressWrap}>
        <View style={[styles.progressBar, { backgroundColor: "#1E2A22" }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${pct}%` as any,
                backgroundColor: isExpired ? "#EF4444" : "#22C55E",
              },
            ]}
          />
        </View>
        <Text style={styles.progressText}>{pkg.remainingCredits} / {pkg.totalCredits} credits left</Text>
      </View>

      <View style={styles.activeCardMeta}>
        {pkg.expiryDate ? (
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color="#9CA3AF" />
            <Text style={styles.metaItemText}>
              Expires {new Date(pkg.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </Text>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Ionicons name="receipt-outline" size={13} color="#9CA3AF" />
          <Text style={styles.metaItemText}>
            Purchased {new Date(pkg.purchaseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
        </View>
      </View>

      {pkg.status === "active" && !isExpired && (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onUse();
          }}
          style={styles.useCreditsBtn}
        >
          <Ionicons name="card-outline" size={14} color={colors.studio.primary} />
          <Text style={[styles.useCreditsText, { color: colors.studio.primary }]}>Use Credits to Book</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function PendingPackageCard({ pkg, onCancel }: { pkg: UserPackage; onCancel: () => void }) {
  return (
    <View style={[styles.activeCard, { borderColor: "#F59E0B30" }]}>
      <View style={styles.activeCardHeader}>
        <View style={styles.activeCardTitleRow}>
          <Text style={styles.activeCardTitle}>{pkg.packageTitle}</Text>
          <View style={[styles.activeBadge, { backgroundColor: "#F59E0B20" }]}>
            <Ionicons name="time-outline" size={10} color="#F59E0B" />
            <Text style={[styles.activeBadgeText, { color: "#F59E0B" }]}>Pending Payment</Text>
          </View>
        </View>
      </View>

      <Text style={styles.pendingInfoText}>
        Your request is awaiting payment confirmation from our team. We'll activate it shortly.
      </Text>

      <View style={styles.activeCardMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={13} color="#9CA3AF" />
          <Text style={styles.metaItemText}>
            Requested {new Date(pkg.purchaseDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="card-outline" size={13} color="#9CA3AF" />
          <Text style={styles.metaItemText}>{pkg.totalCredits} credits</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => {
          Alert.alert(
            "Cancel Request",
            "Are you sure you want to cancel this package request?",
            [
              { text: "Keep", style: "cancel" },
              { text: "Cancel Request", style: "destructive", onPress: onCancel },
            ]
          );
        }}
        style={styles.cancelPendingBtn}
      >
        <Ionicons name="trash-outline" size={14} color="#EF4444" />
        <Text style={styles.cancelPendingBtnText}>Cancel Request</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function PackagesScreen() {
  const { user, userPackages, purchasePackage, cancelPackage, refreshUserPackages } = useAppContext();
  const {
    data: packages,
    isLoading: packagesLoading,
    isError: isPackagesError,
    error: packagesQueryError,
    isRefetching: isRefetchingPackages,
    refetch: refetchPackages,
  } = useListPricePackages();

  const isRefreshing = isRefetchingPackages;
  const onRefresh = useCallback(() => {
    refetchPackages();
    refreshUserPackages();
  }, [refetchPackages, refreshUserPackages]);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"buy" | "mine">("buy");
  const [confirmPkg, setConfirmPkg] = useState<PricePackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const pendingPackages = userPackages.filter((p) => p.status === "pendingPayment");
  const myActivePackages = userPackages.filter(
    (p) => p.status === "active" && (!p.expiryDate || new Date(p.expiryDate) >= new Date())
  );
  const pastPackages = userPackages.filter(
    (p) => p.status !== "pendingPayment" &&
      (p.status !== "active" || (!!p.expiryDate && new Date(p.expiryDate) < new Date()))
  );

  // Active packages the user already owns (for "Owned" badge on buy tab)
  const ownedPackageIds = new Set(
    userPackages
      .filter((p) => p.status === "active" || p.status === "pendingPayment")
      .map((p) => p.packageId)
  );

  function handleBuy(pkg: PricePackage) {
    if (!user) {
      Alert.alert("Sign In Required", "Please sign in to purchase a package.", [
        { text: "Sign In", onPress: () => router.push("/auth/login") },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    setConfirmPkg(pkg);
  }

  async function confirmPurchase() {
    if (!confirmPkg) return;
    setPurchasing(true);
    try {
      await purchasePackage({
        id: confirmPkg.id,
        name: confirmPkg.name,
        sessions: confirmPkg.sessions ?? 1,
        validityMonths: 0,
      });
      setConfirmPkg(null);
      setActiveTab("mine");
      Alert.alert(
        "Request Submitted!",
        `Your ${confirmPkg.name} request has been submitted. Our team will confirm payment and activate it shortly.`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Request Failed", `Could not submit your request.\n\n${msg}\n\nPlease check your connection and try again.`);
    } finally {
      setPurchasing(false);
    }
  }

  const visiblePackages = (packages ?? []).filter((p) => p.isActive);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <Text style={styles.title}>Packages</Text>
        <View style={styles.tabRow}>
          <TouchableOpacity
            onPress={() => setActiveTab("buy")}
            style={[styles.tab, activeTab === "buy" && { backgroundColor: colors.studio.primary }]}
          >
            <Text style={[styles.tabText, activeTab === "buy" && { color: "#000" }]}>Buy Package</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setActiveTab("mine");
              refreshUserPackages();
            }}
            style={[styles.tab, activeTab === "mine" && { backgroundColor: colors.studio.primary }]}
          >
            <Text style={[styles.tabText, activeTab === "mine" && { color: "#000" }]}>
              My Packages {userPackages.length > 0 ? `(${userPackages.length})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 120 : 90 }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.studio.primary}
            colors={[colors.studio.primary]}
          />
        }
      >
        {activeTab === "buy" && (
          <>
            <View style={[styles.infoBanner, { borderColor: colors.studio.primary + "30" }]}>
              <Ionicons name="information-circle" size={18} color={colors.studio.primary} />
              <Text style={styles.infoBannerText}>
                Packages work across dance styles. Each class attendance deducts 1 credit.
              </Text>
            </View>
            {packagesLoading ? (
              <View style={{ paddingTop: 8 }}>
                {[1, 2, 3].map((i) => <PackageCardSkeleton key={i} />)}
              </View>
            ) : isPackagesError ? (
              isOfflineError(packagesQueryError) ? (
                <OfflineState onRetry={refetchPackages} />
              ) : (
                <ErrorState onRetry={refetchPackages} message="Couldn't load packages. Please try again." />
              )
            ) : visiblePackages.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No packages available</Text>
                <Text style={styles.emptyDesc}>Check back soon for new packages.</Text>
              </View>
            ) : (
              visiblePackages.map((pkg) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  onBuy={() => handleBuy(pkg)}
                  owned={ownedPackageIds.has(String(pkg.id))}
                />
              ))
            )}
          </>
        )}

        {activeTab === "mine" && (
          <>
            {userPackages.length === 0 ? (
              <View style={styles.emptyWrap}>
                <View style={[styles.emptyIcon, { backgroundColor: "#1E1E26" }]}>
                  <Ionicons name="card-outline" size={40} color="#4B5563" />
                </View>
                <Text style={styles.emptyTitle}>No packages yet</Text>
                <Text style={styles.emptyDesc}>
                  Buy a class package to save money and book classes with credits.
                </Text>
                <AppButton
                  title="Browse Packages"
                  onPress={() => setActiveTab("buy")}
                  style={{ marginTop: 8 }}
                />
              </View>
            ) : (
              <>
                {pendingPackages.length > 0 && (
                  <>
                    <Text style={[styles.groupLabel, { color: "#F59E0B" }]}>Pending Payment</Text>
                    {pendingPackages.map((p) => (
                      <PendingPackageCard
                        key={p.id}
                        pkg={p}
                        onCancel={() => cancelPackage(p.id)}
                      />
                    ))}
                  </>
                )}
                {myActivePackages.length > 0 && (
                  <>
                    <Text style={[styles.groupLabel, { marginTop: pendingPackages.length > 0 ? 16 : 0 }]}>Active</Text>
                    {myActivePackages.map((p) => (
                      <ActivePackageCard
                        key={p.id}
                        pkg={p}
                        onUse={() => router.push("/(tabs)/classes")}
                      />
                    ))}
                  </>
                )}
                {pastPackages.length > 0 && (
                  <>
                    <Text style={[styles.groupLabel, { marginTop: 16 }]}>Past</Text>
                    {pastPackages.map((p) => (
                      <ActivePackageCard key={p.id} pkg={p} onUse={() => {}} />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Modal
        visible={!!confirmPkg}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmPkg(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Confirm Purchase</Text>
            {confirmPkg && (
              <>
                <View style={[styles.modalPackageSummary, { borderColor: colors.studio.primary + "30" }]}>
                  <Text style={styles.modalPkgName}>{confirmPkg.name}</Text>
                  <Text style={styles.modalPkgCredits}>{confirmPkg.sessions ?? 1} class credits</Text>
                  <Text style={styles.modalPkgValidity}>
                    {confirmPkg.validityMonths} months validity ·{" "}
                    {confirmPkg.allowedDanceTypes.length > 0
                      ? confirmPkg.allowedDanceTypes.join(", ")
                      : "Any dance style"}
                  </Text>
                  <Text style={[styles.modalPkgPrice, { color: colors.studio.primary }]}>
                    EGP {confirmPkg.priceEgp.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.modalBtns}>
                  <AppButton
                    title="Cancel"
                    variant="ghost"
                    onPress={() => setConfirmPkg(null)}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    title={purchasing ? "Submitting…" : "Confirm Purchase"}
                    onPress={confirmPurchase}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  tabRow: { flexDirection: "row", gap: 8 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
  },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  infoBanner: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: `${colors.studio.primary}0A`,
    marginBottom: 16,
    alignItems: "flex-start",
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    lineHeight: 17,
  },
  pkgCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1E2E38",
    overflow: "hidden",
    marginBottom: 14,
    position: "relative",
  },
  popularBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    zIndex: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
  },
  popularBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#000", letterSpacing: 0.5 },
  pkgCardInner: { padding: 18, gap: 14 },
  pkgTop: { flexDirection: "row", gap: 14 },
  pkgCreditsCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    flexShrink: 0,
  },
  pkgCreditsNum: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 26 },
  pkgCreditsLabel: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 12 },
  pkgInfo: { flex: 1, gap: 6 },
  pkgTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  pkgDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 16 },
  pkgTags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  pkgTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  pkgTagText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pkgFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  pkgPriceLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pkgPrice: { fontSize: 22, fontFamily: "Inter_700Bold" },
  pkgPerClass: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  buyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  buyBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  activeCard: {
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: colors.studio.card,
    padding: 16,
    gap: 12,
    marginBottom: 10,
  },
  activeCardHeader: {},
  activeCardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  activeCardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  activeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  progressWrap: { gap: 6 },
  progressBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4 },
  progressText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  activeCardMeta: { gap: 6 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaItemText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  useCreditsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${colors.studio.primary}40`,
    backgroundColor: `${colors.studio.primary}0A`,
  },
  useCreditsText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#6B7280",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  emptyWrap: { alignItems: "center", gap: 12, paddingTop: 60, paddingHorizontal: 20 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 18 },
  cancelPendingBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: "#EF444435",
    marginTop: 4,
  },
  cancelPendingBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#EF4444" },
  pendingInfoText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 17 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#0E1619",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === "web" ? 34 : 40,
    gap: 18,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#2A2A35", alignSelf: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center" },
  modalPackageSummary: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 6,
    alignItems: "center",
    backgroundColor: colors.studio.background,
  },
  modalPkgName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  modalPkgCredits: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  modalPkgValidity: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280" },
  modalPkgPrice: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 4 },
  modalBtns: { flexDirection: "row", gap: 10 },
});
