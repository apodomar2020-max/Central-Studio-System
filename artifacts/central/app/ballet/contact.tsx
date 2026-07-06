/**
 * app/ballet/contact.tsx — Contact Ballet Department
 *
 * Static contact information mirroring the design source. Uses the device's
 * native Linking (WhatsApp / tel / mailto / maps) — no backend. There is no
 * backend contact-settings table yet; values below are documented as static
 * in the backend gap report.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BalletPageShell, BAL } from "@/components/ballet/BalletPageShell";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const PHONE = "+201123456789";
const EMAIL = "ballet@centralstudio.eg";

type Row = {
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  url: string;
};

const ROWS: Row[] = [
  { label: "WhatsApp",        sub: "+20 11 2345 6789",            icon: "logo-whatsapp",     url: `https://wa.me/${PHONE.replace(/[^0-9]/g, "")}` },
  { label: "Phone",           sub: "+20 11 2345 6789",            icon: "call-outline",      url: `tel:${PHONE}` },
  { label: "Email",           sub: EMAIL,                          icon: "mail-outline",      url: `mailto:${EMAIL}` },
  { label: "Studio Location", sub: "Main Branch, Cairo",          icon: "location-outline",  url: "https://maps.google.com/?q=Central+Studio+Cairo" },
];

export default function BalletContactScreen() {
  function open(url: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {
      // Silently ignore if the device has no handler for the scheme.
    });
  }

  return (
    <BalletPageShell title="Contact" contentStyle={s.content}>
      {/* Header card */}
      <View style={s.heroCard}>
        <Text style={s.heroTitle}>{"Ballet\nDepartment"}</Text>
        <Text style={s.heroSub}>
          We're here to help with any question about the program, assessments, or classes.
        </Text>
        <View style={s.responseRow}>
          <Ionicons name="time-outline" size={13} color={BAL.CYAN} />
          <Text style={s.responseText}>Typical response within 24 hours</Text>
        </View>
      </View>

      {/* Contact rows */}
      {ROWS.map((r) => (
        <TouchableOpacity key={r.label} onPress={() => open(r.url)} style={s.row} activeOpacity={0.82}>
          <View style={s.rowIcon}>
            <Ionicons name={r.icon} size={20} color={BAL.CYAN} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{r.label}</Text>
            <Text style={s.rowSub}>{r.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={BAL.CYAN} style={{ opacity: 0.5 }} />
        </TouchableOpacity>
      ))}
    </BalletPageShell>
  );
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  heroCard: {
    padding: 18,
    borderRadius: BAL.R_LG,
    backgroundColor: "rgba(0,182,215,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.28)",
    alignItems: "center",
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 36,
    fontFamily: "Anton_400Regular",
    color: "#fff",
    textTransform: "uppercase",
    textAlign: "center",
    lineHeight: 34,
    ...iosDisplayTextStyle(36, 34),
    marginBottom: 8 - iosCapGuard(36, 34),
  },
  heroSub: {
    fontSize: 13,
    fontFamily: "Archivo_400Regular",
    color: BAL.INK_300,
    textAlign: "center",
    lineHeight: 20,
  },
  responseRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12 },
  responseText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: BAL.CYAN },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    paddingHorizontal: 16,
    backgroundColor: BAL.CARD,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.14)",
    borderRadius: BAL.R_LG,
  },
  rowIcon: {
    width: 42, height: 42, borderRadius: BAL.R_MD,
    backgroundColor: "rgba(0,182,215,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  rowLabel: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#fff" },
  rowSub: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: BAL.INK_400, marginTop: 1 },
});
