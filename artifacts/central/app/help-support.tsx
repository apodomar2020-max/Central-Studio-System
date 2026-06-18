import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customFetch } from "@workspace/api-client-react";

import colors from "@/constants/colors";

const FALLBACK_PAGE = {
  title: "Help & Support",
  subtitle: "Our team is available Saturday-Thursday, 10 AM - 9 PM",
  content: `Need help?

WhatsApp: +20 123 456 7890
Email: support@centralstudio.eg
Location: Cairo, Egypt
Website: centralstudio.eg

Frequently Asked Questions

How do I book a class?
Go to the Classes tab, find your class, and tap Book. You need to be signed in and have an active package or pay per session.

How do packages work?
Packages give you a set number of class credits valid across all dance styles. Each class attendance uses 1 credit. Go to the Packages tab to buy one.

What happens after I purchase a package?
Your package request is submitted to our team. Once we confirm your payment, we activate your credits, usually within 24 hours.

Can I cancel a pending package request?
Yes. In the My Packages tab, find your pending request and tap Cancel Request. This removes the request before any payment is processed.

How do I cancel a booking?
You can cancel a booking up to 24 hours before the class starts. Contact us via WhatsApp for cancellations.

Can I join with my child?
Yes. We have Kids and Teens classes for Ballet and more. Add your child's profile in your account settings.

How do I reset my password?
Tap Forgot Password on the login screen, enter your email, and we will send you a reset link.`,
};

type ContentPage = {
  title: string;
  subtitle?: string | null;
  content: string;
  isActive?: boolean;
};

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    customFetch<ContentPage>("/api/content/pages/help-support")
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
            title: "Help & Support",
            subtitle: null,
            content: "Help & Support is currently unavailable. Please contact the studio directly for assistance.",
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
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 52 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{page.title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        <LinearGradient
          colors={[`${colors.studio.primary}18`, colors.studio.card]}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.studio.primary} />
            ) : (
              <Ionicons
                name={unavailable ? "alert-circle-outline" : "help-circle-outline"}
                size={22}
                color={colors.studio.primary}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{page.title}</Text>
            {page.subtitle ? <Text style={styles.heroSubtitle}>{page.subtitle}</Text> : null}
          </View>
        </LinearGradient>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.studio.primary} />
            <Text style={styles.loadingText}>Loading support content...</Text>
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
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  hero: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: `${colors.studio.primary}20`,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: `${colors.studio.primary}15`,
  },
  heroTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  heroSubtitle: { marginTop: 4, fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  loadingBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  content: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 22 },
});
