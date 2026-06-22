/**
 * app/ballet/performances.tsx — Performance Opportunities
 *
 * Static program marketing content (showcases, recitals, competitions),
 * mirroring the design source. There is no backend table for performances
 * yet — documented in the backend gap report.
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

type Perf = {
  id: string;
  type: "Showcase" | "Recital" | "Competition";
  title: string;
  date: string;
  loc: string;
  elig: string;
  accent: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const PERFORMANCES: Perf[] = [
  { id: "s1", type: "Showcase",   title: "Annual Ballet Showcase",     date: "Dec 20, 2026", loc: "Cairo Opera House",        elig: "Intermediate & above",     accent: BAL.CYAN,  icon: "sparkles-outline" },
  { id: "s2", type: "Recital",    title: "Spring Recital",             date: "Apr 15, 2027", loc: "Central Studio Main Hall", elig: "All levels",               accent: BAL.CYAN,  icon: "musical-notes-outline" },
  { id: "s3", type: "Competition",title: "ISTD Regional Competition",  date: "Feb 8, 2027",  loc: "Cairo",                    elig: "Advanced & Professional",  accent: BAL.AMBER, icon: "trophy-outline" },
];

export default function BalletPerformancesScreen() {
  return (
    <BalletPageShell title="Performances" contentStyle={s.content}>
      {PERFORMANCES.map((p) => (
        <View key={p.id} style={[s.card, { borderColor: p.accent + "33" }]}>
          <View style={s.typeRow}>
            <View style={[s.iconBox, { backgroundColor: p.accent + "1F" }]}>
              <Ionicons name={p.icon} size={18} color={p.accent} />
            </View>
            <View style={[s.typePill, { backgroundColor: p.accent + "22" }]}>
              <Text style={[s.typePillText, { color: p.accent }]}>{p.type}</Text>
            </View>
          </View>
          <Text style={s.title}>{p.title}</Text>
          <View style={s.metaList}>
            <View style={s.metaItem}>
              <Ionicons name="calendar-outline" size={14} color={BAL.INK_400} />
              <Text style={s.metaText}>{p.date}</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="location-outline" size={14} color={BAL.INK_400} />
              <Text style={s.metaText}>{p.loc}</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="checkmark-circle-outline" size={14} color={BAL.SUCCESS} />
              <Text style={s.metaText}>Eligibility: {p.elig}</Text>
            </View>
          </View>
        </View>
      ))}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  card: {
    padding: 16,
    borderRadius: BAL.R_LG,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
  },
  typeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  iconBox: {
    width: 34, height: 34, borderRadius: BAL.R_MD,
    alignItems: "center", justifyContent: "center",
  },
  typePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: BAL.R_PILL },
  typePillText: {
    fontSize: 10, fontFamily: "Archivo_800ExtraBold",
    letterSpacing: 0.7, textTransform: "uppercase",
  },
  title: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#fff", marginBottom: 8 },
  metaList: { gap: 5 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  metaText: { fontSize: 12.5, fontFamily: "Archivo_600SemiBold", color: BAL.INK_300 },
});
