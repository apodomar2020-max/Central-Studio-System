import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import {
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
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import BotChallenge from "@/components/BotChallenge";
import { setStudentToken } from "@/services/secureTokenStorage";

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

type OtpErrorData = {
  error?: string;
  code?: string;
  attemptsLeft?: number;
  requiresResend?: boolean;
  retryAfter?: number;
};

function otpErrorData(error: unknown): OtpErrorData {
  if (!error || typeof error !== "object" || !("data" in error)) return {};
  const data = (error as { data?: unknown }).data;
  return data && typeof data === "object" ? data as OtpErrorData : {};
}

export default function VerifyEmailScreen() {
  const { user, setUser } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState("");
  // Security Wave — Bot Protection. send-email-otp is a protected action;
  // this screen sends automatically on mount, so the challenge must
  // complete before that first send fires. Kept in-memory only.
  const [botToken, setBotToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);
  const refs = useRef<(TextInput | null)[]>([]);

  async function leaveVerification(destination: "/auth/register" | "/auth/login") {
    await setUser(null);
    clearSignupDrafts();
    router.replace(destination as never);
  }

  function confirmStartOver() {
    alert.show({
      tone: "destructive",
      title: "Start over with another email?",
      message: "This will sign you out on this device. The unverified account will remain until Central Studio removes it.",
      actions: [
        { label: "Cancel", tone: "neutral" },
        {
          label: "Start Over",
          tone: "danger",
          onPress: () => { void leaveVerification("/auth/register"); },
        },
      ],
    });
  }

  function confirmSignIn() {
    alert.show({
      title: "Sign in with another account?",
      message: "This will clear the current session on this device.",
      actions: [
        { label: "Cancel", tone: "neutral" },
        {
          label: "Sign In",
          tone: "primary",
          onPress: () => { void leaveVerification("/auth/login"); },
        },
      ],
    });
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

  // Auto-send OTP as soon as the screen opens AND verification is ready
  // (if not already verified). Gated on botToken — send-email-otp is now a
  // protected action.
  useEffect(() => {
    if (!user?.id || user.emailVerified || sent || !botToken) return;
    customFetch("/api/auth/send-email-otp", {
      method: "POST",
      body: JSON.stringify({ studentId: user.id, botToken }),
    })
      .then(() => {
        setSent(true);
        setSendError("");
        setResendCountdown(60);
      })
      .catch((error: unknown) => {
        const data = otpErrorData(error);
        if (data.code === "BOT_VERIFICATION_FAILED" || data.code === "BOT_VERIFICATION_UNAVAILABLE") {
          setBotToken(null);
          setChallengeResetKey((k) => k + 1);
        }
        const retryAfter = typeof data.retryAfter === "number" ? data.retryAfter : 0;
        if (retryAfter > 0) setResendCountdown(retryAfter);
        setSendError(data.error ?? "We couldn't send the verification code. Please try again.");
      });
  }, [user?.id, botToken]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (full.length < CODE_LENGTH) { alert.show({ tone: "warning", title: "Incomplete", message: "Please enter all 6 digits." }); return; }
    if (!user?.id) { alert.show({ tone: "error", title: "Error", message: "You must be signed in to verify your email." }); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const verification = await customFetch<{ accessToken?: string }>("/api/auth/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id, code: full }),
      });
      if (verification.accessToken) {
        // Security Wave — Mobile SecureStore / Privacy Hardening.
        await setStudentToken(verification.accessToken);
      }
      const refreshed = await fetchCurrentUser();
      await setUser(refreshed.user);
      clearSignupDrafts();
      const nextStep = refreshed.user.profileCompletion?.nextStep ?? "done";
      alert.show({
        tone: "success",
        title: "Email Verified!",
        message: "Your email has been verified successfully.",
        actions: [
          {
            label: "Continue",
            tone: "primary",
            onPress: () => {
              if (nextStep === "done") {
                void enterApp();
              } else {
                router.replace(nextStepRoute(nextStep) as never);
              }
            },
          },
        ],
      });
    } catch (err: unknown) {
      const data = otpErrorData(err);
      const attempts = typeof data.attemptsLeft === "number"
        ? ` ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? "" : "s"} remaining.`
        : "";
      alert.show({
        tone: "error",
        title: "Verification Failed",
        message: `${data.error ?? "Invalid or expired verification code."}${attempts}`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0 || !user?.id) return;
    if (!botToken) {
      alert.show({ tone: "error", title: "Verification Needed", message: "Please complete the verification check above, then try resending." });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await customFetch("/api/auth/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ studentId: user.id, botToken }),
      });
      setResendCountdown(60);
      setSent(true);
      setSendError("");
      // Turnstile tokens are single-use — force a fresh challenge before
      // the NEXT resend can proceed.
      setBotToken(null);
      setChallengeResetKey((k) => k + 1);
      alert.show({ tone: "success", title: "Email Sent", message: `A new verification code has been sent to ${user?.email}.` });
    } catch (err: unknown) {
      const data = otpErrorData(err);
      if (data.code === "BOT_VERIFICATION_FAILED" || data.code === "BOT_VERIFICATION_UNAVAILABLE") {
        setBotToken(null);
        setChallengeResetKey((k) => k + 1);
      }
      const retryAfter = typeof data.retryAfter === "number" ? data.retryAfter : 0;
      if (retryAfter > 0) setResendCountdown(retryAfter);
      alert.show({ tone: "error", title: "Failed to Send", message: data.error ?? "We couldn't resend the code. Please try again in a few moments." });
    }
  }

  return (

    <View style={styles.container}>
      <VerifyGlow />
      <View style={[styles.topRow, { paddingTop: Platform.OS === "web" ? 40 : insets.top + 24 }]} pointerEvents="box-none">
        <BackBtn onPress={confirmStartOver} />
        <ProgressDots total={5} current={3} />
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.body}>
        <Eyebrow>Step 4 of 5</Eyebrow>
        <ScreenTitle text={"VERIFY\nEMAIL"} />

        <Text style={styles.lead}>
          {sent ? "We sent a 6-digit verification code to" : "We'll send a 6-digit verification code to"}{"\n"}
          <Text style={[styles.pageDescEmail, { color: CS.cyan400 }]}>{user?.email}</Text>
        </Text>

        {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

        {!botToken && !user?.emailVerified && (
          <BotChallenge action="otp_send" resetKey={challengeResetKey} onToken={(token) => setBotToken(token)} />
        )}

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

        <View style={styles.escapeSection}>
          <Text style={styles.escapeTitle}>Wrong email?</Text>
          <View style={styles.escapeActions}>
            <TouchableOpacity onPress={confirmStartOver} style={styles.escapeButton}>
              <Text style={styles.escapeButtonText}>Start over</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmSignIn} style={styles.escapeButton}>
              <Text style={styles.escapeButtonText}>Sign in with another account</Text>
            </TouchableOpacity>
          </View>
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
  title: { fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78, textTransform: "uppercase", color: CS.cyan500, marginBottom: 10 - iosCapGuard(85, 78), includeFontPadding: false, paddingTop: 6, ...iosDisplayTextStyle(85, 78) },
  lead: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 24, fontFamily: "Archivo_400Regular" },
  sendError: { fontSize: 13, lineHeight: 18, color: CS.danger, fontFamily: "Archivo_600SemiBold", marginBottom: 12 },
  pageDescEmail: { fontFamily: "Archivo_700Bold" },
  codeRow: { flexDirection: "row", gap: 10, marginVertical: 8, justifyContent: "space-between" },
  codeInput: {
    flex: 1, height: 56, borderRadius: 12, borderWidth: 1.5,
    textAlign: "center", fontSize: 26, fontFamily: "Anton_400Regular", ...iosTextInputStyle(26, 31, "anton"),
    ...(Platform.OS === 'ios' ? {
      lineHeight: undefined,
      paddingTop: 3,
      paddingBottom: 0,
    } : { paddingTop: 0 }),
  },
  resendBtn: { paddingVertical: 12, alignSelf: "flex-start" },
  resendText: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "rgba(255,255,255,0.42)" },
  notice: { flexDirection: "row", gap: 10, padding: 13, borderRadius: 12, backgroundColor: "rgba(255,176,46,0.10)", borderWidth: 1, borderColor: "rgba(255,176,46,0.28)", marginBottom: 20 },
  noticeIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,176,46,0.16)", alignItems: "center", justifyContent: "center" },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "rgba(255,255,255,0.65)", fontFamily: "Archivo_400Regular" },
  escapeSection: { gap: 10 },
  escapeTitle: { fontSize: 13, color: "#FFFFFF", fontFamily: "Archivo_700Bold" },
  escapeActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  escapeButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  escapeButtonText: { fontSize: 12.5, color: CS.cyan400, fontFamily: "Archivo_700Bold" },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 6 },
});
