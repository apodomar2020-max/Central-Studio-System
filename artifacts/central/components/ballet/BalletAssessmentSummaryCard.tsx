import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import ParticipantAvatar from "@/components/ParticipantAvatar";
import { BookingCalendarIcon } from "@/components/BookingDetailsIcons";
import type { ChildProfile } from "@/contexts/AppContext";
import type { AssessmentScheduleOption } from "@/services/balletAssessmentService";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import BalletAssessmentIcon from "./BalletAssessmentIcon";
import { BA } from "./assessmentTokens";

type SectionKey = "child" | "appointment";

function assessmentLabel(appointment: AssessmentScheduleOption) {
  const date = new Date(`${appointment.date}T12:00:00Z`);
  const dateLabel = Number.isNaN(date.getTime())
    ? appointment.date
    : date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "long", timeZone: "UTC" });
  return `${(appointment.startTime || appointment.time).slice(0, 5)} - ${dateLabel}`.toUpperCase();
}

function ReviewRow({ eyebrow, value, icon, onEdit, last }: {
  eyebrow: string;
  value: string;
  icon: React.ReactNode;
  onEdit?: () => void;
  last?: boolean;
}) {
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.icon}>{icon}</View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.value} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>{value}</Text>
        </View>
        {onEdit ? (
          <TouchableOpacity onPress={onEdit} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={`Edit ${eyebrow}`}>
            <BalletAssessmentIcon name="edit" size={27} />
          </TouchableOpacity>
        ) : <View style={styles.editSpacer} />}
      </View>
      {!last ? <View style={styles.divider} /> : null}
    </View>
  );
}

export default function BalletAssessmentSummaryCard({ child, appointment, paymentLabel, assessmentFeeEgp, onEdit }: {
  child: ChildProfile;
  appointment: AssessmentScheduleOption;
  paymentLabel: string;
  assessmentFeeEgp?: number | null;
  onEdit: (section: SectionKey) => void;
}) {
  return (
    <View style={styles.card}>
      <ReviewRow
        eyebrow="Child"
        value={child.fullName.toUpperCase()}
        icon={<ParticipantAvatar type="child" name={child.fullName} gender={child.gender} size={38} />}
        onEdit={() => onEdit("child")}
      />
      <ReviewRow
        eyebrow="Assessment"
        value={assessmentLabel(appointment)}
        icon={<BookingCalendarIcon size={29} />}
        onEdit={() => onEdit("appointment")}
      />
      <ReviewRow eyebrow="Ballet Plan" value="ARRANGED AFTER ASSESSMENT" icon={<BalletAssessmentIcon name="price" size={29} />} />
      <ReviewRow eyebrow="Assessment Fee" value={assessmentFeeEgp != null ? `${assessmentFeeEgp.toLocaleString("en-US")} EGP` : "SET BY THE STUDIO"} icon={<BalletAssessmentIcon name="price" size={29} />} />
      <ReviewRow eyebrow="Payment Method" value={paymentLabel.toUpperCase()} icon={<BalletAssessmentIcon name="payment" size={31} />} last />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", paddingHorizontal: 10 },
  row: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10 },
  icon: { width: 39, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, justifyContent: "center" },
  eyebrow: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 16 },
  value: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 23, lineHeight: 27, textTransform: "uppercase", ...iosDisplayTextStyle(23, 27) },
  editSpacer: { width: 27 },
  divider: { height: 1, marginHorizontal: 8, borderTopWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.38)" },
});
