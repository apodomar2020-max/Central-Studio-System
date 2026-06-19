import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";

import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { useAppContext, type User } from "@/contexts/AppContext";
import { mapStudentToUser, type AccountType, type AuthStudent } from "@/services/authProfile";

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

function validPhone(phone: string) {
  return phone.replace(/\D/g, "").length >= 7;
}

export default function EditProfileScreen() {
  const { user, setUser } = useAppContext();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
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
    if (!phone.trim()) {
      setError("Phone number is required.");
      return;
    }
    if (!validPhone(phone)) {
      setError("Please enter a valid phone number.");
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
          phone: phone.trim(),
          accountType,
        }),
      });
      const updated: User = mapStudentToUser(data.student);
      await setUser(updated);
      Alert.alert("Profile Updated", "Your profile details have been saved.", [
        { text: "OK", onPress: () => router.replace("/(tabs)/profile" as never) },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === "web" ? 12 : insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
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
            <Text style={styles.label}>Full Name *</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color="#6B7280" />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                placeholderTextColor="#6B7280"
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
            <Text style={styles.label}>Phone Number *</Text>
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

          <View>
            <Text style={styles.label}>Account Type *</Text>
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
                        borderColor: colors.studio.primary,
                        backgroundColor: colors.studio.primary + "15",
                      },
                    ]}
                    activeOpacity={0.82}
                  >
                    <Ionicons
                      name={item.icon}
                      size={18}
                      color={selected ? colors.studio.primary : "#6B7280"}
                    />
                    <Text style={[styles.accountTypeText, selected && { color: colors.studio.primary }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.readOnlySection}>
            <Text style={styles.sectionLabel}>Read-only account details</Text>
            <View style={styles.readOnlyRow}>
              <Ionicons name="mail-outline" size={17} color="#6B7280" />
              <View style={styles.readOnlyTextWrap}>
                <Text style={styles.readOnlyLabel}>Email</Text>
                <Text style={styles.readOnlyValue}>{user.email}</Text>
              </View>
            </View>
            <View style={styles.readOnlyRow}>
              <Ionicons name={providerIcon(user.authProvider)} size={17} color="#6B7280" />
              <View style={styles.readOnlyTextWrap}>
                <Text style={styles.readOnlyLabel}>Connected provider</Text>
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
  container: { flex: 1, backgroundColor: colors.studio.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1E1E26",
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonPlaceholder: { width: 40, height: 40 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 16 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: "#0E1619",
  },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.studio.primary + "25",
  },
  avatarInitials: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.studio.primary },
  summaryText: { flex: 1, gap: 6 },
  summaryName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  summaryBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.error },
  form: { gap: 16 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginBottom: 7 },
  inputRow: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 15 },
  suggestionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 9 },
  suggestionText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: colors.studio.primary },
  accountTypeRow: { flexDirection: "row", gap: 10 },
  accountTypeButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A2A35",
    backgroundColor: "#1E1E26",
  },
  accountTypeText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#9CA3AF" },
  readOnlySection: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2E38",
    backgroundColor: "#0E1619",
  },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#6B7280", textTransform: "uppercase" },
  readOnlyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  readOnlyTextWrap: { flex: 1 },
  readOnlyLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#6B7280" },
  readOnlyValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: "#FFFFFF", marginTop: 1 },
});
