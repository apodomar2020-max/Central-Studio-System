/**
 * app/ballet/contact.tsx — Contact Ballet Department
 *
 * Source of truth:
 *   GET /api/ballet/settings → admin-managed Ballet contact settings.
 *
 * Missing contact fields are hidden instead of rendered as empty cards.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchBalletSettings, type BalletSettings } from "@/services/balletAssessmentService";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const BASE = "#0A0B0D";
const CYAN = "#00B6D7";
const INK_200 = "#D1D5DB";
const INK_300 = "#9CA3AF";
const INK_400 = "#6B7280";
const R_MD = 12;

type ContactRow = {
  key: string;
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  url: string;
};

function whatsappUrl(number: string): string {
  return `https://wa.me/${number.replace(/[^0-9]/g, "")}`;
}

function buildRows(settings: BalletSettings | null): ContactRow[] {
  if (!settings) return [];
  const rows: ContactRow[] = [];
  if (settings.whatsappNumber?.trim()) {
    rows.push({
      key: "whatsapp",
      label: "WhatsApp",
      sub: settings.whatsappNumber.trim(),
      icon: "logo-whatsapp",
      url: whatsappUrl(settings.whatsappNumber),
    });
  }
  if (settings.phoneNumber?.trim()) {
    rows.push({
      key: "phone",
      label: "Phone",
      sub: settings.phoneNumber.trim(),
      icon: "call-outline",
      url: `tel:${settings.phoneNumber.trim()}`,
    });
  }
  if (settings.email?.trim()) {
    rows.push({
      key: "email",
      label: "Email",
      sub: settings.email.trim(),
      icon: "mail-outline",
      url: `mailto:${settings.email.trim()}`,
    });
  }
  if (settings.studioLocationUrl?.trim()) {
    rows.push({
      key: "location",
      label: "Studio Location",
      sub: settings.studioLocationUrl.trim(),
      icon: "location-outline",
      url: settings.studioLocationUrl.trim(),
    });
  }
  return rows;
}

export default function BalletContactScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [settings, setSettings] = useState<BalletSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(settings), [settings]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBalletSettings(signal);
      if (signal?.aborted) return;
      setSettings(data);
    } catch (err) {
      if ((err as any)?.name === "AbortError") return;
      setSettings(null);
      setErrorMessage("Unable to load Ballet contact information right now.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function open(url: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {
      // Device has no handler for this scheme.
    });
  }

  return (
    <View style={s.screen}>
      <LinearGradient
        colors={["rgba(0,182,215,0.22)", "rgba(0,182,215,0.08)", "transparent"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[s.atmosphericGlow, { height: topPad + 240 }]}
        pointerEvents="none"
      />

      <View style={s.headerWrap}>
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.58)", "rgba(0,0,0,0)"]}
          locations={[0, 0.58, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[s.header, { paddingTop: topPad + 14 }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={CYAN} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces>
        <View style={[s.heroSection, { minHeight: topPad + 222 }]}>
          <LinearGradient
            colors={[BASE, "rgba(0,182,215,0.12)", BASE]}
            locations={[0, 0.48, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[
              "rgba(5,6,8,0.12)",
              "rgba(5,6,8,0.34)",
              "rgba(5,6,8,0.78)",
              "rgba(5,6,8,0.96)",
            ]}
            locations={[0, 0.3, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <View style={[s.heroContent, { paddingTop: topPad + 54 }]}>
            <Text style={s.heroEyebrow}>Central Studio</Text>
            <Text style={s.heroTitle}>{"BALLET\nCONTACT"}</Text>
            <Text style={s.heroDesc}>
              Reach the Ballet department for program questions, assessments, and class support.
            </Text>
          </View>
        </View>

        <View style={s.heroDivider} />

        <View style={s.content}>
          {isLoading ? (
            <View style={s.center}>
              <ActivityIndicator color={CYAN} />
            </View>
          ) : errorMessage ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="alert-circle-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>Contact unavailable</Text>
              <Text style={s.emptyDesc}>{errorMessage}</Text>
              <TouchableOpacity
                onPress={() => {
                  const ctrl = new AbortController();
                  load(ctrl.signal);
                }}
                style={s.retryButton}
                activeOpacity={0.82}
              >
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : rows.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={28} color={INK_400} />
              </View>
              <Text style={s.emptyTitle}>No contact details listed yet</Text>
              <Text style={s.emptyDesc}>Ballet contact information will appear here soon.</Text>
            </View>
          ) : (
            <>
              <View style={s.infoCard}>
                <Text style={s.infoTitle}>Ballet Department</Text>
                <Text style={s.infoSub}>
                  We're here to help with any question about the program, assessments, or classes.
                </Text>
                <View style={s.responseRow}>
                  <Ionicons name="time-outline" size={13} color={CYAN} />
                  <Text style={s.responseText}>Typical response within 24 hours</Text>
                </View>
              </View>

              {rows.map((row) => (
                <TouchableOpacity key={row.key} onPress={() => open(row.url)} style={s.row} activeOpacity={0.82}>
                  <View style={s.rowIcon}>
                    <Ionicons name={row.icon} size={20} color={CYAN} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>{row.label}</Text>
                    <Text style={s.rowSub} numberOfLines={2}>{row.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={CYAN} style={{ opacity: 0.5 }} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>

        <View style={{ height: Platform.OS === "web" ? 120 : 80 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BASE },
  atmosphericGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  headerWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: CYAN,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroSection: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,182,215,0.12)",
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  heroEyebrow: {
    fontSize: 10,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: CYAN,
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 44,
    fontFamily: "Anton_400Regular",
    textTransform: "uppercase",
    lineHeight: 40,
    letterSpacing: 0.5,
    color: "#FFFFFF",
    marginBottom: 8,
    ...iosDisplayTextStyle(44, 40),
    marginTop: -iosCapGuard(44, 40),
  },
  heroDesc: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: INK_200,
    lineHeight: 21,
    maxWidth: 330,
  },
  heroDivider: {
    height: 1,
    backgroundColor: "rgba(0,182,215,0.12)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
  },
  infoCard: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: "rgba(0,182,215,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
    alignItems: "center",
    marginBottom: 2,
  },
  infoTitle: {
    fontSize: 28,
    fontFamily: "Anton_400Regular",
    color: "#fff",
    textTransform: "uppercase",
    textAlign: "center",
    letterSpacing: 0.4,
    ...iosDisplayTextStyle(28, 30),
    marginBottom: 6 - iosCapGuard(28, 30),
  },
  infoSub: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_300,
    textAlign: "center",
    lineHeight: 20,
  },
  responseRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  responseText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: CYAN },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    paddingHorizontal: 16,
    backgroundColor: "#15171B",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.18)",
    borderRadius: 18,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#fff" },
  rowSub: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: INK_400, marginTop: 1 },
  center: {
    paddingVertical: 54,
    alignItems: "center",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Archivo_700Bold",
    color: "#fff",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: INK_400,
    textAlign: "center",
    lineHeight: 19,
  },
  retryButton: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: R_MD,
    backgroundColor: "rgba(0,182,215,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.35)",
  },
  retryText: {
    fontSize: 13,
    fontFamily: "Archivo_700Bold",
    color: CYAN,
  },
});
