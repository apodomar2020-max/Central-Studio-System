import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Image } from "expo-image";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";

const LANGUAGES = [
  { code: "en" as const, label: "English", sublabel: "Continue in English", flag: "🇬🇧" },
  { code: "ar" as const, label: "العربية", sublabel: "استمر باللغة العربية", flag: "🇪🇬" },
];

export default function LanguageScreen() {
  const { setLanguage } = useAppContext();
  const [selected, setSelected] = useState<"en" | "ar" | null>("en");

  async function handleContinue() {
    if (!selected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setLanguage(selected);
    router.replace("/onboarding/choose");
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.inner}>
          <View style={styles.logoBlock}>
            <Image
              source={require("@/assets/images/central_studio_logo_transparent.png")}
              style={styles.logoImage}
              contentFit="contain"
            />
            <View style={styles.taglineRow}>
              <View style={[styles.taglineDivider, { backgroundColor: colors.studio.primary + "35" }]} />
              <Text style={styles.tagline}>Studio & Stage</Text>
              <View style={[styles.taglineDivider, { backgroundColor: colors.studio.primary + "35" }]} />
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title}>Select Your Language</Text>
            <Text style={styles.subtitle}>اختر لغتك المفضلة</Text>
          </View>

          <View style={styles.options}>
            {LANGUAGES.map((lang) => {
              const isSelected = selected === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelected(lang.code);
                  }}
                  activeOpacity={0.8}
                  style={[
                    styles.langCard,
                    {
                      borderColor: isSelected ? colors.studio.primary : colors.studio.border,
                      backgroundColor: isSelected
                        ? colors.studio.primary + "15"
                        : colors.studio.card,
                    },
                  ]}
                >
                  <Text style={styles.flag}>{lang.flag}</Text>
                  <View style={styles.langTexts}>
                    <Text style={[styles.langLabel, { color: "#FFFFFF" }]}>{lang.label}</Text>
                    <Text style={[styles.langSublabel, { color: "#9CA3AF" }]}>{lang.sublabel}</Text>
                  </View>
                  {isSelected && (
                    <View style={[styles.checkCircle, { backgroundColor: colors.studio.primary }]}>
                      <Ionicons name="checkmark" size={14} color="#000" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.85}
            disabled={!selected}
            style={[styles.continueBtn, { opacity: selected ? 1 : 0.4 }]}
          >
            <LinearGradient
              colors={[colors.studio.primary, colors.studio.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.continueGradient}
            >
              <Text style={styles.continueBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#000" />
            </LinearGradient>
          </TouchableOpacity>
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
    paddingHorizontal: 28,
    justifyContent: "center",
    gap: 36,
  },
  logoBlock: {
    alignItems: "center",
    gap: 14,
  },
  logoImage: {
    width: 320,
    height: 200,
  },
  taglineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "70%",
  },
  taglineDivider: {
    flex: 1,
    height: 1,
  },
  tagline: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  titleBlock: { alignItems: "center", gap: 4 },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
  },
  options: { gap: 12 },
  langCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 14,
  },
  flag: { fontSize: 32 },
  langTexts: { flex: 1 },
  langLabel: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  langSublabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtn: { borderRadius: 14, overflow: "hidden" },
  continueGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    gap: 8,
  },
  continueBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#000",
  },
});
