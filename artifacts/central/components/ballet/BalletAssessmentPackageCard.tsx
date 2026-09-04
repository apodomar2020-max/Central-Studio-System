import { Ionicons } from "@expo/vector-icons";
import { normalizeMediaUrl } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { BalletPackageOption } from "@/services/balletAssessmentService";
import { PACKAGE_CARD_HEIGHT, PACKAGE_CARD_WIDTH } from "@/components/PackageVisualCard";
import { iosDisplayTextStyle } from "@/utils/iosTypography";
import { BA } from "./assessmentTokens";

export default function BalletAssessmentPackageCard({ pkg }: { pkg: BalletPackageOption }) {
  const imageUrl = normalizeMediaUrl(pkg.imageUrl, "image");
  return (
    <View style={styles.card} accessibilityRole="summary">
      {imageUrl ? <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" transition={150} /> : (
        <LinearGradient colors={["#22262C", "#0A0B0D"]} style={StyleSheet.absoluteFill}>
          <View style={styles.fallbackArt}><Ionicons name="body-outline" size={94} color="rgba(3,182,215,0.72)" /></View>
        </LinearGradient>
      )}
      <LinearGradient colors={["transparent", "rgba(6,7,8,0.80)", "rgba(6,7,8,0.98)"]} locations={[0, 0.3, 1]} style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={2}>{pkg.name}</Text>
          <Text style={styles.hours}>{pkg.monthlyHours}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.price}>{pkg.priceEgp.toLocaleString("en-US")} EGP</Text>
          <Text style={styles.monthly}>HOURS MONTHLY</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: PACKAGE_CARD_WIDTH,
    height: PACKAGE_CARD_HEIGHT,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  fallbackArt: { flex: 1, alignItems: "center", justifyContent: "center" },
  copy: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 24,
  },
  nameRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 27, lineHeight: 29, textTransform: "uppercase", ...iosDisplayTextStyle(27, 29) },
  hours: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 82, lineHeight: 74, ...iosDisplayTextStyle(82, 74) },
  metaRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: 7 },
  price: { color: BA.cyan400, fontFamily: "Anton_400Regular", fontSize: 32, lineHeight: 32, ...iosDisplayTextStyle(32, 32) },
  monthly: { color: BA.cyan400, fontFamily: "Archivo_800ExtraBold", fontSize: 13, lineHeight: 16, letterSpacing: 0.8, textAlign: "right" },
});
