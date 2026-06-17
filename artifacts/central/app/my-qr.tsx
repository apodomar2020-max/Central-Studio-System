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
        <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Studio Pass</Text>
          <View style={{ width: 40 }} />
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
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Studio Pass</Text>
        <View style={{ width: 40 }} />
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
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2E38",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1E2E38",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  passCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 20,
    borderWidth: 1,
    borderColor: colors.studio.primary + "30",
  },
  passHeader: { alignItems: "center", gap: 4 },
  passStudio: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.studio.primary, letterSpacing: 3 },
  passTagline: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280", letterSpacing: 2 },
  divider: { width: "100%", height: 1, backgroundColor: "#FFFFFF10" },
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
    fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF",
    textAlign: "center", lineHeight: 18,
  },
  studentInfo: { alignItems: "center", gap: 4 },
  studentName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  studentEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  creditsCard: {
    backgroundColor: colors.studio.card,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: "#1E2E38",
  },
  creditsRow: { flexDirection: "row", gap: 10 },
  creditBox: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center", gap: 4 },
  creditValue: { fontSize: 24, fontFamily: "Inter_700Bold" },
  creditLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },
  pkgRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#1E2E38" },
  pkgDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" },
  pkgName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#FFFFFF" },
  pkgCredits: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#22C55E" },
  pkgMore: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", paddingTop: 4 },
  noPackageCard: {
    backgroundColor: colors.studio.card,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#1E2E38",
  },
  noPackageText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  noPackageDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4B5563", textAlign: "center" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4B5563", textAlign: "center", lineHeight: 17 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  emptyDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#4B5563" },
});
