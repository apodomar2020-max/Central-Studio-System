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

import AppButton from "@/components/AppButton";
import colors from "@/constants/colors";
import { useAppContext, type User } from "@/contexts/AppContext";
import { enterApp, mapStudentToUser, type AccountType, type AuthStudent } from "@/services/authProfile";

const ACCOUNT_TYPES: { value: AccountType; title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  {
    value: "student",
    title: "I am a student",
    subtitle: "I book classes for myself",
    icon: "person-outline",
  },
  {
    value: "parent",
    title: "I am a parent",
    subtitle: "I book for my child",
    icon: "people-outline",
  },
];

interface ProfileResponse {
  student: AuthStudent;
}

export default function CompleteProfileScreen() {
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

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter your phone number.");
      return;
    }
    if (!accountType) {
      setError("Please choose your account type.");
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
      await enterApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : 0 }]}>
      <KeyboardAwareScrollView
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: (Platform.OS === "web" ? 0 : insets.top) + 28 },
        ]}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles-outline" size={32} color={colors.studio.primary} />
        </View>
        <Text style={styles.title}>Complete your profile</Text>
        <Text style={styles.subtitle}>
          Add the studio details we need for booking, check-in, and support.
        </Text>

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
              <TouchableOpacity
                style={styles.suggestionBtn}
                onPress={() => setName(providerName)}
              >
                <Ionicons name="logo-google" size={14} color={colors.studio.primary} />
                <Text style={styles.suggestionText}>Use Google name: {providerName}</Text>
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
            <View style={styles.typeList}>
              {ACCOUNT_TYPES.map((item) => {
                const selected = accountType === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    activeOpacity={0.8}
                    onPress={() => setAccountType(item.value)}
                    style={[
                      styles.typeCard,
                      selected && {
                        borderColor: colors.studio.primary,
                        backgroundColor: colors.studio.primary + "15",
                      },
                    ]}
                  >
                    <View style={[styles.typeIcon, selected && { backgroundColor: colors.studio.primary + "20" }]}>
                      <Ionicons
                        name={item.icon}
                        size={20}
                        color={selected ? colors.studio.primary : "#6B7280"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.typeTitle, selected && { color: colors.studio.primary }]}>
                        {item.title}
                      </Text>
                      <Text style={styles.typeSubtitle}>{item.subtitle}</Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.studio.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <AppButton
            title="Save and Continue"
            onPress={handleSubmit}
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
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 16 },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.studio.primary + "18",
    borderWidth: 1,
    borderColor: colors.studio.primary + "30",
  },
  title: { fontSize: 36, fontFamily: "Anton_400Regular", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 40 },
  subtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", lineHeight: 21 },
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
  form: { gap: 16, marginTop: 4 },
  label: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#9CA3AF", marginBottom: 7, letterSpacing: 0.66, textTransform: "uppercase" },
  inputRow: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  input: { flex: 1, color: "#FFFFFF", fontFamily: "Archivo_400Regular", fontSize: 15 },
  suggestionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 9 },
  suggestionText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: colors.studio.primary },
  typeList: { gap: 12 },
  typeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E1E26",
  },
  typeTitle: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF", marginBottom: 2 },
  typeSubtitle: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
});
