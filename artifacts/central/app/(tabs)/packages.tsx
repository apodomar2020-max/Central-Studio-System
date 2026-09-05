import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { pushOnce } from "@/utils/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
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
import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import PackagePurchaseModal from "@/components/PackagePurchaseModal";
import { PackageCardSkeleton } from "@/components/SkeletonLoader";
import OfflineState from "@/components/OfflineState";
import ErrorState from "@/components/ErrorState";
import { isOfflineError } from "@/services/connectivity";
import { showAuthRequiredPrompt } from "@/utils/authRequired";
import { showProfileIncompletePrompt } from "@/utils/profileCompletionRequired";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import type { PackageParticipantSelection } from "@/contexts/AppContext";
import { presentPackagePurchaseError } from "@/utils/packagePurchasePresentation";

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
              <View style={[styles.pkgTag, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name="people-outline" size={11} color="#9CA3AF" />
                <Text style={styles.pkgTagText}>{pkg.ageRangeLabel}</Text>
              </View>
            </View>
          </View>
        </View>

        {pkg.features?.length ? (
          <View style={styles.pkgFeatures}>
            {pkg.features.map((f, i) => (
              <View key={i} style={styles.pkgFeatureRow}>
                <Ionicons name="checkmark-circle" size={15} color={accent} />
                <Text style={styles.pkgFeatureText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}

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

export default function PackagesScreen() {
  const { user, userPackages, purchasePackage, refreshUserPackages, refreshChildren } = useAppContext();
  const alert = useCentralAlert();
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
    refreshChildren();
  }, [refetchPackages, refreshUserPackages, refreshChildren]);
  const insets = useSafeAreaInsets();
  const [confirmPkg, setConfirmPkg] = useState<PricePackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  // Active packages the user already owns (for "Owned" badge on buy tab)
  const ownedPackageIds = new Set(
    userPackages
      .filter((p) => p.status === "active" || p.status === "pendingPayment")
      .map((p) => p.packageId)
  );

  function handleBuy(pkg: PricePackage) {
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    if (user.profileCompletion && !user.profileCompletion.isComplete) {
      showProfileIncompletePrompt(user.profileCompletion.nextStep);
      return;
    }
    setConfirmPkg(pkg);
  }

  // Internal deep link fallback: ?purchaseId=<id> opens the shared purchase
  // confirmation for that package directly.
  const { purchaseId } = useLocalSearchParams<{ purchaseId?: string }>();
  const purchaseHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!purchaseId || purchaseHandledRef.current === purchaseId) return;
    const pkg = (packages ?? []).find((p) => String(p.id) === String(purchaseId) && p.isActive);
    if (pkg) {
      purchaseHandledRef.current = purchaseId;
      handleBuy(pkg);
    }
  }, [purchaseId, packages]);

  async function confirmPurchase(participant: PackageParticipantSelection, promoCode?: string | null) {
    if (!confirmPkg) return;
    setPurchasing(true);
    try {
      await purchasePackage({
        id: confirmPkg.id,
        name: confirmPkg.name,
        sessions: confirmPkg.sessions ?? 1,
        validityMonths: 0,
        promoCode,
        participant,
        // Online Payment is disabled in this UI (Coming Soon) — Pay at
        // Studio / Cash is the only enabled path today. Must match the
        // Home carousel's purchase call so equivalent purchase actions
        // record the same requestedPaymentChannel in Finance, regardless
        // of which screen they were started from.
        paymentMode: "pay_at_studio",
      });
      setConfirmPkg(null);
      pushOnce("/package-center");
      alert.show({
        tone: "success",
        title: "Request Submitted!",
        message: `Your ${confirmPkg.name} request for ${participant.participantType === "self" ? "yourself" : "the selected child"} has been submitted. Our team will confirm payment and activate it shortly.`,
      });
    } catch (err: unknown) {
      const presentation = presentPackagePurchaseError(err);
      alert.show({
        tone: "error",
        title: presentation.title,
        message: presentation.message,
      });
    } finally {
      setPurchasing(false);
    }
  }

  const visiblePackages = (packages ?? []).filter((p) => p.isActive);
  const missingDob = visiblePackages.some((pkg) =>
    pkg.catalogueEligibility?.reasons.some((reason) => reason.code === "DOB_REQUIRED"),
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <Text style={styles.title}>Packages</Text>
        <TouchableOpacity
          onPress={() => pushOnce("/package-center")}
          style={styles.centerShortcut}
          activeOpacity={0.85}
        >
          <Ionicons name="albums-outline" size={15} color={colors.studio.primary} />
          <Text style={styles.centerShortcutText}>Package Center</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 120 : 90 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.studio.primary}
            colors={[colors.studio.primary]}
          />
        }
      >
        <View style={[styles.infoBanner, { borderColor: colors.studio.primary + "30" }]}>
          <Ionicons name="information-circle" size={18} color={colors.studio.primary} />
          <Text style={styles.infoBannerText}>
            Packages work across dance styles. Each class attendance deducts 1 credit.
          </Text>
        </View>
        {missingDob ? (
          <TouchableOpacity
            style={[styles.infoBanner, { borderColor: "#F59E0B60" }]}
            onPress={() => pushOnce("/edit-profile")}
          >
            <Ionicons name="calendar-outline" size={18} color="#F59E0B" />
            <Text style={styles.infoBannerText}>
              Add your date of birth in your profile so we can determine eligible classes and packages.
            </Text>
          </TouchableOpacity>
        ) : null}
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
      </ScrollView>

      <PackagePurchaseModal
        pkg={confirmPkg}
        visible={!!confirmPkg}
        submitting={purchasing}
        onCancel={() => setConfirmPkg(null)}
        onConfirm={confirmPurchase}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#FFFFFF", ...iosDisplayTextStyle(28, 32, "inter") },
  centerShortcut: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: `${colors.studio.primary}40`,
    backgroundColor: `${colors.studio.primary}12`,
  },
  centerShortcutText: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.studio.primary },
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
  pkgCreditsNum: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 26, ...iosDisplayTextStyle(22, 26, "inter") },
  pkgCreditsLabel: { fontSize: 10, fontFamily: "Inter_500Medium", lineHeight: 12 },
  pkgInfo: { flex: 1, gap: 6 },
  pkgTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  pkgDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 16 },
  pkgTags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  pkgTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  pkgTagText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pkgFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  pkgPriceLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pkgPrice: { fontSize: 22, fontFamily: "Inter_700Bold", ...iosDisplayTextStyle(22, 26, "inter") },
  pkgPerClass: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pkgFeatures: { gap: 7, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  pkgFeatureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pkgFeatureText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#D1D5DB" },
  buyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  buyBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  emptyWrap: { alignItems: "center", gap: 12, paddingTop: 60, paddingHorizontal: 20 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 18 },
});
