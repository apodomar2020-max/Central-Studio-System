/**
 * app/ballet/requirements.tsx — Program Requirements
 *
 * Static program content (dress code, attendance, progression) mirroring the
 * design source. The backend `ballet_settings.requirements` is only a single
 * freeform text field; the structured sections below have no backend yet —
 * documented in the backend gap report.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "Enrollment Requirements",
    items: [
      "Placement assessment required for levels Intermediate and above",
      "Age requirements per level (see Levels page)",
      "Completion of application form",
    ],
  },
  {
    title: "Dress Code — Girls",
    items: [
      "Pink or black leotard",
      "Pink ballet tights",
      "Pink canvas or satin ballet shoes",
      "Hair in a neat bun with hairpins",
    ],
  },
  {
    title: "Dress Code — Boys",
    items: [
      "White fitted t-shirt",
      "Black ballet shorts or tights",
      "Black canvas ballet shoes",
    ],
  },
  {
    title: "Attendance Policy",
    items: [
      "Minimum 80% attendance required to progress",
      "3 consecutive absences require a make-up class",
      "Assessment eligibility requires 85% attendance in the past term",
    ],
  },
  {
    title: "Level Progression",
    items: [
      "Progression recommended by instructor based on skill and attendance",
      "Assessments held every 6 months",
      "Assessment fee: EGP 150",
    ],
  },
];

export default function BalletRequirementsScreen() {
  return (
    <BalletPageShell title="Requirements" contentStyle={s.content}>
      {SECTIONS.map((sec) => (
        <View key={sec.title} style={s.card}>
          <Text style={s.cardTitle}>{sec.title}</Text>
          <View style={s.itemList}>
            {sec.items.map((item, i) => (
              <View key={i} style={s.itemRow}>
                <Ionicons name="checkmark" size={15} color={BAL.CYAN} style={s.bullet} />
                <Text style={s.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  card: {
    padding: 16,
    borderRadius: BAL.R_LG,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.12)",
  },
  cardTitle: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: BAL.CYAN, marginBottom: 10 },
  itemList: { gap: 7 },
  itemRow: { flexDirection: "row", gap: 9 },
  bullet: { marginTop: 1 },
  itemText: { flex: 1, fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_200, lineHeight: 19 },
});
