/**
 * Children — Profile Completion Engine (Phase 4), parent accounts only.
 * Reuses the existing child model/API (addChild → POST /api/children) — no
 * new child system. Visual style matches the rest of the onboarding funnel.
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ProgressDots from "@/components/ProgressDots";
import { useAppContext } from "@/contexts/AppContext";
import { fetchCurrentUser, nextStepRoute } from "@/services/authProfile";
import { BackBtn, CS, Eyebrow, Icon, PrimaryCTA, ScreenTitle } from "@/components/signup/SignupKit";
import { iosTextInputStyle } from "@/utils/iosTypography";

type Gender = "male" | "female";

function calculateAge(birthday: string): number | null {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const [y, m, d] = birthday.split("-").map((v) => parseInt(v, 10));
  if ([y, m, d].some((v) => Number.isNaN(v))) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d)) age--;
  return age;
}

export default function OnboardingChildrenScreen() {
  const insets = useSafeAreaInsets();
  const { children, addChild, setUser } = useAppContext();
  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 24;

  const [showForm, setShowForm] = useState(children.length === 0);
  const [fullName, setFullName] = useState("");
  const [dobD, setDobD] = useState("");
  const [dobM, setDobM] = useState("");
  const [dobY, setDobY] = useState("");
  const [gender, setGender] = useState<Gender>("female");
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState("");

  async function handleAddChild() {
    if (!fullName.trim()) { setError("Please enter the child's full name."); return; }
    const birthday = dobD && dobM && dobY ? `${dobY}-${dobM.padStart(2, "0")}-${dobD.padStart(2, "0")}` : "";
    const age = calculateAge(birthday);
    if (age === null) { setError("Please select a valid date of birth."); return; }
    setError("");
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await addChild({ id: "", fullName: fullName.trim(), birthday, age, gender });
      setFullName("");
      setDobD(""); setDobM(""); setDobY("");
      setGender("female");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    if (children.length === 0) { setError("Add at least one child to continue."); return; }
    setContinuing(true);
    try {
      // Re-fetch so routing is driven by the backend's fresh nextStep —
      // never hardcode the next screen here.
      const { user } = await fetchCurrentUser();
      await setUser(user);
      const nextStep = user.profileCompletion?.nextStep ?? "medical";
      router.replace(nextStepRoute(nextStep) as never);
    } finally {
      setContinuing(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingTop: topPad }]} pointerEvents="box-none">
        <BackBtn onPress={() => router.replace("/auth/complete-profile" as never)} />
        <ProgressDots total={5} current={2} />
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Eyebrow>Step 3 of 5</Eyebrow>
        <ScreenTitle text={"ADD YOUR\nCHILDREN"} />
        <Text style={styles.sub}>Add each child who'll be taking classes with us.</Text>

        {error ? <Text style={styles.apiError}>{error}</Text> : null}

        {children.map((child) => (
          <View key={child.id} style={styles.childCard}>
            <View style={styles.childAvatar}>
              <Icon name="user" size={18} stroke={2} color={CS.cyan400} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.childName}>{child.fullName}</Text>
              <Text style={styles.childMeta}>Age {child.age} · {child.gender === "female" ? "Girl" : "Boy"}</Text>
            </View>
          </View>
        ))}

        {showForm ? (
          <View style={{ gap: 12, marginTop: children.length > 0 ? 16 : 4 }}>
            <View style={styles.fieldBox}>
              <Icon name="user" size={18} stroke={2} color="rgba(255,255,255,0.32)" />
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Child's full name"
                placeholderTextColor="rgba(255,255,255,0.38)"
                style={styles.fieldInput}
              />
            </View>

            <View style={styles.dobRow}>
              <TextInput placeholder="DD" value={dobD} onChangeText={setDobD} keyboardType="number-pad" maxLength={2} style={styles.dobInput} placeholderTextColor="rgba(255,255,255,0.38)" />
              <Text style={styles.dobSep}>/</Text>
              <TextInput placeholder="MM" value={dobM} onChangeText={setDobM} keyboardType="number-pad" maxLength={2} style={styles.dobInput} placeholderTextColor="rgba(255,255,255,0.38)" />
              <Text style={styles.dobSep}>/</Text>
              <TextInput placeholder="YYYY" value={dobY} onChangeText={setDobY} keyboardType="number-pad" maxLength={4} style={[styles.dobInput, { width: 80 }]} placeholderTextColor="rgba(255,255,255,0.38)" />
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["female", "male"] as const).map((g) => {
                const on = gender === g;
                return (
                  <TouchableOpacity key={g} onPress={() => setGender(g)} activeOpacity={0.8} style={[styles.chip, on && styles.chipOn, { flex: 1 }]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{g === "female" ? "Girl" : "Boy"}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity onPress={handleAddChild} disabled={saving} activeOpacity={0.8} style={styles.addBtn}>
              <Text style={styles.addBtnText}>{saving ? "Saving…" : "Save Child"}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowForm(true)} activeOpacity={0.8} style={styles.addAnotherBtn}>
            <Icon name="user" size={16} stroke={2} color={CS.cyan400} />
            <Text style={styles.addAnotherText}>Add {children.length > 0 ? "another" : "a"} child</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        <PrimaryCTA label="Continue" icon="arrow" onPress={handleContinue} loading={continuing} disabled={children.length === 0} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56 },
  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 20, fontFamily: "Archivo_400Regular" },
  apiError: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: CS.danger, marginBottom: 12 },
  childCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 10,
  },
  childAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,182,215,0.13)", alignItems: "center", justifyContent: "center" },
  childName: { fontFamily: "Archivo_700Bold", fontSize: 15, color: "#FFFFFF" },
  childMeta: { fontFamily: "Archivo_400Regular", fontSize: 12, color: "rgba(255,255,255,0.42)", marginTop: 2 },
  fieldBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14,
  },
  fieldInput: { flex: 1, paddingVertical: 0, fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(15, 18) },
  dobRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dobInput: { flex: 1, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)", color: "#FFF", fontFamily: "Archivo_600SemiBold", fontSize: 15, ...iosTextInputStyle(15, 18), textAlign: "center" },
  dobSep: { color: "rgba(255,255,255,0.3)" },
  chip: {
    paddingVertical: 12, borderRadius: 100, borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center",
  },
  chipOn: { borderColor: CS.cyan500, backgroundColor: "rgba(0,182,215,0.13)" },
  chipText: { fontSize: 14, fontFamily: "Archivo_600SemiBold", color: "rgba(255,255,255,0.55)" },
  chipTextOn: { color: "#FFFFFF" },
  addBtn: { height: 50, borderRadius: 12, backgroundColor: CS.cyan500, alignItems: "center", justifyContent: "center" },
  addBtnText: { fontFamily: "Archivo_700Bold", fontSize: 14, color: CS.ink900 },
  addAnotherBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(0,182,215,0.35)", borderStyle: "dashed",
  },
  addAnotherText: { fontFamily: "Archivo_700Bold", fontSize: 14, color: CS.cyan400 },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 8 },
});
