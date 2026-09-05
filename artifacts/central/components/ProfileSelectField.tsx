import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";

type Props = {
  title: string;
  value: string;
  placeholder: string;
  options: readonly string[];
  onSelect: (value: string) => void;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  compact?: boolean;
  testID?: string;
};

export default function ProfileSelectField({
  title,
  value,
  placeholder,
  options,
  onSelect,
  icon = "chevron-down-outline",
  compact = false,
  testID,
}: Props) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const searchLabel = title.replace(/^Select\s+/i, "").toLocaleLowerCase();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.toLocaleLowerCase().includes(normalized));
  }, [options, query]);

  function close() {
    setVisible(false);
    setQuery("");
  }

  function select(option: string) {
    onSelect(option);
    close();
  }

  return (
    <>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${value || placeholder}`}
        activeOpacity={0.82}
        onPress={() => setVisible(true)}
        style={[styles.field, compact && styles.fieldCompact]}
      >
        <Ionicons name={icon} size={compact ? 17 : 18} color="rgba(255,255,255,0.38)" />
        <Text numberOfLines={1} style={[styles.value, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={17} color={colors.studio.primary} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.overlay}
        >
          <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) + 8 }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>PROFILE DETAILS</Text>
                <Text style={styles.title}>{title}</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Close" onPress={close} style={styles.closeButton}>
                <Ionicons name="close" size={21} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color="#73808A" />
              <TextInput
                autoFocus={false}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${searchLabel}`}
                placeholderTextColor="#68737D"
                autoCapitalize="words"
                autoCorrect={false}
                style={styles.searchInput}
              />
              {query ? (
                <TouchableOpacity accessibilityLabel="Clear search" onPress={() => setQuery("")}>
                  <Ionicons name="close-circle" size={18} color="#73808A" />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView
              style={styles.optionsScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.options}
            >
              {filtered.map((option) => {
                const selected = option === value;
                return (
                  <TouchableOpacity
                    key={option}
                    activeOpacity={0.8}
                    onPress={() => select(option)}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
                    {selected ? (
                      <View style={styles.checkCircle}>
                        <Ionicons name="checkmark" size={14} color="#061014" />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No matching option</Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  fieldCompact: {
    height: 50,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  value: { flex: 1, color: "#FFFFFF", fontSize: 15, fontFamily: "Archivo_500Medium" },
  placeholder: { color: "rgba(255,255,255,0.38)", fontFamily: "Archivo_400Regular" },
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.76)" },
  sheet: {
    maxHeight: "76%",
    minHeight: 390,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(0,182,215,0.28)",
    backgroundColor: "#101417",
  },
  handle: { alignSelf: "center", width: 48, height: 4, borderRadius: 2, backgroundColor: "#364149", marginBottom: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  eyebrow: { fontSize: 10, letterSpacing: 1, fontFamily: "SpaceMono_700Bold", color: colors.studio.primary, marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  searchBox: { height: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#080B0D", marginBottom: 12 },
  searchInput: { flex: 1, color: "#FFFFFF", fontSize: 14, fontFamily: "Archivo_400Regular", paddingVertical: 0 },
  optionsScroll: { flexShrink: 1 },
  options: { gap: 7, paddingBottom: 12 },
  option: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", backgroundColor: "rgba(255,255,255,0.035)" },
  optionSelected: { borderColor: "rgba(0,182,215,0.55)", backgroundColor: "rgba(0,182,215,0.13)" },
  optionText: { fontSize: 14.5, fontFamily: "Archivo_500Medium", color: "#C5CBD0" },
  optionTextSelected: { color: "#FFFFFF", fontFamily: "Archivo_700Bold" },
  checkCircle: { width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.studio.primary },
  empty: { paddingVertical: 36, alignItems: "center" },
  emptyText: { fontSize: 14, fontFamily: "Archivo_500Medium", color: "#73808A" },
});
