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
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAppContext } from "@/contexts/AppContext";
import { STORAGE_KEYS } from "@/constants/danceStyles";
import { continueAfterAuth, postAuthDestination } from "@/services/authProfile";
import ProgressDots from "@/components/ProgressDots";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import {
  BackBtn, CS, Divider, Eyebrow, FacebookLogo, GhostBtn, GoogleLogo, Icon, PrimaryCTA, ScreenTitle,
  type SignupIconName,
} from "@/components/signup/SignupKit";
import { useGoogleSignIn } from "@/hooks/useGoogleSignIn";
import { useFacebookSignIn } from "@/hooks/useFacebookSignIn";
import BotChallenge from "@/components/BotChallenge";
import SocialLinkVerifyModal from "@/components/SocialLinkVerifyModal";

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
  ]);
}
export default function RegisterScreen() {
  const { setUser, user } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const google = useGoogleSignIn("social-signup");
  const facebook = useFacebookSignIn("social-signup");

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

  useEffect(() => {
    if (!user) return;
    router.replace(postAuthDestination(user) as never);
  }, [user]);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  // Security Wave — Bot Protection. The token is kept ONLY in this
  // component's in-memory state — never AsyncStorage, never logged.
  // `challengeResetKey` is bumped to force the widget to remount and issue
  // a fresh single-use token after any failed submission.
  const [botToken, setBotToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);

  async function submit() {
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !email.trim() ||
      !/\S+@\S+\.\S+/.test(email) ||
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setApiError("Use a valid email and a password with at least 8 characters, one letter, and one number.");
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
          const name = `${firstName.trim()} ${lastName.trim()}`.trim();

          await fetch(`${apiUrl}/api/auth/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          await continueAfterAuth(undefined, setUser, { guidedOnboarding: true, source: "email-signup" });
          setLoading(false);
        } catch {
          setApiError("Network error. Please check your connection.");
          setLoading(false);
        }
        return;
      } else {
        setLoading(false);
        alert.show({
          tone: "destructive",
          title: "Restart Signup?",
          message: "Changing your email will restart signup. Continue?",
          actions: [
            { label: "Cancel", tone: "neutral" },
            {
              label: "Continue",
              tone: "danger",
              onPress: async () => {
                await setUser(null);
                clearSignupDrafts();
                setFirstName("");
                setLastName("");
                setEmail("");
                setPassword("");
                // We don't automatically resubmit because fields are now empty.
                // Just clear the state and let user type again.
              },
            },
          ],
        });
        return;
      }
    }

    if (!botToken) {
      setApiError("Please complete verification below before continuing.");
      setLoading(false);
      return;
    }

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      const trimmedEmail = email.trim();

      // Account-enumeration hardening (Security Wave — Auth Abuse
      // Foundation): register no longer distinguishes "email already
      // exists" from "new account created" — both return the same generic
      // { ok: true } body and no token. The UX no longer branches on that
      // distinction either; the next step is always the same: try to sign
      // in with the credentials just submitted.
      const response = await fetch(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: trimmedEmail, accountType: "student", password, botToken }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.code === "BOT_VERIFICATION_FAILED" || data.code === "BOT_VERIFICATION_UNAVAILABLE") {
          setBotToken(null);
          setChallengeResetKey((k) => k + 1);
          setApiError(
            data.code === "BOT_VERIFICATION_UNAVAILABLE"
              ? "Verification is temporarily unavailable. Please try again shortly."
              : "Verification failed — please complete the check again.",
          );
          setLoading(false);
          return;
        }
        if (data.code === "RATE_LIMITED") {
          setApiError("Too many attempts. Please wait a bit before trying again.");
          setLoading(false);
          return;
        }
        setApiError(data.error ?? "Registration failed. Please try again.");
        setLoading(false);
        return;
      }

      // Generic acceptance — obtain the actual access token via a
      // follow-up login using the same credentials just submitted. If this
      // email already belonged to someone else, login fails with the SAME
      // generic message an ordinary wrong-password attempt gets, and we
      // surface that without ever confirming the email was already taken.
      const loginResponse = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const loginData = await loginResponse.json();
      if (!loginResponse.ok) {
        setApiError("Couldn't sign you in. Please check your details or try signing in instead.");
        setLoading(false);
        return;
      }

      await continueAfterAuth(loginData.accessToken, setUser, { guidedOnboarding: true, source: "email-signup" });
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
        <BackBtn onPress={() => {
          draftPassword = "";
          router.replace("/onboarding/welcome");
        }} />
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

            <BotChallenge
              action="register"
              resetKey={challengeResetKey}
              onToken={(token) => setBotToken(token)}
            />

            <Divider label="or sign up with" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <GhostBtn label="Facebook" icon={FACEBOOK_ICON} onPress={() => facebook.signIn()} disabled={facebook.loading} />
              <GhostBtn label="Google" icon={GOOGLE_ICON} onPress={() => google.signIn()} disabled={google.loading} />
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

      <SocialLinkVerifyModal
        challenge={google.linkChallenge ?? facebook.linkChallenge}
        onClose={() => { google.clearLinkChallenge(); facebook.clearLinkChallenge(); }}
      />
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
    textTransform: "uppercase", color: CS.cyan500, marginBottom: 6 - iosCapGuard(85, 78),
    // iOS: keep the tight lineHeight; helper supplies the cap-clip inset (must
    // come after paddingTop so it wins on iOS while Android keeps its 6).
    ...iosDisplayTextStyle(85, 78),
  },
  sub: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  apiError: { fontFamily: "Archivo_600SemiBold", fontSize: 13, color: CS.danger, marginBottom: 12 },
  // Dark rounded input box — same radius/border/background/height family as the design.
  fieldBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 14,
  },
  fieldInput: { flex: 1, paddingVertical: 0, fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(15, 18) },
  terms: { fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 18, textAlign: "center", marginTop: 4, paddingBottom: 8, fontFamily: "Archivo_400Regular" },
  termsLink: { color: CS.cyan400, fontFamily: "Archivo_600SemiBold" },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: 0 },
});
