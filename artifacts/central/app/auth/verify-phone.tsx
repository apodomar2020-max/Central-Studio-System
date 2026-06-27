/**
 * Verify Phone — design `Verify` shell (signup-views2.jsx), Step 2 of 4.
 *
 * IMPORTANT: there is NO SMS/OTP backend. This screen does NOT fake verification
 * — it never accepts an arbitrary code as "verified" and never saves any phone
 * verified status. The account is secured by the existing EMAIL verification
 * flow (already run earlier in the funnel via continueAfterAuth → /verify-email).
 * The screen is clearly marked as not-yet-active and offers safe paths:
 *   • "Continue" → proceed to style selection
 *   • "Verify by email instead" → the real /verify-email flow
 */
import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ProgressDots from "@/components/ProgressDots";
import { BackBtn, CS, Eyebrow, FloatInput, Icon, PrimaryCTA } from "@/components/signup/SignupKit";

export default function VerifyPhoneScreen() {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState("");
  const topPad = (Platform.OS === "web" ? 40 : insets.top) + 24;

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingTop: topPad }]}>
        <BackBtn onPress={() => router.replace("/onboarding/styles")} />
        <ProgressDots total={5} current={3} />
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.body}>
        <Eyebrow>Step 4 of 5</Eyebrow>
        <Text style={[styles.title, { color: CS.cyan500 }]}>{"Verify\nPhone"}</Text>
        <Text style={styles.lead}>We'll secure your account so you can book and check in.</Text>

        {/* Honest status — phone OTP isn't wired to a backend yet. */}
        <View style={styles.notice}>
          <View style={styles.noticeIcon}>
            <Icon name="lock" size={15} stroke={2} color={CS.amber} />
          </View>
          <Text style={styles.noticeText}>
            SMS verification is coming soon and isn't active yet. Your account is already secured by{" "}
            <Text style={styles.noticeStrong}>email verification</Text>. Add your number now or skip — you won't be marked verified by phone.
          </Text>
        </View>

        <View style={styles.phoneRow}>
          <View style={styles.cc}><Text style={styles.ccText}>🇪🇬 +20</Text></View>
          <View style={{ flex: 1 }}>
            <FloatInput label="Phone Number (optional)" value={phone} onChangeText={setPhone} icon="phone" keyboardType="phone-pad" />
          </View>
        </View>
        <Text style={styles.fine}>Standard SMS rates may apply once activated. Your number won't be shared.</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: (Platform.OS === "web" ? 36 : insets.bottom) + 16 }]}>
        <PrimaryCTA label="Continue" icon="arrow" onPress={() => router.replace("/onboarding/success")} />
        <TouchableOpacity onPress={() => router.replace("/verify-email")} style={styles.altBtn}>
          <Text style={styles.altText}>Verify by email instead</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CS.base },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, height: 56 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 28 },
  title: { fontFamily: "Anton_400Regular", fontSize: 56, lineHeight: 50, textTransform: "uppercase", marginBottom: 8 },
  lead: { fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 21, marginBottom: 18, fontFamily: "Archivo_400Regular" },
  notice: { flexDirection: "row", gap: 10, padding: 13, borderRadius: 12, backgroundColor: "rgba(255,176,46,0.10)", borderWidth: 1, borderColor: "rgba(255,176,46,0.28)", marginBottom: 20 },
  noticeIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(255,176,46,0.16)", alignItems: "center", justifyContent: "center" },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "rgba(255,255,255,0.65)", fontFamily: "Archivo_400Regular" },
  noticeStrong: { fontFamily: "Archivo_700Bold", color: CS.amber },
  phoneRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  cc: { width: 86, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  ccText: { fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FFFFFF" },
  fine: { fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 18, marginTop: 10, fontFamily: "Archivo_400Regular" },
  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 6 },
  altBtn: { alignItems: "center", paddingVertical: 8 },
  altText: { fontFamily: "Archivo_700Bold", fontSize: 13, color: CS.cyan400 },
});
