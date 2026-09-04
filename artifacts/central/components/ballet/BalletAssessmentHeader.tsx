import React from "react";
import { StyleSheet, Text, View } from "react-native";

import CentralBackButton from "@/components/CentralBackButton";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

export default function BalletAssessmentHeader({ title = "Ballet Assessment", onBack, showBack = true }: {
  title?: string;
  onBack: () => void;
  showBack?: boolean;
}) {
  return (
    <View style={styles.header}>
      {showBack ? <CentralBackButton onPress={onBack} style={styles.backButton} /> : <View style={styles.spacer} />}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { width: "100%", maxWidth: 430, minHeight: 54, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 15, paddingBottom: 8, zIndex: 3 },
  backButton: { width: 40, height: 40 },
  title: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 22, lineHeight: 27, textTransform: "uppercase", letterSpacing: 0.15, ...iosDisplayTextStyle(22, 27) },
  spacer: { width: 40 },
});
