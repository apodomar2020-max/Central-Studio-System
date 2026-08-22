import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import AsyncStorage from "@react-native-async-storage/async-storage";

import { customFetch } from "@workspace/api-client-react";
import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";
import { iosTextInputStyle } from "@/utils/iosTypography";
import { useCentralAlert } from "@/hooks/useCentralAlert";
import { passwordPolicyError } from "@/utils/passwordPolicy";
import {
  buildChangePasswordPayload,
  changePasswordOutcome,
  forgotPasswordOutcome,
  maskEmail,
  persistChangePasswordToken,
  toApiErrorLike,
} from "@/services/passwordRecoveryFlow";

export default function ChangePasswordScreen() {
  const { user } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [view, setView] = useState<"form" | "recovery">("form");
  const [sendingCode, setSendingCode] = useState(false);

  async function handleSendCode() {
    if (sendingCode) return; // prevent duplicate submissions
    const email = user?.email?.trim();
    if (!email) {
      // Defensive: authenticated state exists but the email is missing/empty
      // — never call the endpoint or navigate without a usable target.
      alert.show({ tone: "error", title: "Something Went Wrong", message: "We couldn't verify your account. Please try again later." });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSendingCode(true);
    try {
      await customFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      forgotPasswordOutcome();
      setSendingCode(false);
      router.push({ pathname: "/auth/reset-password", params: { email } });
    } catch (err: unknown) {
      setSendingCode(false);
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        alert.show({ tone: "error", title: "Network Error", message: "Please check your connection and try again." });
        return;
      }
      const data = apiError.data;
      const message = data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? "")
        : "";
      alert.show({ tone: "error", title: "Couldn't Send Code", message: message || "Something went wrong. Please try again." });
    }
  }

  async function handleSubmit() {
    if (loading) return; // prevent duplicate submissions
    if (!current.trim()) { alert.show({ tone: "warning", title: "Required", message: "Please enter your current password." }); return; }
    const policyError = passwordPolicyError(next);
    if (policyError) { alert.show({ tone: "warning", title: "Too weak", message: policyError }); return; }
    if (next !== confirm) { alert.show({ tone: "warning", title: "Mismatch", message: "New passwords don't match." }); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);

    try {
      // Security-02B (CS-SEC-H-03): the backend revokes every OTHER
      // outstanding session as part of this call (token_version bump), and
      // — because this device's own token is one of the ones that gets
      // revoked — issues a fresh replacement token in the response so THIS
      // device stays logged in. Persist it if present; older server builds
      // that don't yet send it leave this a no-op and the existing token
      // simply keeps working exactly as before.
      const result = await customFetch<{ ok: boolean; accessToken?: string }>(
        "/api/auth/change-password",
        { method: "POST", body: JSON.stringify(buildChangePasswordPayload(current, next)) },
      );
      // The token getter (app/_layout.tsx) reads AsyncStorage fresh on every
      // request — no separate in-memory copy to update, and no re-fetch of
      // the user/session is needed to pick this up.
      await persistChangePasswordToken(result, AsyncStorage);
      setLoading(false);
      setSuccess(true);
    } catch (err: unknown) {
      setLoading(false);
      const apiError = toApiErrorLike(err);
      if (!apiError) {
        alert.show({ tone: "error", title: "Network Error", message: "Please check your connection and try again." });
        return;
      }
      const outcome = changePasswordOutcome(apiError);
      const message = outcome.kind === "success" ? "" : outcome.message;
      alert.show({ tone: "error", title: "Couldn't Update Password", message });
    }
  }

  if (view === "recovery") {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
            <Text style={styles.headerButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verify Identity</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: "rgba(0,182,215,0.15)" }]}>
            <Ionicons name="shield-checkmark-outline" size={48} color={colors.studio.primary} />
          </View>
          <Text style={styles.successTitle}>Verify your identity</Text>
          <Text style={styles.successDesc}>
            We'll send a verification code to{"\n"}
            <Text style={{ fontFamily: "Archivo_700Bold", color: "#FFFFFF" }}>{maskEmail(user?.email ?? "")}</Text>
          </Text>
          <View style={{ marginTop: 8, width: "100%", gap: 12 }}>
            <AppButton title="Send Code" onPress={handleSendCode} loading={sendingCode} fullWidth />
            <TouchableOpacity onPress={() => setView("form")} style={styles.cancelRecoveryBtn}>
              <Text style={styles.cancelRecoveryText}>Use my current password instead</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (success) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
            <Text style={styles.headerButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Password</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: "#22C55E20" }]}>
            <Ionicons name="checkmark-circle" size={56} color="#22C55E" />
          </View>
          <Text style={styles.successTitle}>Password Updated!</Text>
          <Text style={styles.successDesc}>Your password has been changed successfully. Use your new password the next time you sign in.</Text>
          <View style={{ marginTop: 8, width: "100%" }}>
            <AppButton title="Back to Profile" onPress={() => router.back()} fullWidth />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.infoBox}>
          <Ionicons name="mail-outline" size={16} color={colors.studio.primary} />
          <Text style={styles.infoText}>
            Changing password for{" "}
            <Text style={{ fontFamily: "Archivo_700Bold", color: "#FFFFFF" }}>{user?.email ?? "your account"}</Text>
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Current Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color="#6B7280" />
              <TextInput
                value={current}
                onChangeText={setCurrent}
                placeholder="Your current password"
                placeholderTextColor="#4B5563"
                secureTextEntry={!showCurrent}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
                <Ionicons name={showCurrent ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setView("recovery")} style={styles.forgotCurrentBtn}>
              <Text style={styles.forgotCurrentText}>Forgot your current password?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>New Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-open-outline" size={18} color="#6B7280" />
              <TextInput
                value={next}
                onChangeText={setNext}
                placeholder="At least 8 characters"
                placeholderTextColor="#4B5563"
                secureTextEntry={!showNext}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowNext(!showNext)}>
                <Ionicons name={showNext ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {next.length > 0 && (
              <View style={styles.strengthRow}>
                {[...Array(4)].map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.strengthBar,
                      {
                        backgroundColor:
                          next.length >= 12 ? "#22C55E" :
                          next.length >= 8 ? "#F59E0B" :
                          next.length >= 5 ? "#F97316" : "#EF4444",
                        opacity: i < (next.length >= 12 ? 4 : next.length >= 8 ? 3 : next.length >= 5 ? 2 : 1) ? 1 : 0.2,
                      },
                    ]}
                  />
                ))}
                <Text style={styles.strengthLabel}>
                  {next.length >= 12 ? "Strong" : next.length >= 8 ? "Good" : next.length >= 5 ? "Fair" : "Weak"}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Confirm New Password</Text>
            <View style={[styles.inputRow, confirm.length > 0 && next !== confirm && { borderColor: "#EF4444" }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#6B7280" />
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Repeat new password"
                placeholderTextColor="#4B5563"
                secureTextEntry={!showConfirm}
                style={styles.input}
              />
              <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)}>
                <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {confirm.length > 0 && next !== confirm && (
              <Text style={styles.errorText}>Passwords don't match</Text>
            )}
          </View>
        </View>

        <AppButton
          title="Update Password"
          onPress={handleSubmit}
          loading={loading}
          fullWidth
          size="lg"
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: {
    flexDirection: "row", alignItems: "center", gap: 4, minWidth: 54,
  },
  headerButtonText: {
    fontSize: 14, fontFamily: "Archivo_600SemiBold", color: colors.studio.primary,
  },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  headerButtonPlaceholder: { minWidth: 54 },
  scroll: { paddingHorizontal: 20, paddingBottom: 60, paddingTop: 20, gap: 24 },
  infoBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(0,182,215,0.3)", backgroundColor: "rgba(0,182,215,0.1)" },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Archivo_400Regular", lineHeight: 18, color: colors.studio.primary },
  form: { gap: 14 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)", paddingHorizontal: 14, height: 50,
  },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 15, ...iosTextInputStyle(15, 18) },
  forgotCurrentBtn: { alignSelf: "flex-start", paddingTop: 6, paddingVertical: 4 },
  forgotCurrentText: { fontSize: 12.5, fontFamily: "Archivo_600SemiBold", color: colors.studio.primary },
  cancelRecoveryBtn: { paddingVertical: 10, alignItems: "center" },
  cancelRecoveryText: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: 4 },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#6B747F", marginLeft: 4, textTransform: "uppercase" },
  errorText: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#EF4444", marginTop: 2 },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(34,197,94,0.2)" },
  successTitle: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  successDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 22 },
});
