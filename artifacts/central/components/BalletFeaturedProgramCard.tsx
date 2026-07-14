import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { iosDisplayTextStyle } from "@/utils/iosTypography";

const INK_900 = "#0A0B0D";
const INK_300 = "#8E97A2";
const CYAN = "#00B6D7";
const AMBER = "#FFB02E";
const SUCCESS = "#1FB871";
const DANGER = "#FF3B47";
const INK_400 = "#6B747F";
const R_MD = 12;
const R_LG = 16;
const R_PILL = 999;

const DETAIL_MODE_STATUSES = new Set([
  "pending",
  "needsFollowUp",
  "accepted",
  "assignedToLevel",
  "active",
]);

function getStatusBadgeLabel(status: string) {
  switch (status) {
    case "pending": return "Under Review";
    case "needsFollowUp": return "Follow-Up";
    case "accepted": return "Accepted";
    case "assignedToLevel": return "Level Assigned";
    case "active": return "Active";
    case "rejected": return "Not Accepted";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function getStatusBadgeColor(status: string) {
  switch (status) {
    case "pending": return AMBER;
    case "needsFollowUp": return AMBER;
    case "accepted": return SUCCESS;
    case "assignedToLevel": return CYAN;
    case "active": return CYAN;
    case "rejected": return DANGER;
    case "cancelled": return INK_400;
    default: return INK_300;
  }
}

export default function BalletFeaturedProgramCard({
  balletStatus,
  onView,
  onApply,
}: {
  balletStatus: string | null;
  onView: () => void;
  onApply: () => void;
}) {
  const isDetailMode = balletStatus !== null && DETAIL_MODE_STATUSES.has(balletStatus);
  const statusColor = balletStatus ? getStatusBadgeColor(balletStatus) : null;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <ImageBackground
          source={require("@/assets/images/ballet_hero.png")}
          style={StyleSheet.absoluteFill}
          imageStyle={{ borderRadius: R_LG }}
        />
        <LinearGradient
          colors={["rgba(5,6,8,0.22)", "rgba(5,6,8,0.30)", "rgba(5,6,8,0.97)"]}
          locations={[0, 0.25, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.top}>
          {statusColor && (
            <View style={[styles.statusBadge, { backgroundColor: statusColor + "28", borderColor: statusColor + "60" }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {getStatusBadgeLabel(balletStatus!)}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.bottom}>
          <Text style={styles.name}>{"Ballet Intensive\nProgram"}</Text>
          <Text style={styles.sub}>12 weeks · Fundamentals to performance stage</Text>
          <View style={{ flexDirection: "row", gap: 9 }}>
            <TouchableOpacity onPress={onView} style={styles.primaryButton} activeOpacity={0.85}>
              <Text style={styles.primaryButtonText}>View Program</Text>
            </TouchableOpacity>
            {!isDetailMode && (
              <TouchableOpacity onPress={onApply} style={styles.ghostButton} activeOpacity={0.85}>
                <Text style={styles.ghostButtonText}>Apply Now</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  card: {
    height: 216,
    borderRadius: R_LG,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  top: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1 },
  statusText: { fontSize: 11, fontFamily: "Archivo_800ExtraBold" },
  bottom: { position: "absolute", left: 16, right: 16, bottom: 14 },
  name: {
    fontSize: 26,
    fontFamily: "Anton_400Regular",
    color: "#fff",
    lineHeight: 24,
    ...iosDisplayTextStyle(26, 24),
    textTransform: "uppercase",
    marginBottom: 6,
  },
  sub: { fontSize: 13, fontFamily: "Archivo_400Regular", color: INK_300, marginBottom: 12 },
  primaryButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: CYAN,
    borderRadius: R_MD,
    alignItems: "center",
  },
  primaryButtonText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold", color: INK_900 },
  ghostButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.09)",
    borderRadius: R_MD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    alignItems: "center",
  },
  ghostButtonText: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#fff" },
});
