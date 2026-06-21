import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
      const response = await fetch(`${apiUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      setLoading(false);

      if (data.studentId) {
        // Account found — go to reset screen
        router.push({
          pathname: "/auth/reset-password",
          params: { studentId: String(data.studentId), email: email.trim() },
        });
      } else {
        // No account with that email — show neutral message (don't leak)
        setSent(true);
      }
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
        <TouchableOpacity
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/auth/login"); }}
          style={[styles.closeBtn, { top: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}
        >
          <Ionicons name="close" size={22} color="#9CA3AF" />
        </TouchableOpacity>
        <View style={styles.centeredMsg}>
          <Ionicons name="mail-open-outline" size={48} color={colors.studio.primary} />
          <Text style={styles.msgTitle}>Check your email</Text>
          <Text style={styles.msgBody}>
            If an account exists for {email.trim()}, we've sent a 6-digit code. Check your inbox (and spam folder).
          </Text>
          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.backToLogin}>
            <Text style={[styles.backToLoginText, { color: colors.studio.primary }]}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      {/* Background radial glow */}
      <LinearGradient
        colors={["rgba(0,182,215,0.08)", "transparent"]}
        style={[StyleSheet.absoluteFillObject, { height: 400 }]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <TouchableOpacity
        onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/auth/login"); }}
        style={[styles.closeBtn, { top: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}
      >
        <Ionicons name="close" size={22} color="#9CA3AF" />
      </TouchableOpacity>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 60 },
        ]}
      >
        <LinearGradient
          colors={[colors.studio.primary, "#007A91"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoBadge}
        >
          <Ionicons name="lock-open-outline" size={28} color="#000" />
        </LinearGradient>

        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.subtitle}>
          Enter your email and we'll send you a reset code.
        </Text>

        {error !== "" && (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: colors.error + "20", borderColor: colors.error + "50" },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputRow}>
              <Ionicons name="mail-outline" size={18} color="#6B7280" />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#6B7280"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
          </View>

          <AppButton
            title="Send Reset Code"
            onPress={handleSend}
            loading={loading}
            fullWidth
            size="lg"
          />
        </View>

        <TouchableOpacity
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/auth/login"); }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back-outline" size={16} color="#6B7280" />
          <Text style={styles.backText}>Back to Sign In</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  centeredMsg: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  msgTitle: { fontSize: 32, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase" },
  msgBody: { fontSize: 15, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 22 },
  backToLogin: { marginTop: 24, paddingVertical: 12 },
  backToLoginText: { fontSize: 14, fontFamily: "Archivo_800ExtraBold" },
  closeBtn: {
    position: "absolute",
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 60, alignItems: "center", gap: 16 },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 36, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 40 },
  subtitle: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 4,
  },
  errorBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: { fontSize: 13, fontFamily: "Archivo_400Regular", flex: 1 },
  form: { width: "100%", gap: 14 },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: "Archivo_700Bold",
    color: "#9CA3AF",
    paddingLeft: 2,
    letterSpacing: 0.66,
    textTransform: "uppercase",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  input: {
    flex: 1,
    color: "#FFFFFF",
    fontFamily: "Archivo_400Regular",
    fontSize: 15,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  backText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B7280" },
});
