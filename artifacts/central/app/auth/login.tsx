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

import { useAppContext, User } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

export default function LoginScreen() {
  const { setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        setLoading(false);
        return;
      }

      const { student } = data;
      const user: User = {
        id: String(student.id),
        fullName: student.name,
        phone: student.phone ?? "",
        email: student.email,
        emailVerified: true,
        role: "student",
      };
      await setUser(user);
      setLoading(false);
      router.replace("/(tabs)/");
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <TouchableOpacity
        onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/"); }}
        style={[styles.closeBtn, { top: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}
      >
        <Ionicons name="close" size={22} color="#9CA3AF" />
      </TouchableOpacity>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        contentContainerStyle={[styles.scroll, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 60 }]}
      >
        <LinearGradient
          colors={[colors.studio.primary, "#007A91"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logoBadge}
        >
          <Ionicons name="musical-notes" size={28} color="#000" />
        </LinearGradient>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to Central Studio</Text>

        {error !== "" && (
          <View style={[styles.errorBanner, { backgroundColor: colors.error + "20", borderColor: colors.error + "50" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email or Phone</Text>
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

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#6B7280"
                secureTextEntry={!showPw}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowPw(!showPw)}>
                <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={styles.forgotBtn} onPress={() => router.push("/auth/forgot-password")}>
            <Text style={[styles.forgotText, { color: colors.studio.primary }]}>Forgot password?</Text>
          </TouchableOpacity>

          <AppButton title="Sign In" onPress={handleLogin} loading={loading} fullWidth size="lg" />
        </View>

        <View style={styles.registerRow}>
          <Text style={styles.registerNote}>Don't have an account?</Text>
          <TouchableOpacity onPress={() => router.replace("/auth/register")}>
            <Text style={[styles.registerLink, { color: colors.studio.primary }]}> Create one</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/"); }} style={styles.guestBtn}>
          <Text style={styles.guestText}>Continue browsing as guest</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#060C10" },
  closeBtn: {
    position: "absolute",
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  scroll: { paddingHorizontal: 28, paddingBottom: 60, alignItems: "center", gap: 16 },
  logoBadge: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -8 },
  errorBanner: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  form: { width: "100%", gap: 14 },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF", paddingLeft: 2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 50, borderRadius: 12, borderWidth: 1, backgroundColor: "#1E1E26", borderColor: "#2A2A35" },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 15 },
  forgotBtn: { alignSelf: "flex-end" },
  forgotText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  registerRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  registerNote: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  registerLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  guestBtn: { marginTop: 8 },
  guestText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
});
