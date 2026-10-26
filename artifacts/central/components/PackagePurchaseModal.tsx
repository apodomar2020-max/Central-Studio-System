import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { PricePackage } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
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
  onConfirm: (participant: PackageParticipantSelection) => void;
};

export default function PackagePurchaseModal({
  pkg,
  visible,
  submitting,
  onCancel,
  onConfirm,
}: PackagePurchaseModalProps) {
  const { user, children } = useAppContext();
  const [selectedKey, setSelectedKey] = useState("self");

  useEffect(() => {
    if (!visible) {
      setSelectedKey("self");
    }
  }, [visible, pkg?.id]);

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
              <View style={styles.modalBtns}>
                <AppButton title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
                <AppButton
                  title={submitting ? "Submitting…" : "Confirm Purchase"}
                  disabled={!selectedEligible || submitting}
                  onPress={() => {
                    if (!selected || !selectedEligible) return;
                    onConfirm(
                      participantSelectionFor(selected),
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
  promoLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
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
