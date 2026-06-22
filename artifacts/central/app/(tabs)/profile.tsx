import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { Image } from "expo-image";
import { customFetch } from "@workspace/api-client-react";
import type { MyAttendanceResponse } from "@workspace/api-client-react";

import { useAppContext, ChildProfile } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

/**
 * PIcon — exact replica of the design's `PIcon` (home-profile.jsx) rendered
 * with react-native-svg. Uses the same paths/viewBox/stroke so the Profile
 * header, stats, and studio-pass icons match the design source exactly
 * (no substitute icon sets).
 */
type PIconName =
  | "edit" | "bookings" | "package" | "credits" | "history" | "bell" | "help"
  | "shield" | "lock" | "privacy" | "chevron" | "plus" | "mail" | "phone"
  | "check" | "expand" | "logout";

function PIcon({
  name,
  size = 20,
  stroke = 2,
  color = "#FFFFFF",
}: {
  name: PIconName;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const sp = { stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "edit" && (
        <>
          <Path d="M12 20h9" {...sp} />
          <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" {...sp} />
        </>
      )}
      {name === "bookings" && (
        <>
          <Rect x={4} y={3} width={16} height={18} rx={2} {...sp} />
          <Path d="M8 8h8M8 12h8M8 16h5" {...sp} />
        </>
      )}
      {name === "package" && (
        <>
          <Path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z" {...sp} />
          <Path d="m4 6.5 8 4.5 8-4.5M12 11v9" {...sp} />
        </>
      )}
      {name === "credits" && (
        <>
          <Circle cx={9} cy={9} r={6} {...sp} />
          <Path d="M14.5 5.3a6 6 0 1 1 0 13.4" {...sp} />
        </>
      )}
      {name === "history" && (
        <>
          <Path d="M3 12a9 9 0 1 0 3-6.7L3 8" {...sp} />
          <Path d="M3 4v4h4M12 8v4l3 2" {...sp} />
        </>
      )}
      {name === "bell" && (
        <>
          <Path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...sp} />
          <Path d="M13.7 21a2 2 0 0 1-3.4 0" {...sp} />
        </>
      )}
      {name === "help" && (
        <>
          <Circle cx={12} cy={12} r={9} {...sp} />
          <Path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" {...sp} />
          <Circle cx={12} cy={17} r={0.6} fill={color} stroke="none" />
        </>
      )}
      {name === "shield" && <Path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" {...sp} />}
      {name === "lock" && (
        <>
          <Rect x={4.5} y={10.5} width={15} height={10} rx={2} {...sp} />
          <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...sp} />
        </>
      )}
      {name === "privacy" && (
        <>
          <Path d="M6 3h9l5 5v13H6V3Z" {...sp} />
          <Path d="M14 3v5h5M9 13h6M9 17h6" {...sp} />
        </>
      )}
      {name === "chevron" && <Path d="M9 6l6 6-6 6" {...sp} />}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...sp} />}
      {name === "mail" && (
        <>
          <Rect x={2.5} y={4.5} width={19} height={15} rx={2.5} {...sp} />
          <Path d="m3 6.5 9 6 9-6" {...sp} />
        </>
      )}
      {name === "phone" && (
        <Path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" {...sp} />
      )}
      {name === "check" && <Path d="M20 6 9 17l-5-5" {...sp} />}
      {name === "expand" && <Path d="M8 3H3v5M16 3h5v5M16 21h5v-5M8 21H3v-5" {...sp} />}
      {name === "logout" && <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" {...sp} />}
    </Svg>
  );
}

