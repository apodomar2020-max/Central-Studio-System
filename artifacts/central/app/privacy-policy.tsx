import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";

import colors from "@/constants/colors";

const FALLBACK_PAGE = {
  title: "Privacy & Policy",
  subtitle: "Last updated: June 2026",
  content: `Central Studio is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your personal information when you use our app and services.

1. Information We Collect
We collect information you provide directly to us, such as when you create an account, book a class, or contact us for support. This may include:

* Full name, email address, and phone number
* Date of birth and gender for class recommendations
* Children's profiles for parents booking on behalf of children
* Payment information processed securely via our payment providers
* Booking history and class attendance records

2. How We Use Your Information
We use the information we collect to process bookings, manage your account, send reminders and confirmations, personalise your experience, improve our services, comply with legal obligations, and resolve disputes.

3. Information Sharing
We do not sell, trade, or rent your personal information to third parties. We may share information with instructors, payment processors, service providers, and legal authorities when required.

4. Data Security
We take data security seriously and implement industry-standard measures to protect your information, including encryption of data in transit and at rest. No internet transmission method is 100% secure.

5. Your Rights
You may request access, correction, or deletion of your personal information, opt out of marketing communications, or lodge a complaint with the relevant authority.

6. Children's Privacy
When parents register children under 18, we collect only the information necessary to manage class bookings and assessments. Parental consent is required for children's profiles.

7. Cookies & Analytics
We use analytics tools to understand how users interact with the app and improve the experience. This data is collected in aggregate.

8. Changes to This Policy
We may update this Privacy Policy from time to time. We will notify you of significant changes via the app or email.

9. Contact Us
Central Studio & Stage
Zamalek, Cairo, Egypt
Email: privacy@centralstudio.eg
Phone: +20 2 XXXX XXXX`,
};

type ContentPage = {
  title: string;
  subtitle?: string | null;
  content: string;
  isActive?: boolean;
};

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    customFetch<ContentPage>("/api/content/pages/privacy-policy")
      .then((data) => {
        if (!active) return;
        setPage(data);
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status =
          err !== null && typeof err === "object" && "status" in err
            ? (err as { status: number }).status
            : 0;
        if (status === 404) {
          setUnavailable(true);
          setPage({
            title: "Privacy & Policy",
            subtitle: null,
            content: "Privacy & Policy is currently unavailable. Please contact the studio if you need a copy.",
          });
        } else {
          setPage(FALLBACK_PAGE);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{page.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        <View style={[styles.heroBadge, { backgroundColor: colors.studio.primary + "15", borderColor: colors.studio.primary + "30" }]}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.studio.primary} />
          ) : (
            <Ionicons
              name={unavailable ? "alert-circle-outline" : "shield-checkmark"}
              size={20}
              color={colors.studio.primary}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroBadgeTitle, { color: colors.studio.primary }]}>{page.title}</Text>
            {page.subtitle ? <Text style={styles.heroBadgeSub}>{page.subtitle}</Text> : null}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.studio.primary} />
            <Text style={styles.loadingText}>Loading privacy content...</Text>
          </View>
        ) : (
          <Text style={styles.content}>{page.content}</Text>
        )}
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
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  heroBadgeTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  heroBadgeSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 1 },
  loadingBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  content: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 22 },
});
