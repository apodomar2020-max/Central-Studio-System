import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BookingLocationIcon } from "@/components/BookingDetailsIcons";
import type { AssessmentScheduleOption } from "@/services/balletAssessmentService";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import BalletAssessmentIcon from "./BalletAssessmentIcon";
import { BA } from "./assessmentTokens";

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return { day: "—", month: "" };
  return {
    day: String(date.getUTCDate()).padStart(2, "0"),
    month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase(),
  };
}

function timeLabel(appointment: AssessmentScheduleOption) {
  return (appointment.startTime || appointment.time || "—").slice(0, 5);
}

export default function BalletAssessmentAppointmentCard({ appointment, assessmentFeeEgp, selected, onPress }: {
  appointment: AssessmentScheduleOption;
  assessmentFeeEgp?: number | null;
  selected?: boolean;
  onPress: () => void;
}) {
  const date = dateParts(appointment.date);
  const location = appointment.branchName || appointment.roomName || "Central Studio";

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.84} accessibilityRole="radio" accessibilityState={{ selected: selected === true }} style={styles.row}>
      <View style={[styles.details, selected && styles.detailsSelected]}>
        <Text style={[styles.level, selected && styles.onSelected]} numberOfLines={1}>{appointment.levelName}</Text>
        <Text style={[styles.time, selected && styles.onSelected]}>{timeLabel(appointment)}</Text>
        <View style={styles.metaRow}>
          <BalletAssessmentIcon name="price" size={16} tintColor="#FFFFFF" />
          <Text style={[styles.meta, selected && styles.onSelected]}>
            Assessment Fee: {assessmentFeeEgp != null ? `${assessmentFeeEgp.toLocaleString("en-US")} EGP` : "Set by the studio"}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <BookingLocationIcon size={16} />
          <Text style={[styles.meta, selected && styles.onSelected]} numberOfLines={1}>{location}</Text>
        </View>
      </View>
      <View style={[styles.date, selected && styles.dateSelected]}>
        <Text style={[styles.weekday, selected && styles.dateTextSelected]} numberOfLines={1}>{appointment.day}</Text>
        <Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>{date.day}</Text>
        <Text style={[styles.month, selected && styles.dateTextSelected]}>{date.month}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", minHeight: 132, flexDirection: "row", gap: 8 },
  details: { flex: 1, minWidth: 0, borderRadius: 21, paddingHorizontal: 20, paddingVertical: 16, justifyContent: "center", backgroundColor: "#003741" },
  detailsSelected: { backgroundColor: BA.cyan500 },
  level: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 21, lineHeight: 25 },
  time: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 40, lineHeight: 42, ...iosDisplayTextStyle(40, 42) },
  metaRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  meta: { flex: 1, minWidth: 0, color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 17 },
  onSelected: { color: "#FFFFFF" },
  date: { width: 82, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#F4F4F4", paddingHorizontal: 4 },
  dateSelected: { backgroundColor: BA.cyan500 },
  weekday: { maxWidth: "100%", color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 17, lineHeight: 20 },
  dateNumber: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 50, lineHeight: 52, ...iosDisplayTextStyle(50, 52) },
  month: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 14, lineHeight: 17 },
  dateTextSelected: { color: "#FFFFFF" },
});
