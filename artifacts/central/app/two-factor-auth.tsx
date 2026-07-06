import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { iosTextInputStyle } from "@/utils/iosTypography";

const INK = { bg: "#0A0B0D", card: "#15171B", border: "rgba(255,255,255,0.08)", text3: "#8E97A2", text4: "#6B747F" };
const OTP_LEN = 6;
type Method = "email" | "sms";

/**
 * Two-Factor Authentication — design parity with the redesign's `TwoFA`
 * (home-profile-pages2.jsx). Status card + toggle, method selection, 6-digit
 * verification, and recovery-codes action once enabled.
 *
 * NOTE: no 2FA backend exists yet, so enable/disable is local UI state. Any
 * 6-digit code is accepted. Wire the method + code submission to a real
 * endpoint when available.
 */
export default function TwoFactorAuthScreen() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [method, setMethod] = useState<Method>("email");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(""));
  const inputs = useRef<(TextInput | null)[]>([]);

  function onToggle(v: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!v) {
      setEnabled(false);
      setSetupOpen(false);
      setDigits(Array(OTP_LEN).fill(""));
    } else {
      setSetupOpen(true);
    }
  }

  function setAt(i: number, raw: string) {
    const val = raw.replace(/\D/g, "").slice(-1);
    const arr = [...digits];
    arr[i] = val;
    setDigits(arr);
    if (val && i < OTP_LEN - 1) inputs.current[i + 1]?.focus();
  }

  function onKeyPress(i: number, key: string) {
    if (key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  }

  function enable() {
    if (digits.some((d) => !d)) {
      Alert.alert("Enter the code", "Please enter the 6-digit verification code.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEnabled(true);
    setSetupOpen(false);
    setDigits(Array(OTP_LEN).fill(""));
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={20} color={colors.studio.primary} />
          <Text style={styles.headerButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Two-Factor Auth</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Status card */}
        <LinearGradient
          colors={enabled ? ["rgba(31,184,113,0.14)", "rgba(10,11,13,0)"] : ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.04)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.statusCard, { borderColor: enabled ? "rgba(31,184,113,0.35)" : INK.border }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>Two-Factor Authentication</Text>
            <Text style={[styles.statusSub, { color: enabled ? colors.success : INK.text4 }]}>
              {enabled ? "✓ Enabled — your account is more secure" : "Disabled — enable for extra security"}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{ false: "#343A43", true: colors.cyan }}
            thumbColor="#FFFFFF"
          />
        </LinearGradient>

        {/* Setup flow */}
        {setupOpen && !enabled && (
          <View style={{ gap: 16 }}>
            <Text style={styles.eyebrow}>VERIFICATION METHOD</Text>
            {([
              { id: "email", label: "Email OTP", sub: "Code sent to your email address" },
              { id: "sms", label: "SMS OTP", sub: "Code sent to your phone number" },
            ] as { id: Method; label: string; sub: string }[]).map((m) => {
              const on = method === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMethod(m.id); }}
                  style={[styles.methodCard, on ? styles.methodCardOn : null]}
                  activeOpacity={0.85}
                >
                  <View style={[styles.radio, { borderColor: on ? colors.cyan : "#4C545E" }]}>
                    {on && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    <Text style={styles.methodSub}>{m.sub}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}

            <Text style={styles.helpText}>
              We sent a 6-digit code to your {method === "email" ? "email" : "phone"}. Enter it below to verify.
            </Text>

            <View style={styles.otpRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(el) => { inputs.current[i] = el; }}
                  value={d}
                  onChangeText={(v) => setAt(i, v)}
                  onKeyPress={(e) => onKeyPress(i, e.nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  style={[styles.otpBox, d ? styles.otpBoxFilled : null]}
                />
              ))}
            </View>

            <AppButton title="Enable 2FA" onPress={enable} fullWidth size="lg" />
          </View>
        )}

        {/* Recovery codes (enabled) */}
        {enabled && (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Alert.alert("Recovery codes", "Recovery codes downloaded. Keep them somewhere safe."); }}
            style={styles.recoveryBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="download-outline" size={18} color="#FFFFFF" />
            <Text style={styles.recoveryText}>Download Recovery Codes</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  headerButton: { flexDirection: "row", alignItems: "center", gap: 2, width: 60 },
  headerButtonText: { fontFamily: "Archivo_600SemiBold", fontSize: 15, color: colors.studio.primary },
  headerTitle: { fontFamily: "Archivo_700Bold", fontSize: 16, color: "#FFFFFF" },
  scroll: { padding: 20, paddingBottom: 80 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 18, borderRadius: 16, borderWidth: 1, marginBottom: 24 },
  statusTitle: { fontFamily: "Archivo_800ExtraBold", fontSize: 17, color: "#FFFFFF", marginBottom: 4 },
  statusSub: { fontFamily: "Archivo_400Regular", fontSize: 13, lineHeight: 18 },
  eyebrow: { fontFamily: "Archivo_800ExtraBold", fontSize: 11, letterSpacing: 1.4, color: colors.cyan, textTransform: "uppercase" },
  methodCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: INK.border, backgroundColor: INK.card },
  methodCardOn: { borderColor: "rgba(0,182,215,0.5)", borderWidth: 1.5, backgroundColor: "rgba(0,182,215,0.10)" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cyan },
  methodLabel: { fontFamily: "Archivo_700Bold", fontSize: 15, color: "#FFFFFF" },
  methodSub: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK.text4, marginTop: 1 },
  helpText: { fontFamily: "Archivo_400Regular", fontSize: 13, color: INK.text3, lineHeight: 19 },
  otpRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  otpBox: {
    width: 44, height: 52, textAlign: "center", fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF",
    ...iosTextInputStyle(20, 24, "archivo"),
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.15)", borderRadius: 10,
  },
  otpBoxFilled: { borderColor: colors.cyan, backgroundColor: "rgba(0,182,215,0.10)" },
  recoveryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.07)",
  },
  recoveryText: { fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FFFFFF" },
});
