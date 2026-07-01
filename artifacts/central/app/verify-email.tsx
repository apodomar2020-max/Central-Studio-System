import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { customFetch } from "@workspace/api-client-react";
import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";

import { BackBtn, CS, Eyebrow, PrimaryCTA, Icon, ScreenTitle } from "@/components/signup/SignupKit";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import ProgressDots from "@/components/ProgressDots";

import { enterApp, fetchCurrentUser, nextStepRoute } from "@/services/authProfile";
import { clearSignupDrafts } from "./auth/register";

const VerifyGlow = React.memo(function VerifyGlow() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="verifyGlow" cx="20%" cy="110%" rx="70%" ry="50%">
            <Stop offset="0%" stopColor={CS.cyan500} stopOpacity={0.09} />
            <Stop offset="60%" stopColor={CS.cyan500} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#verifyGlow)" />
      </Svg>
    </View>
  );
});

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const { user, setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [sent, setSent] = useState(false);
  const refs = useRef<(TextInput | null)[]>([]);

  function handleSafeBack() {
    // Verify Email is now reached right after registration/login, before
    // Complete Profile and Your Vibe — those steps may not have run yet, so
    // "back" must not point into the middle of onboarding.
    router.replace("/onboarding/welcome" as never);
  }

  useEffect(() => {
    if (!user?.emailVerified) return;
    const nextStep = user.profileCompletion?.nextStep ?? "done";
    if (nextStep === "done") {
      void enterApp();
      return;
    }
    router.replace(nextStepRoute(nextStep) as never);
  }, [user?.emailVerified, user?.profileCompletion?.nextStep]);

  // Auto-send OTP as soon as the screen opens (if not already verified)
  useEffect(() => {
    if (!user?.id || user.emailVerified || sent) return;
    customFetch("/api/auth/send-email-otp", {
      method: "POST",
      body: JSON.stringify({ studentId: user.id }),
    })
      .then(() => { setSent(true); setResendCountdown(60); })
      .catch(() => { setSent(true); }); // still show UI even if first send fails
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setInterval(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCountdown]);

  if (user?.emailVerified) {
    return <View style={styles.container} />;
  }

  function handleDigit(val: string, i: number) {
    const cleaned = val.replace(/[^0-9]/g, "").slice(-1);
    const next = [...code];
    next[i] = cleaned;
    setCode(next);
    if (cleaned && i < CODE_LENGTH - 1) {
      refs.current[i + 1]?.focus();
    }
  }

  function handleKeyPress(e: any, i: number) {
    if (e.nativeEvent.key === "Backspace" && !code[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  async function handleVerify() {
    const full = code.join("");
    if (full.length < CODE_LENGTH) { Alert.alert("Incomplete", "Please enter all 6 digits."); return; }
    if (!user?.id) { Alert.alert("Error", "You must be signed in to verify your email."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const verification = await customFetch<{ accessToken?: string }>("/api/auth/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id, code: full }),
      });
      if (verification.accessToken) {
        await AsyncStorage.setItem("studentToken", verification.accessToken);
      }
      const refreshed = await fetchCurrentUser();
      await setUser(refreshed.user);
      clearSignupDrafts();
      const nextStep = refreshed.user.profileCompletion?.nextStep ?? "done";
      Alert.alert("Email Verified!", "Your email has been verified successfully.", [
        {
          text: "Continue",
          onPress: () => {
            if (nextStep === "done") {
              void enterApp();
            } else {
              router.push(nextStepRoute(nextStep) as never);
            }
          },
        },
      ]);
    } catch (err: unknown) {
      // const msg = err instanceof Error ? err.message : "Invalid or expired code.";
      Alert.alert("Verification Failed", "Invalid or expired verification code. Please request a new code and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0 || !user?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await customFetch("/api/auth/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id }),
      });
      setResendCountdown(60);
      setSent(true);
      Alert.alert("Email Sent", `A new verification code has been sent to ${user?.email}.`);
    } catch (err: unknown) {
      // const msg = err instanceof Error ? err.message : "Could not send code.";
      Alert.alert("Failed to Send", "We couldn't resend the code. Please try again in a few moments.");
    }
  }

  return (

    <View style={styles.container}>
      <VerifyGlow />
      <View style={[styles.topRow, { paddingTop: Platform.OS === "web" ? 40 : insets.top + 24 }]} pointerEvents="box-none">
        <BackBtn onPress={handleSafeBack} />
        <ProgressDots total={5} current={3} />
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.body}>
        <Eyebrow>Step 4 of 5</Eyebrow>
        <ScreenTitle text={"VERIFY\nEMAIL"} />

        <Text style={styles.lead}>
          We sent a 6-digit verification code to{"\n"}
          <Text style={[styles.pageDescEmail, { color: CS.cyan400 }]}>{user?.email}</Text>
        </Text>

        <View style={styles.codeRow}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={(r) => { refs.current[i] = r; }}
              value={digit}
              onChangeText={(v) => handleDigit(v, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              style={[
                styles.codeInput,
                {
                  borderColor: digit ? CS.cyan500 : "rgba(255,255,255,0.12)",
                  backgroundColor: digit ? "rgba(0,182,215,0.13)" : "rgba(255,255,255,0.05)",
                  color: digit ? CS.cyan500 : "#FFFFFF",
                },
              ]}
              selectTextOnFocus
            />
          ))}
        </View>

        <TouchableOpacity
          onPress={handleResend}
          disabled={resendCountdown > 0}
          style={styles.resendBtn}
        >
          {resendCountdown > 0 ? (
            <Text style={styles.resendText}>
              Resend code in{" "}
              <Text style={{ color: CS.cyan400 }}>{resendCountdown}s</Text>
            </Text>
          ) : (
            <Text style={[styles.resendText, { color: CS.cyan400, fontFamily: "Archivo_700Bold" }]}>Resend verification email</Text>
          )}
        </TouchableOpacity>

        <View style={[styles.notice, { marginTop: 24 }]}>
          <View style={styles.noticeIcon}>
            <Icon name="lock" size={15} stroke={2} color={CS.amber} />
          </View>
          <Text style={styles.noticeText}>
            Can't find the email? Check your spam folder or make sure you signed up with the correct address.
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        <PrimaryCTA
          label="Verify Email"
          onPress={handleVerify}
          loading={loading}
          icon="arrow"
        />
      </View>
    </View>

  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CS.base },
  topRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56,
    zIndex: 50, elevation: 10,
  },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },
  title: { fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78, textTransform: "uppercase", color: CS.cyan500, marginBottom: 10, includeFontPadding: false, paddingTop: 6 },
  lead: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  pageDescEmail: { fontFamily: "Archivo_700Bold" },
  codeRow: { flexDirection: "row", gap: 10, marginVertical: 8, justifyContent: "space-between" },
  codeInput: {
    flex: 1, height: 56, borderRadius: 12, borderWidth: 1.5,
    textAlign: "center", fontSize: 26, fontFamily: "Anton_400Regular",
  },
  resendBtn: { paddingVertical: 12, alignSelf: "flex-start" },
  resendText: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "rgba(255,255,255,0.42)" },
  notice: { flexDirection: "row", gap: 10, padding: 13, borderRadius: 12, backgroundColor: "rgba(255,176,46,0.10)", borderWidth: 1, borderColor: "rgba(255,176,46,0.28)", marginBottom: 20 },
  noticeIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,176,46,0.16)", alignItems: "center", justifyContent: "center" },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "rgba(255,255,255,0.65)", fontFamily: "Archivo_400Regular" },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 6 },
});
