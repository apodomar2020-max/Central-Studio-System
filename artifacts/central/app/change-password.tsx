import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { customFetch } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import BotChallenge from "@/components/BotChallenge";
import CentralBackButton from "@/components/CentralBackButton";
import { useAppContext } from "@/contexts/AppContext";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import {
  buildChangePasswordPayload,
  buildForgotPasswordPayload,
  changePasswordOutcome,
  forgotPasswordOutcome,
  maskEmail,
  persistChangePasswordToken,
  toApiErrorLike,
} from "@/services/passwordRecoveryFlow";
import { secureTokenStorageAdapter } from "@/services/secureTokenStorage";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { passwordPolicyError } from "@/utils/passwordPolicy";

const OTP_ARTWORK = require("@/assets/images/enter-otp-amico.svg");
const CYAN = "#00B6D7";
const SCREEN = "#101112";

function PasswordBackdrop(): React.ReactElement {
  return <>
    <LinearGradient colors={["#17191B", SCREEN]} style={StyleSheet.absoluteFill} />
    <LinearGradient pointerEvents="none" colors={["rgba(0,182,215,0.62)", "rgba(0,182,215,0.08)", "transparent"]} locations={[0, 0.3, 0.72]} start={{ x: 1, y: 0 }} end={{ x: 0.08, y: 0.62 }} style={styles.topGlow} />
  </>;
}

function ScreenHeader({ title, onBack, top }: { title: string; onBack?: () => void; top: number }): React.ReactElement {
  return <View style={[styles.header, { paddingTop: top + 10 }]}>
    <CentralBackButton onPress={onBack} />
    <Text style={styles.headerTitle}>{title}</Text>
    <View style={styles.headerSpacer} />
  </View>;
}

