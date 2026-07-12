/**
 * app/ballet/classes.tsx — Ballet Classes
 *
 * Uses the dedicated public GET /api/ballet/classes endpoint (Phase 4a),
 * which only ever returns active Ballet classes with their schedules,
 * instructor, and level/group ids already resolved server-side — no
 * heuristic category filtering against the generic /api/classes needed.
 *
 * Also reads GET /api/ballet/levels to resolve each class's levelIds into
 * display names (the old build showed a generic "Ballet" category label in
 * this slot; the real level names are more useful and were already fetched
 * by this endpoint for free).
 *
 * Note: ballet_classes/ballet_schedules carry no capacity or booking-count
 * columns (unlike the generic classes/schedules tables), so the previous
 * "Full"/"X left" availability pill has no data source under the dedicated
 * Ballet backend and has been removed rather than showing fabricated
 * numbers. See Phase 4C report for details.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  fetchBalletClasses,
  fetchBalletLevels,
  type BalletClass,
  type BalletLevel,
} from "@/services/balletAssessmentService";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "18:00" → "6:00 PM", "09:30" → "9:30 AM" */
function formatTime(timeStr: string): string {
  const [hoursStr = "0", minsStr = "00"] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minsStr} ${ampm}`;
}

export default function BalletClassesScreen() {
  const [classes, setClasses] = useState<BalletClass[]>([]);
  const [levels, setLevels] = useState<BalletLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const [classesData, levelsData] = await Promise.all([
        fetchBalletClasses(signal),
        fetchBalletLevels(signal),
      ]);
      if (signal?.aborted) return;
      setClasses(classesData);
      setLevels(levelsData);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      // Degrade to the existing empty state — matches the previous
      // react-query-hook behaviour where a failed fetch left `data` undefined.
      setClasses([]);
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

  const levelNameById = useMemo(() => {
    const m = new Map<number, string>();
    levels.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [levels]);

  return (
    <BalletPageShell title="Ballet Classes" contentStyle={s.content}>
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : classes.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="calendar-outline" size={28} color={BAL.INK_400} />
          </View>
          <Text style={s.emptyTitle}>No ballet classes yet</Text>
          <Text style={s.emptyDesc}>
            Ballet classes will appear here once they're scheduled. Apply for an
            assessment to get started.
          </Text>
        </View>
      ) : (
        classes.map((c) => {
          const levelNames = c.levelIds
            .map((id) => levelNameById.get(id))
            .filter((name): name is string => !!name)
            .join(", ");

          return (
            <View key={c.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.className}>{c.title}</Text>
                  {!!levelNames && <Text style={s.classLevel}>{levelNames}</Text>}
                </View>
              </View>

              <View style={s.metaWrap}>
                {c.schedules.map((sch) => (
                  <View key={sch.id} style={s.metaItem}>
                    <Ionicons name="time-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>
                      {DAY_NAMES[sch.dayOfWeek] ?? ""} · {formatTime(sch.startTime)} - {formatTime(sch.endTime)}
                    </Text>
                  </View>
                ))}
                {!!c.instructor && (
                  <View style={s.metaItem}>
                    <Ionicons name="person-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>{c.instructor.name}</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/ballet/assessment" as any);
                }}
                style={s.applyBtn}
                activeOpacity={0.85}
              >
                <Text style={s.applyBtnText}>Apply for this class</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  center: { paddingVertical: 60, alignItems: "center" },
  card: {
    padding: 16,
    borderRadius: BAL.R_LG,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  className: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  classLevel: { fontSize: 12.5, fontFamily: "Archivo_700Bold", color: BAL.CYAN, marginTop: 2 },
  metaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12.5, fontFamily: "Archivo_600SemiBold", color: BAL.INK_300 },
  applyBtn: {
    paddingVertical: 10,
    borderRadius: BAL.R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(0,182,215,0.30)",
    alignItems: "center",
  },
  applyBtnText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: BAL.CYAN },
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 8 },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_400, textAlign: "center", lineHeight: 19, maxWidth: 260 },
});
