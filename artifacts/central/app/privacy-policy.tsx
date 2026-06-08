import { Ionicons } from "@expo/vector-icons";
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

import colors from "@/constants/colors";

const SECTIONS = [
  {
    title: "1. Information We Collect",
    body: "We collect information you provide directly to us, such as when you create an account, book a class, or contact us for support. This may include:\n\n• Full name, email address, and phone number\n• Date of birth and gender (for class recommendations)\n• Children's profiles (for parents booking on behalf of children)\n• Payment information processed securely via our payment providers\n• Booking history and class attendance records",
  },
  {
    title: "2. How We Use Your Information",
    body: "We use the information we collect to:\n\n• Process bookings and manage your account\n• Send class reminders, booking confirmations, and important updates\n• Personalise your experience and recommend suitable classes\n• Improve our services and develop new features\n• Comply with legal obligations and resolve disputes",
  },
  {
    title: "3. Information Sharing",
    body: "We do not sell, trade, or rent your personal information to third parties. We may share your information with:\n\n• Instructors — to manage attendance and class rosters\n• Payment processors — to complete transactions securely\n• Service providers — who assist in operating our platform under strict confidentiality agreements\n• Legal authorities — when required by law or to protect our rights",
  },
  {
    title: "4. Data Security",
    body: "We take data security seriously and implement industry-standard measures to protect your information, including encryption of data in transit and at rest. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.",
  },
  {
    title: "5. Your Rights",
    body: "You have the right to:\n\n• Access the personal information we hold about you\n• Request correction of inaccurate or incomplete data\n• Request deletion of your account and associated data\n• Opt out of marketing communications at any time\n• Lodge a complaint with the relevant data protection authority\n\nTo exercise any of these rights, please contact us through the app or at privacy@centralstudio.eg",
  },
  {
    title: "6. Children's Privacy",
    body: "Our service is primarily designed for users aged 13 and over. When parents register children under 18 on the platform, we collect only the information necessary to manage class bookings and assessments. Parental consent is required for all children's profiles.",
  },
  {
    title: "7. Cookies & Analytics",
    body: "We use analytics tools to understand how users interact with our app and improve the experience. This data is collected in aggregate and does not personally identify you. You can opt out of analytics in your device settings.",
  },
  {
    title: "8. Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. We will notify you of significant changes via the app or email. Your continued use of the service after such changes constitutes acceptance of the updated policy.",
  },
  {
    title: "9. Contact Us",
    body: "If you have any questions about this Privacy Policy or how we handle your data, please contact us at:\n\nCentral Studio & Stage\nZamalek, Cairo, Egypt\nEmail: privacy@centralstudio.eg\nPhone: +20 2 XXXX XXXX",
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        <View style={[styles.heroBadge, { backgroundColor: colors.studio.primary + "15", borderColor: colors.studio.primary + "30" }]}>
          <Ionicons name="shield-checkmark" size={20} color={colors.studio.primary} />
          <View>
            <Text style={[styles.heroBadgeTitle, { color: colors.studio.primary }]}>Privacy Policy</Text>
            <Text style={styles.heroBadgeSub}>Last updated: June 2026</Text>
          </View>
        </View>

        <Text style={styles.intro}>
          Central Studio ("we", "us", or "our") is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your personal information when you use our app and services.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}

        <View style={[styles.footerNote, { borderColor: "#1E2E38", backgroundColor: "#0E1619" }]}>
          <Text style={styles.footerNoteText}>
            By using the Central Studio app, you agree to the terms described in this Privacy Policy.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  heroBadgeTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  heroBadgeSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 1 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 22 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  sectionBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 21 },
  footerNote: {
    padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 4,
  },
  footerNoteText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 17 },
});
