import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";

const FAQS = [
  {
    q: "How do I book a class?",
    a: "Go to the Classes tab, find your class, and tap 'Book'. You'll need to be signed in and have an active package or pay per session.",
  },
  {
    q: "How do packages work?",
    a: "Packages give you a set number of class credits valid across all dance styles. Each class attendance uses 1 credit. Go to Packages tab to buy one.",
  },
  {
    q: "What happens after I purchase a package?",
    a: "Your package request is submitted to our team. Once we confirm your payment, we'll activate your credits — usually within 24 hours.",
  },
  {
    q: "Can I cancel a pending package request?",
    a: "Yes! In the My Packages tab, find your pending request and tap 'Cancel Request'. This removes the request before any payment is processed.",
  },
  {
    q: "How do I cancel a booking?",
    a: "You can cancel a booking up to 24 hours before the class starts. Contact us via WhatsApp for cancellations.",
  },
  {
    q: "What is the Central Stage section?",
    a: "Central Stage is our professional dancer directory. If you're a trained dancer, you can apply to be featured and get booking opportunities.",
  },
  {
    q: "Can I join with my child?",
    a: "Yes! We have Kids and Teens classes for Ballet and more. Add your child's profile in your account settings.",
  },
  {
    q: "How do I reset my password?",
    a: "Tap 'Forgot Password' on the login screen, enter your email, and we'll send you a reset link.",
  },
];

function FAQItem({ faq }: { faq: { q: string; a: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpen((v) => !v); }}
      style={styles.faqItem}
      activeOpacity={0.8}
    >
      <View style={styles.faqHeader}>
        <Text style={styles.faqQ}>{faq.q}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
      </View>
      {open && <Text style={styles.faqA}>{faq.a}</Text>}
    </TouchableOpacity>
  );
}

export default function HelpSupportScreen() {
  const insets = useSafeAreaInsets();

  function openWhatsApp() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL("https://wa.me/201234567890?text=Hello%2C%20I%20need%20help%20with%20Central%20Studio%20app");
  }

  function openEmail() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL("mailto:support@centralstudio.eg?subject=App%20Support");
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 52 : insets.top) + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Help & Support</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === "web" ? 60 : 40 }]}
      >
        <LinearGradient
          colors={[`${colors.studio.primary}18`, colors.studio.card]}
          style={styles.contactBanner}
        >
          <View style={styles.contactBannerLeft}>
            <Text style={styles.contactBannerTitle}>Need help?</Text>
            <Text style={styles.contactBannerDesc}>
              Our team is available Saturday–Thursday, 10 AM – 9 PM
            </Text>
          </View>
          <View style={styles.contactActions}>
            <TouchableOpacity onPress={openWhatsApp} style={[styles.contactBtn, { backgroundColor: "#25D366" }]}>
              <Ionicons name="logo-whatsapp" size={18} color="#FFF" />
              <Text style={styles.contactBtnText}>WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openEmail} style={[styles.contactBtn, { backgroundColor: colors.studio.primary }]}>
              <Ionicons name="mail-outline" size={18} color="#000" />
              <Text style={[styles.contactBtnText, { color: "#000" }]}>Email</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.quickLinks}>
          {[
            { icon: "location-outline", label: "Visit Us", sub: "Cairo, Egypt", onPress: () => Linking.openURL("https://maps.google.com/?q=Central+Studio+Cairo") },
            { icon: "call-outline", label: "Call Us", sub: "+20 123 456 7890", onPress: () => Linking.openURL("tel:+201234567890") },
            { icon: "globe-outline", label: "Website", sub: "centralstudio.eg", onPress: () => Linking.openURL("https://centralstudio.eg") },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              onPress={item.onPress}
              style={styles.quickLink}
              activeOpacity={0.75}
            >
              <View style={[styles.quickLinkIcon, { backgroundColor: `${colors.studio.primary}15` }]}>
                <Ionicons name={item.icon as any} size={20} color={colors.studio.primary} />
              </View>
              <Text style={styles.quickLinkLabel}>{item.label}</Text>
              <Text style={styles.quickLinkSub}>{item.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.faqTitle}>Frequently Asked Questions</Text>

        <View style={styles.faqList}>
          {FAQS.map((faq, i) => (
            <FAQItem key={i} faq={faq} />
          ))}
        </View>
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
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  contactBanner: {
    borderRadius: 18, padding: 18, gap: 14,
    borderWidth: 1, borderColor: `${colors.studio.primary}20`,
  },
  contactBannerLeft: { gap: 4 },
  contactBannerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  contactBannerDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 18 },
  contactActions: { flexDirection: "row", gap: 10 },
  contactBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 12,
  },
  contactBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  quickLinks: { flexDirection: "row", gap: 10 },
  quickLink: {
    flex: 1, alignItems: "center", gap: 8, padding: 14,
    borderRadius: 14, borderWidth: 1, borderColor: "#1E2E38",
    backgroundColor: colors.studio.card,
  },
  quickLinkIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickLinkLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  quickLinkSub: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },
  faqTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  faqList: { gap: 8 },
  faqItem: {
    borderRadius: 14, borderWidth: 1, borderColor: "#1E2E38",
    backgroundColor: colors.studio.card, padding: 16, gap: 10,
  },
  faqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  faqQ: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", lineHeight: 18 },
  faqA: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 19 },
});
