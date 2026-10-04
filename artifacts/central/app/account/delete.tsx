import { useEffect, useState } from "react";
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppButton from "@/components/AppButton";
import CentralBackButton from "@/components/CentralBackButton";
import { useAppContext } from "@/contexts/AppContext";
import { useDeletionProviderCleanup } from "@/hooks/useDeletionProviderCleanup";
import { getDeletionDetails, savedDeletionStatus, sendDeletionCode, reauthenticateDeletion, submitAccountDeletion, type DeletionDetails, type DeletionStatus } from "@/services/accountDeletion";

export default function DeleteAccountScreen() {
  const { user, logout } = useAppContext();
  const insets = useSafeAreaInsets();
  const cleanupProviders = useDeletionProviderCleanup();
  const [details, setDetails] = useState<DeletionDetails | null>(null);
  const [result, setResult] = useState<DeletionStatus | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualProviders, setManualProviders] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const load = user ? getDeletionDetails().then(v => { if (alive) setDetails(v); }) : savedDeletionStatus().then(v => { if (alive) setResult(v); });
    void load.catch(() => { if (alive) setError("Unable to load account deletion. Please check your connection."); });
    return () => { alive = false; };
  }, [user?.id]);
  async function sendCode() {
    setBusy(true); setError("");
    try { await sendDeletionCode(); setUseCode(true); }
    catch { setError("Unable to send a confirmation code. Please try again later."); }
    finally { setBusy(false); }
  }
  async function removeAccount() {
    if (busy || confirmation !== "DELETE") return;
    setBusy(true); setError("");
    try {
      const proof = await reauthenticateDeletion(useCode ? { code } : { password });
      setPassword(""); setCode("");
      setManualProviders(await cleanupProviders(details?.linkedProviders ?? []));
      const deleted = await submitAccountDeletion(proof.deletionProof);
      setResult(deleted);
      await logout();
    } catch {
      const saved = await savedDeletionStatus().catch(() => null);
      if (saved) { setResult(saved); await logout(); }
      else setError("Unable to complete deletion. Check your confirmation and connection, then try again. If your account is already closed, reopen this screen to check the saved request.");
    }
    finally { setBusy(false); }
  }
  return <ScrollView style={styles.screen} contentContainerStyle={{ padding: 24, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
    <CentralBackButton onPress={() => router.back()} />
    <Text style={styles.title}>Delete account</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {result ? <>
      <Text style={styles.heading}>{result.status === "completed" ? "Your Central Studio account is deleted" : "Your deletion request is saved"}</Text>
      {result.status === "pending" && <Text style={styles.text}>Your account access is closed. The remaining conditions are checked automatically and can be resolved by the studio.</Text>}
      {result.blockers.map(b => <Text key={b.key} style={styles.text}>• {b.label}</Text>)}
      {!!result.appleManualRevocation && <Text style={styles.text}>{result.appleRevocation === "pending" ? "Apple revocation is being retried. You can also remove access yourself: " : "Apple access could not be revoked automatically: "}{result.appleManualRevocation}</Text>}
      {manualProviders.includes("google") && <Text style={styles.text}>Google access was not revoked automatically. Remove Central Studio under your Google Account → third-party connections.</Text>}
      {manualProviders.includes("facebook") && <Text style={styles.text}>Facebook access was not revoked automatically. Remove Central Studio under Facebook Settings → Apps and Websites.</Text>}
      <AppButton title="Refresh status" onPress={() => { void savedDeletionStatus().then(v => { if (v) setResult(v); }).catch(() => setError("Unable to refresh. Your request remains saved.")); }} />
      <AppButton title="Continue as guest" onPress={() => router.replace("/auth/login")} />
    </> : user ? <>
      <Text style={styles.text}>Deletion is permanent. Your sign-in credentials, sessions and student profile are removed or anonymized.</Text>
      <Text style={styles.heading}>Records retained</Text>
      {(details?.disclosure.retained ?? []).map(item => <Text key={item} style={styles.text}>• {item}</Text>)}
      <Text style={styles.text}>{details?.disclosure.pending}</Text>
      <Text style={styles.heading}>Confirm it's you</Text>
      {useCode ? <TextInput accessibilityLabel="Deletion confirmation code" style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="Email confirmation code" placeholderTextColor="#999" />
        : <TextInput accessibilityLabel="Current password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Current password" placeholderTextColor="#999" />}
      <TouchableOpacity disabled={busy} onPress={sendCode}><Text style={styles.link}>{useCode ? "Send a new code" : "Use an email confirmation code instead"}</Text></TouchableOpacity>
      <Text style={styles.text}>Type DELETE to confirm. We will attempt to remove linked provider access; cancellation or a provider failure will not prevent deletion.</Text>
      <TextInput accessibilityLabel="Type DELETE to confirm" style={styles.input} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" placeholder="DELETE" placeholderTextColor="#999" />
      <AppButton title="Permanently delete account" loading={busy} disabled={!details || confirmation !== "DELETE" || !(useCode ? code.length === 6 : password.length > 0)} onPress={removeAccount} />
    </> : <Text style={styles.text}>No saved deletion status is available. Sign in to initiate account deletion.</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#101112" }, title: { fontSize: 28, color: "#fff", marginVertical: 24, fontFamily: "Archivo_700Bold" },
  heading: { fontSize: 18, color: "#fff", marginVertical: 14 }, text: { color: "#ccc", lineHeight: 23, marginBottom: 12 },
  error: { color: "#F87171", marginVertical: 12 }, input: { color: "#fff", borderColor: "#555", borderWidth: 1, padding: 14, borderRadius: 10, marginVertical: 12 }, link: { color: "#00B6D7", marginBottom: 18 } });
