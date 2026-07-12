/**
 * app/ballet/performances.tsx — Performance Opportunities
 *
 * Uses the real public GET /api/ballet/performances endpoint (Phase 4a),
 * which returns upcoming admin-managed events (eventDate >= today).
 *
 * eventType is a free-form string set by the admin (not a fixed 3-value
 * union) — icon/accent are chosen via a best-effort keyword match instead of
 * a hardcoded switch, so any admin-entered type still renders sensibly.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { fetchBalletPerformances, type BalletPerformance } from "@/services/balletAssessmentService";
import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";

function iconForType(eventType: string): { icon: React.ComponentProps<typeof Ionicons>["name"]; accent: string } {
  const t = eventType.toLowerCase();
  if (t.includes("competition")) return { icon: "trophy-outline", accent: BAL.AMBER };
  if (t.includes("recital")) return { icon: "musical-notes-outline", accent: BAL.CYAN };
  return { icon: "sparkles-outline", accent: BAL.CYAN };
}

/** ISO date ("2026-12-20") → "20 December 2026". Parsed as local time (not
 *  UTC) so date-only values never shift a day in negative-UTC timezones. */
function formatEventDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function BalletPerformancesScreen() {
  const [performances, setPerformances] = useState<BalletPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const data = await fetchBalletPerformances(signal);
      if (signal?.aborted) return;
      setPerformances(data);
    } catch (e) {
      if ((e as any)?.name === "AbortError") return;
      setPerformances([]);
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
    <BalletPageShell title="Performances" contentStyle={s.content}>
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={BAL.CYAN} />
        </View>
      ) : performances.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="sparkles-outline" size={28} color={BAL.INK_400} />
          </View>
          <Text style={s.emptyTitle}>No performances scheduled yet</Text>
          <Text style={s.emptyDesc}>Upcoming showcases and competitions will appear here.</Text>
        </View>
      ) : (
        performances.map((p) => {
          const { icon, accent } = iconForType(p.eventType);
          const elig = p.requirements.join(", ");
          return (
            <View key={p.id} style={[s.card, { borderColor: accent + "33" }]}>
              <View style={s.typeRow}>
                <View style={[s.iconBox, { backgroundColor: accent + "1F" }]}>
                  <Ionicons name={icon} size={18} color={accent} />
                </View>
                <View style={[s.typePill, { backgroundColor: accent + "22" }]}>
                  <Text style={[s.typePillText, { color: accent }]}>{p.eventType}</Text>
                </View>
              </View>
              <Text style={s.title}>{p.eventTitle}</Text>
              <View style={s.metaList}>
                <View style={s.metaItem}>
                  <Ionicons name="calendar-outline" size={14} color={BAL.INK_400} />
                  <Text style={s.metaText}>{formatEventDate(p.eventDate)}</Text>
                </View>
                {!!p.locationName && (
                  <View style={s.metaItem}>
                    <Ionicons name="location-outline" size={14} color={BAL.INK_400} />
                    <Text style={s.metaText}>{p.locationName}</Text>
                  </View>
                )}
                {!!elig && (
                  <View style={s.metaItem}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={BAL.SUCCESS} />
                    <Text style={s.metaText}>Eligibility: {elig}</Text>
                  </View>
                )}
              </View>
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
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#fff", marginBottom: 8 },
  emptyDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: BAL.INK_400, textAlign: "center" },
});
