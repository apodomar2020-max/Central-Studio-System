import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { AssessmentScheduleOption } from "@/services/balletAssessmentService";
import { BA, BA_RADIUS } from "./assessmentTokens";

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long" });
}

export default function BalletAssessmentAppointmentCard({
  appointment,
  selected,
  onPress,
}: {
  appointment: AssessmentScheduleOption;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={styles.iconBox}>
        <Ionicons name="calendar-outline" size={20} color={BA.cyan400} />
      </View>
      <View style={styles.content}>
        <Text style={styles.level}>{appointment.levelName}</Text>
        <Text style={styles.title}>{appointment.className}</Text>
        <Text style={styles.meta}>{appointment.day} · {formatDate(appointment.date)} · {appointment.time}</Text>
        <Text style={styles.available}>Available</Text>
      </View>
      {selected ? <Ionicons name="checkmark-circle" size={24} color={BA.cyan500} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: BA_RADIUS.lg,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: BA.ink800,
  },
  cardSelected: {
    borderColor: BA.cyan500,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  content: { flex: 1, gap: 2 },
  level: {
    color: BA.cyan400,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 15.5,
  },
  meta: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 12.5,
  },
  available: {
    color: BA.success,
    fontFamily: "Archivo_700Bold",
    fontSize: 12,
    marginTop: 2,
  },
});
