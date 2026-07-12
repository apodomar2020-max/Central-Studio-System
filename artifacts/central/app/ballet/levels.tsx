/**
 * app/ballet/levels.tsx — Ballet Levels (program curriculum)
 *
 * The list of levels (identity, order, description, requirements, age range)
 * now comes from the real public GET /api/ballet/levels endpoint (Phase 4a),
 * so adding/renaming/reordering/deactivating a level in admin reflects here.
 *
 * weekly/exp/skills/next/accent have no backend equivalent (ballet_levels
 * only stores name/sortOrder/description/requirements/ageMin/ageMax) — they
 * remain local marketing-only display metadata, keyed by level NAME, so the
 * card keeps its existing visual richness. The real seeded level names are
 * "Pre-Ballet" + "Ballet Level 1"–"Ballet Level 9" (see BALLET_LEVELS in
 * balletAssessmentService.ts), which differ from this screen's old fictional
 * 6-tier names ("Beginner", "Elementary", …) — LEVEL_METADATA below is keyed
 * by the real names, with content re-distributed across all 10 real levels
 * as a placeholder; the studio should review/refine this copy. Any level
 * name absent from the map degrades gracefully (its weekly/exp/skills/next
 * chips are simply omitted, never "undefined").
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { fetchBalletLevels, type BalletLevel } from "@/services/balletAssessmentService";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

// ─── Local marketing-only metadata (NOT from the backend) ────────────────────
// Placeholder content re-distributed from the old 6-tier copy across the real
// 10 seeded level names — a judgment call the studio should review, not
// authoritative curriculum data.
type LevelMeta = { weekly: number; exp: string; accent: string; skills: string[]; next: string };

const LEVEL_METADATA: Record<string, LevelMeta> = {
  "Pre-Ballet":     { weekly: 2, exp: "None required",   accent: BAL.MAGENTA, skills: ["Coordination", "Balance", "Music response"], next: "Ballet Level 1" },
  "Ballet Level 1": { weekly: 2, exp: "None required",   accent: BAL.CYAN,    skills: ["Positions 1–3", "Plié & relevé", "Basic barre"], next: "Ballet Level 2" },
  "Ballet Level 2": { weekly: 2, exp: "1 year min",       accent: BAL.CYAN,    skills: ["Positions 1–5", "Centre work basics", "Port de bras"], next: "Ballet Level 3" },
  "Ballet Level 3": { weekly: 3, exp: "2 years min",      accent: BAL.CYAN,    skills: ["All 5 positions", "Centre work", "Port de bras"], next: "Ballet Level 4" },
  "Ballet Level 4": { weekly: 3, exp: "3 years min",      accent: BAL.CYAN,    skills: ["Adagio", "Petit allegro", "Turns"], next: "Ballet Level 5" },
  "Ballet Level 5": { weekly: 4, exp: "4 years min",      accent: BAL.AMBER,   skills: ["Allegro combinations", "Turns", "Pointe prep"], next: "Ballet Level 6" },
  "Ballet Level 6": { weekly: 4, exp: "5 years min",      accent: BAL.AMBER,   skills: ["Fouetté turns", "Pointe work", "Variations"], next: "Ballet Level 7" },
  "Ballet Level 7": { weekly: 5, exp: "6 years min",      accent: BAL.SUCCESS, skills: ["Grand allegro", "Pointe variations", "Partnering basics"], next: "Ballet Level 8" },
  "Ballet Level 8": { weekly: 5, exp: "7 years min",      accent: BAL.SUCCESS, skills: ["Advanced pointe", "Solo variations", "Pas de deux"], next: "Ballet Level 9" },
  "Ballet Level 9": { weekly: 6, exp: "Assessment req.",  accent: "#FFB81C",   skills: ["Full repertoire", "Solo variations", "Competition prep"], next: "—" },
};

const DEFAULT_ACCENT = BAL.CYAN;

function ageLabel(level: BalletLevel): string {
  if (level.ageMin != null && level.ageMax != null) return `${level.ageMin}–${level.ageMax} yrs`;
  if (level.ageMin != null) return `${level.ageMin}+ yrs`;
  if (level.ageMax != null) return `Up to ${level.ageMax} yrs`;
  return "";
}

export default function BalletLevelsScreen() {
  const [levels, setLevels] = useState<BalletLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const data = await fetchBalletLevels(signal);
      if (signal?.aborted) return;
      setLevels(data);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setLevels([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return (
    <BalletPageShell title="Ballet Levels" contentStyle={s.content}>
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : levels.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="ribbon-outline" size={28} color={BAL.INK_400} />
          </View>
          <Text style={s.emptyTitle}>No levels listed yet</Text>
          <Text style={s.emptyDesc}>Ballet level information will appear here soon.</Text>
        </View>
      ) : (
        <>
          {levels.map((l) => {
            const meta = LEVEL_METADATA[l.name];
            const accent = meta?.accent ?? DEFAULT_ACCENT;
            const age = ageLabel(l);
            const desc = l.description ?? "";
            return (
              <View key={l.id} style={s.card}>
                {/* header row */}
                <View style={s.rowBetween}>
                  <View style={[s.namePill, { backgroundColor: accent + "26" }]}>
                    <Text style={[s.namePillText, { color: accent }]}>{l.name}</Text>
                  </View>
                  {!!age && <Text style={s.age}>{age}</Text>}
                </View>

                {/* description + requirements */}
                {!!desc && <Text style={s.desc}>{desc}</Text>}
                {!!l.requirements && <Text style={s.desc}>{l.requirements}</Text>}

                {/* skill chips (marketing metadata only) */}
                {!!meta?.skills.length && (
                  <View style={s.skillRow}>
                    {meta.skills.map((sk) => (
                      <View key={sk} style={s.skillChip}>
                        <Text style={s.skillChipText}>{sk}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* meta footer (marketing metadata only, individually optional) */}
                {(meta?.weekly || meta?.exp || meta?.next) && (
                  <View style={s.metaRow}>
                    {!!meta?.weekly && (
                      <View style={s.metaItem}>
                        <Ionicons name="calendar-outline" size={13} color={BAL.CYAN} />
                        <Text style={s.metaText}>{meta.weekly}×/week</Text>
                      </View>
                    )}
                    {!!meta?.exp && (
                      <View style={s.metaItem}>
                        <Ionicons name="school-outline" size={13} color={BAL.INK_400} />
                        <Text style={s.metaText}>{meta.exp}</Text>
                      </View>
                    )}
                    {!!meta?.next && (
                      <View style={s.metaItem}>
                        <Ionicons name="arrow-forward" size={13} color={BAL.INK_400} />
                        <Text style={s.metaText}>{meta.next}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })}

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
        </>
      )}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 10 },
  center: { paddingVertical: 60, alignItems: "center" },
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
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 8 },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_400, textAlign: "center" },
});