export default function ChangePasswordScreen(): React.ReactElement {
  const { user } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const safeTop = Platform.OS === "web" ? 67 : insets.top;
  const safeBottom = Math.max(insets.bottom, 18);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [view, setView] = useState<"form" | "recovery">("form");
  const [sendingCode, setSendingCode] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);

  const initials = (user?.fullName ?? "User").split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function handleSendCode(): Promise<void> {
    if (sendingCode) return;
    const email = user?.email?.trim();
    if (!email) {
      alert.show({ tone: "error", title: "Something Went Wrong", message: "We couldn't verify your account. Please try again later." });
      return;
    }
    if (!botToken) {
      alert.show({ tone: "warning", title: "Verification Required", message: "Please complete the verification before continuing." });
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSendingCode(true);
    try {
      await customFetch("/api/auth/forgot-password", { method: "POST", auth: "omit", body: JSON.stringify(buildForgotPasswordPayload(email, botToken)) });
      forgotPasswordOutcome();
      router.push({ pathname: "/auth/otp-verification", params: { email } });
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        alert.show({ tone: "error", title: "Network Error", message: "Please check your connection and try again." });
        return;
      }
      const data = apiError.data;
      const code = data && typeof data === "object" && "code" in data ? String((data as { code?: unknown }).code ?? "") : "";
      if (code === "BOT_VERIFICATION_FAILED" || code === "BOT_VERIFICATION_UNAVAILABLE") {
        setBotToken(null);
        setChallengeResetKey((value) => value + 1);
      }
      const message = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error ?? "") : "";
      alert.show({ tone: "error", title: "Couldn't Send Code", message: message || "Something went wrong. Please try again." });
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (loading) return;
    if (!current.trim()) {
      alert.show({ tone: "warning", title: "Required", message: "Please enter your current password." });
      return;
    }
    const policyError = passwordPolicyError(next);
    if (policyError) {
      alert.show({ tone: "warning", title: "Too Weak", message: policyError });
      return;
    }
    if (next !== confirm) {
      alert.show({ tone: "warning", title: "Mismatch", message: "New passwords don't match." });
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const result = await customFetch<{ ok: boolean; accessToken?: string }>("/api/auth/change-password", { method: "POST", body: JSON.stringify(buildChangePasswordPayload(current, next)) });
      await persistChangePasswordToken(result, secureTokenStorageAdapter);
      setSuccess(true);
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        alert.show({ tone: "error", title: "Network Error", message: "Please check your connection and try again." });
        return;
      }
      const outcome = changePasswordOutcome(apiError);
      alert.show({ tone: "error", title: "Couldn't Update Password", message: outcome.kind === "success" ? "" : outcome.message });
    } finally {
      setLoading(false);
    }
  }

  if (view === "recovery") {
    return <View style={styles.screen}>
      <PasswordBackdrop />
      <ScreenHeader title="VERIFY IDENTITY" top={safeTop} onBack={() => setView("form")} />
      <KeyboardAwareScrollView showsVerticalScrollIndicator={false} bottomOffset={24} contentContainerStyle={[styles.recoveryScroll, { paddingBottom: safeBottom + 20 }]}>
        <Image source={OTP_ARTWORK} style={styles.otpArtwork} contentFit="contain" transition={0} />
        <View style={styles.recoveryCopy}>
          <Text style={styles.recoveryTitle}>Verify Your Identity</Text>
          <Text style={styles.recoveryDescription}>We’ll send a verification code to</Text>
          <Text style={styles.maskedEmail}>{maskEmail(user?.email ?? "")}</Text>
        </View>
        <View style={styles.recoveryActions}>
          <BotChallenge action="forgot_password" resetKey={challengeResetKey} onToken={setBotToken} />
          <AppButton title="Send Verification Code" onPress={handleSendCode} loading={sendingCode} disabled={!botToken} fullWidth size="lg" style={styles.primaryButton} />
          <TouchableOpacity onPress={() => setView("form")} style={styles.textAction}>
            <Text style={styles.textActionLabel}>Use my current password instead</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </View>;
  }

  if (success) {
    return <View style={styles.screen}>
      <PasswordBackdrop />
      <ScreenHeader title="CHANGE PASSWORD" top={safeTop} />
      <View style={styles.successWrap}>
        <View style={styles.successMark}><Text style={styles.successMarkText}>✓</Text></View>
        <Text style={styles.successTitle}>Password Updated</Text>
        <Text style={styles.successDescription}>Your password has been changed successfully.</Text>
        <AppButton title="Back to Profile" onPress={() => router.back()} fullWidth size="lg" style={styles.primaryButton} />
      </View>
    </View>;
  }

  return <View style={styles.screen}>
    <PasswordBackdrop />
    <ScreenHeader title="CHANGE PASSWORD" top={safeTop} />
    <KeyboardAwareScrollView showsVerticalScrollIndicator={false} bottomOffset={28} contentContainerStyle={[styles.formScroll, { paddingBottom: safeBottom + 18 }]}>
      <View>
        <View style={styles.userRow}>
          <View style={styles.avatarFrame}>
            {user?.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} contentFit="cover" transition={100} /> : <Text style={styles.avatarInitials}>{initials}</Text>}
          </View>
          <View style={styles.userCopy}>
            <Text style={styles.userRole}>{user?.accountType === "parent" ? "PARENT" : "STUDENT"}</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.userName}>{user?.fullName?.toUpperCase() ?? "USER"}</Text>
          </View>
        </View>
        <Text style={styles.policyCopy}>Your password must be at least 8 characters and include a combination of letters and numbers.</Text>
        <View style={styles.formFields}>
          <TextInput value={current} onChangeText={setCurrent} placeholder="Current password" placeholderTextColor="#E4E4E4" secureTextEntry autoCapitalize="none" style={styles.input} />
          <TextInput value={next} onChangeText={setNext} placeholder="New password" placeholderTextColor="#E4E4E4" secureTextEntry autoCapitalize="none" style={styles.input} />
          <TextInput value={confirm} onChangeText={setConfirm} placeholder="Retype new password" placeholderTextColor="#E4E4E4" secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => void handleSubmit()} style={styles.input} />
        </View>
        <TouchableOpacity onPress={() => setView("recovery")} style={styles.forgotLink}>
          <Text style={styles.forgotLinkText}>Forgotten your password?</Text>
        </TouchableOpacity>
      </View>
      <AppButton title="Change Password" onPress={handleSubmit} loading={loading} fullWidth size="lg" style={styles.primaryButton} />
    </KeyboardAwareScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN },
  topGlow: { ...StyleSheet.absoluteFillObject },
  header: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, zIndex: 2 },
  headerTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 21, lineHeight: 27, letterSpacing: 0.2, ...iosDisplayTextStyle(21, 27) },
  headerSpacer: { width: 34, height: 34 },
  formScroll: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 28, gap: 42 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  avatarFrame: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: CYAN, backgroundColor: "#08343E", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitials: { color: CYAN, fontFamily: "Anton_400Regular", fontSize: 22 },
  userCopy: { flex: 1, minWidth: 0 },
  userRole: { color: "#FFFFFF", fontFamily: "Archivo_700Bold", fontSize: 10, lineHeight: 13 },
  userName: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 25, lineHeight: 30, ...iosDisplayTextStyle(25, 30) },
  policyCopy: { maxWidth: 370, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 17 },
  formFields: { gap: 10, marginTop: 18 },
  input: { height: 48, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.075)", color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, paddingHorizontal: 14, ...iosTextInputStyle(14, 18) },
  forgotLink: { alignSelf: "flex-start", paddingVertical: 18, paddingRight: 18 },
  forgotLinkText: { color: CYAN, fontFamily: "Archivo_400Regular", fontSize: 13 },
  primaryButton: { borderRadius: 28 },
  recoveryScroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 18, paddingTop: 8 },
  otpArtwork: { width: "78%", maxWidth: 300, aspectRatio: 1.22 },
  recoveryCopy: { alignItems: "center", marginTop: 6 },
  recoveryTitle: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 24, lineHeight: 30, textAlign: "center" },
  recoveryDescription: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: "center" },
  maskedEmail: { color: CYAN, fontFamily: "Archivo_600SemiBold", fontSize: 14, lineHeight: 20, textAlign: "center" },
  recoveryActions: { width: "100%", marginTop: 26, alignItems: "center" },
  textAction: { paddingVertical: 13, paddingHorizontal: 16 },
  textActionLabel: { color: CYAN, fontFamily: "Archivo_400Regular", fontSize: 13 },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 14 },
  successMark: { width: 82, height: 82, borderRadius: 41, backgroundColor: "rgba(0,182,215,0.15)", alignItems: "center", justifyContent: "center" },
  successMarkText: { color: CYAN, fontFamily: "Archivo_800ExtraBold", fontSize: 42 },
  successTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 30, ...iosDisplayTextStyle(30, 36) },
  successDescription: { color: "#B8BCC1", fontFamily: "Archivo_400Regular", fontSize: 14, textAlign: "center", marginBottom: 14 },
});
