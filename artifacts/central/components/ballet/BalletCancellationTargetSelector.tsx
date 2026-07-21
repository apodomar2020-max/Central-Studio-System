import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";
import type { BalletCancellationTarget } from "./balletCancellationTargets";

export type BalletCancellationSelectionKind = "cancelApplication" | "cancelProgram" | "viewRequest";

export default function BalletCancellationTargetSelector({
  visible,
  kind,
  targets,
  selectedApplicationId,
  onSelect,
  onClose,
  onContinue,
}: {
  visible: boolean;
  kind: BalletCancellationSelectionKind;
  targets: BalletCancellationTarget[];
  selectedApplicationId: number | null;
  onSelect: (target: BalletCancellationTarget) => void;
  onClose: () => void;
  onContinue: () => void;
}) {
  const insets = useSafeAreaInsets();
  const copy = kind === "cancelApplication"
    ? "Which Ballet application would you like to cancel?"
    : kind === "cancelProgram"
      ? "Which Ballet enrollment would you like to cancel?"
      : "Which Ballet cancellation request would you like to view?";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Select Child</Text>
              <Text style={styles.copy}>{copy}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close child selection"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={21} color="#D1D5DB" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {targets.map((target) => {
              const selected = selectedApplicationId === target.applicationId;
              return (
                <TouchableOpacity
                  key={`application-${target.applicationId}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(target)}
                  activeOpacity={0.84}
                  style={[styles.targetCard, selected && styles.targetCardSelected]}
                >
                  <View style={styles.targetHeading}>
                    <Text style={styles.childName}>{target.childName}</Text>
                    <View style={[styles.statusPill, selected && styles.statusPillSelected]}>
                      <Text style={styles.statusText}>{target.applicationStatus}</Text>
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    {target.levelName ?? "Level unavailable"} · {target.groupName ?? "Group unavailable"}
                  </Text>
                  {target.subscriptionState ? <Text style={styles.meta}>Subscription: {target.subscriptionState}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondary} onPress={onClose}>
              <Text style={styles.secondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.continueButton, selectedApplicationId == null && styles.disabled]}
              onPress={onContinue}
              disabled={selectedApplicationId == null}
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedApplicationId == null }}
            >
              <Text style={styles.continueText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.74)",
  },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(0,182,215,0.34)",
    backgroundColor: colors.studio.card,
    paddingHorizontal: 18,
    paddingTop: 18,
    gap: 14,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerCopy: { flex: 1, gap: 5 },
  title: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 20 },
  copy: { color: "#9CA3AF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 19 },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  list: { flexGrow: 0 },
  listContent: { gap: 10 },
  targetCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14,
    gap: 6,
  },
  targetCardSelected: {
    borderColor: colors.cyan,
    backgroundColor: "rgba(0,182,215,0.11)",
  },
  targetHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  childName: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 16 },
  statusPill: { borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 9, paddingVertical: 4 },
  statusPillSelected: { backgroundColor: "rgba(0,182,215,0.20)" },
  statusText: { color: "#D1D5DB", fontFamily: "Archivo_700Bold", fontSize: 10, textTransform: "uppercase" },
  meta: { color: "#9CA3AF", fontFamily: "Archivo_400Regular", fontSize: 12.5, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 10 },
  secondary: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 14 },
  continueButton: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  continueText: { color: "#070A0D", fontFamily: "Archivo_800ExtraBold", fontSize: 14 },
  disabled: { opacity: 0.42 },
});
