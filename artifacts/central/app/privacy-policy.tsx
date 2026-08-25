import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import CentralBackButton from "@/components/CentralBackButton";

const LOGO = require("@/assets/images/privacy-policy-hero-logo.png");

const FALLBACK_PAGE = {
  title: "Privacy & Policy",
  subtitle: "Last Updated: June 2026",
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

type ContentPage = { title: string; subtitle?: string | null; content: string };

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<ContentPage>(FALLBACK_PAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    customFetch<ContentPage>("/api/content/pages/privacy-policy")
      .then((data) => active && setPage(data))
      .catch(() => active && setPage(FALLBACK_PAGE))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const topInset = Platform.OS === "web" ? 18 : insets.top + 10;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#111315", "#151515", "#101112"]}
        locations={[0, 0.54, 1]}
        style={[styles.fixedHero, { paddingTop: topInset }]}
      >
        <Svg style={styles.heroGlow} pointerEvents="none">
          <Defs>
            <RadialGradient id="privacyHeroGlow" cx="50%" cy="-10%" rx="120%" ry="90%">
              <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.16} />
              <Stop offset="60%" stopColor="#00B6D7" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#privacyHeroGlow)" />
        </Svg>
        <View style={styles.navRow}>
          <CentralBackButton style={styles.backButton} />
          <Text style={styles.title}>{page.title}</Text>
          <View style={styles.navSpacer} />
        </View>

        <View style={styles.logoWrap}>
          <Image source={LOGO} resizeMode="contain" style={styles.logo} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="small" color="#03BFE9" /></View>
        ) : (
          <>
            {page.subtitle ? <Text style={styles.updated}>{page.subtitle}</Text> : null}
            <Text style={styles.content}>{page.content}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0E1010" },
  fixedHero: { height: 304, overflow: "hidden", backgroundColor: "#131414" },
  heroGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 304 },
  navRow: { height: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  navSpacer: { width: 34 },
  title: { flex: 1, textAlign: "center", color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 22, lineHeight: 25, textTransform: "uppercase" },
  logoWrap: { position: "absolute", top: 118, alignSelf: "center", width: 284, height: 154, alignItems: "center", justifyContent: "center" },
  logo: { width: 284, height: 154 },
  contentScroll: { flex: 1, backgroundColor: "#0E1010" },
  contentContainer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: Platform.OS === "web" ? 44 : 32 },
  loadingBox: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  updated: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 13, marginBottom: 12 },
  content: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 10, lineHeight: 12, letterSpacing: 0.03 },
});
