import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useMemo, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";
import { formatAccountPhoneLocal, validateAccountPhone } from "@workspace/api-zod";

import AppButton from "@/components/AppButton";
import CentralBackButton from "@/components/CentralBackButton";
import colors from "@/constants/colors";
import { useAppContext, type User } from "@/contexts/AppContext";
import { iosTextInputStyle } from "@/utils/iosTypography";
import { mapStudentToUser, type AccountType, type AuthStudent } from "@/services/authProfile";
import { useCentralAlert } from "@/hooks/useCentralAlert";

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { value: "student", label: "Student", icon: "person-outline" },
  { value: "parent", label: "Parent", icon: "people-outline" },
];

interface ProfileResponse {
  student: AuthStudent;
}

function providerLabel(provider?: string | null) {
  if (!provider) return "Email";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function providerIcon(provider?: string | null): React.ComponentProps<typeof Ionicons>["name"] {
  if (provider === "google") return "logo-google";
  if (provider === "facebook") return "logo-facebook";
  return "mail-outline";
}

export default function EditProfileScreen() {
  const { user, setUser } = useAppContext();
  const alert = useCentralAlert();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.fullName ?? "");
  // The API returns the canonical "20XXXXXXXXXX" form (Canonical Account
  // Phone Domain) — display the familiar local "01..." form instead; users
  // should never have to read or type the canonical representation.
  const [phone, setPhone] = useState(formatAccountPhoneLocal(user?.phone));
  const [accountType, setAccountType] = useState<AccountType | null>(user?.accountType ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const providerName = useMemo(() => {
    const suggested = user?.providerDisplayName?.trim();
    if (!suggested || suggested === name.trim()) return null;
    return suggested;
  }, [name, user?.providerDisplayName]);

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.emptyState}>
          <Ionicons name="person-circle-outline" size={52} color="#4B5563" />
          <Text style={styles.emptyTitle}>Sign in required</Text>
          <AppButton title="Go to Login" onPress={() => router.replace("/auth/login" as never)} />
        </View>
      </View>
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    // Canonical Account Phone Domain — the SAME authority as Complete
    // Profile (see lib/api-zod/src/phoneDomain.ts). No more separate,
    // weaker >=7-digit rule.
    const phoneValidation = validateAccountPhone(phone);
    if (!phoneValidation.ok) {
      setError(
        phoneValidation.reason === "empty"
          ? "Phone number is required."
          : "Please enter a valid Egyptian mobile number.",
      );
      return;
    }
    if (!accountType) {
      setError("Account type is required.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setError("");
    try {
      const data = await customFetch<ProfileResponse>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phoneValidation.canonical,
          accountType,
        }),
      });
      const updated: User = mapStudentToUser(data.student);
      await setUser(updated);
      alert.show({
        tone: "success",
        title: "Profile Updated",
        message: "Your profile details have been saved.",
        actions: [{ label: "OK", tone: "primary", onPress: () => router.replace("/(tabs)/profile" as never) }],
      });
    } catch (err) {
      const errorData = (err as { data?: { code?: string } })?.data;
      if (errorData?.code === "PHONE_ALREADY_IN_USE") {
        setError("This phone number is already associated with another account.");
      } else {
        setError(err instanceof Error ? err.message : "Could not save your profile.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <CentralBackButton style={styles.headerButton} />
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerButtonPlaceholder} />
      </View>

      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.summaryCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitials}>
              {user.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.summaryText}>
            <Text style={styles.summaryName}>{user.fullName}</Text>
            <View style={styles.summaryBadgeRow}>
              <View style={[styles.badge, { backgroundColor: user.emailVerified ? "#22C55E20" : "#F59E0B20" }]}>
                <Ionicons
                  name={user.emailVerified ? "checkmark-circle" : "alert-circle"}
                  size={12}
                  color={user.emailVerified ? "#22C55E" : "#F59E0B"}
                />
                <Text style={[styles.badgeText, { color: user.emailVerified ? "#22C55E" : "#F59E0B" }]}>
                  {user.emailVerified ? "Verified email" : "Unverified email"}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <View>
            <Text style={styles.sectionLabel}>Personal Information</Text>
          </View>
          <View>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                placeholderTextColor="#6B747F"
                autoCapitalize="words"
                style={styles.input}
              />
            </View>
            {providerName ? (
              <TouchableOpacity style={styles.suggestionBtn} onPress={() => setName(providerName)}>
                <Ionicons name={providerIcon(user.authProvider)} size={14} color={colors.studio.primary} />
                <Text style={styles.suggestionText}>
                  Use {providerLabel(user.authProvider)} name: {providerName}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View>
            <Text style={styles.label}>Phone Number</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+20 100 000 0000"
                placeholderTextColor="#6B747F"
                keyboardType="phone-pad"
                style={styles.input}
              />
            </View>
          </View>

          <View>
            <Text style={styles.label}>Account Type</Text>
            <View style={styles.accountTypeRow}>
              {ACCOUNT_TYPES.map((item) => {
                const selected = accountType === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    onPress={() => setAccountType(item.value)}
                    style={[
                      styles.accountTypeButton,
                      selected && {
                        borderColor: "rgba(0,182,215,0.5)",
                        backgroundColor: "#0A0B0D",
                      },
                    ]}
                    activeOpacity={0.82}
                  >
                    <Text style={[styles.accountTypeText, selected && { color: "#FFFFFF" }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.readOnlySection}>
            <Text style={styles.sectionLabel}>Account Information</Text>
            <View style={styles.readOnlyRow}>
              <Text style={styles.readOnlyLabel}>Email Address</Text>
              <View style={styles.readOnlyTextWrap}>
                <Text style={styles.readOnlyValue}>{user.email}</Text>
              </View>
            </View>
            <View style={styles.readOnlyRow}>
              <Text style={styles.readOnlyLabel}>Connected Provider</Text>
              <View style={styles.readOnlyTextWrap}>
                <Text style={styles.readOnlyValue}>{providerLabel(user.authProvider)}</Text>
              </View>
            </View>
          </View>

          <AppButton
            title="Save Changes"
            onPress={handleSave}
            loading={loading}
            fullWidth
            size="lg"
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0B0D" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 54,
  },
  headerButtonText: {
    fontSize: 14,
    fontFamily: "Archivo_600SemiBold",
    color: colors.studio.primary,
  },
  headerButtonPlaceholder: { minWidth: 54 },
  headerTitle: { fontSize: 17, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 20, paddingBottom: 100, gap: 24, paddingTop: 22 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,182,215,0.1)",
    borderWidth: 3,
    borderColor: colors.studio.primary,
  },
  avatarInitials: { fontSize: 24, fontFamily: "Archivo_700Bold", color: colors.studio.primary },
  summaryText: { flex: 1, gap: 8 },
  summaryName: { fontSize: 18, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  summaryBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9 },
  badgeText: { fontSize: 11, fontFamily: "Archivo_600SemiBold" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error + "50",
    backgroundColor: colors.error + "20",
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Archivo_400Regular", color: colors.error },
  form: { gap: 14 },
  label: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#6B747F", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 15, ...iosTextInputStyle(15, 18) },
  suggestionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 9 },
  suggestionText: { flex: 1, fontSize: 12, fontFamily: "Archivo_500Medium", color: colors.studio.primary },
  accountTypeRow: { flexDirection: "row", gap: 8 },
  accountTypeButton: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  accountTypeText: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#6B747F" },
  readOnlySection: { gap: 14, marginTop: 10 },
  sectionLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: colors.studio.primary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: -2 },
  readOnlyRow: { flexDirection: "column", gap: 6 },
  readOnlyTextWrap: { height: 50, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12 },
  readOnlyLabel: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.5 },
  readOnlyValue: { fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF" },
});
