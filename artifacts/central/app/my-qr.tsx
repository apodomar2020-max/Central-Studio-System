/**
 * My Studio Pass — full-screen member pass (design: StudioPassFull).
 *
 * Renders the student's secure check-in QR (payload
 *   JSON.stringify({ app: "centralstudio", token: user.qrToken })
 * ) plus membership info and attendance stats. Admins scan this to check the
 * student in via POST /api/check-in/qr. All data is real (user, packages,
 * bookings) — nothing is faked.
 */
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";

import { useAppContext } from "@/contexts/AppContext";
import CentralBackButton from "@/components/CentralBackButton";
import { formatApiDate, parseApiDate } from "@/utils/dateTime";
import { nextStepRoute } from "@/services/authProfile";
import { iosCapGuard, iosDisplayTextStyle } from "@/utils/iosTypography";

const CYAN = "#00B6D7";
const CYAN_400 = "#2DCDEC";
const SUCCESS = "#1FB871";
const AMBER = "#FFB02E";
const INK_400 = "#6B747F";
const INK_800 = "#15171B";
const BORDER = "rgba(255,255,255,0.08)";

export default function MyQRScreen() {
  const insets = useSafeAreaInsets();
  const { user, userPackages, bookings } = useAppContext();
  const topPad = (Platform.OS === "web" ? 67 : insets.top) + 12;

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={{ paddingTop: topPad, paddingHorizontal: 20, paddingBottom: 16 }}>
          <CentralBackButton style={styles.backBtnStatic} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Not signed in</Text>
          <Text style={styles.emptyDesc}>Sign in to view your studio pass</Text>
        </View>
      </View>
    );
  }

  // Guard: profile must be complete (Profile Completion Engine, Phase 4) —
  // no QR membership until the account is fully set up.
  if (user.profileCompletion && !user.profileCompletion.isComplete) {
    return (
      <View style={styles.container}>
        <View style={{ paddingTop: topPad, paddingHorizontal: 20, paddingBottom: 16 }}>
          <CentralBackButton style={styles.backBtnStatic} />
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Complete your profile first</Text>
          <Text style={styles.emptyDesc}>Finish setting up your profile to receive your QR membership.</Text>
          <TouchableOpacity
            onPress={() => router.push(nextStepRoute(user.profileCompletion!.nextStep) as never)}
            style={[styles.backBtnStatic, { marginTop: 16 }]}
            activeOpacity={0.85}
          >
            <Text style={styles.backText}>Complete Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const activePackages = userPackages.filter(
    (p) => {
      const expiryDate = parseApiDate(p.expiryDate);
      return p.status === "active" && Boolean(expiryDate && expiryDate >= new Date());
    },
  );
  const totalCredits = activePackages.reduce((sum, p) => sum + (p.remainingCredits ?? 0), 0);
  const primaryPkg = activePackages[0];

  const totalBookings = bookings.length;
  const attended = bookings.filter(
    (b) => b.bookingStatus === "attended" || b.attendanceStatus === "attended",
  ).length;
  const attendancePct = totalBookings ? Math.round((attended / totalBookings) * 100) : 0;

  const initials = user.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const memberId = `CS-MEM-${String(user.id).replace(/\D/g, "").padStart(5, "0").slice(-5)}`;
  const fmtDate = (d?: string) =>
    formatApiDate(d, "—", { day: "numeric", month: "short", year: "numeric" });

  const qrValue = user.qrToken
    ? JSON.stringify({ app: "centralstudio", token: user.qrToken })
    : null;

  const infoRows: { label: string; val: string }[] = [
    { label: "Account Type", val: user.accountType === "parent" ? "Parent" : "Student" },
    { label: "Active Package", val: primaryPkg?.packageTitle ?? "No active package" },
    { label: "Credits Left", val: `${totalCredits} credit${totalCredits === 1 ? "" : "s"}` },
    { label: "Package Expires", val: fmtDate(primaryPkg?.expiryDate) },
  ];

  const stats: { val: string; label: string; tint: string }[] = [
    { val: String(totalBookings), label: "Total Bookings", tint: CYAN_400 },
    { val: String(attended), label: "Attended", tint: SUCCESS },
    { val: `${attendancePct}%`, label: "Attendance", tint: AMBER },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 60 : insets.bottom + 40 }}
      >
        {/* Header with cyan radial glow */}
        <View style={[styles.heroHeader, { paddingTop: topPad + 8 }]}>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <RadialGradient id="passGlow" cx="50%" cy="-10%" rx="80%" ry="50%">
                <Stop offset="0%" stopColor={CYAN} stopOpacity={0.28} />
                <Stop offset="60%" stopColor={CYAN} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#passGlow)" />
          </Svg>

          <CentralBackButton style={[styles.backBtn, { top: topPad }]} />

          <Text style={styles.eyebrow}>MEMBER PASS</Text>

          <View style={styles.avatarWrap}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} contentFit="cover" transition={150} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>

          <Text style={styles.name}>{user.fullName}</Text>
          <Text style={styles.memberId}>{memberId}</Text>
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active Member</Text>
          </View>
        </View>

        {/* QR section */}
        <View style={styles.qrSection}>
          <View style={styles.qrBox}>
            {qrValue ? (
              <QRCode value={qrValue} size={180} color="#0A0B0D" backgroundColor="#FFFFFF" />
            ) : (
              <View style={styles.qrPlaceholder}>
                <Text style={styles.qrPlaceholderText}>
                  Your pass is being prepared.{"\n"}Contact reception if this persists.
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.qrCaption}>Show this code at the studio reception to check in</Text>

          {/* Membership info */}
          <View style={styles.infoCard}>
            {infoRows.map((r, i) => (
              <View
                key={r.label}
                style={[styles.infoRow, i < infoRows.length - 1 && styles.infoRowBorder]}
              >
                <Text style={styles.infoLabel}>{r.label}</Text>
                <Text style={styles.infoValue}>{r.val}</Text>
              </View>
            ))}
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            {stats.map((s) => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statVal, { color: s.tint }]}>{s.val}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050608" },
  // header
  heroHeader: {
    paddingHorizontal: 20, paddingBottom: 28, alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  backBtn: {
    position: "absolute", left: 20, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    zIndex: 5,
  },
  backBtnStatic: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
  },
  backText: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#B6BDC6" },
  eyebrow: { fontFamily: "SpaceMono_700Bold", fontSize: 12, letterSpacing: 1.9, textTransform: "uppercase", color: CYAN_400, marginBottom: 16, marginTop: 8 },
  avatarWrap: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: CYAN,
    alignItems: "center", justifyContent: "center",
    shadowColor: CYAN, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  avatarImg: { width: 90, height: 90, borderRadius: 45, backgroundColor: INK_800 },
  avatarCircle: { width: 90, height: 90, borderRadius: 45, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,182,215,0.20)" },
  avatarInitials: { fontFamily: "Anton_400Regular", fontSize: 30, ...iosDisplayTextStyle(30, 34), color: CYAN, marginTop: -iosCapGuard(30, 34) },
  name: { fontFamily: "Archivo_800ExtraBold", fontSize: 24, color: "#FFFFFF", marginTop: 14 },
  memberId: { fontFamily: "SpaceMono_400Regular", fontSize: 12.5, color: INK_400, marginTop: 4, letterSpacing: 1 },
  activePill: {
    flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10,
    paddingHorizontal: 13, paddingVertical: 5, borderRadius: 999,
    backgroundColor: "rgba(31,184,113,0.14)", borderWidth: 1, borderColor: "rgba(31,184,113,0.35)",
  },
  activeDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: SUCCESS },
  activeText: { fontFamily: "Archivo_700Bold", fontSize: 12, color: SUCCESS },
  // qr
  qrSection: { paddingHorizontal: 20, paddingTop: 28, alignItems: "center" },
  qrBox: {
    padding: 16, backgroundColor: "#FFFFFF", borderRadius: 16, marginBottom: 14,
    shadowColor: CYAN, shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  qrPlaceholder: { width: 180, height: 180, alignItems: "center", justifyContent: "center" },
  qrPlaceholderText: { fontFamily: "Archivo_400Regular", fontSize: 12, color: "#6B7280", textAlign: "center", lineHeight: 18 },
  qrCaption: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK_400, textAlign: "center", marginBottom: 28, maxWidth: 260, lineHeight: 19 },
  // info
  infoCard: { width: "100%", backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: "hidden", marginBottom: 16 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  infoLabel: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: INK_400 },
  infoValue: { fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FFFFFF", maxWidth: "60%", textAlign: "right" },
  // stats
  statsRow: { flexDirection: "row", gap: 10, width: "100%", marginBottom: 8 },
  statCard: { flex: 1, alignItems: "center", paddingVertical: 14, paddingHorizontal: 10, backgroundColor: INK_800, borderWidth: 1, borderColor: BORDER, borderRadius: 12 },
  statVal: { fontFamily: "Anton_400Regular", fontSize: 26, lineHeight: 24, ...iosDisplayTextStyle(26, 24), marginTop: Platform.OS === 'ios' ? 3 : 0, marginBottom: Platform.OS === 'ios' ? -10 : 0 },
  statLabel: { fontFamily: "Archivo_400Regular", fontSize: 11, color: INK_400, marginTop: 6, textAlign: "center" },
  // empty
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 },
  emptyTitle: { fontFamily: "Archivo_700Bold", fontSize: 18, color: "#FFFFFF" },
  emptyDesc: { fontFamily: "Archivo_400Regular", fontSize: 14, color: "#9CA3AF", textAlign: "center" },
});
