/**
 * app/ballet/instructors.tsx — Ballet Faculty
 *
 * Uses the dedicated public GET /api/ballet/instructors endpoint (Phase 4a),
 * which only ever returns active Ballet instructors — no heuristic
 * category/specialty filtering needed, and no generic /api/classes|instructors
 * data involved.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { normalizeMediaUrl } from "@workspace/api-client-react";

import { fetchBalletInstructors, type BalletInstructor } from "@/services/balletAssessmentService";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function titleFromSpecialties(specialties: string[]): string {
  return specialties.length ? `${specialties.join(" & ")} Instructor` : "Instructor";
}

function styleLabel(title: string) {
  return title.replace(/\s*Instructor\s*$/i, "").trim() || "Ballet Faculty";
}

function InstructorAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);

  if (photoUrl && !failed) {
    return <Image source={{ uri: photoUrl }} style={s.avatar} resizeMode="cover" onError={() => setFailed(true)} />;
  }

  return (
    <View style={[s.avatar, s.avatarFallback]}>
      <Text style={s.avatarInitials}>{initialsFromName(name)}</Text>
    </View>
  );
}

export default function BalletInstructorsScreen() {
  const [instructors, setInstructors] = useState<BalletInstructor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const data = await fetchBalletInstructors(signal);
      if (signal?.aborted) return;
      setInstructors(data);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      // Degrade to the existing empty state — matches the previous
      // react-query-hook behaviour where a failed fetch left `data` undefined.
      setInstructors([]);
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
    <BalletPageShell title="Instructors" contentStyle={s.content}>
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : instructors.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="people-outline" size={28} color={BAL.INK_400} />
          </View>
          <Text style={s.emptyTitle}>No faculty listed yet</Text>
          <Text style={s.emptyDesc}>Our ballet faculty will appear here soon.</Text>
        </View>
      ) : (
        instructors.map((i) => {
          const title = titleFromSpecialties(i.specialties);
          const photoUrl = normalizeMediaUrl(i.photoUrl, "image");
          return (
            <View key={i.id} style={s.card}>
              <View style={s.cardTop}>
                <InstructorAvatar name={i.name} photoUrl={photoUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{i.name}</Text>
                  <Text style={s.title}>{styleLabel(title)}</Text>
                  {i.experienceYears > 0 && (
                    <Text style={s.exp}>{i.experienceYears} yrs experience</Text>
                  )}
                </View>
              </View>
              {!!i.bio && <Text style={s.bio}>{i.bio}</Text>}
            </View>
          );
        })
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
