import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { customFetch } from "@workspace/api-client-react";
import AppButton from "@/components/AppButton";
import CentralBackButton from "@/components/CentralBackButton";
import { useAppContext } from "@/contexts/AppContext";
import { enterApp } from "@/services/authProfile";
import { buildResetPasswordWithGrantPayload, resetPasswordOutcome, toApiErrorLike } from "@/services/passwordRecoveryFlow";
import { clearPasswordResetGrant, getPasswordResetGrant } from "@/services/passwordResetGrantStore";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";
import { resetPasswordPolicyError } from "@/utils/passwordPolicy";

const RESET_ARTWORK = require("@/assets/images/enter-otp-amico.svg");
const CYAN = "#00B6D7";
const SCREEN = "#101112";

export default function ResetPasswordScreen(): React.ReactElement {
  const { user } = useAppContext();
  const insets = useSafeAreaInsets();
  const safeTop = Platform.OS === "web" ? 67 : insets.top;
  const safeBottom = Math.max(insets.bottom, 18);
  const confirmRef = useRef<TextInput>(null);
  const resetGrantRef = useRef(getPasswordResetGrant());
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleReset(): Promise<void> {
    if (loading) return;
    const resetGrant = resetGrantRef.current;
    if (!resetGrant) {
      setError("Your verification session is incomplete. Please return and enter the code again.");
      return;
    }
    const policyError = resetPasswordPolicyError(newPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        auth: "omit",
        body: JSON.stringify(buildResetPasswordWithGrantPayload(resetGrant.email, resetGrant.resetToken, newPassword)),
      });
      clearPasswordResetGrant();
      setSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        setError("Network error. Please check your connection.");
        return;
      }
      const outcome = resetPasswordOutcome(apiError);
      setError(outcome.kind === "success" ? "" : outcome.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return <View style={styles.screen}>
      <PasswordBackdrop />
      <View style={styles.successWrap}>
        <View style={styles.successMark}><Text style={styles.successMarkText}>✓</Text></View>
        <Text style={styles.successTitle}>Password Updated</Text>
        <Text style={styles.successDescription}>{user ? "Your password has been reset successfully. You're all set." : "Your password has been reset successfully. Sign in with your new password."}</Text>
        <AppButton title={user ? "Continue" : "Sign In"} onPress={() => (user ? void enterApp() : router.replace("/auth/login"))} fullWidth size="lg" style={styles.primaryButton} />
      </View>
    </View>;
  }

  return <View style={styles.screen}>
    <PasswordBackdrop />
    <View style={[styles.header, { paddingTop: safeTop + 10 }]}>
      <CentralBackButton />
      <Text style={styles.headerTitle}>RESET PASSWORD</Text>
      <View style={styles.headerSpacer} />
    </View>
    <KeyboardAwareScrollView showsVerticalScrollIndicator={false} bottomOffset={28} contentContainerStyle={[styles.scroll, { paddingBottom: safeBottom + 18 }]}>
      <View style={styles.content}>
        <Image source={RESET_ARTWORK} style={styles.artwork} contentFit="contain" transition={0} />
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.description}>Please enter your new password. It must be different from your current password.</Text>
        {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
        <View style={styles.fields}>
          <TextInput value={newPassword} onChangeText={(value) => { setNewPassword(value); if (error) setError(""); }} placeholder="New password" placeholderTextColor="#E4E4E4" secureTextEntry autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} style={styles.input} />
          <TextInput ref={confirmRef} value={confirmPassword} onChangeText={(value) => { setConfirmPassword(value); if (error) setError(""); }} placeholder="Retype new password" placeholderTextColor="#E4E4E4" secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => void handleReset()} style={styles.input} />
        </View>
        <View style={styles.requirements}>
          <Text style={styles.requirementsTitle}>Minimum requirements:</Text>
          <Text style={styles.requirement}>•  12 Characters</Text>
          <Text style={styles.requirement}>•  At least 1 Letter in password</Text>
          <Text style={styles.requirement}>•  At least 1 Number in password</Text>
          <Text style={styles.requirement}>•  1 Special Character</Text>
        </View>
      </View>
      <AppButton title="Change Password" onPress={handleReset} loading={loading} fullWidth size="lg" style={styles.primaryButton} />
    </KeyboardAwareScrollView>
  </View>;
}

function PasswordBackdrop(): React.ReactElement {
  return <>
    <LinearGradient colors={["#17191B", SCREEN]} style={StyleSheet.absoluteFill} />
    <LinearGradient pointerEvents="none" colors={["rgba(0,182,215,0.62)", "rgba(0,182,215,0.08)", "transparent"]} locations={[0, 0.3, 0.72]} start={{ x: 1, y: 0 }} end={{ x: 0.08, y: 0.62 }} style={StyleSheet.absoluteFill} />
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN },
  header: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, zIndex: 2 },
  headerTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 21, lineHeight: 27, letterSpacing: 0.2, ...iosDisplayTextStyle(21, 27) },
  headerSpacer: { width: 34, height: 34 },
  scroll: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: 18, gap: 36 },
  content: { width: "100%", alignItems: "center" },
  artwork: { width: "68%", maxWidth: 270, aspectRatio: 1.22 },
  title: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 24, lineHeight: 30, textAlign: "center", marginTop: 6 },
  description: { maxWidth: 350, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 8 },
  fields: { width: "100%", gap: 10, marginTop: 12 },
  input: { width: "100%", height: 48, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.075)", color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, paddingHorizontal: 14, ...iosTextInputStyle(14, 18) },
  requirements: { width: "100%", marginTop: 12 },
  requirementsTitle: { color: "#FFFFFF", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 18, marginBottom: 2 },
  requirement: { color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18, paddingLeft: 7 },
  primaryButton: { borderRadius: 28 },
  errorBanner: { width: "100%", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,73,92,0.45)", backgroundColor: "rgba(255,73,92,0.10)", paddingHorizontal: 13, paddingVertical: 10, marginTop: 14 },
  errorText: { color: "#FF6B79", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 18, textAlign: "center" },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 14 },
  successMark: { width: 82, height: 82, borderRadius: 41, backgroundColor: "rgba(0,182,215,0.15)", alignItems: "center", justifyContent: "center" },
  successMarkText: { color: CYAN, fontFamily: "Archivo_800ExtraBold", fontSize: 42 },
  successTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 30, ...iosDisplayTextStyle(30, 36) },
  successDescription: { color: "#B8BCC1", fontFamily: "Archivo_400Regular", fontSize: 14, textAlign: "center", marginBottom: 14 },
});
