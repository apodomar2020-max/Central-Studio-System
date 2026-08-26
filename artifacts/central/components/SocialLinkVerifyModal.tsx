/**
 * Security-01B2 — social-account-linking OTP ownership-verification modal.
 *
 * Shown when a Google/Facebook sign-in attempt returns
 * `requiresLinkVerification` + `linkChallengeId`: a verified provider
 * identity's email matched an EXISTING Central Studio account, but the
 * provider did not attest ownership of that address. Nothing has been
 * linked and no token has been issued yet — the account owner must enter
 * the code sent to their registered email before the provider identity may
 * attach.
 *
 * The challenge id is the only credential this screen holds — it is kept in
 * memory (component state / navigation state) only, never written to
 * AsyncStorage, and never logged. Cancelling closes the modal and performs
 * no request; the provider stays completely unlinked.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { useAppContext } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import { continueAfterAuth } from "@/services/authProfile";
import type { SocialLinkChallenge } from "@/hooks/useGoogleSignIn";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

type Props = {
  challenge: SocialLinkChallenge | null;
  onClose: () => void;
};

export default function SocialLinkVerifyModal({ challenge, onClose }: Props) {
  const { setUser } = useAppContext();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!challenge) return;
    setCode("");
    setError("");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [challenge?.challengeId]);

  useEffect(() => {
    if (cooldown <= 0) {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current);
      return;
    }
    cooldownTimer.current = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, [cooldown > 0]);

  if (!challenge) return null;

  const providerLabel = challenge.provider === "google" ? "Google" : "Facebook";

  async function handleVerify() {
    if (!challenge || code.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/social-link/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Incorrect code. Please try again.");
        setCode("");
        return;
      }
      // Success: the provider is now linked and a fresh session was issued —
      // continue exactly like any other successful sign-in.
      onClose();
      await continueAfterAuth(data.accessToken, setUser, { source: "social-login" });
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!challenge || cooldown > 0 || resending) return;
    setResending(true);
    setError("");
    try {
      await fetch(`${API_URL}/api/auth/social-link/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId }),
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Verify your existing Central Studio account</Text>
          <Text style={styles.body}>
            We found an existing Central Studio account using this email. Enter the code sent to
            your registered email to securely link your {providerLabel} account.
          </Text>

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, CODE_LENGTH))}
            placeholder="000000"
            placeholderTextColor="#6B7280"
            keyboardType="number-pad"
            style={styles.codeInput}
            maxLength={CODE_LENGTH}
            autoFocus
          />

          {error !== "" && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, (code.length !== CODE_LENGTH || submitting) && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={code.length !== CODE_LENGTH || submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify & Link</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || resending} style={styles.resendBtn}>
            <Text style={[styles.resendText, (cooldown > 0 || resending) && styles.resendTextDisabled]}>
              {cooldown > 0 ? `Resend code (${cooldown}s)` : resending ? "Sending…" : "Resend code"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(6,12,16,0.82)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#12181C", borderRadius: 20, padding: 24, gap: 12 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  body: { color: "#9CA3AF", fontSize: 14, lineHeight: 20 },
  codeInput: {
    borderWidth: 1, borderColor: "#2A3339", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    color: "#fff", fontSize: 22, letterSpacing: 8, textAlign: "center", marginTop: 4,
  },
  error: { color: colors.error, fontSize: 13 },
  primaryBtn: { backgroundColor: colors.studio.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  resendBtn: { alignItems: "center", paddingVertical: 8 },
  resendText: { color: colors.studio.primary, fontSize: 13 },
  resendTextDisabled: { color: "#6B7280" },
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelText: { color: "#9CA3AF", fontSize: 13 },
});
