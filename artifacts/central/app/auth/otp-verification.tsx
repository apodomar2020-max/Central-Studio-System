import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { customFetch } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import BotChallenge from "@/components/BotChallenge";
import CentralBackButton from "@/components/CentralBackButton";
import {
  buildForgotPasswordPayload,
  buildVerifyResetOtpPayload,
  forgotPasswordOutcome,
  maskEmail,
  toApiErrorLike,
  verifyResetOtpErrorOutcome,
} from "@/services/passwordRecoveryFlow";
import { storePasswordResetGrant } from "@/services/passwordResetGrantStore";
import { iosDisplayTextStyle } from "@/utils/iosTypography";

const OTP_ARTWORK = require("@/assets/images/my-password-pana.svg");
const RESEND_COOLDOWN_SECONDS = 60;
const CYAN = "#00B6D7";
const SCREEN = "#101112";

export default function OtpVerificationScreen(): React.ReactElement {
  const { email } = useLocalSearchParams<{ email: string }>();
  const insets = useSafeAreaInsets();
  const safeTop = Platform.OS === "web" ? 67 : insets.top;
  const safeBottom = Math.max(insets.bottom, 18);
  const codeRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendCountdown, setResendCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resendPending, setResendPending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendBotToken, setResendBotToken] = useState<string | null>(null);
  const [resendChallengeKey, setResendChallengeKey] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => setResendCountdown((value) => value - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  async function continueToPassword(): Promise<void> {
    if (verifying) return;
    const targetEmail = email?.trim();
    if (!targetEmail) {
      setError("Something went wrong. Please start again from Forgot Password.");
      return;
    }
    if (code.length !== 6) {
      setError("Please enter the 6-digit code from your email.");
      codeRef.current?.focus();
      return;
    }
    setError("");
    setVerifying(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await customFetch<{ resetToken: string }>("/api/auth/verify-reset-otp", {
        method: "POST",
        auth: "omit",
        body: JSON.stringify(buildVerifyResetOtpPayload(targetEmail, code)),
      });
      if (!result.resetToken) {
        setError("We couldn't verify this code. Please try again.");
        return;
      }
      storePasswordResetGrant({ email: targetEmail, resetToken: result.resetToken });
      router.push("/auth/reset-password");
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      setError(apiError
        ? verifyResetOtpErrorOutcome(apiError).message
        : "Network error. Please check your connection.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend(): Promise<void> {
    if (resendCountdown > 0 || resendPending) return;
    const targetEmail = email?.trim();
    if (!targetEmail) {
      setError("Something went wrong. Please start again from Forgot Password.");
      return;
    }
    if (!resendBotToken) {
      setError("Please complete verification before requesting another code.");
      return;
    }
    setError("");
    setResendMessage("");
    setResendPending(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await customFetch("/api/auth/forgot-password", {
        method: "POST",
        auth: "omit",
        body: JSON.stringify(buildForgotPasswordPayload(targetEmail, resendBotToken)),
      });
      forgotPasswordOutcome();
      setCode("");
      setResendCountdown(RESEND_COOLDOWN_SECONDS);
      setResendBotToken(null);
      setResendChallengeKey((value) => value + 1);
      setResendMessage("Check your inbox for the most recent code.");
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        setError("Network error. Please check your connection.");
        return;
      }
      const data = apiError.data;
      const responseCode = data && typeof data === "object" && "code" in data ? String((data as { code?: unknown }).code ?? "") : "";
      if (responseCode === "BOT_VERIFICATION_FAILED" || responseCode === "BOT_VERIFICATION_UNAVAILABLE") {
        setResendBotToken(null);
        setResendChallengeKey((value) => value + 1);
      }
      setError("Something went wrong. Please try again.");
    } finally {
      setResendPending(false);
    }
  }

  return <View style={styles.screen}>
    <LinearGradient colors={["#17191B", SCREEN]} style={StyleSheet.absoluteFill} />
    <LinearGradient pointerEvents="none" colors={["rgba(0,182,215,0.62)", "rgba(0,182,215,0.08)", "transparent"]} locations={[0, 0.3, 0.72]} start={{ x: 1, y: 0 }} end={{ x: 0.08, y: 0.62 }} style={StyleSheet.absoluteFill} />
    <View style={[styles.header, { paddingTop: safeTop + 10 }]}>
      <CentralBackButton />
      <Text style={styles.headerTitle}>OTP VERIFICATION</Text>
      <View style={styles.headerSpacer} />
    </View>

    <KeyboardAwareScrollView showsVerticalScrollIndicator={false} bottomOffset={20} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: safeBottom + 18 }]}>
      <View style={styles.content}>
        <Image source={OTP_ARTWORK} style={styles.artwork} contentFit="contain" transition={0} />
        <Text style={styles.title}>Verification Code</Text>
        <Text style={styles.description}>We sent a verification code to</Text>
        <Text style={styles.maskedEmail}>{maskEmail(email ?? "")}</Text>

        <Text style={styles.codePrompt}>Enter OTP code that you received in your email here:</Text>

        <TouchableOpacity activeOpacity={0.9} onPress={() => codeRef.current?.focus()} style={styles.codeBoxes} accessibilityRole="button" accessibilityLabel="Enter six digit verification code">
          {Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.codeBox, code.length === index && styles.codeBoxActive]}>
            <Text style={styles.codeDigit}>{code[index] ?? ""}</Text>
          </View>)}
          <TextInput ref={codeRef} value={code} onChangeText={(value) => { setCode(value.replace(/\D/g, "").slice(0, 6)); if (error) setError(""); }} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} caretHidden style={styles.hiddenInput} onSubmitEditing={() => void continueToPassword()} />
        </TouchableOpacity>

        {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
        {resendCountdown <= 0 ? <BotChallenge action="forgot_password" resetKey={resendChallengeKey} onToken={setResendBotToken} /> : null}
        {resendMessage ? <Text style={styles.resendMessage}>{resendMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <AppButton title="Change Password" onPress={continueToPassword} loading={verifying} disabled={code.length !== 6} fullWidth size="lg" style={styles.primaryButton} />
        <View style={styles.resendRow}>
          <Text style={styles.resendNote}>Didn’t get the code?</Text>
          <TouchableOpacity onPress={handleResend} disabled={resendCountdown > 0 || resendPending}>
            <Text style={[styles.resendLink, resendCountdown > 0 && styles.resendLinkDisabled]}>{resendCountdown > 0 ? ` Resend in ${resendCountdown}s` : resendPending ? " Sending..." : " Resend"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAwareScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN },
  header: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, zIndex: 2 },
  headerTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 21, lineHeight: 27, letterSpacing: 0.2, ...iosDisplayTextStyle(21, 27) },
  headerSpacer: { width: 34, height: 34 },
  scroll: { flexGrow: 1, justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, gap: 24 },
  content: { width: "100%", alignItems: "center" },
  artwork: { width: "68%", maxWidth: 270, aspectRatio: 1 },
  title: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 24, lineHeight: 30, textAlign: "center", marginTop: 2 },
  description: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 5 },
  maskedEmail: { color: CYAN, fontFamily: "Archivo_600SemiBold", fontSize: 13, lineHeight: 18, textAlign: "center" },
  codePrompt: { width: "100%", color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, marginTop: 24, paddingHorizontal: 14 },
  codeBoxes: { width: "100%", flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 8, position: "relative" },
  codeBox: { flex: 1, maxWidth: 54, height: 82, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.075)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  codeBoxActive: { borderColor: "rgba(0,182,215,0.55)" },
  codeDigit: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 25 },
  hiddenInput: { ...StyleSheet.absoluteFillObject, opacity: 0.01, color: "transparent" },
  actions: { width: "100%", alignItems: "center" },
  primaryButton: { borderRadius: 28 },
  resendRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  resendNote: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 12.5 },
  resendLink: { color: CYAN, fontFamily: "Archivo_600SemiBold", fontSize: 12.5 },
  resendLinkDisabled: { color: "rgba(255,255,255,0.42)" },
  resendMessage: { color: "#B8BCC1", fontFamily: "Archivo_400Regular", fontSize: 12.5, marginTop: 8, textAlign: "center" },
  errorBanner: { width: "100%", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,73,92,0.45)", backgroundColor: "rgba(255,73,92,0.10)", paddingHorizontal: 13, paddingVertical: 10, marginTop: 14 },
  errorText: { color: "#FF6B79", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 18, textAlign: "center" },
});
