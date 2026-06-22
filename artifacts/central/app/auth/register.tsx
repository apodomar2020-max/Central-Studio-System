import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAppContext, User } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { STORAGE_KEYS } from "@/constants/danceStyles";
import AppButton from "@/components/AppButton";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { useGoogleSignIn } from "@/hooks/useGoogleSignIn";
import FacebookSignInButton from "@/components/FacebookSignInButton";
import { useFacebookSignIn } from "@/hooks/useFacebookSignIn";
import AppleSignInButton from "@/components/AppleSignInButton";
import { continueAfterAuth } from "@/services/authProfile";

const ROLES: { value: User["role"]; label: string; icon: string }[] = [
  { value: "student", label: "Student", icon: "school-outline" },
  { value: "parent", label: "Parent / Guardian", icon: "people-outline" },
];

export default function RegisterScreen() {
  const { setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const google = useGoogleSignIn();
  const facebook = useFacebookSignIn();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>("student");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRegister() {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
      const apiKey = process.env.EXPO_PUBLIC_API_KEY ?? "";
      const response = await fetch(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          accountType: role,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Registration failed. Please try again.");
        setLoading(false);
        return;
      }

      // Mark this as a brand-new account so the post-auth funnel routes
      // through the signup personalization steps (phone → styles → success).
      await AsyncStorage.setItem(STORAGE_KEYS.needsPersonalization, "1");
      await continueAfterAuth(data.accessToken, setUser);
      setLoading(false);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <TouchableOpacity
        onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/" as never); }}
        style={[styles.closeBtn, { top: (Platform.OS === "web" ? 67 : insets.top) + 12 }]}
      >
        <Ionicons name="close" size={22} color="#9CA3AF" />
      </TouchableOpacity>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
        contentContainerStyle={[styles.scroll, { paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 60 }]}
      >
        <Image
          source={require("@/assets/images/central_studio_logo.png")}
          style={styles.logoBadge}
          resizeMode="contain"
        />

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join Central Studio</Text>

        {(error || google.error || facebook.error) !== "" && (
          <View style={[styles.errorBanner, { backgroundColor: colors.error + "20", borderColor: colors.error + "50" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error || google.error || facebook.error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name *</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color="#6B7280" />
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your full name"
                placeholderTextColor="#6B7280"
                autoCapitalize="words"
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.inputRow}>
              <Ionicons name="call-outline" size={18} color="#6B7280" />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+20 100 000 0000"
                placeholderTextColor="#6B7280"
                keyboardType="phone-pad"
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email *</Text>
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
            <Text style={styles.label}>Password *</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Create a password"
                placeholderTextColor="#6B7280"
                secureTextEntry
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>I am a...</Text>
            <View style={styles.roleRow}>
              {ROLES.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRole(r.value);
                  }}
                  style={[
                    styles.roleCard,
                    {
                      borderColor: role === r.value ? colors.studio.primary : "#2A2A35",
                      backgroundColor: role === r.value ? colors.studio.primary + "15" : "#1E1E26",
                    },
                  ]}
                >
                  <Ionicons
                    name={r.icon as any}
                    size={20}
                    color={role === r.value ? colors.studio.primary : "#6B7280"}
                  />
                  <Text style={[styles.roleLabel, { color: role === r.value ? colors.studio.primary : "#9CA3AF" }]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <AppButton title="Create Account" onPress={handleRegister} loading={loading} fullWidth size="lg" />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <AppleSignInButton />

          <GoogleSignInButton onPress={google.signIn} loading={google.loading} disabled={!google.ready} />

          <FacebookSignInButton onPress={facebook.signIn} loading={facebook.loading} disabled={facebook.loading} />
        </View>

        <View style={styles.loginRow}>
          <Text style={styles.loginNote}>Already have an account?</Text>
          <TouchableOpacity onPress={() => router.replace("/auth/login")}>
            <Text style={[styles.loginLink, { color: colors.studio.primary }]}> Sign in</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
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
  logoBadge: { width: "100%", height: 160, marginBottom: 8, marginHorizontal: -24 },
  title: { fontSize: 44, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 43 },
  subtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", marginTop: 4 },
  errorBanner: { width: "100%", flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13, fontFamily: "Archivo_400Regular", flex: 1 },
  form: { width: "100%", gap: 14 },
  inputGroup: { gap: 6 },
  label: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#9CA3AF", paddingLeft: 2, letterSpacing: 0.66, textTransform: "uppercase" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, height: 50, borderRadius: 12, borderWidth: 1.5, backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.12)" },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 15 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  dividerText: { fontSize: 12, fontFamily: "SpaceMono_700Bold", color: "#6B7280", textTransform: "uppercase" },
  roleRow: { gap: 8 },
  roleCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  roleLabel: { fontSize: 14, fontFamily: "Archivo_700Bold" },
  loginRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  loginNote: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  loginLink: { fontSize: 14, fontFamily: "Archivo_800ExtraBold" },
});
