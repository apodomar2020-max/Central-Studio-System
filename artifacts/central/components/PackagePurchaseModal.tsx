import { Modal, Platform, StyleSheet, Text, View } from "react-native";

import type { PricePackage } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";

type PackagePurchaseModalProps = {
  pkg: PricePackage | null;
  visible: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function PackagePurchaseModal({
  pkg,
  visible,
  submitting,
  onCancel,
  onConfirm,
}: PackagePurchaseModalProps) {
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
              </View>
              <View style={styles.modalBtns}>
                <AppButton title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
                <AppButton
                  title={submitting ? "Submitting…" : "Confirm Purchase"}
                  onPress={onConfirm}
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
  modalPkgValidity: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center" },
  modalPkgPrice: { fontSize: 28, fontFamily: "Inter_700Bold", marginTop: 4 },
  modalBtns: { flexDirection: "row", gap: 10 },
});