function ChildCard({
  child,
  onEdit,
}: {
  child: ChildProfile;
  onEdit: () => void;
}) {
  const isGirl = child.gender === "female";
  const genderColor = isGirl ? "#FF2E7E" : "#00B6D7";
  const genderLabel = isGirl ? "GIRL" : "BOY";
  const figureSp = { stroke: genderColor, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  const badgeSp = { stroke: "#0A0B0D", strokeWidth: 2.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <View style={styles.childCard}>
      <View style={[styles.childAvatarWrap, { borderColor: genderColor }]}>
        <View style={[styles.childAvatar, { backgroundColor: genderColor + "15" }]}>
          {/* exact design Boy/Girl figure (home-profile.jsx ChildCard) */}
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Circle cx={12} cy={8} r={4} {...figureSp} />
            <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" {...figureSp} />
            {isGirl ? <Path d="M12 16v5M9.5 18.5h5" {...figureSp} /> : <Path d="M17 3h4v4M17 7l4-4" {...figureSp} />}
          </Svg>
        </View>
        <View style={[styles.childAvatarBadge, { backgroundColor: genderColor, borderColor: "#15171B" }]}>
          {/* exact design gender mini-symbol */}
          <Svg width={10} height={10} viewBox="0 0 24 24">
            {isGirl ? (
              <>
                <Path d="M12 16v5M9.5 18.5h5" {...badgeSp} />
                <Circle cx={12} cy={8} r={4} {...badgeSp} />
              </>
            ) : (
              <>
                <Path d="M17 3h4v4M17 7l4-4" {...badgeSp} />
                <Circle cx={10} cy={10} r={4} {...badgeSp} />
              </>
            )}
          </Svg>
        </View>
      </View>
      <View style={styles.childInfo}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.childName}>{child.fullName}</Text>
          <Text style={[styles.childGenderTag, { color: genderColor }]}>{genderLabel}</Text>
        </View>
        <Text style={styles.childMeta}>
          Age {child.age} {child.birthday ? `· Born ${child.birthday}` : ""}
        </Text>
      </View>
      <TouchableOpacity onPress={onEdit} style={styles.childAction}>
        <PIcon name="edit" size={16} color="#B6BDC6" />
      </TouchableOpacity>
    </View>
  );
}

function calculateAgeFromBirthday(birthdayStr: string): number | null {
  if (!birthdayStr || !/^\d{4}-\d{2}-\d{2}$/.test(birthdayStr)) {
    return null;
  }
  const parts = birthdayStr.split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) {
    return null;
  }
  const today = new Date();
  let calculatedAge = today.getFullYear() - y;
  const birthMonthIndex = m - 1;
  if (
    today.getMonth() < birthMonthIndex ||
    (today.getMonth() === birthMonthIndex && today.getDate() < d)
  ) {
    calculatedAge--;
  }
  return Math.max(0, calculatedAge);
}

