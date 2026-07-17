import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useRef, useState } from "react";
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
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { studentId, email } = useLocalSearchParams<{ studentId: string; email: string }>();

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const codeRef = useRef<TextInput>(null);
  const newPwRef = useRef<TextInput>(null);
  const confirmPwRef = useRef<TextInput>(null);

  async function handleReset() {
    if (!code.trim() || code.length !== 6) {
      setError("Please enter the 6-digit code from your email.");
      return;
    }
    if (!newPassword) {
      setError("Please enter a new password.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
      const response = await fetch(`${apiUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          studentId: Number(studentId),
          code: code.trim(),
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Reset failed. Please try again.");
        setLoading(false);
        return;
      }

      setLoading(false);
      setSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <View style={[styles.container, styles.centeredContainer]}>
        <LinearGradient
          colors={[colors.studio.primary, "#007A91"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.successBadge}
        >
          <Ionicons name="checkmark" size={36} color="#000" />
        </LinearGradient>
        <Text style={styles.successTitle}>Password Updated!</Text>
        <Text style={styles.successBody}>
          Your password has been reset successfully. Sign in with your new password.
        </Text>
        <AppButton
          title="Sign In"
          onPress={() => router.replace("/auth/login")}
          fullWidth
          size="lg"
        />
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
        onPress={() => router.replace("/auth/login")}
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
          <Ionicons name="key-outline" size={28} color="#000" />
        </LinearGradient>

        <Text style={styles.title}>Reset Password</Text>
        {email ? (
          <Text style={styles.subtitle}>
            We sent a code to{"\n"}
            <Text style={{ color: colors.studio.primary }}>{email}</Text>
          </Text>
        ) : (
          <Text style={styles.subtitle}>Enter the 6-digit code from your email.</Text>
        )}

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
          {/* 6-digit code */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Verification Code</Text>
            <View style={styles.inputRow}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#6B7280" />
              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                placeholderTextColor="#6B7280"
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="next"
                onSubmitEditing={() => newPwRef.current?.focus()}
                style={[styles.input, styles.codeInput]}
              />
            </View>
          </View>

          {/* New password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>New Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
              <TextInput
                ref={newPwRef}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="At least 6 characters"
                placeholderTextColor="#6B7280"
                secureTextEntry={!showPw}
                returnKeyType="next"
                onSubmitEditing={() => confirmPwRef.current?.focus()}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowPw(!showPw)}>
                <Ionicons
                  name={showPw ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color="#6B7280"
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
              <TextInput
                ref={confirmPwRef}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repeat new password"
                placeholderTextColor="#6B7280"
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleReset}
                style={styles.input}
              />
            </View>
          </View>

          <AppButton
            title="Reset Password"
            onPress={handleReset}
            loading={loading}
            fullWidth
            size="lg"
          />
        </View>

        {/* Resend */}
        <View style={styles.resendRow}>
          <Text style={styles.resendNote}>Didn't get the code?</Text>
          <TouchableOpacity onPress={() => router.replace("/auth/forgot-password")}>
            <Text style={[styles.resendLink, { color: colors.studio.primary }]}> Resend</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  centeredContainer: { justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  successBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  successTitle: { fontSize: 32, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", ...iosDisplayTextStyle(32, 38) },
  successBody: {
    fontSize: 15,
    fontFamily: "Archivo_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 22,
  },
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
  title: { fontSize: 36, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 40, ...iosDisplayTextStyle(36, 40), marginBottom: -iosCapGuard(36, 40) },
  subtitle: {
    fontSize: 14,
    fontFamily: "Archivo_400Regular",
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 20,
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
    ...iosTextInputStyle(15, 18),
  },
  codeInput: {
    fontSize: 20,
    fontFamily: "SpaceMono_700Bold",
    letterSpacing: 4,
    color: colors.studio.primary,
  },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  resendNote: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  resendLink: { fontSize: 14, fontFamily: "Archivo_800ExtraBold" },
});
