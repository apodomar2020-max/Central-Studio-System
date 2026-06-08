import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";

const FEATURES = [
  { icon: "musical-notes-outline", text: "12+ Dance Styles" },
  { icon: "calendar-outline", text: "Easy Class Booking" },
  { icon: "card-outline", text: "Flexible Packages" },
  { icon: "diamond-outline", text: "Ballet Assessment Flow" },
  { icon: "person-outline", text: "Children Profiles" },
  { icon: "notifications-outline", text: "Class Reminders" },
];

export default function ChooseScreen() {
  const { setIsOnboarded } = useAppContext();

  async function handleStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await setIsOnboarded(true);
    router.replace("/(tabs)/");
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.inner}>
          <View style={styles.header}>
            <Image
              source={require("@/assets/images/central_studio_logo_transparent.png")}
              style={styles.logoImage}
              contentFit="contain"
            />
            <Text style={styles.tagline}>Dance · Learn · Create</Text>
          </View>

          <LinearGradient
            colors={["#00222E", "#060C10"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, { borderColor: colors.studio.primary + "40" }]}
          >
            <View style={[styles.iconBlock, { backgroundColor: colors.studio.primary + "20" }]}>
              <Ionicons name="musical-notes" size={40} color={colors.studio.primary} />
            </View>

            <View style={[styles.badge, { backgroundColor: colors.studio.primary }]}>
              <Text style={styles.badgeText}>CENTRAL STUDIO</Text>
            </View>

            <Text style={styles.cardTitle}>Your Dance{"\n"}Learning Hub</Text>
            <Text style={styles.cardDesc}>
              Browse classes, book sessions, buy packages, and track your dance journey — all in one place.
            </Text>

            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f.text} style={styles.featureRow}>
                  <View style={[styles.featureIcon, { backgroundColor: colors.studio.primary + "15" }]}>
                    <Ionicons name={f.icon as any} size={14} color={colors.studio.primary} />
                  </View>
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>

          <TouchableOpacity onPress={handleStart} activeOpacity={0.85} style={styles.startBtn}>
            <Text style={styles.startBtnText}>Get Started</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </TouchableOpacity>

          <Text style={styles.note}>Central Studio, Zamalek · Cairo, Egypt</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.studio.background,
    paddingTop: Platform.OS === "web" ? 67 : 0,
  },
  safe: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: Platform.OS === "web" ? 34 : 16,
    gap: 18,
  },
  header: { alignItems: "center", gap: 6 },
  logoImage: { width: 200, height: 126 },
  tagline: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF", letterSpacing: 1 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 12,
  },
  iconBlock: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#000",
    letterSpacing: 1,
  },
  cardTitle: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 32,
  },
  cardDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    lineHeight: 19,
  },
  features: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 6, width: "47%" },
  featureIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.studio.primary,
    gap: 8,
  },
  startBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#000" },
  note: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    textAlign: "center",
  },
});
