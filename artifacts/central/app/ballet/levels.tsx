/**
 * app/ballet/levels.tsx — Ballet Levels (program curriculum)
 *
 * Static program content matching the design's 6 marketing tiers
 * (Pre Ballet → Professional). Age range, descriptions, skills and
 * progression are curriculum marketing info — NOT user-specific data.
 *
 * Backend note: the DB `ballet_levels` table stores level NAMES only
 * (Pre-Ballet + Level 1–9) and is exposed via an admin-only route. The
 * rich per-level metadata below has no public endpoint yet — documented
 * in the backend gap report.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

type Level = {
  id: string;
  name: string;
  age: string;
  weekly: number;
  exp: string;
  accent: string;
  desc: string;
  skills: string[];
  next: string;
};

const LEVELS: Level[] = [
  { id: "pre",  name: "Pre Ballet",   age: "3–5 yrs",  weekly: 2, exp: "None required",  accent: BAL.MAGENTA, desc: "Playful movement exploration through music, rhythm and imaginative play.",   skills: ["Coordination", "Balance", "Music response"], next: "Beginner" },
  { id: "beg",  name: "Beginner",     age: "5–8 yrs",  weekly: 2, exp: "6 months min",   accent: BAL.CYAN,    desc: "Foundation of classical ballet — positions, basic barre and centre work.",    skills: ["Positions 1–3", "Plié & relevé", "Basic barre"], next: "Elementary" },
  { id: "elem", name: "Elementary",   age: "8–12 yrs", weekly: 3, exp: "2 years min",    accent: BAL.CYAN,    desc: "Technical proficiency and artistry development across full syllabus.",        skills: ["All 5 positions", "Centre work", "Port de bras"], next: "Intermediate" },
  { id: "int",  name: "Intermediate", age: "12–16 yrs",weekly: 4, exp: "4 years min",    accent: BAL.AMBER,   desc: "Advanced classical vocabulary, pointe work and performance skills.",          skills: ["Allegro combinations", "Fouetté turns", "Pointe work"], next: "Advanced" },
  { id: "adv",  name: "Advanced",     age: "14+ yrs",  weekly: 5, exp: "6 years min",    accent: BAL.SUCCESS, desc: "Pre-professional training with the full classical ballet syllabus.",          skills: ["Grand allegro", "Pointe variations", "Pas de deux"], next: "Professional" },
  { id: "pro",  name: "Professional", age: "16+ yrs",  weekly: 6, exp: "Assessment req.", accent: "#FFB81C",  desc: "Elite conservatory-level training with competition and performance focus.",   skills: ["Full repertoire", "Solo variations", "Competition prep"], next: "—" },
];

export default function BalletLevelsScreen() {
  return (
    <BalletPageShell title="Ballet Levels" contentStyle={s.content}>
      {LEVELS.map((l) => (
        <View key={l.id} style={s.card}>
          {/* header row */}
          <View style={s.rowBetween}>
            <View style={[s.namePill, { backgroundColor: l.accent + "26" }]}>
              <Text style={[s.namePillText, { color: l.accent }]}>{l.name}</Text>
            </View>
            <Text style={s.age}>{l.age}</Text>
          </View>

          {/* description */}
          <Text style={s.desc}>{l.desc}</Text>

          {/* skill chips */}
          <View style={s.skillRow}>
            {l.skills.map((sk) => (
              <View key={sk} style={s.skillChip}>
                <Text style={s.skillChipText}>{sk}</Text>
              </View>
            ))}
          </View>

          {/* meta footer */}
          <View style={s.metaRow}>
            <View style={s.metaItem}>
              <Ionicons name="calendar-outline" size={13} color={BAL.CYAN} />
              <Text style={s.metaText}>{l.weekly}×/week</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="school-outline" size={13} color={BAL.INK_400} />
              <Text style={s.metaText}>{l.exp}</Text>
            </View>
            <View style={s.metaItem}>
              <Ionicons name="arrow-forward" size={13} color={BAL.INK_400} />
              <Text style={s.metaText}>{l.next}</Text>
            </View>
          </View>
        </View>
      ))}

      {/* Apply CTA */}
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push("/ballet/assessment" as any);
        }}
        style={s.applyCTA}
        activeOpacity={0.88}
      >
        <Text style={s.applyCTAText}>✦ Apply Now</Text>
      </TouchableOpacity>
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  card: {
    padding: 16,
    paddingVertical: 14,
    borderRadius: BAL.R_LG,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  namePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: BAL.R_PILL },
  namePillText: {
    fontSize: 10,
    fontFamily: "Archivo_800ExtraBold",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  age: { fontSize: 12, fontFamily: "Archivo_700Bold", color: BAL.INK_400 },
  desc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_300, lineHeight: 19, marginBottom: 8 },
  skillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  skillChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BAL.R_PILL,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  skillChipText: { fontSize: 10, fontFamily: "Archivo_600SemiBold", color: BAL.INK_200 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 9 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: BAL.INK_400 },
  applyCTA: {
    marginTop: 10,
    paddingVertical: 15,
    backgroundColor: BAL.CYAN,
    borderRadius: BAL.R_MD,
    alignItems: "center",
    shadowColor: BAL.CYAN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  applyCTAText: { fontSize: 15, fontFamily: "Archivo_800ExtraBold", color: "#fff", letterSpacing: 0.3 },
});
