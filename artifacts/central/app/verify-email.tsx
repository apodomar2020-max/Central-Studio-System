import { Ionicons } from "@expo/vector-icons";
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
import AppButton from "@/components/AppButton";
import { fetchCurrentUser } from "@/services/authProfile";

const CODE_LENGTH = 6;

export default function VerifyEmailScreen() {
  const { user, setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [sent, setSent] = useState(false);
  const refs = useRef<(TextInput | null)[]>([]);

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
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verify Email</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centeredWrap}>
          <View style={[styles.iconWrap, { backgroundColor: "#22C55E20" }]}>
            <Ionicons name="checkmark-circle" size={56} color="#22C55E" />
          </View>
          <Text style={styles.successTitle}>Already Verified!</Text>
          <Text style={styles.successDesc}>Your email address is verified. You have full access to all features.</Text>
          <View style={[styles.emailBox, { borderColor: "#22C55E30", backgroundColor: "#22C55E10" }]}>
            <Ionicons name="mail" size={16} color="#22C55E" />
            <Text style={[styles.emailText, { color: "#22C55E" }]}>{user.email}</Text>
          </View>
          <View style={{ marginTop: 8, width: "100%" }}>
            <AppButton title="Back to Profile" onPress={() => router.back()} fullWidth />
          </View>
        </View>
      </View>
    );
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
      Alert.alert("Email Verified!", "Your email has been verified successfully.", [
        {
          text: "Continue",
          onPress: () => {
            if (!refreshed.user.profileCompleted) {
              router.replace("/auth/complete-profile" as never);
            } else {
              router.replace("/" as never);
            }
          },
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid or expired code.";
      Alert.alert("Verification Failed", msg);
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
      const msg = err instanceof Error ? err.message : "Could not send code.";
      Alert.alert("Failed to Send", msg);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 30 : 0 }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify Email</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.scroll}>
        <View style={[styles.iconWrap, { backgroundColor: colors.studio.primary + "20" }]}>
          <Ionicons name="mail-open-outline" size={40} color={colors.studio.primary} />
        </View>

        <Text style={styles.pageTitle}>Check your inbox</Text>
        <Text style={styles.pageDesc}>
          We sent a 6-digit verification code to{"\n"}
          <Text style={[styles.pageDescEmail, { color: colors.studio.primary }]}>{user?.email}</Text>
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
                  borderColor: digit ? colors.studio.primary : "#2A2A35",
                  backgroundColor: digit ? colors.studio.primary + "15" : "#1E1E26",
                  color: digit ? colors.studio.primary : "#FFFFFF",
                },
              ]}
              selectTextOnFocus
            />
          ))}
        </View>

        <AppButton
          title="Verify Email"
          onPress={handleVerify}
          loading={loading}
          fullWidth
          size="lg"
        />

        <TouchableOpacity
          onPress={handleResend}
          disabled={resendCountdown > 0}
          style={styles.resendBtn}
        >
          {resendCountdown > 0 ? (
            <Text style={styles.resendText}>
              Resend code in{" "}
              <Text style={{ color: colors.studio.primary }}>{resendCountdown}s</Text>
            </Text>
          ) : (
            <Text style={[styles.resendText, { color: colors.studio.primary }]}>Resend verification email</Text>
          )}
        </TouchableOpacity>

        <View style={[styles.helpBox, { borderColor: "#1E2E38", backgroundColor: "#0E1619" }]}>
          <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
          <Text style={styles.helpText}>
            Can't find the email? Check your spam folder or make sure you signed up with the correct address.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { flex: 1, paddingHorizontal: 28, paddingTop: 24, gap: 20, alignItems: "center" },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center" },
  pageDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  pageDescEmail: { fontFamily: "Inter_600SemiBold" },
  centeredWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 16 },
  successTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#FFFFFF", textAlign: "center" },
  successDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  emailBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, width: "100%",
  },
  emailText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  codeRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  codeInput: {
    width: 44, height: 52, borderRadius: 12, borderWidth: 1.5,
    textAlign: "center", fontSize: 22, fontFamily: "Inter_700Bold",
  },
  resendBtn: { paddingVertical: 4 },
  resendText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#6B7280" },
  helpBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4,
  },
  helpText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 17 },
});
