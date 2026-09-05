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
import {
  buildForgotPasswordPayload,
  forgotPasswordOutcome,
  toApiErrorLike,
} from "@/services/passwordRecoveryFlow";
import { iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";

const OTP_ARTWORK = require("@/assets/images/enter-otp-amico.svg");
const CYAN = "#00B6D7";
const SCREEN = "#101112";

export default function ForgotPasswordScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const safeTop = Platform.OS === "web" ? 67 : insets.top;
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [botToken, setBotToken] = useState<string | null>(null);
  const [challengeResetKey, setChallengeResetKey] = useState(0);

  async function handleSend(): Promise<void> {
    if (loading) return;
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    if (!botToken) {
      setError("Please complete the verification before continuing.");
      return;
    }
    setError("");
    setLoading(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await customFetch("/api/auth/forgot-password", {
        method: "POST",
        auth: "omit",
        body: JSON.stringify(buildForgotPasswordPayload(email, botToken)),
      });
      forgotPasswordOutcome();
      router.replace({ pathname: "/auth/otp-verification", params: { email: email.trim() } });
    } catch (err: unknown) {
      const apiError = toApiErrorLike(err);
      const data = apiError?.data;
      const code = data && typeof data === "object" && "code" in data ? String((data as { code?: unknown }).code ?? "") : "";
      if (code === "BOT_VERIFICATION_FAILED" || code === "BOT_VERIFICATION_UNAVAILABLE") {
        setBotToken(null);
        setChallengeResetKey((value) => value + 1);
      }
      const message = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error ?? "") : "";
      setError(message || (apiError ? "Something went wrong. Please try again." : "Please check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  return <View style={styles.screen}>
    <LinearGradient colors={["#17191B", SCREEN]} style={StyleSheet.absoluteFill} />
    <LinearGradient pointerEvents="none" colors={["rgba(0,182,215,0.62)", "rgba(0,182,215,0.08)", "transparent"]} locations={[0, 0.3, 0.72]} start={{ x: 1, y: 0 }} end={{ x: 0.08, y: 0.62 }} style={styles.topGlow} />

    <View style={[styles.header, { paddingTop: safeTop + 10 }]}>
      <CentralBackButton onPress={() => router.replace("/auth/login")} />
      <Text style={styles.headerTitle}>FORGOT PASSWORD</Text>
      <View style={styles.headerSpacer} />
    </View>

    <KeyboardAwareScrollView
      showsVerticalScrollIndicator={false}
      bottomOffset={24}
      contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 18) + 24 }]}
    >
      <Image source={OTP_ARTWORK} style={styles.artwork} contentFit="contain" transition={0} />

      <Text style={styles.title}>Forgot Your Password?</Text>
      <Text style={styles.description}>Enter your email address and we’ll send you a verification code.</Text>
      <View style={styles.form}>
        {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
        <TextInput
          value={email}
          onChangeText={(value) => { setEmail(value); if (error) setError(""); }}
          placeholder="Email address"
          placeholderTextColor="#B8BCC1"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void handleSend()}
          style={styles.input}
        />
        <BotChallenge action="forgot_password" resetKey={challengeResetKey} onToken={setBotToken} />
        <AppButton title="Send Verification Code" onPress={handleSend} loading={loading} disabled={!botToken} fullWidth size="lg" style={styles.primaryButton} />
      </View>
      <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.textAction}>
        <Text style={styles.textActionLabel}>Back to Sign In</Text>
      </TouchableOpacity>
    </KeyboardAwareScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN },
  topGlow: { ...StyleSheet.absoluteFillObject },
  header: { minHeight: 92, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, zIndex: 2 },
  headerTitle: { color: "#FFFFFF", fontFamily: "Anton_400Regular", fontSize: 21, lineHeight: 27, letterSpacing: 0.2, ...iosDisplayTextStyle(21, 27) },
  headerSpacer: { width: 34, height: 34 },
  scroll: { flexGrow: 1, alignItems: "center", paddingHorizontal: 18, paddingTop: 4 },
  artwork: { width: "72%", maxWidth: 285, aspectRatio: 1.22 },
  title: { color: "#FFFFFF", fontFamily: "Archivo_800ExtraBold", fontSize: 25, lineHeight: 31, textAlign: "center", marginTop: 4 },
  description: { maxWidth: 330, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 9 },
  form: { width: "100%", marginTop: 24, alignItems: "center", gap: 12 },
  input: { width: "100%", height: 50, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.075)", color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 14, paddingHorizontal: 14, ...iosTextInputStyle(14, 18) },
  errorBanner: { width: "100%", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,73,92,0.45)", backgroundColor: "rgba(255,73,92,0.10)", paddingHorizontal: 13, paddingVertical: 10 },
  errorText: { color: "#FF6B79", fontFamily: "Archivo_500Medium", fontSize: 13, lineHeight: 18, textAlign: "center" },
  primaryButton: { borderRadius: 28 },
  textAction: { paddingVertical: 14, paddingHorizontal: 18 },
  textActionLabel: { color: CYAN, fontFamily: "Archivo_400Regular", fontSize: 13 },
});
