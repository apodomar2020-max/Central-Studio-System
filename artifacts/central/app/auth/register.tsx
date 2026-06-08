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

const ROLES: { value: User["role"]; label: string; icon: string }[] = [
  { value: "student", label: "Student", icon: "school-outline" },
  { value: "parent", label: "Parent / Guardian", icon: "people-outline" },
  { value: "instructor", label: "Instructor", icon: "star-outline" },
];

export default function RegisterScreen() {
  const { setUser } = useAppContext();
  const insets = useSafeAreaInsets();
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
    setError("");
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await new Promise((r) => setTimeout(r, 1000));
    const newUser: User = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      fullName: fullName.trim(),
      phone: phone.trim() || "+20 100 000 0000",
      email: email.trim(),
      emailVerified: false,
      role,
    };
    await setUser(newUser);
    setLoading(false);
    router.back();
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <TouchableOpacity
        onPress={() => router.back()}
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

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join Central Studio</Text>

        {error !== "" && (
          <View style={[styles.errorBanner, { backgroundColor: colors.error + "20", borderColor: colors.error + "50" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
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
  roleRow: { gap: 8 },
  roleCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  roleLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  loginRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  loginNote: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  loginLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
