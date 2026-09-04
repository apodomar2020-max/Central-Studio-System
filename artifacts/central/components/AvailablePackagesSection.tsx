import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useListPricePackages } from "@workspace/api-client-react";
import type { PricePackage } from "@workspace/api-client-react";
import CsIcon from "@/components/CsIcon";
import PackageDetailsSheet from "@/components/PackageDetailsSheet";
import PackageVisualCard, {
  PACKAGE_CARD_HEIGHT,
  PACKAGE_CARD_WIDTH,
} from "@/components/PackageVisualCard";
import { useAppContext } from "@/contexts/AppContext";
import type { PackageParticipantSelection } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { showAuthRequiredPrompt } from "@/utils/authRequired";
import {
  PACKAGE_AGE_BAND_LABELS,
  packageMatchesAgeBand,
  type PackageAgeBand,
} from "@/utils/packageAgeBands";

const CYAN = "#00B6D7";
const INK_900 = "#0A0B0D";
const INK_800 = "#15171B";
const INK_300 = "#8E97A2";

type AvailablePackagesSectionProps = {
  mode?: "home" | "packageCenter";
  initialAgeFilter?: PackageAgeBand;
  onPurchased?: () => void | Promise<void>;
};

const PACKAGE_FILTERS: PackageAgeBand[] = ["adults", "teens", "kids"];

/**
 * The single catalogue presentation shared by Home and Package Center.
 * Purchase state and the participant-selection flow live here so both screens
 * always expose the same packages and behaviour.
 */
