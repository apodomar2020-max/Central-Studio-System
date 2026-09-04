import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import ParticipantAvatar from "@/components/ParticipantAvatar";
import type { ChildProfile } from "@/contexts/AppContext";
import { BA } from "./assessmentTokens";

function SelectionRadio({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected ? <View style={styles.radioFill} /> : null}
    </View>
  );
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
  const unavailable = disabled || locked;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={unavailable}
      activeOpacity={0.82}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === true, disabled: unavailable === true }}
      style={[styles.card, selected && styles.cardSelected, unavailable && styles.cardDisabled]}
    >
      <ParticipantAvatar type="child" name={child.fullName} gender={child.gender} size={46} selected={selected} />
      <View style={styles.content}>
        <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={1} ellipsizeMode="tail">
          {child.fullName}
        </Text>
        <Text style={[styles.age, selected && styles.ageSelected]} numberOfLines={1}>
          {child.age || "—"} YEARS
        </Text>
      </View>
      {unavailable ? (
        <View style={styles.unavailableWrap}>
          {unavailableLabel ? <Text style={styles.unavailable} numberOfLines={1}>{unavailableLabel}</Text> : null}
          <Ionicons name="lock-closed" size={18} color="#809096" />
        </View>
      ) : (
        <SelectionRadio selected={selected === true} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 64, borderRadius: 32, paddingHorizontal: 14, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#003741" },
  cardSelected: { backgroundColor: BA.cyan500 },
  cardDisabled: { opacity: 0.48 },
  content: { flex: 1, minWidth: 0, justifyContent: "center", gap: 0 },
  name: { color: BA.cyan500, fontFamily: "Anton_400Regular", fontSize: 20, lineHeight: 23, textTransform: "uppercase" },
  nameSelected: { color: "#FFFFFF" },
  age: { color: BA.cyan500, fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 16 },
  ageSelected: { color: "#005464", fontFamily: "Archivo_700Bold" },
  unavailableWrap: { maxWidth: 118, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  unavailable: { flexShrink: 1, color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 11, lineHeight: 14, textTransform: "uppercase", textAlign: "right" },
  radio: { width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: BA.cyan500, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: "#FFFFFF" },
  radioFill: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" },
});
