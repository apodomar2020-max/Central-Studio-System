import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BA, BA_RADIUS } from "./assessmentTokens";

export default function BalletAssessmentSuccessActions({
  onHome,
  onModify,
  onAnotherChild,
  onCancel,
  cancelLoading,
}: {
  onHome: () => void;
  onModify: () => void;
  onAnotherChild: () => void;
  onCancel: () => void;
  cancelLoading?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={onHome} activeOpacity={0.86} style={[styles.button, styles.primary]}>
        <Ionicons name="home-outline" size={17} color={BA.ink900} />
        <Text style={[styles.text, styles.primaryText]}>Go To Home</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onModify} activeOpacity={0.86} style={[styles.button, styles.secondary]}>
        <Text style={styles.text}>Modify Application</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onAnotherChild} activeOpacity={0.86} style={[styles.button, styles.secondary]}>
        <Text style={styles.text}>Apply For Another Child</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel} disabled={cancelLoading} activeOpacity={0.86} style={[styles.button, styles.danger, cancelLoading && { opacity: 0.6 }]}>
        <Text style={[styles.text, styles.dangerText]}>{cancelLoading ? "Cancelling…" : "Cancel Application"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  button: {
    minHeight: 50,
    borderRadius: BA_RADIUS.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primary: { backgroundColor: BA.cyan500 },
  secondary: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  danger: {
    backgroundColor: "rgba(255,59,71,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,59,71,0.32)",
  },
  text: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 14.5,
  },
  primaryText: { color: BA.ink900 },
  dangerText: { color: BA.danger },
});
