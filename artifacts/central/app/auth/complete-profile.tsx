/**
 * Complete Client Profile — Step 2 of 5 in the new signup flow.
 * Visual style: design system from signup-views.jsx (dark screen, Archivo/Anton fonts,
 * CS color tokens, BackBtn, ProgressDots, PrimaryCTA from SignupKit).
 *
 * Fields collected and backend support:
 *   • Phone Number   → PATCH /api/auth/profile  (students.phone)        ✅ backend
 *   • Account Type   → PATCH /api/auth/profile  (students.account_type) ✅ backend
 *   • Date of Birth  → AsyncStorage only (cs_profile_dob)               ⚠️ TEMP — backend missing:
 *                      needs students.date_of_birth column + PATCH support
 *   • City           → AsyncStorage only (cs_profile_city)              ⚠️ TEMP — backend missing:
 *                      needs students.city column + PATCH support
 *   • Nationality    → AsyncStorage only (cs_profile_nationality)       ⚠️ TEMP — backend missing:
 *                      needs students.nationality column + PATCH support
 *
 * After saving, routes to /onboarding/styles (Step 3 of 5).
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { KeyboardAvoidingView, Modal } from "react-native";
import { useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import ProgressDots from "@/components/ProgressDots";
import { useAppContext, type User } from "@/contexts/AppContext";
import { mapStudentToUser, type AccountType, type AuthStudent } from "@/services/authProfile";
import { STORAGE_KEYS } from "@/constants/danceStyles";
import {
  BackBtn,
  CS,
  Eyebrow,
  Icon,
  PrimaryCTA, ScreenTitle,
  type SignupIconName,
} from "@/components/signup/SignupKit";

interface ProfileResponse {
  student: AuthStudent;
}

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "student", label: "I am a student" },
  { value: "parent", label: "I am a parent / booking for my child" },
];

/** Same freeze-safe flat input design as register.tsx */
const SignupTextInput = React.memo(function SignupTextInput({
  placeholder,
  value,
  onChangeText,
  icon,
  keyboardType,
  autoCapitalize,
}: {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  icon?: SignupIconName;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "sentences";
}) {
  return (
    <View style={styles.fieldBox}>
      {icon ? <Icon name={icon} size={18} stroke={2} color="rgba(255,255,255,0.32)" /> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.38)"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={styles.fieldInput}
      />
    </View>
  );
});

/** Static background glow — renders once. */
const ProfileGlow = React.memo(function ProfileGlow() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="cpGlow" cx="20%" cy="110%" rx="70%" ry="50%">
            <Stop offset="0%" stopColor={CS.cyan500} stopOpacity={0.09} />
            <Stop offset="60%" stopColor={CS.cyan500} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#cpGlow)" />
      </Svg>
    </View>
  );
});

