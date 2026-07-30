import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import type { PricePackage } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { useAppContext, type PackageParticipantSelection } from "@/contexts/AppContext";
import {
  buildPackageParticipantOptions,
  participantSelectionFor,
} from "@/utils/packagePurchaseParticipants";

type PackagePurchaseModalProps = {
  pkg: PricePackage | null;
  visible: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (participant: PackageParticipantSelection, promoCode?: string | null) => void;
};

type PromotionPreview = {
  eligible: boolean;
  reason: string | null;
  originalSubtotal: number;
  discountAmount: number;
  finalSubtotal: number;
  promotion: { id: number; name: string } | null;
  promotionCode: string | null;
};

export default function PackagePurchaseModal({
  pkg,
  visible,
  submitting,
  onCancel,
  onConfirm,
}: PackagePurchaseModalProps) {
  const { user, children } = useAppContext();
  const [promoCode, setPromoCode] = useState("");
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [selectedKey, setSelectedKey] = useState("self");

  useEffect(() => {
    if (!visible) {
      setPromoCode("");
      setPreview(null);
      setPromoError(null);
      setSelectedKey("self");
    }
  }, [visible, pkg?.id]);

  useEffect(() => {
    if (!visible || !pkg) return;
    let cancelled = false;
    customFetch<PromotionPreview>("/api/promotions/validate", {
      method: "POST",
      body: JSON.stringify({ packageId: pkg.id }),
    })
      .then((result) => {
        if (!cancelled && result.eligible) setPreview(result);
      })
      .catch(() => {
        // Automatic promotions are optional; failed preview should not block checkout.
      });
    return () => {
      cancelled = true;
    };
  }, [visible, pkg?.id]);

  async function applyPromoCode() {
    if (!pkg || !promoCode.trim()) return;
    setApplying(true);
    setPromoError(null);
    try {
      const result = await customFetch<PromotionPreview>("/api/promotions/validate", {
        method: "POST",
        body: JSON.stringify({ packageId: pkg.id, promoCode }),
      });
      if (!result.eligible) {
        setPreview(null);
        setPromoError(result.reason ?? "Promo code is not eligible.");
      } else {
        setPreview(result);
      }
    } catch (err) {
      setPreview(null);
      setPromoError(err instanceof Error ? err.message : "Could not apply promo code.");
    } finally {
      setApplying(false);
    }
  }

  const appliedCode = preview?.eligible ? promoCode.trim() : null;
  const finalPrice = preview?.eligible ? preview.finalSubtotal : pkg?.priceEgp;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const options = pkg ? buildPackageParticipantOptions(user, children, pkg, today) : [];
  const selected = options.find((option) => option.key === selectedKey) ?? options[0];
  const selectedEligible = Boolean(selected?.eligible);

  useEffect(() => {
    if (!options.some((option) => option.key === selectedKey)) {
      setSelectedKey("self");
    }
  }, [options, selectedKey]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Confirm Purchase</Text>
          {pkg && (
            <>
              <View style={[styles.modalPackageSummary, { borderColor: colors.studio.primary + "30" }]}>
                <Text style={styles.modalPkgName}>{pkg.name}</Text>
                <Text style={styles.modalPkgCredits}>{pkg.sessions ?? 1} class credits</Text>
                <Text style={styles.modalPkgValidity}>
                  {pkg.validityMonths} months validity ·{" "}
                  {pkg.allowedDanceTypes.length > 0 ? pkg.allowedDanceTypes.join(", ") : "Any dance style"}
                </Text>
                <Text style={styles.modalPkgValidity}>{pkg.ageRangeLabel}</Text>
                <Text style={[styles.modalPkgPrice, { color: colors.studio.primary }]}>
                  EGP {pkg.priceEgp.toLocaleString()}
                </Text>
                {preview?.eligible && (
                  <View style={styles.discountBox}>
                    <Text style={styles.discountText}>
                      {preview.promotion?.name ?? "Promotion"} applied · -EGP {preview.discountAmount.toLocaleString()}
                    </Text>
                    <Text style={[styles.modalPkgPrice, { color: colors.studio.primary }]}>
                      EGP {finalPrice?.toLocaleString()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.participantBox}>
                <Text style={styles.promoLabel}>Package participant</Text>
                {options.map((option) => {
                  const eligible = option.eligible;
                  const selectedOption = option.key === selectedKey;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      disabled={!eligible}
                      onPress={() => setSelectedKey(option.key)}
                      style={[
                        styles.participantOption,
                        selectedOption && styles.participantOptionSelected,
                        !eligible && styles.participantOptionDisabled,
                      ]}
                    >
                      <View>
                        <Text style={styles.participantName}>{option.name}</Text>
                        <Text style={styles.participantMeta}>
                          {option.type === "self" ? "My account" : "Child"}
                          {option.age == null ? " · Date of birth required" : ` · age ${option.age}`}
                        </Text>
                      </View>
                      <Text style={{ color: eligible ? "#22C55E" : "#EF4444", fontSize: 12 }}>
                        {eligible ? "Eligible" : "Not eligible"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {selected?.type === "child" && selected.age == null ? (
                  <Text style={styles.participantDobHelp}>
                    Add this child’s date of birth in their profile before purchasing an age-restricted package.
                  </Text>
                ) : null}
              </View>
              <View style={styles.promoBox}>
                <Text style={styles.promoLabel}>Promo code</Text>
                <View style={styles.promoRow}>
                  <TextInput
                    value={promoCode}
                    onChangeText={(text) => {
                      setPromoCode(text.toUpperCase());
                      setPromoError(null);
                      setPreview(null);
                    }}
                    placeholder="Enter code"
                    placeholderTextColor="#6B7280"
                    autoCapitalize="characters"
                    style={styles.promoInput}
                  />
                  <TouchableOpacity
                    onPress={applyPromoCode}
                    disabled={!promoCode.trim() || applying}
                    style={[styles.promoApply, (!promoCode.trim() || applying) && styles.promoApplyDisabled]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.promoApplyText}>{applying ? "..." : "Apply"}</Text>
                  </TouchableOpacity>
                </View>
                {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}
              </View>
              <View style={styles.modalBtns}>
                <AppButton title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
                <AppButton
                  title={submitting ? "Submitting…" : "Confirm Purchase"}
                  disabled={!selectedEligible || submitting}
                  onPress={() => {
                    if (!selected || !selectedEligible) return;
                    onConfirm(
                      participantSelectionFor(selected),
                      appliedCode,
                    );
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center", ...iosDisplayTextStyle(20, 24, "inter") },
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
  modalPkgValidity: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  modalPkgPrice: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 4, ...iosDisplayTextStyle(28, 32, "inter") },
  discountBox: { marginTop: 10, alignItems: "center", gap: 4 },
  discountText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#22C55E", textAlign: "center" },
  promoBox: { gap: 8 },
  promoLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  promoRow: { flexDirection: "row", gap: 8 },
  promoInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: colors.studio.background,
    color: "#FFFFFF",
    ...iosTextInputStyle(14, 18, "inter"),
    paddingHorizontal: 12,
    fontFamily: "Inter_500Medium",
  },
  promoApply: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.studio.primary,
  },
  promoApplyDisabled: { opacity: 0.5 },
  promoApplyText: { color: "#001014", fontFamily: "Inter_700Bold", fontSize: 13 },
  promoError: { color: "#EF4444", fontFamily: "Inter_500Medium", fontSize: 12 },
  participantBox: { gap: 8 },
  participantOption: {
    borderWidth: 1,
    borderColor: "#2A2A35",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  participantOptionSelected: { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "12" },
  participantOptionDisabled: { opacity: 0.5 },
  participantName: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  participantMeta: { color: "#9CA3AF", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  participantDobHelp: { color: "#FCA5A5", fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  modalBtns: { flexDirection: "row", gap: 10 },
});
