/**
 * app/ballet/instructors.tsx — Ballet Faculty
 *
 * Uses REAL instructors from the existing API (useListInstructors), filtered
 * to ballet specialty via the adapter's danceStyles. No new backend logic.
 * If no instructor lists "Ballet" as a specialty, all instructors are shown
 * (the studio is ballet-focused) with the gap documented.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useListInstructors } from "@workspace/api-client-react";

import { mapApiInstructorToMobile } from "@/data/apiAdapters";
import type { Instructor } from "@/data/mockData";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

function styleLabel(title?: string) {
  return (title ?? "").replace(/\s*Instructor\s*$/i, "").trim() || "Ballet Faculty";
}

export default function BalletInstructorsScreen() {
  const instructorsQuery = useListInstructors();

  const faculty: Instructor[] = useMemo(() => {
    const all = (instructorsQuery.data ?? []).map(mapApiInstructorToMobile);
    const ballet = all.filter((i) =>
      i.danceStyles.some((d) => d.toLowerCase().includes("ballet")),
    );
    // Fall back to the full roster if no specialty tag matches ballet.
    return ballet.length > 0 ? ballet : all;
  }, [instructorsQuery.data]);

  return (
    <BalletPageShell title="Instructors" contentStyle={s.content}>
      {instructorsQuery.isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : faculty.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="people-outline" size={28} color={BAL.INK_400} />
          </View>
          <Text style={s.emptyTitle}>No faculty listed yet</Text>
          <Text style={s.emptyDesc}>Our ballet faculty will appear here soon.</Text>
        </View>
      ) : (
        faculty.map((i) => (
          <View key={i.id} style={s.card}>
            <View style={s.cardTop}>
              {i.photoUrl ? (
                <Image source={{ uri: i.photoUrl }} style={s.avatar} resizeMode="cover" />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarInitials}>{i.initials}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{i.name}</Text>
                <Text style={s.title}>{styleLabel(i.title)}</Text>
                {i.totalClasses > 0 && (
                  <Text style={s.exp}>{i.totalClasses} yrs experience</Text>
                )}
              </View>
            </View>
            {!!i.bio && <Text style={s.bio}>{i.bio}</Text>}
          </View>
        ))
      )}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  center: { paddingVertical: 60, alignItems: "center" },
  card: {
    padding: 16,
    borderRadius: BAL.R_LG,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.16)",
  },
  cardTop: { flexDirection: "row", gap: 14, marginBottom: 10 },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, borderColor: BAL.CYAN,
    backgroundColor: BAL.SURFACE,
  },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitials: { fontSize: 18, fontFamily: "Archivo_800ExtraBold", color: BAL.CYAN },
  name: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#fff" },
  title: { fontSize: 13, fontFamily: "Archivo_700Bold", color: BAL.CYAN, marginTop: 2 },
  exp: { fontSize: 12, fontFamily: "Archivo_400Regular", color: BAL.INK_400, marginTop: 3 },
  bio: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_300, lineHeight: 20 },
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 8 },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_400, textAlign: "center" },
});
