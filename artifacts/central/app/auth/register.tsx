/**
 * Create Account — design `CreateAccount` (signup-views.jsx). Step 1 of 4.
 *
 * INPUTS: plain controlled React Native `TextInput` inside a lightweigh
 * `SignupTextInput` block. The old `FloatInput` (floating label) is intentionally
 * NOT used here — its absolutely-positioned label over the input touch area plus
 * the per-input onFocus/onBlur re-render caused a focus/keyboard freeze on this
 * screen. This block has: a STATIC label above each field, NO floating-label
 * animation, NO onFocus/onBlur, NO absolute element over the touch area, NO
 * Touchable wrapping the input, and it never remounts on focus or calls focus().
 *
 * Visual matches the design: labels above fields, FIRST/LAST side by side, EMAIL
 * and PASSWORD full width, large dark rounded boxes, left field icons, password
 * eye toggle. Same title/spacing/divider/social/footer. Backend + routing unchanged.
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useEffect } from "react";

let draftFirstName = "";
let draftLastName = "";
let draftEmail = "";
let draftPassword = "";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAppContext } from "@/contexts/AppContext";
import { STORAGE_KEYS } from "@/constants/danceStyles";
import { continueAfterAuth } from "@/services/authProfile";
import ProgressDots from "@/components/ProgressDots";
import {
  BackBtn, CS, Divider, Eyebrow, FacebookLogo, GhostBtn, GoogleLogo, Icon, PrimaryCTA, ScreenTitle,
  type SignupIconName,
} from "@/components/signup/SignupKit";
import { useGoogleSignIn } from "@/hooks/useGoogleSignIn";
import { useFacebookSignIn } from "@/hooks/useFacebookSignIn";

// Stable social icon elements.
const FACEBOOK_ICON = <FacebookLogo />;
const GOOGLE_ICON = <GoogleLogo />;

/** Static background glow — renders once. */
const RegisterGlow = React.memo(function RegisterGlow() {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      shouldRasterizeIOS
      renderToHardwareTextureAndroid
      collapsable={false}
    >
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="caGlow" cx="80%" cy="-10%" rx="80%" ry="60%">
            <Stop offset="0%" stopColor={CS.cyan500} stopOpacity={0.1} />
            <Stop offset="60%" stopColor={CS.cyan500} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#caGlow)" />
      </Svg>
    </View>
  );
});

/**
 * Lightweight design-matched input block. Structurally simple and flat:
 *   Container (dark rounded box) ─ Left Icon ─ TextInput ─ Optional Eye Button
 * The text label lives INSIDE the field as the native `placeholder` (no floating
 * label, no animated label, no absolute-positioned label over the touch area).
 * The left icon and optional right element are flex SIBLINGS of the TextInput —
 * neither wraps it. No focus state, no onFocus/onBlur, never remounts on focus,
 * never calls focus().
 */
const SignupTextInput = React.memo(function SignupTextInput({
  placeholder,
  value,
  onChangeText,
  icon,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  rightEl,
}: {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  icon?: SignupIconName;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  secureTextEntry?: boolean;
  rightEl?: React.ReactNode;
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
        secureTextEntry={secureTextEntry}
        style={styles.fieldInput}
      />
      {rightEl ?? null}
    </View>
  );
});


