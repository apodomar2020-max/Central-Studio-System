import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { BalletPackageOption } from "@/services/balletAssessmentService";
import { BA, BA_RADIUS } from "./assessmentTokens";

export default function BalletAssessmentPackageCard({
  pkg,
  selected,
  onPress,
}: {
  pkg: BalletPackageOption;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={[styles.card, selected && styles.cardSelected]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{pkg.name}</Text>
          <Text style={styles.price}>{pkg.priceEgp.toLocaleString("en-US")} EGP</Text>
        </View>
        {selected ? <Ionicons name="checkmark-circle" size={24} color={BA.cyan500} /> : null}
      </View>
      <View style={styles.benefits}>
        <View style={styles.benefit}>
          <Ionicons name="calendar-outline" size={15} color={BA.cyan400} />
          <Text style={styles.benefitText}>{pkg.monthlyClasses} classes / month</Text>
        </View>
        <View style={styles.benefit}>
          <Ionicons name="time-outline" size={15} color={BA.cyan400} />
          <Text style={styles.benefitText}>{pkg.monthlyHours} hours / month</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: BA_RADIUS.lg,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: BA.ink800,
    gap: 12,
  },
  cardSelected: {
    borderColor: BA.cyan500,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 17,
  },
  price: {
    color: BA.cyan400,
    fontFamily: "Anton_400Regular",
    fontSize: 28,
    lineHeight: 32,
    marginTop: 2,
  },
  benefits: { gap: 7 },
  benefit: { flexDirection: "row", alignItems: "center", gap: 8 },
  benefitText: {
    color: BA.ink300,
    fontFamily: "Archivo_600SemiBold",
    fontSize: 13,
  },
});
