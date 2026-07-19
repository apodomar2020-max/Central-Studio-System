import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { ChildProfile } from "@/contexts/AppContext";
import { BA, BA_RADIUS } from "./assessmentTokens";

function formatBirthday(value?: string) {
  if (!value) return "Birthday not set";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export default function BalletAssessmentChildCard({
  child,
  selected,
  disabled,
  locked,
  unavailableLabel,
  onPress,
}: {
  child: ChildProfile;
  selected?: boolean;
  disabled?: boolean;
  locked?: boolean;
  unavailableLabel?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || locked}
      activeOpacity={0.82}
      style={[
        styles.card,
        selected && styles.cardSelected,
        disabled && styles.cardDisabled,
      ]}
    >
      <View style={styles.avatar}>
        <Ionicons name="happy-outline" size={22} color={disabled ? BA.ink400 : BA.cyan400} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.name, disabled && styles.disabledText]}>{child.fullName}</Text>
        <Text style={styles.meta}>Age: {child.age || "—"} Years</Text>
        <Text style={styles.meta}>Birthday: {formatBirthday(child.birthday)}</Text>
        {unavailableLabel ? <Text style={styles.unavailable}>{unavailableLabel}</Text> : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={24} color={BA.cyan500} />
      ) : disabled ? (
        <Ionicons name="lock-closed-outline" size={20} color={BA.ink400} />
      ) : null}
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
  cardDisabled: {
    opacity: 0.62,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  content: { flex: 1, gap: 2 },
  name: {
    color: BA.white,
    fontFamily: "Archivo_800ExtraBold",
    fontSize: 16,
  },
  disabledText: { color: "rgba(255,255,255,0.62)" },
  meta: {
    color: BA.ink300,
    fontFamily: "Archivo_400Regular",
    fontSize: 12.5,
  },
  unavailable: {
    color: BA.amber,
    fontFamily: "SpaceMono_700Bold",
    fontSize: 10,
    letterSpacing: 0.7,
    marginTop: 4,
    textTransform: "uppercase",
  },
});