export default function CompleteProfileScreen() {
  const { setUser, user } = useAppContext();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 24;


  const [phone, setPhone] = useState(user?.phone ?? "");
  const [accountType, setAccountType] = useState<AccountType | null>(user?.accountType ?? null);
  const [dob, setDob] = useState("");
  const [city, setCity] = useState("");
  const [nationality, setNationality] = useState("");
  const [showDobModal, setShowDobModal] = useState(false);
  const [dobD, setDobD] = useState("");
  const [dobM, setDobM] = useState("");
  const [dobY, setDobY] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const d = await AsyncStorage.getItem(STORAGE_KEYS.profileDob);
        const c = await AsyncStorage.getItem(STORAGE_KEYS.profileCity);
        const n = await AsyncStorage.getItem(STORAGE_KEYS.profileNationality);
        if (d) setDob(d);
        if (c) setCity(c);
        if (n) setNationality(n);
      } catch {}
    })();
  }, []);

  function saveDobModal() {
    if (dobD && dobM && dobY) {
      setDob(`${dobY}-${dobM.padStart(2,"0")}-${dobD.padStart(2,"0")}`);
    }
    setShowDobModal(false);
  }


  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const canSubmit = !!(phone.trim() && accountType);

  async function submit() {
    if (!phone.trim()) { setApiError("Phone number is required."); return; }
    if (!/^\d+$/.test(phone.trim())) { setApiError("Phone number must contain digits only."); return; }
    if (!/^01/.test(phone.trim())) { setApiError("Phone number must start with 01."); return; }
    if (phone.trim().length !== 11) { setApiError("Phone number must be exactly 11 digits."); return; }
    if (!/^01[0125][0-9]{8}$/.test(phone.trim())) { setApiError("Please enter a valid Egyptian mobile number."); return; }
    if (!accountType) { setApiError("Please choose your account type."); return; }
    setApiError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Save supported fields to backend
      const data = await customFetch<ProfileResponse>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ phone: phone.trim(), accountType }),
      });
      const updated: User = mapStudentToUser(data.student);
      await setUser(updated);

      // Save temporarily-local fields (backend columns not yet available)
      // TODO: once students.date_of_birth, students.city, students.nationality
      // columns exist and PATCH /api/auth/profile accepts them, move these
      // saves into the PATCH call above and remove these AsyncStorage writes.
      const writes: Promise<void>[] = [];
      if (dob.trim()) writes.push(AsyncStorage.setItem(STORAGE_KEYS.profileDob, dob.trim()));
      if (city.trim()) writes.push(AsyncStorage.setItem(STORAGE_KEYS.profileCity, city.trim()));
      if (nationality.trim()) writes.push(AsyncStorage.setItem(STORAGE_KEYS.profileNationality, nationality.trim()));
      await Promise.all(writes);

      router.push("/onboarding/styles" as never);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ProfileGlow />

      <View style={[styles.topRow, { paddingTop: topPad }]} pointerEvents="box-none">
        <BackBtn onPress={() => router.push("/auth/register" as never)} />
        <ProgressDots total={5} current={1} />
        <View style={{ width: 42 }} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Eyebrow>Step 2 of 5</Eyebrow>
          <ScreenTitle text={"COMPLETE\nPROFILE"} />
          <Text style={styles.sub}>Add the details we need for booking, check-in and personalisation.</Text>

          {apiError ? <Text style={styles.apiError}>{apiError}</Text> : null}

          <View style={{ gap: 16, marginTop: 4 }}>
            {/* Phone */}
            <SignupTextInput
              placeholder="Phone Number (+20 100 000 0000)"
              value={phone}
              onChangeText={setPhone}
              icon="phone"
              keyboardType="phone-pad"
            />

            {/* Account Type selector */}
            <View style={styles.typeSection}>
              <Text style={styles.typeLabel}>Account Type</Text>
              <View style={styles.typeRow}>
                {ACCOUNT_TYPES.map((t) => {
                  const on = accountType === t.value;
                  return (
                    <TouchableOpacity
                      key={t.value}
                      onPress={() => setAccountType(t.value)}
                      activeOpacity={0.8}
                      style={[styles.typeBtn, on && styles.typeBtnOn]}
                    >
                      {on ? (
                        <View style={styles.typeCheck}>
                          <Icon name="check" size={12} stroke={3} color={CS.ink900} />
                        </View>
                      ) : (
                        <View style={styles.typeUncheck} />
                      )}
                      <Text style={[styles.typeBtnText, on && styles.typeBtnTextOn]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Date of Birth — TEMPORARY: stored locally */}

            <View>
              <TouchableOpacity onPress={() => setShowDobModal(true)} activeOpacity={0.8} style={styles.fieldBox}>
                <Icon name="lock" size={18} stroke={2} color="rgba(255,255,255,0.32)" />
                <Text style={[styles.fieldInput, { color: dob ? "#FFFFFF" : "rgba(255,255,255,0.38)", marginTop: Platform.OS === 'ios' ? 4 : 0 }]}>
                  {dob ? new Date(dob).toLocaleDateString() : "Date of Birth (Select)"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.tempNote}>⚠️ Stored locally — backend field pending</Text>
            </View>

            {/* DOB Modal */}
            <Modal visible={showDobModal} transparent animationType="fade">
              <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBg}>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Enter Date of Birth</Text>
                  <View style={styles.modalRow}>
                    <TextInput placeholder="DD" value={dobD} onChangeText={setDobD} keyboardType="number-pad" maxLength={2} style={styles.modalInput} placeholderTextColor="rgba(255,255,255,0.38)" />
                    <Text style={{color:"rgba(255,255,255,0.3)"}}>/</Text>
                    <TextInput placeholder="MM" value={dobM} onChangeText={setDobM} keyboardType="number-pad" maxLength={2} style={styles.modalInput} placeholderTextColor="rgba(255,255,255,0.38)" />
                    <Text style={{color:"rgba(255,255,255,0.3)"}}>/</Text>
                    <TextInput placeholder="YYYY" value={dobY} onChangeText={setDobY} keyboardType="number-pad" maxLength={4} style={[styles.modalInput, {width: 80}]} placeholderTextColor="rgba(255,255,255,0.38)" />
                  </View>
                  <View style={styles.modalFooter}>
                    <TouchableOpacity onPress={() => setShowDobModal(false)} style={styles.modalBtn}>
                      <Text style={styles.modalBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={saveDobModal} style={styles.modalBtn}>
                      <Text style={[styles.modalBtnText, { color: CS.cyan400 }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </Modal>


            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <SignupTextInput
                  placeholder="City"
                  value={city}
                  onChangeText={setCity}
                  icon="lock"
                  autoCapitalize="words"
                />
                <Text style={styles.tempNote}>⚠️ Stored locally</Text>
              </View>
              <View style={{ flex: 1 }}>
                <SignupTextInput
                  placeholder="Nationality"
                  value={nationality}
                  onChangeText={setNationality}
                  icon="user"
                  autoCapitalize="words"
                />
                <Text style={styles.tempNote}>⚠️ Stored locally</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
          <PrimaryCTA label="Continue" icon="arrow" onPress={submit} loading={loading} disabled={!canSubmit} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  flex: { flex: 1 },
  topRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56,
    zIndex: 50, elevation: 10,
  },
  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  title: {
    fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78,
    includeFontPadding: false, paddingTop: 6,
    textTransform: "uppercase", color: CS.cyan500, marginBottom: 6,
  },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  apiError: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: CS.danger, marginBottom: 12 },
  fieldBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14,
  },
  fieldInput: { flex: 1, paddingVertical: 0, fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF" },
  typeSection: { gap: 10 },
  typeLabel: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#9CA3AF", letterSpacing: 0.66, textTransform: "uppercase" },
  typeRow: { gap: 10 },
  typeBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 14, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  typeBtnOn: { borderColor: CS.cyan500, backgroundColor: "rgba(0,182,215,0.13)" },
  typeCheck: { width: 22, height: 22, borderRadius: 11, backgroundColor: CS.cyan500, alignItems: "center", justifyContent: "center" },
  typeUncheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" },
  typeBtnText: { flex: 1, fontSize: 15, fontFamily: "Archivo_500Medium", color: "rgba(255,255,255,0.55)" },
  typeBtnTextOn: { color: "#FFFFFF", fontFamily: "Archivo_700Bold" },
  tempNote: { fontSize: 11, fontFamily: "Archivo_400Regular", color: "rgba(255,176,46,0.65)", marginTop: 4, paddingLeft: 4 },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 8 },
  skipBtn: { alignItems: "center", paddingVertical: 6 },
  skipText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: "rgba(255,255,255,0.28)" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: "#111418", borderRadius: 20, padding: 24, width: "85%", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  modalTitle: { fontFamily: "Archivo_700Bold", fontSize: 16, color: "#FFF", marginBottom: 20, textAlign: "center" },
  modalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 24 },
  modalInput: { width: 60, height: 50, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#FFF", fontFamily: "Anton_400Regular", fontSize: 20, textAlign: "center" },
  modalFooter: { flexDirection: "row", justifyContent: "flex-end", gap: 20 },
  modalBtn: { padding: 8 },
  modalBtnText: { fontFamily: "Archivo_700Bold", fontSize: 15, color: "#9CA3AF" },
});
