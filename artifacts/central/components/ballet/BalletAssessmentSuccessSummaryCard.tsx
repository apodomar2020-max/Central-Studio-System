import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import BookingFlowIcon from "@/components/booking/BookingFlowIcon";
import ParticipantAvatar from "@/components/ParticipantAvatar";
import { BookingWatchIcon } from "@/components/BookingDetailsIcons";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import BalletAssessmentIcon from "./BalletAssessmentIcon";

const GRADIENT = ["#026071", "#03B6D7"] as const;

function Tile({ style, children }: { style?: object; children: React.ReactNode }) {
  return <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={style}>{children}</LinearGradient>;
}

export default function BalletAssessmentSuccessSummaryCard({
  childName,
  childGender,
  assessmentDateLabel,
  assessmentTimeLabel,
  paymentLabel,
  locationLabel,
  assessmentFeeEgp,
  statusLabel,
}: {
  childName: string;
  childGender?: string | null;
  assessmentDateLabel: string;
  assessmentTimeLabel: string;
  paymentLabel: string;
  locationLabel: string;
  assessmentFeeEgp?: number | null;
  statusLabel: string;
}) {
  return (
    <View style={styles.card}>
      <Tile style={styles.statusTile}>
        <Text style={styles.statusTitle}>APPLICATION STATUS</Text>
        <View style={styles.statusBadge}><Text style={styles.statusBadgeText}>{statusLabel}</Text></View>
      </Tile>

      <View style={styles.primaryGrid}>
        <Tile style={styles.timeTile}>
          <View style={styles.heading}><BookingWatchIcon size={27} /><Text style={styles.headingText}>Time</Text></View>
          <Text style={styles.date}>{assessmentDateLabel}</Text>
          <Text style={styles.time}>{assessmentTimeLabel}</Text>
        </Tile>
        <Tile style={styles.studentTile}>
          <View style={styles.heading}>
            <ParticipantAvatar type="child" name={childName} gender={childGender} size={27} />
            <Text style={styles.headingText}>Student</Text>
          </View>
          <Text style={styles.studentName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72}>{childName.toUpperCase()}</Text>
        </Tile>
      </View>

      <View style={styles.secondaryGrid}>
        <Tile style={styles.smallTile}>
          <BookingFlowIcon name="cash" size={34} />
          <Text style={styles.smallLabel}>Payment Method</Text>
          <Text style={styles.smallValue}>{paymentLabel.toUpperCase()}</Text>
        </Tile>
        <Tile style={styles.smallTile}>
          <BookingFlowIcon name="location" size={34} />
          <Text style={styles.smallLabel}>Location</Text>
          <Text style={styles.smallValue} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.74}>{locationLabel.toUpperCase()}</Text>
        </Tile>
        <Tile style={styles.smallTile}>
          <BalletAssessmentIcon name="price" size={30} tintColor="#FFFFFF" />
          <Text style={styles.smallLabel}>Assessment Fee</Text>
          <Text style={styles.smallValue}>{assessmentFeeEgp != null ? `${assessmentFeeEgp.toLocaleString("en-US")} EGP` : "TBC"}</Text>
        </Tile>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.58)", padding: 9, backgroundColor: "rgba(1,35,41,0.70)" },
  statusTile: { minHeight: 61, borderRadius: 12, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusTitle: { flex: 1, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 20, lineHeight: 24, ...iosDisplayTextStyle(20, 24) },
  statusBadge: { height: 28, minWidth: 91, borderRadius: 14, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#FFC400" },
  statusBadgeText: { color: "#FFFFFF", fontFamily: "Archivo_600SemiBold", fontSize: 11.5 },
  primaryGrid: { minHeight: 127, marginTop: 6, flexDirection: "row", gap: 6 },
  timeTile: { flex: 1.05, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, justifyContent: "space-between" },
  studentTile: { flex: 1, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  headingText: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 16 },
  date: { marginTop: 13, color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 14, lineHeight: 18 },
  time: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 32, lineHeight: 35, ...iosDisplayTextStyle(32, 35) },
  studentName: { marginTop: 19, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 30, lineHeight: 29, ...iosDisplayTextStyle(30, 29) },
  secondaryGrid: { minHeight: 129, marginTop: 6, flexDirection: "row", gap: 6 },
  smallTile: { flex: 1, minWidth: 0, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 5, alignItems: "center", justifyContent: "space-between" },
  smallLabel: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 12, lineHeight: 15, textAlign: "center" },
  smallValue: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 19, lineHeight: 22, textAlign: "center", ...iosDisplayTextStyle(19, 22) },
});
