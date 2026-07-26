import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { BA, BA_RADIUS } from "./assessmentTokens";

function Row({
  icon,
  label,
  children,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowHeader}>
        <Ionicons name={icon} size={15} color={BA.cyan400} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

export default function BalletAssessmentSuccessSummaryCard({
  childName,
  assessmentDateLabel,
  assessmentTimeLabel,
  paymentLabel,
  statusLabel,
}: {
  childName: string;
  assessmentDateLabel: string;
  assessmentTimeLabel: string;
  paymentLabel: string;
  statusLabel: string;
}) {
  return (
    <View style={styles.card}>
      <Row icon="happy-outline" label="Child">
        <Text style={styles.value}>{childName}</Text>
      </Row>
      <Row icon="calendar-outline" label="Assessment">
        <Text style={styles.value}>{assessmentDateLabel}</Text>
        <Text style={styles.valueSecondary}>{assessmentTimeLabel}</Text>
      </Row>
      <Row icon="card-outline" label="Payment Method">
        <Text style={styles.value}>{paymentLabel}</Text>
      </Row>
      <Row icon="hourglass-outline" label="Status" last>
        <View style={styles.statusBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: BA_RADIUS.xl,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
    backgroundColor: BA.ink800,
    paddingHorizontal: 16,
  },
  row: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    gap: 4,
  },
  rowLast: { borderBottomWidth: 0 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 2 },
  rowLabel: {
    color: BA.ink300,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  value: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15,
  },
  valueSecondary: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,176,46,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,176,46,0.35)",
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BA.amber },
  statusText: {
    color: BA.amber,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 12,
    letterSpacing: 0.3,
  },
});