export default function AvailablePackagesSection({
  mode = "home",
  initialAgeFilter,
  onPurchased,
}: AvailablePackagesSectionProps) {
  const { user, purchasePackage } = useAppContext();
  const alert = useCentralAlert();
  const { data: raw, isLoading, isError } = useListPricePackages();
  const [detailsPkg, setDetailsPkg] = useState<PricePackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [ageFilter, setAgeFilter] = useState<PackageAgeBand>(initialAgeFilter ?? "adults");

  useEffect(() => {
    if (initialAgeFilter) setAgeFilter(initialAgeFilter);
  }, [initialAgeFilter]);

  const packages = useMemo(
    () => (raw ?? []).filter((pkg: PricePackage) => pkg.isActive !== false),
    [raw],
  );
  const visiblePackages = useMemo(
    () => mode === "packageCenter"
      ? packages.filter((pkg) => packageMatchesAgeBand(pkg, ageFilter))
      : packages,
    [ageFilter, mode, packages],
  );

  const handleOpenDetails = useCallback((pkg: PricePackage) => {
    if (!user) {
      showAuthRequiredPrompt();
      return;
    }
    setDetailsPkg(pkg);
  }, [user]);

  const confirmPurchase = useCallback(async (participant: PackageParticipantSelection) => {
    if (!detailsPkg) return;
    setPurchasing(true);
    try {
      await purchasePackage({
        id: detailsPkg.id,
        name: detailsPkg.name,
        sessions: detailsPkg.sessions ?? 1,
        validityMonths: 0,
        participant,
        paymentMode: "pay_at_studio",
      });
      const packageName = detailsPkg.name;
      setDetailsPkg(null);
      await onPurchased?.();
      if (mode === "home") router.push("/package-center");
      alert.show({
        tone: "success",
        title: "Request Submitted!",
        message: `Your ${packageName} request has been submitted. Our team will confirm payment and activate it shortly.`,
      });
    } catch (error) {
      alert.show({
        tone: "error",
        title: "Request Failed",
        message: `Could not submit your request.\n\n${error instanceof Error ? error.message : "Unknown error"}\n\nPlease check your connection and try again.`,
      });
    } finally {
      setPurchasing(false);
    }
  }, [alert, detailsPkg, mode, onPurchased, purchasePackage]);

  const packageCenter = mode === "packageCenter";

  if (isError || (!isLoading && packages.length === 0)) {
    return (
      <View style={[
        styles.section,
        packageCenter ? styles.centerSection : styles.homeFallbackSection,
      ]}>
        {packageCenter ? <PackageCenterHeading /> : null}
        <LinearGradient
          colors={["#003A47", "#001828"]}
          style={[styles.promo, packageCenter && styles.centerPromo]}
        >
          <View style={styles.promoIcon}>
            <CsIcon name="ticket" size={24} stroke={2.2} color={CYAN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.promoTitle}>
              {packageCenter ? "Packages are being updated" : "Save with Class Packages"}
            </Text>
            <Text style={styles.promoDescription}>
              {packageCenter ? "Please check again shortly." : "4, 8, or 12 classes — any style, 6-month validity"}
            </Text>
          </View>
          {!packageCenter ? (
            <TouchableOpacity onPress={() => router.push("/package-center")} style={styles.promoButton}>
              <Text style={styles.promoButtonText}>View</Text>
            </TouchableOpacity>
          ) : null}
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={[styles.section, packageCenter && styles.centerSection]}>
      {packageCenter ? (
        <>
          <PackageCenterHeading />
          <View style={styles.ageFilters} accessibilityRole="tablist">
            {PACKAGE_FILTERS.map((filter) => {
              const selected = filter === ageFilter;
              return (
                <TouchableOpacity
                  key={filter}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  activeOpacity={0.84}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setAgeFilter(filter);
                  }}
                  style={[styles.ageFilterButton, selected && styles.ageFilterButtonSelected]}
                >
                  <Text style={[styles.ageFilterText, selected && styles.ageFilterTextSelected]}>
                    {PACKAGE_AGE_BAND_LABELS[filter]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.eyebrow}>SAVE MORE, DANCE MORE</Text>
            <Text style={styles.homeTitle}>Packages</Text>
          </View>
          <TouchableOpacity onPress={() => router.push("/package-center")} style={styles.manageRow}>
            <Text style={styles.manageText}>Manage</Text>
            <CsIcon name="chevron" size={15} stroke={2.4} color={INK_300} />
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <View style={[styles.skeletonRow, packageCenter && styles.centerSkeletonRow]}>
          {[1, 2].map((item) => <View key={item} style={styles.skeleton} />)}
        </View>
      ) : packageCenter && visiblePackages.length === 0 ? (
        <View style={styles.ageFilterEmpty}>
          <Text style={styles.ageFilterEmptyTitle}>NO {PACKAGE_AGE_BAND_LABELS[ageFilter].toUpperCase()} PACKAGES YET</Text>
          <Text style={styles.ageFilterEmptyText}>Choose another category or check again soon.</Text>
        </View>
      ) : (
        <FlatList
          data={visiblePackages}
          keyExtractor={(pkg) => String(pkg.id)}
          renderItem={({ item }) => <PackageVisualCard pkg={item} onPress={handleOpenDetails} />}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, packageCenter && styles.centerListContent]}
        />
      )}

      <PackageDetailsSheet
        pkg={detailsPkg}
        visible={Boolean(detailsPkg)}
        submitting={purchasing}
        onClose={() => setDetailsPkg(null)}
        onContinue={confirmPurchase}
      />
    </View>
  );
}

function PackageCenterHeading() {
  return (
    <View style={styles.centerHeading}>
      <Text style={styles.centerTitle}>BUY NEW ONE</Text>
      <Text style={styles.centerSubtitle}>You can select the new package</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 30 },
  homeFallbackSection: { paddingHorizontal: 20 },
  centerSection: { marginTop: 30, marginBottom: 10 },
  homeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    color: CYAN,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  homeTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontFamily: "Archivo_800ExtraBold",
    color: "#FFFFFF",
    letterSpacing: -0.24,
  },
  manageRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  manageText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: INK_300 },
  centerHeading: { paddingHorizontal: 22, marginBottom: 18 },
  centerTitle: {
    color: CYAN,
    fontFamily: "Anton_400Regular",
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: 0.3,
  },
  centerSubtitle: {
    color: "#FFFFFF",
    fontFamily: "Archivo_400Regular",
    fontSize: 14,
    lineHeight: 18,
    marginTop: 1,
  },
  ageFilters: { flexDirection: "row", gap: 8, paddingHorizontal: 22, marginBottom: 16 },
  ageFilterButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(0,182,215,0.58)",
    backgroundColor: "#012C31",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  ageFilterButtonSelected: { borderColor: CYAN, backgroundColor: CYAN },
  ageFilterText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14 },
  ageFilterTextSelected: { color: INK_900 },
  ageFilterEmpty: {
    minHeight: 170,
    marginHorizontal: 22,
    borderRadius: 18,
    backgroundColor: "#012C31",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  ageFilterEmptyTitle: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 24, lineHeight: 29, textAlign: "center" },
  ageFilterEmptyText: { marginTop: 5, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center" },
  listContent: { paddingLeft: 20, paddingRight: 20, gap: 12 },
  centerListContent: { paddingLeft: 22, paddingRight: 22, gap: 8, paddingTop: 28 },
  skeletonRow: { paddingLeft: 20, flexDirection: "row", gap: 12 },
  centerSkeletonRow: { paddingLeft: 22, gap: 8, paddingTop: 28 },
  skeleton: {
    width: PACKAGE_CARD_WIDTH,
    height: PACKAGE_CARD_HEIGHT,
    borderRadius: 18,
    backgroundColor: INK_800,
    opacity: 0.35,
  },
  promo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginHorizontal: 0,
    borderRadius: 16,
  },
  centerPromo: { marginHorizontal: 20 },
  promoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0,182,215,0.13)",
    alignItems: "center",
    justifyContent: "center",
  },
  promoTitle: { color: "#FFFFFF", fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  promoDescription: { color: INK_300, fontSize: 11, fontFamily: "Archivo_400Regular", marginTop: 2 },
  promoButton: { backgroundColor: CYAN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  promoButtonText: { fontSize: 12, fontFamily: "Archivo_800ExtraBold", color: INK_900 },
});
