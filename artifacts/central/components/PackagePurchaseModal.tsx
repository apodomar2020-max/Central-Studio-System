import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import type { PricePackage } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";

type PackagePurchaseModalProps = {
  pkg: PricePackage | null;
  visible: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (promoCode?: string | null) => void;
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
  const [promoCode, setPromoCode] = useState("");
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPromoCode("");
      setPreview(null);
      setPromoError(null);
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
                  onPress={() => onConfirm(appliedCode)}
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
  modalBtns: { flexDirection: "row", gap: 10 },
});
