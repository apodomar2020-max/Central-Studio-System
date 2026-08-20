import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

const HOW_IT_WORKS = [
  {
    step: "1",
    icon: "share-social-outline",
    title: "Share Your Code",
    desc: "Send your unique referral code to friends who want to join Central Studio.",
  },
  {
    step: "2",
    icon: "pricetag-outline",
    title: "Friend Applies Code",
    desc: "When your friend books their first class, they enter your referral code at checkout.",
  },
];
// F-02: the previous step 3 ("Earn Rewards" — "You earn EGP 100 credit...")
// promised a specific credit amount with no crediting system behind it. It
// was removed rather than reworded, since no reward mechanism exists today
// to describe accurately. Referral-code capture (steps 1-2 above) is
// unaffected.

export default function ReferralScreen() {
  const { user, referralCode, referralCredits } = useAppContext();
  const referralCount = 0;
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await Clipboard.setStringAsync(referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleShare() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({
        message: `Join me at Central Studio — Egypt's top dance school! 🎉\n\nUse my referral code ${referralCode} when you book your class.\n\nDownload the Central Studio app and start dancing! 💃🕺`,
        title: "Join Central Studio",
      });
    } catch {}
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Refer a Friend</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === "web" ? 120 : 90 },
        ]}
      >
        <LinearGradient
          colors={["#003A47", "#001828"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroBanner, { borderColor: colors.studio.primary + "40" }]}
        >
          <View style={[styles.giftIcon, { backgroundColor: colors.studio.primary + "20" }]}>
            <Ionicons name="gift" size={40} color={colors.studio.primary} />
          </View>
          {/* F-02: the EGP 100 reward claim was removed — no crediting system
              exists to back it. Referral-code sharing itself is unaffected. */}
          <Text style={styles.heroTitle}>Refer a Friend</Text>
          <Text style={styles.heroDesc}>
            Share your referral code with friends who want to join Central Studio.
          </Text>
        </LinearGradient>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: "#0E1619", borderColor: colors.studio.primary + "30" }]}>
            <Text style={[styles.statValue, { color: colors.studio.primary }]}>{referralCount}</Text>
            <Text style={styles.statLabel}>Friends Referred</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#0E1619", borderColor: colors.studio.primary + "30" }]}>
            <Text style={[styles.statValue, { color: "#22C55E" }]}>
              {referralCredits > 0 ? `EGP ${referralCredits}` : "EGP 0"}
            </Text>
            <Text style={styles.statLabel}>Credits Earned</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Referral Code</Text>
          <View style={[styles.codeCard, { backgroundColor: "#0E1619", borderColor: colors.studio.primary + "40" }]}>
            <Text style={[styles.codeText, { color: colors.studio.primary }]}>{referralCode}</Text>
            <TouchableOpacity
              onPress={handleCopy}
              style={[
                styles.copyBtn,
                { backgroundColor: copied ? "#22C55E20" : colors.studio.primary + "20", borderColor: copied ? "#22C55E" : colors.studio.primary },
              ]}
            >
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={18}
                color={copied ? "#22C55E" : colors.studio.primary}
              />
              <Text style={[styles.copyBtnText, { color: copied ? "#22C55E" : colors.studio.primary }]}>
                {copied ? "Copied!" : "Copy"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleShare}
            activeOpacity={0.85}
            style={[styles.shareBtn, { backgroundColor: colors.studio.primary }]}
          >
            <Ionicons name="share-social-outline" size={20} color="#000" />
            <Text style={styles.shareBtnText}>Share with Friends</Text>
          </TouchableOpacity>
        </View>

        {referralCredits > 0 && (
          <LinearGradient
            colors={["#0A2010", "#060C10"]}
            style={[styles.creditsCard, { borderColor: "#22C55E40" }]}
          >
            <View style={[styles.creditsIcon, { backgroundColor: "#22C55E20" }]}>
              <Ionicons name="wallet-outline" size={24} color="#22C55E" />
            </View>
            <View style={styles.creditsText}>
              <Text style={styles.creditsTitle}>Available Credits</Text>
              <Text style={[styles.creditsAmount, { color: "#22C55E" }]}>
                EGP {referralCredits}
              </Text>
              <Text style={styles.creditsHint}>Applied automatically on your next booking</Text>
            </View>
          </LinearGradient>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How It Works</Text>
          <View style={styles.stepsContainer}>
            {HOW_IT_WORKS.map((step, index) => (
              <View key={step.step} style={styles.stepRow}>
                <View style={styles.stepLeft}>
                  <View style={[styles.stepBubble, { backgroundColor: colors.studio.primary }]}>
                    <Text style={styles.stepNum}>{step.step}</Text>
                  </View>
                  {index < HOW_IT_WORKS.length - 1 && (
                    <View style={[styles.stepLine, { backgroundColor: colors.studio.primary + "30" }]} />
                  )}
                </View>
                <View style={[styles.stepCard, { backgroundColor: "#0E1619", borderColor: "#1E2E38" }]}>
                  <View style={[styles.stepIconWrap, { backgroundColor: colors.studio.primary + "15" }]}>
                    <Ionicons name={step.icon as any} size={20} color={colors.studio.primary} />
                  </View>
                  <View style={styles.stepText}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepDesc}>{step.desc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.termsBox, { backgroundColor: "#0E1619", borderColor: "#1E2E38" }]}>
          <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
          {/* F-02: dropped the "credits are awarded..." claim — no crediting
              system exists to back it. The expiry statement is unrelated
              and remains accurate. */}
          <Text style={styles.termsText}>
            Referral codes have no expiry date.
          </Text>
        </View>
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
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.studio.background,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  heroBanner: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  giftIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
    lineHeight: 30,
  },
  heroDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 20,
  },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 26, fontFamily: "Inter_700Bold", ...iosDisplayTextStyle(26, 30, "inter") },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },
  section: { gap: 12 },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  codeText: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: 4,
    ...iosDisplayTextStyle(28, 32, "inter"),
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  copyBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 14,
  },
  shareBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#000" },
  creditsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  creditsIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  creditsText: { flex: 1, gap: 2 },
  creditsTitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  creditsAmount: { fontSize: 22, fontFamily: "Inter_700Bold", ...iosDisplayTextStyle(22, 26, "inter") },
  creditsHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  stepsContainer: { gap: 0 },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepLeft: { alignItems: "center", width: 28 },
  stepBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#000" },
  stepLine: { width: 2, flex: 1, minHeight: 20, marginVertical: 4 },
  stepCard: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  stepIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { flex: 1, gap: 3 },
  stepTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  stepDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 17 },
  termsBox: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    alignItems: "flex-start",
    marginBottom: 8,
  },
  termsText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    lineHeight: 17,
  },
});