export function clearSignupDrafts() {
  draftFirstName = "";
  draftLastName = "";
  draftEmail = "";
  draftPassword = "";
  void AsyncStorage.multiRemove([
    STORAGE_KEYS.danceStyles,
    STORAGE_KEYS.phoneVerified,
    STORAGE_KEYS.profileDob,
    STORAGE_KEYS.profileCity,
    STORAGE_KEYS.profileNationality,
  ]);
}
export default function RegisterScreen() {
  const { setUser, user } = useAppContext();
  const insets = useSafeAreaInsets();
  const google = useGoogleSignIn();
  const facebook = useFacebookSignIn();

  // Plain controlled state (same proven pattern as the Sign In screen).
  const [firstName, setFirstName] = useState(draftFirstName);
  const [lastName, setLastName] = useState(draftLastName);
  const [email, setEmail] = useState(draftEmail);
  const [password, setPassword] = useState(draftPassword);

  useEffect(() => {
    draftFirstName = firstName;
    draftLastName = lastName;
    draftEmail = email;
    draftPassword = password;
  }, [firstName, lastName, email, password]);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  async function submit() {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !/\S+@\S+\.\S+/.test(email) || password.length < 6) {
      setApiError("Please complete all fields (valid email, password ≥ 6 characters).");
      return;
    }
    setApiError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const isSameEmail = user?.email?.toLowerCase() === email.trim().toLowerCase();

    if (user) {
      if (isSameEmail) {
        try {
          const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
          const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
          const name = `${firstName.trim()} ${lastName.trim()}`.trim();

          await fetch(`${apiUrl}/api/auth/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ name }),
          });
          await continueAfterAuth(undefined, setUser);
          setLoading(false);
        } catch {
          setApiError("Network error. Please check your connection.");
          setLoading(false);
        }
        return;
      } else {
        setLoading(false);
        Alert.alert(
          "Restart Signup?",
          "Changing your email will restart signup. Continue?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              style: "destructive",
              onPress: async () => {
                await setUser(null);
                clearSignupDrafts();
                setFirstName("");
                setLastName("");
                setEmail("");
                setPassword("");
                // We don't automatically resubmit because fields are now empty.
                // Just clear the state and let user type again.
              }
            }
          ]
        );
        return;
      }
    }

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const response = await fetch(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ name, email: email.trim(), accountType: "student", password }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 || data.error?.toLowerCase().includes("exists")) {
          setLoading(false);
          Alert.alert(
            "Email Registered",
            "This email is already registered. Please sign in or use another email.",
            [
              { text: "Sign In", onPress: () => router.push("/auth/login") },
              { text: "Cancel", style: "cancel" }
            ]
          );
          return;
        }
        setApiError(data.error ?? "Registration failed. Please try again.");
        setLoading(false);
        return;
      }
      await continueAfterAuth(data.accessToken, setUser);
      setLoading(false);
    } catch {
      setApiError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 24;
  const canSubmit = !!(firstName.trim() && lastName.trim() && email.trim() && password.length > 0);

  return (
    <View style={styles.screen}>
      <RegisterGlow />

      <View style={[styles.topRow, { paddingTop: topPad }]} pointerEvents="box-none">
        <BackBtn onPress={() => { draftPassword = ""; router.replace("/onboarding/welcome"); }} />
        <ProgressDots total={5} current={0} />
        <View style={{ width: 42 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Eyebrow>Step 1 of 5</Eyebrow>
          <ScreenTitle text={"CREATE\nACCOUNT"} />
          <Text style={styles.sub}>Join thousands of dancers at Central Studio.</Text>

          {apiError ? <Text style={styles.apiError}>{apiError}</Text> : null}

          <View style={{ gap: 16, marginTop: 4 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <SignupTextInput placeholder="First Name" value={firstName} onChangeText={setFirstName} icon="user" autoCapitalize="words" />
              </View>
              <View style={{ flex: 1 }}>
                <SignupTextInput placeholder="Last Name" value={lastName} onChangeText={setLastName} icon="user" autoCapitalize="words" />
              </View>
            </View>

            <SignupTextInput
              placeholder="Email Address"
              value={email}
              onChangeText={setEmail}
              icon="mail"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <SignupTextInput
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              icon="lock"
              secureTextEntry={!showPwd}
              rightEl={
                <TouchableOpacity onPress={() => setShowPwd((s) => !s)} hitSlop={8}>
                  <Icon name={showPwd ? "eyeOff" : "eye"} size={17} stroke={2} color="rgba(255,255,255,0.38)" />
                </TouchableOpacity>
              }
            />

            <Divider label="or sign up with" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <GhostBtn label="Facebook" icon={FACEBOOK_ICON} onPress={() => facebook.signIn()} />
              <GhostBtn label="Google" icon={GOOGLE_ICON} onPress={() => google.signIn()} />
            </View>
            <Text style={styles.terms}>
              By continuing you agree to our <Text style={styles.termsLink}>Terms</Text> and <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
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
  // Title kept at the design's full 85px. lineHeight ≥ fontSize + includeFontPadding
  // off + a small paddingTop prevents the tall Anton caps from being clipped/cut a
  // the top, and guarantees both lines ("CREATE" / "ACCOUNT") render in full.
  title: {
    fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78,
    includeFontPadding: false, paddingTop: 6,
    textTransform: "uppercase", color: CS.cyan500, marginBottom: 6,
  },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  apiError: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: CS.danger, marginBottom: 12 },
  // Dark rounded input box — same radius/border/background/height family as the design.
  fieldBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14,
  },
  fieldInput: { flex: 1, paddingVertical: 0, fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF" },
  terms: { fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 18, textAlign: "center", marginTop: 4, paddingBottom: 8, fontFamily: "Archivo_400Regular" },
  termsLink: { color: CS.cyan400, fontFamily: "Archivo_600SemiBold" },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: 0 },
});
