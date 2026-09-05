import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import colors from "@/constants/colors";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEK_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MIN_YEAR = 1900;

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function initialMonth(value: string): Date {
  const parsed = parseDateKey(value);
  if (parsed) return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  const today = new Date();
  return new Date(today.getFullYear() - 18, today.getMonth(), 1);
}

export function isValidProfileDate(value: string): boolean {
  const parsed = parseDateKey(value);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getFullYear() >= MIN_YEAR && parsed.getTime() <= today.getTime();
}

export function formatProfileDate(value: string): string {
  const parsed = parseDateKey(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type Props = {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  compact?: boolean;
  testID?: string;
};

export default function ProfileDateField({
  value,
  onChange,
  placeholder = "Select date of birth",
  compact = false,
  testID,
}: Props) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [month, setMonth] = useState(() => initialMonth(value));
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!visible) return;
    setMonth(initialMonth(value));
    setDraft(value);
  }, [value, visible]);

  const calendarDays = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const leading = new Date(year, monthIndex, 1).getDay();
    const count = new Date(year, monthIndex + 1, 0).getDate();
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ];
  }, [month]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const displayedIsCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();

  function moveMonth(delta: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    if (next.getFullYear() < MIN_YEAR) return;
    if (next.getFullYear() > today.getFullYear()) return;
    if (next.getFullYear() === today.getFullYear() && next.getMonth() > today.getMonth()) return;
    setMonth(next);
  }

  function moveYear(delta: number) {
    const targetYear = Math.min(today.getFullYear(), Math.max(MIN_YEAR, month.getFullYear() + delta));
    const targetMonth = targetYear === today.getFullYear()
      ? Math.min(month.getMonth(), today.getMonth())
      : month.getMonth();
    setMonth(new Date(targetYear, targetMonth, 1));
  }

  function chooseDay(day: number) {
    const candidate = new Date(month.getFullYear(), month.getMonth(), day);
    if (candidate.getTime() > today.getTime()) return;
    setDraft(toDateKey(candidate));
  }

  function confirm() {
    if (!isValidProfileDate(draft)) return;
    onChange(draft);
    setVisible(false);
  }

  return (
    <>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`Date of birth. ${formatProfileDate(value) || placeholder}`}
        activeOpacity={0.82}
        onPress={() => setVisible(true)}
        style={[styles.field, compact && styles.fieldCompact]}
      >
        <Ionicons name="calendar-outline" size={18} color="rgba(255,255,255,0.38)" />
        <Text numberOfLines={1} style={[styles.value, !value && styles.placeholder]}>
          {formatProfileDate(value) || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={17} color={colors.studio.primary} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setVisible(false)} />
          <View style={[styles.sheet, { marginBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>PROFILE DETAILS</Text>
                <Text style={styles.title}>Date of Birth</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Close" onPress={() => setVisible(false)} style={styles.closeButton}>
                <Ionicons name="close" size={21} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.calendarHeader}>
              <TouchableOpacity accessibilityLabel="Previous year" onPress={() => moveYear(-1)} style={styles.navButton}>
                <Ionicons name="play-back" size={16} color="#AAB2B9" />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel="Previous month" onPress={() => moveMonth(-1)} style={styles.navButton}>
                <Ionicons name="chevron-back" size={18} color="#AAB2B9" />
              </TouchableOpacity>
              <Text style={styles.monthTitle}>{MONTHS[month.getMonth()]} {month.getFullYear()}</Text>
              <TouchableOpacity accessibilityLabel="Next month" onPress={() => moveMonth(1)} style={styles.navButton}>
                <Ionicons name="chevron-forward" size={18} color={displayedIsCurrentMonth ? "#3E474E" : "#AAB2B9"} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel="Next year" onPress={() => moveYear(1)} style={styles.navButton}>
                <Ionicons name="play-forward" size={16} color={month.getFullYear() === today.getFullYear() ? "#3E474E" : "#AAB2B9"} />
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {WEEK_DAYS.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekDay}>{day}</Text>)}
            </View>
            <View style={styles.daysGrid}>
              {calendarDays.map((day, index) => {
                if (day == null) return <View key={`blank-${index}`} style={styles.dayCell} />;
                const key = toDateKey(new Date(month.getFullYear(), month.getMonth(), day));
                const disabled = new Date(month.getFullYear(), month.getMonth(), day).getTime() > today.getTime();
                const selected = key === draft;
                return (
                  <TouchableOpacity
                    key={key}
                    disabled={disabled}
                    onPress={() => chooseDay(day)}
                    style={[styles.dayCell, selected && styles.daySelected]}
                  >
                    <Text style={[styles.dayText, disabled && styles.dayDisabled, selected && styles.dayTextSelected]}>{day}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              disabled={!isValidProfileDate(draft)}
              activeOpacity={0.86}
              onPress={confirm}
              style={[styles.confirmButton, !isValidProfileDate(draft) && styles.confirmDisabled]}
            >
              <Text style={styles.confirmText}>Confirm Date</Text>
            </TouchableOpacity>
            <Text style={styles.jumpHint}>Use the double arrows to move one year at a time.</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { height: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)" },
  fieldCompact: { height: 50, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)" },
  value: { flex: 1, color: "#FFFFFF", fontSize: 15, fontFamily: "Archivo_500Medium" },
  placeholder: { color: "rgba(255,255,255,0.38)", fontFamily: "Archivo_400Regular" },
  overlay: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 14, backgroundColor: "rgba(0,0,0,0.76)" },
  sheet: { width: "100%", maxWidth: 460, alignSelf: "center", padding: 20, borderRadius: 26, borderWidth: 1, borderColor: "rgba(0,182,215,0.28)", backgroundColor: "#101417" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  eyebrow: { fontSize: 10, letterSpacing: 1, fontFamily: "SpaceMono_700Bold", color: colors.studio.primary, marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13 },
  navButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.045)" },
  monthTitle: { flex: 1, textAlign: "center", color: "#FFFFFF", fontSize: 15, fontFamily: "Archivo_700Bold" },
  weekRow: { flexDirection: "row", marginBottom: 5 },
  weekDay: { width: `${100 / 7}%`, textAlign: "center", color: "#69747C", fontSize: 11, fontFamily: "SpaceMono_700Bold" },
  daysGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 4 },
  dayCell: { width: `${100 / 7}%`, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  daySelected: { backgroundColor: colors.studio.primary },
  dayText: { color: "#D5D9DC", fontSize: 13.5, fontFamily: "Archivo_600SemiBold" },
  dayDisabled: { color: "#343C42" },
  dayTextSelected: { color: "#061014", fontFamily: "Archivo_800ExtraBold" },
  confirmButton: { height: 50, marginTop: 18, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: colors.studio.primary },
  confirmDisabled: { opacity: 0.35 },
  confirmText: { color: "#071014", fontSize: 15, fontFamily: "Archivo_800ExtraBold" },
  jumpHint: { marginTop: 9, textAlign: "center", color: "#68737D", fontSize: 10.5, fontFamily: "Archivo_400Regular" },
});
