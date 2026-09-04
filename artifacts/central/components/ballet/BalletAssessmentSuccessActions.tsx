import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import BookingSuccessActionIcon from "@/components/booking/BookingSuccessActionIcon";
import BalletAssessmentIcon from "./BalletAssessmentIcon";
import { BA } from "./assessmentTokens";

export default function BalletAssessmentSuccessActions({ onModify, onRemind, onHome }: {
  onModify: () => void;
  onRemind: () => void;
  onHome: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.actionRow}>
        <TouchableOpacity onPress={onModify} activeOpacity={0.84} style={styles.outlineButton}>
          <BalletAssessmentIcon name="edit" size={23} />
          <Text style={styles.outlineText}>Modify</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemind} activeOpacity={0.84} style={styles.outlineButton}>
          <BookingSuccessActionIcon name="calendar" size={23} />
          <Text style={styles.outlineText}>Remind Me</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onHome} activeOpacity={0.86} style={styles.homeButton}>
        <BookingSuccessActionIcon name="home" size={23} />
        <Text style={styles.homeText}>Back to home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  actionRow: { flexDirection: "row", gap: 10 },
  outlineButton: { flex: 1, height: 50, borderRadius: 25, borderWidth: 1, borderColor: BA.cyan500, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  outlineText: { color: BA.cyan500, fontFamily: "Archivo_700Bold", fontSize: 15 },
  homeButton: { marginTop: 10, height: 52, borderRadius: 26, backgroundColor: BA.cyan500, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  homeText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 16 },
});
