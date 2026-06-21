/**
 * My QR — dedicated full-screen studio pass.
 *
 * Renders the student's check-in QR code at maximum size, with name, active
 * package summary, and remaining credits. The payload matches the profile modal:
 *   JSON.stringify({ app: "centralstudio", token: user.qrToken })
 *
 * Admins scan this to check the student in via POST /api/check-in/qr.
 */
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";

export default function MyQRScreen() {
  const insets = useSafeAreaInsets();
  const { user, userPackages } = useAppContext();

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
            <Text style={styles.headerButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Studio Pass</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="person-outline" size={48} color="#4B5563" />
          <Text style={styles.emptyTitle}>Not signed in</Text>
          <Text style={styles.emptyDesc}>Sign in to view your studio pass</Text>
        </View>
      </View>
    );
  }

  const activePackages = userPackages.filter(
    (p) => p.status === "active" && new Date(p.expiryDate) >= new Date()
  );
  const totalCredits = activePackages.reduce((sum, p) => sum + (p.remainingCredits ?? 0), 0);

  const qrValue = user.qrToken
    ? JSON.stringify({ app: "centralstudio", token: user.qrToken })
    : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Studio Pass</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 40 : 100 }]}
      >
        {/* Pass card */}
        <LinearGradient
          colors={["#003A47", "#001828"]}
          style={styles.passCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* Studio branding */}
          <View style={styles.passHeader}>
            <Text style={styles.passStudio}>CENTRAL STUDIO</Text>
            <Text style={styles.passTagline}>STUDIO PASS</Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* QR code */}
          <View style={styles.qrWrap}>
            {qrValue ? (
              <QRCode
                value={qrValue}
                size={220}
                color="#000000"
                backgroundColor="#FFFFFF"
              />
            ) : (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={56} color="#9CA3AF" />
                <Text style={styles.qrPlaceholderText}>
                  Your pass is being prepared.{"\n"}Contact reception if this persists.
                </Text>
              </View>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Student details */}
          <View style={styles.studentInfo}>
            <Text style={styles.studentName}>{user.fullName}</Text>
            <Text style={styles.studentEmail}>{user.email}</Text>
          </View>
        </LinearGradient>

        {/* Credits / packages summary */}
        {activePackages.length > 0 ? (
          <View style={styles.creditsCard}>
            <View style={styles.creditsRow}>
              <View style={[styles.creditBox, { borderColor: colors.studio.primary + "40" }]}>
                <Text style={[styles.creditValue, { color: colors.studio.primary }]}>{totalCredits}</Text>
                <Text style={styles.creditLabel}>Credits</Text>
              </View>
              <View style={[styles.creditBox, { borderColor: "#22C55E40" }]}>
                <Text style={[styles.creditValue, { color: "#22C55E" }]}>{activePackages.length}</Text>
                <Text style={styles.creditLabel}>Active{"\n"}Package{activePackages.length !== 1 ? "s" : ""}</Text>
              </View>
            </View>

            {activePackages.slice(0, 2).map((pkg) => (
              <View key={pkg.id} style={styles.pkgRow}>
                <View style={styles.pkgDot} />
                <Text style={styles.pkgName} numberOfLines={1}>{pkg.packageTitle}</Text>
                <Text style={styles.pkgCredits}>{pkg.remainingCredits} left</Text>
              </View>
            ))}
            {activePackages.length > 2 && (
              <Text style={styles.pkgMore}>+{activePackages.length - 2} more package{activePackages.length - 2 !== 1 ? "s" : ""}</Text>
            )}
          </View>
        ) : (
          <View style={styles.noPackageCard}>
            <Ionicons name="card-outline" size={22} color="#4B5563" />
            <Text style={styles.noPackageText}>No active packages</Text>
            <Text style={styles.noPackageDesc}>Purchase a package to start booking classes</Text>
          </View>
        )}

        {/* Hint */}
        <Text style={styles.hint}>
          Show this QR code to the admin to check in to a class or use a package credit.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: {
    flexDirection: "row", alignItems: "center", gap: 4, minWidth: 54,
  },
  headerButtonText: {
    fontSize: 14, fontFamily: "Archivo_600SemiBold", color: colors.studio.primary,
  },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  headerButtonPlaceholder: { minWidth: 54 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  passCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 20,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.38)",
  },
  passHeader: { alignItems: "center", gap: 4 },
  passStudio: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: colors.studio.primary, letterSpacing: 3 },
  passTagline: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#6B747F", letterSpacing: 2 },
  divider: { width: "100%", height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  qrWrap: {
    backgroundColor: "#FFFFFF",
    padding: 16,
    borderRadius: 16,
  },
  qrPlaceholder: {
    width: 220, height: 220,
    alignItems: "center", justifyContent: "center",
    gap: 12,
  },
  qrPlaceholderText: {
    fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF",
    textAlign: "center", lineHeight: 18,
  },
  studentInfo: { alignItems: "center", gap: 4 },
  studentName: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  studentEmail: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  creditsCard: {
    backgroundColor: "#15171B",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  creditsRow: { flexDirection: "row", gap: 10 },
  creditBox: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.02)" },
  creditValue: { fontSize: 24, fontFamily: "Anton_400Regular" },
  creditLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#9CA3AF", textAlign: "center", textTransform: "uppercase" },
  pkgRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  pkgDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#1FB871" },
  pkgName: { flex: 1, fontSize: 13, fontFamily: "Archivo_600SemiBold", color: "#FFFFFF" },
  pkgCredits: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#1FB871" },
  pkgMore: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B747F", textAlign: "center", paddingTop: 4 },
  noPackageCard: {
    backgroundColor: "#15171B",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  noPackageText: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  noPackageDesc: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center" },
  hint: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B747F", textAlign: "center", lineHeight: 18 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  emptyDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
});