const DP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function SpinnerCol({
  displayValue,
  onIncrement,
  onDecrement,
}: {
  displayValue: string;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <View style={dpStyles.col}>
      <TouchableOpacity onPress={onIncrement} style={dpStyles.arrowBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-up" size={22} color={colors.studio.primary} />
      </TouchableOpacity>
      <Text style={dpStyles.spinnerValue}>{displayValue}</Text>
      <TouchableOpacity onPress={onDecrement} style={dpStyles.arrowBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-down" size={22} color={colors.studio.primary} />
      </TouchableOpacity>
    </View>
  );
}

function ChildDatePickerModal({
  visible,
  value,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onConfirm: (dateStr: string) => void;
}) {
  const defaultYear = new Date().getFullYear() - 8;
  const parseInitial = () => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { y: +value.slice(0, 4), m: +value.slice(5, 7), d: +value.slice(8, 10) };
    }
    return { y: defaultYear, m: 1, d: 1 };
  };

  const init = parseInitial();
  const [year, setYear] = useState(init.y);
  const [month, setMonth] = useState(init.m);
  const [day, setDay] = useState(init.d);

  React.useEffect(() => {
    if (visible) {
      const p = parseInitial();
      setYear(p.y);
      setMonth(p.m);
      setDay(p.d);
    }
  }, [value, visible]);

  const daysInMonth = (y: number, m: number): number => {
    return new Date(y, m, 0).getDate();
  };

  const maxDay = daysInMonth(year, month);
  const clampedDay = Math.min(day, maxDay);

  React.useEffect(() => {
    if (day > daysInMonth(year, month)) {
      setDay(daysInMonth(year, month));
    }
  }, [year, month, day]);

  function handleConfirm() {
    const d = clampedDay;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    onConfirm(dateStr);
    onClose();
  }

  const today = new Date();
  const DP_MIN_YEAR = today.getFullYear() - 25;
  const DP_MAX_YEAR = today.getFullYear();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dpStyles.overlay}>
        <View style={dpStyles.sheet}>
          <View style={dpStyles.sheetHeader}>
            <Text style={dpStyles.sheetTitle}>Select Date of Birth</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <View style={dpStyles.spinners}>
            <View style={dpStyles.spinnerWrap}>
              <Text style={dpStyles.spinnerLabel}>Day</Text>
              <SpinnerCol
                displayValue={String(clampedDay).padStart(2, "0")}
                onIncrement={() => setDay((d) => (d >= maxDay ? 1 : d + 1))}
                onDecrement={() => setDay((d) => (d <= 1 ? maxDay : d - 1))}
              />
            </View>

            <View style={dpStyles.spinnerSep} />

            <View style={dpStyles.spinnerWrap}>
              <Text style={dpStyles.spinnerLabel}>Month</Text>
              <SpinnerCol
                displayValue={DP_MONTHS[month - 1] ?? ""}
                onIncrement={() => setMonth((m) => (m >= 12 ? 1 : m + 1))}
                onDecrement={() => setMonth((m) => (m <= 1 ? 12 : m - 1))}
              />
            </View>

            <View style={dpStyles.spinnerSep} />

            <View style={dpStyles.spinnerWrap}>
              <Text style={dpStyles.spinnerLabel}>Year</Text>
              <SpinnerCol
                displayValue={String(year)}
                onIncrement={() => setYear((y) => Math.min(y + 1, DP_MAX_YEAR))}
                onDecrement={() => setYear((y) => Math.max(y - 1, DP_MIN_YEAR))}
              />
            </View>
          </View>

          <TouchableOpacity onPress={handleConfirm} style={dpStyles.confirmBtn} activeOpacity={0.85}>
            <Text style={dpStyles.confirmText}>Confirm Date</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function AddChildModal({
  visible,
  onClose,
  onSave,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (c: Omit<ChildProfile, "id">) => void;
  initial?: ChildProfile;
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [gender, setGender] = useState<"male" | "female">(initial?.gender ?? "female");
  const [medicalNotes, setMedicalNotes] = useState(initial?.medicalNotes ?? "");
  const [emergencyName, setEmergencyName] = useState(initial?.emergencyContactName ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(initial?.emergencyContactPhone ?? "");

  const [showDatePicker, setShowDatePicker] = useState(false);

  function reset() {
    setFullName(initial?.fullName ?? "");
    setBirthday(initial?.birthday ?? "");
    setGender(initial?.gender ?? "female");
    setMedicalNotes(initial?.medicalNotes ?? "");
    setEmergencyName(initial?.emergencyContactName ?? "");
    setEmergencyPhone(initial?.emergencyContactPhone ?? "");
  }

  React.useEffect(() => {
    if (visible) {
      reset();
    }
  }, [initial, visible]);

  const calculatedAge = calculateAgeFromBirthday(birthday);

  function handleSave() {
    if (!fullName.trim()) {
      Alert.alert("Required", "Please enter the child's full name.");
      return;
    }
    if (!birthday.trim()) {
      Alert.alert("Required", "Please select a date of birth.");
      return;
    }
    const ageVal = calculateAgeFromBirthday(birthday);
    if (ageVal === null) {
      Alert.alert("Required", "Please select a valid date of birth.");
      return;
    }

    onSave({
      fullName: fullName.trim(),
      birthday: birthday.trim(),
      age: ageVal,
      gender,
      medicalNotes: medicalNotes.trim() || undefined,
      emergencyContactName: emergencyName.trim() || undefined,
      emergencyContactPhone: emergencyPhone.trim() || undefined,
    });
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{initial ? "Edit Child" : "Add Child"}</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            <View>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              <TextInput value={fullName} onChangeText={setFullName} style={styles.input} placeholderTextColor="#4B5563" placeholder="Child's full name" />
            </View>
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Date of Birth *</Text>
                <TouchableOpacity
                  onPress={() => setShowDatePicker(true)}
                  style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: birthday ? "#FFFFFF" : "#4B5563", fontFamily: "Inter_400Regular", fontSize: 14 }}>
                    {birthday ? birthday : "Select DOB"}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color={colors.studio.primary} />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Calculated Age</Text>
                <View style={[styles.input, { backgroundColor: "#15151D", justifyContent: "center" }]}>
                  <Text style={{ color: birthday ? "#FFFFFF" : "#4B5563", fontFamily: "Inter_400Regular", fontSize: 14 }}>
                    {calculatedAge !== null ? `${calculatedAge} yrs` : "—"}
                  </Text>
                </View>
              </View>
            </View>
            <View>
              <Text style={styles.fieldLabel}>Gender</Text>
              <View style={styles.genderRow}>
                {(["female", "male"] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => setGender(g)}
                    style={[styles.genderBtn, gender === g && { borderColor: colors.studio.primary, backgroundColor: colors.studio.primary + "15" }]}
                  >
                    <Ionicons name={g === "female" ? "person" : "person-outline"} size={15} color={gender === g ? colors.studio.primary : "#6B7280"} />
                    <Text style={[styles.genderBtnText, gender === g && { color: colors.studio.primary }]}>
                      {g === "female" ? "Girl" : "Boy"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View>
              <Text style={styles.fieldLabel}>Medical Notes</Text>
              <TextInput value={medicalNotes} onChangeText={setMedicalNotes} style={[styles.input, { minHeight: 60 }]} placeholderTextColor="#4B5563" placeholder="Any allergies, conditions, or medical info..." multiline />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Emergency Contact Name</Text>
              <TextInput value={emergencyName} onChangeText={setEmergencyName} style={styles.input} placeholderTextColor="#4B5563" placeholder="Full name" />
            </View>
            <View>
              <Text style={styles.fieldLabel}>Emergency Contact Phone</Text>
              <TextInput value={emergencyPhone} onChangeText={setEmergencyPhone} style={styles.input} placeholderTextColor="#4B5563" placeholder="+20 1XX XXX XXXX" keyboardType="phone-pad" />
            </View>
          </ScrollView>

          <View style={styles.modalBtns}>
            <AppButton title="Cancel" variant="ghost" onPress={() => { reset(); onClose(); }} style={{ flex: 1 }} />
            <AppButton title="Save" onPress={handleSave} style={{ flex: 1 }} />
          </View>
        </View>
      </View>

      <ChildDatePickerModal
        visible={showDatePicker}
        value={birthday}
        onClose={() => setShowDatePicker(false)}
        onConfirm={(dateStr) => setBirthday(dateStr)}
      />
    </Modal>
  );
}

const dpStyles = StyleSheet.create({
  col: {
    alignItems: "center",
    gap: 12,
  },
  arrowBtn: {
    padding: 4,
  },
  spinnerValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    minWidth: 60,
    textAlign: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#15151D",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: "#2A2A35",
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    paddingTop: 20,
    gap: 20,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  spinners: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    backgroundColor: "#1E1E26",
    borderRadius: 16,
    padding: 16,
  },
  spinnerWrap: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  spinnerLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  spinnerSep: {
    width: 1,
    height: 80,
    backgroundColor: "#2A2A35",
    marginHorizontal: 4,
  },
  confirmBtn: {
    backgroundColor: colors.studio.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
});

export default function ProfileScreen() {
  const { user, setUser, bookings, children, addChild, updateChild, removeChild, userPackages, unreadNotifications } = useAppContext();
  const insets = useSafeAreaInsets();
  const [addChildVisible, setAddChildVisible] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | undefined>(undefined);
  const [serverAttendedCount, setServerAttendedCount] = useState<number | null>(null);

  // Derive recent attendance
  const recentAttendance = React.useMemo(() => {
    return [...bookings]
      .filter((b) => b.bookingStatus === "attended" || b.bookingStatus === "noShow" || b.attendanceStatus === "attended" || b.attendanceStatus === "noShow")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 4);
  }, [bookings]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return undefined;
      let active = true;

      customFetch<MyAttendanceResponse>("/api/my/attendance?limit=100")
        .then((res) => {
          if (!active) return;
          const count = res.data.filter((record) =>
            record.status === "checked_in" || record.status === "late",
          ).length;
          setServerAttendedCount(count);
        })
        .catch(() => {
          if (active) setServerAttendedCount(null);
        });

      return () => {
        active = false;
      };
    }, [user]),
  );

  const upcoming = bookings.filter(
    (b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pending"
  ).length;
  const activePackages = userPackages.filter(
    (p) => p.status === "active" && new Date(p.expiryDate) >= new Date()
  ).length;
  const totalCredits = userPackages
    .filter((p) => p.status === "active" && new Date(p.expiryDate) >= new Date())
    .reduce((sum, p) => sum + (p.remainingCredits ?? 0), 0);
  const attendedCount =
    serverAttendedCount ??
    bookings.filter((b) => b.bookingStatus === "attended").length;

  async function handleLogout() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => setUser(null) },
    ]);
  }

  function handleDeleteChild(id: string) {
    Alert.alert("Remove Child", "Are you sure you want to remove this child profile?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeChild(id) },
    ]);
  }

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 : insets.top }]}>
        <View style={styles.guestContainer}>
          <View style={[styles.guestAvatarCircle, { backgroundColor: "#1E1E26" }]}>
            <Ionicons name="person" size={40} color="#6B7280" />
          </View>
          <Text style={styles.guestTitle}>Not signed in</Text>
          <Text style={styles.guestSubtitle}>
            Sign in to book classes, manage your account, and track your progress.
          </Text>
          <View style={{ gap: 10, width: "100%", marginTop: 8 }}>
            <AppButton title="Sign In" onPress={() => router.push("/auth/login")} fullWidth />
            <AppButton title="Create Account" onPress={() => router.push("/auth/register")} variant="ghost" fullWidth />
          </View>
        </View>
      </View>
    );
  }

  const initials = user.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <View style={styles.container}>
      {/* Full-bleed header glow — exact design radial-gradient(120% 90% at 50% -10%, rgba(0,182,215,0.16) 0%, transparent 60%).
          Rendered on the root container (not the padded content) so it spans edge-to-edge and never reads as a boxed panel. */}
      <Svg style={styles.headerGlow} pointerEvents="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="50%" cy="-10%" rx="120%" ry="90%">
            <Stop offset="0%" stopColor="#00B6D7" stopOpacity={0.16} />
            <Stop offset="60%" stopColor="#00B6D7" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)" />
      </Svg>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === "web" ? 140 : 120, paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarGlowWrap}>
            <View style={styles.avatarWrap}>
              {user.avatarUrl ? (
                <Image
                  source={{ uri: user.avatarUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={[styles.avatarCircle, { backgroundColor: colors.studio.primary + "30" }]}>
                  <Text style={[styles.avatarInitials, { color: colors.studio.primary }]}>{initials}</Text>
                </View>
              )}
              {user.emailVerified && (
                <View style={styles.avatarVerifiedBadge}>
                  <PIcon name="check" size={14} stroke={3} color="#0A0B0D" />
                </View>
              )}
            </View>
          </View>
          <Text style={styles.fullName}>{user.fullName}</Text>
          <View style={styles.contactBlock}>
            <View style={styles.contactRow}>
              <PIcon name="mail" size={15} color="#6B747F" />
              <Text style={styles.contactText}>{user.email}</Text>
            </View>
            {user.phone ? (
              <View style={styles.contactRow}>
                <PIcon name="phone" size={15} color="#6B747F" />
                <Text style={styles.contactText}>{user.phone}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.accountTypePill}>
            <Text style={styles.accountTypeRole}>
              {user.accountType === "parent" ? "PARENT" : "STUDENT"}
            </Text>
            <View style={styles.accountTypeDot} />
            <Text style={styles.accountTypeProvider}>
              {user.authProvider ? `${user.authProvider} account` : "Local account"}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <PIcon name="credits" size={18} stroke={2.2} color="#2DCDEC" />
            </View>
            <Text style={styles.statValue}>{totalCredits}</Text>
            <Text style={styles.statLabel}>Credits</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <PIcon name="bookings" size={18} stroke={2.2} color="#FFB02E" />
            </View>
            <Text style={styles.statValue}>{upcoming}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <PIcon name="check" size={18} stroke={2.2} color="#1FB871" />
            </View>
            <Text style={styles.statValue}>{attendedCount}</Text>
            <Text style={styles.statLabel}>Attended</Text>
          </View>
        </View>

        <Text style={styles.sectionEyebrow}>MY STUDIO PASS</Text>
        <TouchableOpacity
          style={styles.qrCard}
          activeOpacity={0.85}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/my-qr"); }}
        >
          <LinearGradient
            colors={["rgba(0,182,215,0.16)", "rgba(0,182,215,0.12)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.qrCardLeft}>
            <QRCode value={user.id || "central-studio-pass"} size={104} color="#000000" backgroundColor="transparent" />
          </View>
          <View style={styles.qrCardRight}>
            <Text style={styles.qrCardEyebrow}>MEMBER PASS</Text>
            <Text style={styles.qrCardTitle}>{user.fullName}</Text>
            <Text style={styles.qrCardDesc}>Show at reception to check in</Text>
            <View style={styles.qrExpandBtn}>
              <PIcon name="expand" size={14} stroke={2.4} color="#0A0B0D" />
              <Text style={styles.qrExpandText}>Full screen</Text>
            </View>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionEyebrow}>ACCOUNT</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/edit-profile")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: colors.studio.primary + "15" }]}>
              <PIcon name="edit" size={19} stroke={2.1} color={colors.studio.primary} />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Edit Profile</Text>
              <Text style={styles.menuSubtitle}>Name, phone, photo, address</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/(tabs)/bookings")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FFB02E15" }]}>
              <PIcon name="bookings" size={19} stroke={2.1} color="#FFB02E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>My Bookings</Text>
              <Text style={styles.menuSubtitle}>Upcoming & past classes</Text>
            </View>
            <Text style={styles.menuTrailingText}>{bookings.length > 0 ? bookings.length.toString() : ""}</Text>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/package-center")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#7C3AED15" }]}>
              <PIcon name="package" size={19} stroke={2.1} color="#7C3AED" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Package Center</Text>
              <Text style={styles.menuSubtitle}>Active packages & credits</Text>
            </View>
            <Text style={styles.menuTrailingText}>{totalCredits} cr</Text>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/credit-history")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: colors.studio.primary + "15" }]}>
              <PIcon name="history" size={19} stroke={2.1} color={colors.studio.primary} />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Credit History</Text>
              <Text style={styles.menuSubtitle}>Recent package usage</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>ATTENDANCE HISTORY</Text>
        <View style={[styles.menuContainer, { paddingVertical: 4 }]}>
          {recentAttendance.length === 0 ? (
            <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
              <Ionicons name="barbell-outline" size={24} color="#4C545E" />
              <Text style={{ fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" }}>No recent attendance records</Text>
            </View>
          ) : (
            recentAttendance.map((rec, idx) => {
              const isAttended = rec.bookingStatus === "attended" || rec.attendanceStatus === "attended";
              const dotColor = isAttended ? "#1FB871" : "#FFB02E"; // Wait, "Missed" was red, "Late" was orange. I will use Red for missed.
              let badgeText = "Attended";
              let badgeColor = "#1FB871";
              if (rec.attendanceStatus === "noShow" || rec.bookingStatus === "noShow") {
                badgeText = "Missed";
                badgeColor = "#EF4444";
              }

              return (
                <View key={rec.bookingNumber + idx} style={[styles.attendanceItem, idx < recentAttendance.length - 1 && styles.menuItemBorder]}>
                  <View style={[styles.attendanceDot, { backgroundColor: badgeColor }]} />
                  <View style={styles.attendanceTextCol}>
                    <Text style={styles.attendanceTitle}>{rec.className || rec.danceType}</Text>
                    <Text style={styles.attendanceSubtitle}>{rec.instructorName} · {rec.date} {rec.time ? `· ${rec.time}` : ""}</Text>
                  </View>
                  <View style={[styles.attendanceBadge, { backgroundColor: badgeColor + "15" }]}>
                    <Text style={[styles.attendanceBadgeText, { color: badgeColor }]}>{badgeText}</Text>
                  </View>
                </View>
              )
            })
          )}
        </View>

        {user.accountType === "parent" && (
          <View style={{ marginTop: 24 }}>
            <Text style={[styles.sectionEyebrow, { marginTop: 0 }]}>CHILDREN</Text>

            {children.length === 0 ? (
              <View style={styles.emptyChildren}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="people-outline" size={28} color="#4C545E" />
                </View>
                <Text style={styles.emptyChildrenText}>No children added yet</Text>
                <Text style={styles.emptyChildrenDesc}>Add your child profile to book classes for them.</Text>
                <TouchableOpacity
                  onPress={() => { setEditingChild(undefined); setAddChildVisible(true); }}
                  style={[styles.addChildTextBtn, { marginTop: 12 }]}
                >
                  <Text style={styles.addChildTextBtnLabel}>+ Add Child</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.childrenContainer}>
                {children.map((child, idx) => (
                  <View key={child.id} style={idx < children.length - 1 ? styles.menuItemBorder : {}}>
                    <ChildCard
                      child={child}
                      onEdit={() => { setEditingChild(child); setAddChildVisible(true); }}
                    />
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() => { setEditingChild(undefined); setAddChildVisible(true); }}
                  style={[styles.addChildTextBtn, styles.addChildTextBtnDivider]}
                >
                  <PIcon name="plus" size={18} stroke={2.4} color="#00B6D7" />
                  <Text style={styles.addChildTextBtnLabel}>Add Child</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>ACTIVITY & SUPPORT</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/notifications")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FF2E7E15" }]}>
              <PIcon name="bell" size={19} stroke={2.1} color="#FF2E7E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Notifications</Text>
              <Text style={styles.menuSubtitle}>Reminders, offers, updates</Text>
            </View>
            {unreadNotifications > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>{unreadNotifications}</Text>
              </View>
            )}
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/help-support")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <PIcon name="help" size={19} stroke={2.1} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Help & Support</Text>
              <Text style={styles.menuSubtitle}>FAQ, contact, submit an issue</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>PRIVACY & SECURITY</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/change-password")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <PIcon name="lock" size={19} stroke={2.1} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Change Password</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/verify-email")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#00B6D715" }]}>
              <PIcon name="mail" size={19} stroke={2.1} color="#00B6D7" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Email Verification</Text>
            </View>
            {user.emailVerified ? (
              <View style={styles.verifiedGreenBadge}>
                <PIcon name="check" size={12} stroke={3} color="#1FB871" />
                <Text style={styles.verifiedGreenBadgeText}>Verified</Text>
              </View>
            ) : (
              <View style={styles.unverifiedBadge}>
                <Text style={styles.unverifiedBadgeText}>Unverified</Text>
              </View>
            )}
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/two-factor-auth")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FFB02E15" }]}>
              <PIcon name="shield" size={19} stroke={2.1} color="#FFB02E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Two-Factor Auth</Text>
              <Text style={styles.menuSubtitle}>Add an extra layer</Text>
            </View>
            <Text style={styles.menuTrailingText}>Off</Text>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/privacy-policy")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <PIcon name="privacy" size={19} stroke={2.1} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Privacy & Permissions</Text>
              <Text style={styles.menuSubtitle}>Policy, terms, data usage</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleLogout} style={[styles.menuContainer, { marginTop: 24, marginBottom: 24 }]} activeOpacity={0.8}>
          <View style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: "#EF444415" }]}>
              <PIcon name="logout" size={19} stroke={2.1} color="#EF4444" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={[styles.menuLabel, { color: "#EF4444" }]}>Sign Out</Text>
              <Text style={styles.menuSubtitle}>Sign out from the app</Text>
            </View>
            <PIcon name="chevron" size={17} stroke={2.4} color="#4C545E" />
          </View>
        </TouchableOpacity>
      </ScrollView>

      <AddChildModal


        visible={addChildVisible}
        onClose={() => { setAddChildVisible(false); setEditingChild(undefined); }}
        initial={editingChild}
        onSave={(data) => {
          if (editingChild) {
            updateChild({ ...data, id: editingChild.id });
          } else {
            addChild({ ...data, id: `child-${Date.now()}` });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 380, zIndex: 0 },
  scroll: { paddingHorizontal: 20 },
  guestContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  guestAvatarCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestTitle: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  guestSubtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },

  profileCard: { alignItems: "center", paddingTop: 8, paddingBottom: 22, gap: 14 },
  // avatar: 92×92 image (design) with a 3px cyan ring outside (→98 wrap) + soft cyan glow (design boxShadow 0 0 28px rgba(0,182,215,0.4))
  avatarWrap: {
    position: "relative", width: 98, height: 98, borderRadius: 49, alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "#00B6D7",
    shadowColor: "#00B6D7", shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  avatarGlowWrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  avatarCircle: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 92, height: 92, borderRadius: 46, backgroundColor: "#1E1E26" },
  avatarInitials: { fontSize: 28, fontFamily: "Anton_400Regular" },
  avatarVerifiedBadge: { position: "absolute", bottom: 2, right: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: "#00B6D7", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#0A0B0D" },
  fullName: { fontSize: 28, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF", letterSpacing: -0.3 },
  contactBlock: { alignItems: "center", gap: 5 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  contactText: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#8E97A2" },
  accountTypePill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.06)" },
  accountTypeRole: { fontSize: 12.5, fontFamily: "Archivo_800ExtraBold", color: "#2DCDEC", letterSpacing: 0.7, textTransform: "uppercase" },
  accountTypeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#4C545E" },
  accountTypeProvider: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: "#8E97A2" },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statCard: { flex: 1, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  statIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginBottom: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  statValue: { fontSize: 26, lineHeight: 24, fontFamily: "Anton_400Regular", color: "#FFFFFF" },
  statLabel: { fontSize: 11.5, fontFamily: "Archivo_400Regular", color: "#6B747F", marginTop: 3 },

  sectionEyebrow: { fontSize: 12, fontFamily: "SpaceMono_700Bold", color: "#6B747F", letterSpacing: 1.9, marginBottom: 10, textTransform: "uppercase", marginLeft: 4 },

  qrCard: { flexDirection: "row", backgroundColor: "#15171B", borderRadius: 16, overflow: "hidden", marginBottom: 24, borderWidth: 1, borderColor: "rgba(0,182,215,0.4)", alignItems: "center", padding: 18, gap: 16 },
  qrCardLeft: { backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 8, borderRadius: 10 },
  qrCardRight: { flex: 1, justifyContent: "center" },
  qrCardEyebrow: { fontSize: 11, fontFamily: "SpaceMono_700Bold", color: "#2DCDEC", letterSpacing: 1.7, marginBottom: 6, textTransform: "uppercase" },
  qrCardTitle: { fontSize: 16, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  qrCardDesc: { fontSize: 12.5, fontFamily: "Archivo_400Regular", color: "#8E97A2", marginTop: 2, marginBottom: 12 },
  qrExpandBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#00B6D7", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  qrExpandText: { fontSize: 12.5, fontFamily: "Archivo_800ExtraBold", color: "#0A0B0D" },

  menuContainer: { backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  menuIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  menuTextCol: { flex: 1, gap: 2 },
  menuLabel: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  menuSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B7280" },
  menuTrailingText: { fontSize: 13, fontFamily: "Archivo_600SemiBold", color: "#9CA3AF", marginRight: 4 },
  notificationBadge: { backgroundColor: "#FF2E7E", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginRight: 4 },
  notificationBadgeText: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  verifiedGreenBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(31, 184, 113, 0.15)", borderWidth: 1, borderColor: "rgba(31, 184, 113, 0.3)" },
  verifiedGreenBadgeText: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#1FB871" },
  unverifiedBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(255,176,46,0.14)", borderWidth: 1, borderColor: "rgba(255,176,46,0.3)" },
  unverifiedBadgeText: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#FFB02E" },

  attendanceItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  attendanceDot: { width: 8, height: 8, borderRadius: 4 },
  attendanceTextCol: { flex: 1, gap: 2 },
  attendanceTitle: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  attendanceSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  attendanceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  attendanceBadgeText: { fontSize: 11, fontFamily: "Archivo_700Bold" },

  childrenContainer: { backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  childCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  childAvatarWrap: { position: "relative", width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  childAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  childAvatarBadge: { position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: "#0A0B0D", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent" },
  childInfo: { flex: 1, gap: 2 },
  childName: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  childGenderTag: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 1 },
  childMeta: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  childAction: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },

  addChildTextBtn: { width: "100%", flexDirection: "row", gap: 6, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  addChildTextBtnDivider: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  addChildTextBtnLabel: { fontSize: 14, fontFamily: "Archivo_700Bold", color: "#00B6D7" },

  emptyChildren: { padding: 24, alignItems: "center", gap: 12, backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", justifyContent: "center" },
  emptyChildrenText: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  emptyChildrenDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#0E1619", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === "web" ? 34 : 40, gap: 16, maxHeight: "90%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#2A2A35", alignSelf: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginBottom: 6 },
  input: { backgroundColor: "#1E1E26", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: "#FFFFFF", fontFamily: "Inter_400Regular", fontSize: 14, borderWidth: 1, borderColor: "#2A2A35" },
  rowFields: { flexDirection: "row", gap: 10 },
  genderRow: { flexDirection: "row", gap: 8 },
  genderBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: "#2A2A35", backgroundColor: "#1E1E26" },
  genderBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },

  qrModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 },
  qrModal: { backgroundColor: "#0E1619", borderRadius: 24, padding: 28, alignItems: "center", gap: 12, width: "100%", borderWidth: 1, borderColor: "#1E2E38" },
  qrModalClose: { position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center" },
  qrModalLabel: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: colors.studio.primary, letterSpacing: 2, textTransform: "uppercase" },
  qrModalCode: { backgroundColor: "#FFFFFF", padding: 16, borderRadius: 16, marginVertical: 4 },
  qrModalName: { fontSize: 20, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  qrModalEmail: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  qrPackageBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  qrPackageBadgeText: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },
  qrModalHint: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 17, marginTop: 4 },
  qrPlaceholderModal: { width: 220, height: 220, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F3F4F6", borderRadius: 8 },
  qrPlaceholderText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },
});
