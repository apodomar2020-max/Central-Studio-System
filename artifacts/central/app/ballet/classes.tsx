/**
 * app/ballet/classes.tsx — Ballet Classes
 *
 * Uses REAL ballet classes from the existing API (useListClasses +
 * useListSchedules + useListInstructors), filtered to ballet categories via
 * the existing adapter's `isBallet` flag. No new backend logic.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  useListClasses,
  useListInstructors,
  useListSchedules,
} from "@workspace/api-client-react";

import {
  compareSchedulesByNextOccurrence,
  isMobileVisibleSchedule,
  mapApiClassWithScheduleToMobile,
  mapApiInstructorToMobile,
} from "@/data/apiAdapters";
import type { DanceClass, Instructor } from "@/data/mockData";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

export default function BalletClassesScreen() {
  const classesQuery = useListClasses();
  const schedulesQuery = useListSchedules();
  const instructorsQuery = useListInstructors();

  const isLoading =
    classesQuery.isLoading || schedulesQuery.isLoading || instructorsQuery.isLoading;

  const instructorById = useMemo(() => {
    const m = new Map<string, Instructor>();
    (instructorsQuery.data ?? []).map(mapApiInstructorToMobile).forEach((i) => m.set(i.id, i));
    return m;
  }, [instructorsQuery.data]);

  const balletClasses: DanceClass[] = useMemo(() => {
    const byClassId = new Map<number, NonNullable<typeof schedulesQuery.data>[number]>();
    const scheduledClassIds = new Set((schedulesQuery.data ?? []).map((schedule) => schedule.classId));
    const visibleScheduledClassIds = new Set<number>();
    [...(schedulesQuery.data ?? [])]
      .filter(isMobileVisibleSchedule)
      .sort((a, b) => compareSchedulesByNextOccurrence(a, b))
      .forEach((sch) => {
        visibleScheduledClassIds.add(sch.classId);
        if (!byClassId.has(sch.classId)) byClassId.set(sch.classId, sch);
      });
    return (classesQuery.data ?? [])
      .filter((c) => c.isActive)
      .filter((c) => !scheduledClassIds.has(c.id) || visibleScheduledClassIds.has(c.id))
      .map((c) => mapApiClassWithScheduleToMobile(c, byClassId.get(c.id), 0))
      .filter((c) => c.isBallet);
  }, [classesQuery.data, schedulesQuery.data]);

  function availabilityChip(c: DanceClass) {
    const avail = Math.max(0, c.capacity - c.bookedCount);
    const color = avail === 0 ? BAL.MAGENTA : avail <= 3 ? BAL.AMBER : BAL.SUCCESS;
    return { label: avail === 0 ? "Full" : `${avail} left`, color };
  }

  return (
    <BalletPageShell title="Ballet Classes" contentStyle={s.content}>
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : balletClasses.length === 0 ? (
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
        balletClasses.map((c) => {
          const chip = availabilityChip(c);
          const instructor = instructorById.get(c.instructorId);
          return (
            <View key={c.id} style={s.card}>
              <View style={s.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.className}>{c.title}</Text>
                  <Text style={s.classLevel}>{c.categoryName}</Text>
                </View>
                <View style={[s.availPill, { backgroundColor: chip.color + "22" }]}>
                  <Text style={[s.availPillText, { color: chip.color }]}>{chip.label}</Text>
                </View>
              </View>

              <View style={s.metaWrap}>
                {!!c.startTime && (
                  <View style={s.metaItem}>
                    <Ionicons name="time-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>{c.startTime} · {c.duration}</Text>
                  </View>
                )}
                {!!c.dayOfWeek && (
                  <View style={s.metaItem}>
                    <Ionicons name="calendar-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>{c.dayOfWeek}</Text>
                  </View>
                )}
                {!!instructor && (
                  <View style={s.metaItem}>
                    <Ionicons name="person-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>{instructor.name}</Text>
                  </View>
                )}
                {!!c.location && (
                  <View style={s.metaItem}>
                    <Ionicons name="location-outline" size={13} color={BAL.INK_400} />
                    <Text style={s.metaText}>{c.location}</Text>
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
  availPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: BAL.R_PILL, alignSelf: "flex-start" },
  availPillText: { fontSize: 10, fontFamily: "Archivo_700Bold" },
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
