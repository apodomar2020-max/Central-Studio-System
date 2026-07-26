import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BA, BA_RADIUS } from "./assessmentTokens";

export default function BalletAssessmentSuccessActions({
  onModify,
  onAnotherChild,
  onCancel,
  cancelLoading,
}: {
  onModify: () => void;
  onAnotherChild: () => void;
  onCancel: () => void;
  cancelLoading?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.mainActions}>
        <TouchableOpacity onPress={onModify} activeOpacity={0.86} style={[styles.button, styles.primary]}>
          <Ionicons name="create-outline" size={17} color={BA.ink900} />
          <Text style={[styles.text, styles.primaryText]}>Modify Application</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAnotherChild} activeOpacity={0.86} style={[styles.button, styles.secondary]}>
          <Ionicons name="person-add-outline" size={16} color={BA.white} />
          <Text style={styles.text}>Apply For Another Child</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={onCancel}
        disabled={cancelLoading}
        activeOpacity={0.6}
        style={styles.cancelAction}
        hitSlop={{ top: 6, bottom: 6, left: 16, right: 16 }}
      >
        {cancelLoading ? (
          <ActivityIndicator color={BA.danger} size="small" />
        ) : (
          <Ionicons name="close-circle-outline" size={15} color={BA.danger} />
        )}
        <Text style={styles.cancelText}>{cancelLoading ? "Cancelling…" : "Cancel Application"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  mainActions: { width: "100%", gap: 13 },
  button: {
    width: "100%",
    minHeight: 54,
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
    borderColor: "rgba(255,255,255,0.14)",
  },
  text: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 14.5,
    textAlign: "center",
    flexShrink: 1,
  },
  primaryText: { color: BA.ink900 },
  cancelAction: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 22,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: BA.danger,
    fontFamily: "Archivo_700Bold",
    fontSize: 14,
  },
});
