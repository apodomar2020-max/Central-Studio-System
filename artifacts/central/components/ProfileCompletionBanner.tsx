/**
 * Profile Completion Banner — Profile Completion Engine (Phase 4).
 * Shown on Home for any signed-in user whose profile isn't 100% complete.
 * Dismiss is session-only (local state in the screen that renders this,
 * not persisted) — it reappears on the next app open, per design.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import colors from "@/constants/colors";
import type { ProfileCompletion } from "@/contexts/AppContext";

interface Props {
  completion: ProfileCompletion;
  onContinue: () => void;
  onDismiss: () => void;
}

const STEP_LABELS: Record<string, string> = {
  email: "Verify your email",
  profile: "Complete your profile",
  gender: "Add your gender",
  dateOfBirth: "Add your date of birth",
  city: "Add your city",
  nationality: "Add your nationality",
  howDidYouHearAboutUs: "Tell us how you heard about us",
  policiesAccepted: "Accept our policies",
  children: "Add your children",
  medical: "Add medical information",
  styles: "Pick your dance styles",
};

export default function ProfileCompletionBanner({ completion, onContinue, onDismiss }: Props) {
  const remaining = completion.missing.map((step) => STEP_LABELS[step] ?? step);

  return (
    <View style={styles.wrapper}>
      <LinearGradient
        colors={["#003A47", "#001E28"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.container}
      >
        <View style={[styles.accentBar, { backgroundColor: colors.studio.primary }]} />

        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <Text style={styles.headline}>Profile {completion.percent}% Complete</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDismiss();
              }}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              style={styles.dismissBtn}
            >
              <Ionicons name="close" size={16} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${completion.percent}%`, backgroundColor: colors.studio.primary }]} />
          </View>

          <Text style={styles.description}>
            Complete your profile to unlock all features.
            {remaining.length > 0 ? ` ${remaining.length} step${remaining.length !== 1 ? "s" : ""} remaining.` : ""}
          </Text>

          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onContinue();
            }}
            activeOpacity={0.85}
            style={[styles.ctaBtn, { backgroundColor: colors.studio.primary }]}
          >
            <Text style={styles.ctaBtnText}>Continue</Text>
            <Ionicons name="arrow-forward" size={15} color="#000" />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 20,
    marginBottom: 28,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.studio.primary + "30",
  },
  container: { flexDirection: "row" },
  accentBar: { width: 4 },
  inner: { flex: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headline: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFFFFF0F",
    alignItems: "center", justifyContent: "center",
  },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: "#FFFFFF14", overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  description: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", lineHeight: 17 },
  ctaBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 40, borderRadius: 10,
  },
  ctaBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#000" },
});
