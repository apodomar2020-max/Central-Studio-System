import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
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

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { useGoogleSignIn } from "@/hooks/useGoogleSignIn";
import FacebookSignInButton from "@/components/FacebookSignInButton";
import { useFacebookSignIn } from "@/hooks/useFacebookSignIn";
import AppleSignInButton from "@/components/AppleSignInButton";
import { continueAfterAuth } from "@/services/authProfile";

export default function LoginScreen() {
  const { setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const google = useGoogleSignIn();
  const facebook = useFacebookSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const player = useVideoPlayer(
    require("@/assets/EntroVideo.mp4"),
    (p) => {
      p.loop = true;
      p.muted = true;
      p.play();
    }
  );

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

      await continueAfterAuth(data.accessToken, setUser);
      setLoading(false);
    } catch {
      setError("Network error. Please check your connection.");
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      {/* Video background */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        allowsFullscreen={false}
      />
      {/* Dark gradient overlay so the form stays legible */}
      <LinearGradient
        colors={["rgba(6,12,16,0.55)", "rgba(6,12,16,0.82)", "rgba(6,12,16,0.97)"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

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

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to Central Studio</Text>

        {(error || google.error || facebook.error) !== "" && (
          <View style={[styles.errorBanner, { backgroundColor: colors.error + "20", borderColor: colors.error + "50" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error || google.error || facebook.error}</Text>
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

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <AppleSignInButton />

          <GoogleSignInButton onPress={google.signIn} loading={google.loading} disabled={!google.ready} />

          <FacebookSignInButton onPress={facebook.signIn} loading={facebook.loading} disabled={facebook.loading} />
        </View>

        <View style={styles.registerRow}>
          <Text style={styles.registerNote}>Don't have an account?</Text>
          <TouchableOpacity onPress={() => router.replace("/auth/register")}>
            <Text style={[styles.registerLink, { color: colors.studio.primary }]}> Create one</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/" as never); }} style={styles.guestBtn}>
          <Text style={styles.guestText}>Continue browsing as guest</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D", overflow: "hidden" },
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
  forgotBtn: { alignSelf: "flex-end" },
  forgotText: { fontSize: 13, fontFamily: "Archivo_700Bold" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  dividerText: { fontSize: 12, fontFamily: "SpaceMono_700Bold", color: "#6B7280", textTransform: "uppercase" },
  registerRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  registerNote: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  registerLink: { fontSize: 14, fontFamily: "Archivo_800ExtraBold" },
  guestBtn: { marginTop: 8 },
  guestText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#6B7280" },
});
