/**
 * Medical Information — Profile Completion Engine (Phase 4), parent accounts
 * only. Reuses the existing children.medicalNotes field — no duplicate
 * schema. An explicitly empty submission ("Nothing to report") still counts
 * as reviewed; only a field the parent never touched is "missing".
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ProgressDots from "@/components/ProgressDots";
import { useAppContext } from "@/contexts/AppContext";
import { fetchCurrentUser, nextStepRoute } from "@/services/authProfile";
import { BackBtn, CS, Eyebrow, PrimaryCTA, ScreenTitle } from "@/components/signup/SignupKit";
import { iosTextInputStyle } from "@/utils/iosTypography";

export default function OnboardingMedicalScreen() {
  const insets = useSafeAreaInsets();
  const { children, updateChild, setUser } = useAppContext();
  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 24;

  const [notesById, setNotesById] = useState<Record<string, string>>(
    () => Object.fromEntries(children.map((c) => [c.id, c.medicalNotes ?? ""])),
  );
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Promise.all(
        children.map((child) => updateChild({ ...child, medicalNotes: (notesById[child.id] ?? "").trim() })),
      );
      const { user } = await fetchCurrentUser();
      await setUser(user);
      const nextStep = user.profileCompletion?.nextStep ?? "styles";
      router.replace(nextStepRoute(nextStep) as never);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingTop: topPad }]} pointerEvents="box-none">
        <BackBtn onPress={() => router.replace("/onboarding/children" as never)} />
        <ProgressDots total={5} current={3} />
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Eyebrow>Step 4 of 5</Eyebrow>
        <ScreenTitle text={"MEDICAL\nINFORMATION"} />
        <Text style={styles.sub}>
          Let us know about any allergies, conditions, or things instructors should be aware of.
          Leave blank if there's nothing to report.
        </Text>

        {children.map((child) => (
          <View key={child.id} style={{ marginBottom: 16 }}>
            <Text style={styles.childLabel}>{child.fullName}</Text>
            <TextInput
              value={notesById[child.id] ?? ""}
              onChangeText={(v) => setNotesById((prev) => ({ ...prev, [child.id]: v }))}
              placeholder="e.g. Asthma, nut allergy, none…"
              placeholderTextColor="rgba(255,255,255,0.38)"
              multiline
              style={styles.notesInput}
            />
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        <PrimaryCTA label="Continue" icon="arrow" onPress={handleContinue} loading={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56 },
  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  childLabel: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#9CA3AF", letterSpacing: 0.66, textTransform: "uppercase", marginBottom: 8 },
  notesInput: {
    minHeight: 88, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(14, 20), textAlignVertical: "top",
  },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 8 },
});
