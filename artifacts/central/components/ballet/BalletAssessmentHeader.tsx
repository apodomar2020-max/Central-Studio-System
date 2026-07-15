import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BA } from "./assessmentTokens";

export default function BalletAssessmentHeader({
  title = "Ballet Assessment",
  onBack,
}: {
  title?: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.75}>
        <Ionicons name="chevron-back" size={20} color={BA.cyan500} />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backButton: {
    minWidth: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  backText: {
    color: BA.cyan500,
    fontFamily: "Archivo_700Bold",
    fontSize: 14,
  },
  title: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 16,
  },
  spacer: { width: 72 },
});
