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
import { Image } from "expo-image";
import { customFetch } from "@workspace/api-client-react";
import type { MyAttendanceResponse } from "@workspace/api-client-react";

import { useAppContext, ChildProfile } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

const SECTION_ITEMS = [
  { icon: "create-outline",        label: "Edit Profile",        route: "/edit-profile" },
  { icon: "calendar-outline",      label: "My Bookings",         route: "/(tabs)/bookings"   },
  { icon: "layers-outline",        label: "Package Center",       route: "/package-center"    },
  { icon: "receipt-outline",       label: "Credit History",       route: "/credit-history"    },
  { icon: "barbell-outline",       label: "Attendance History",   route: "/attendance-history" },
  { icon: "qr-code-outline",       label: "My Studio Pass",       route: "/my-qr"             },
  { icon: "notifications-outline", label: "Notifications",        route: "/notifications"     },
  { icon: "help-circle-outline",   label: "Help & Support",       route: "/help-support"      },
  { icon: "shield-checkmark-outline", label: "Privacy & Security", route: "/privacy-policy"   },
];

function ChildCard({
  child,
  onEdit,
  onDelete,
}: {
  child: ChildProfile;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const genderColor = child.gender === "female" ? "#EC4899" : "#3B82F6";
  return (
    <View style={[styles.childCard, { borderColor: genderColor + "30" }]}>
      <View style={[styles.childAvatar, { backgroundColor: genderColor + "20" }]}>
        <Ionicons name={child.gender === "female" ? "person" : "person"} size={20} color={genderColor} />
      </View>
      <View style={styles.childInfo}>
        <Text style={styles.childName}>{child.fullName}</Text>
        <Text style={styles.childMeta}>
          Age {child.age} · {child.gender === "female" ? "Girl" : "Boy"}
          {child.birthday ? ` · Born ${child.birthday}` : ""}
        </Text>
        {child.medicalNotes ? (
          <Text style={styles.childNote} numberOfLines={1}>{child.medicalNotes}</Text>
        ) : null}
      </View>
      <TouchableOpacity onPress={onEdit} style={styles.childAction}>
        <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} style={styles.childAction}>
        <Ionicons name="trash-outline" size={16} color="#EF4444" />
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
  const { user, setUser, bookings, children, addChild, updateChild, removeChild, userPackages } = useAppContext();
  const insets = useSafeAreaInsets();
  const [addChildVisible, setAddChildVisible] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | undefined>(undefined);
  const [qrVisible, setQrVisible] = useState(false);
  const [serverAttendedCount, setServerAttendedCount] = useState<number | null>(null);

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === "web" ? 120 : 90, paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <View style={styles.profileCard}>
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
          <Text style={styles.fullName}>{user.fullName}</Text>
          <View style={styles.emailRow}>
            <Text style={styles.email}>{user.email}</Text>
            <View style={[styles.verifiedBadge, { backgroundColor: user.emailVerified ? "#22C55E20" : "#F59E0B20" }]}>
              <Ionicons name={user.emailVerified ? "checkmark-circle" : "alert-circle"} size={12} color={user.emailVerified ? "#22C55E" : "#F59E0B"} />
              <Text style={[styles.verifiedText, { color: user.emailVerified ? "#22C55E" : "#F59E0B" }]}>
                {user.emailVerified ? "Verified" : "Unverified"}
              </Text>
            </View>
          </View>
          {user.phone ? <Text style={styles.phone}>{user.phone}</Text> : null}
          <View style={styles.tagRow}>
            <View style={styles.accountTypeTag}>
              <Ionicons
                name={user.accountType === "parent" ? "people-outline" : "person-outline"}
                size={11}
                color={user.accountType === "parent" ? "#60A5FA" : "#A78BFA"}
              />
              <Text style={[styles.accountTypeText, { color: user.accountType === "parent" ? "#60A5FA" : "#A78BFA" }]}>
                {user.accountType === "parent" ? "Parent" : "Student"}
              </Text>
            </View>
            {user.authProvider ? (
              <View style={styles.providerTag}>
                <Ionicons name={user.authProvider === "google" ? "logo-google" : "person-circle-outline"} size={11} color="#9CA3AF" />
                <Text style={styles.providerText}>{user.authProvider}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: "#1E1E26" }]}>
            <Text style={[styles.statValue, { color: colors.studio.primary }]}>{totalCredits}</Text>
            <Text style={styles.statLabel}>Credits</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#1E1E26" }]}>
            <Text style={[styles.statValue, { color: "#22C55E" }]}>{upcoming}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: "#1E1E26" }]}>
            <Text style={[styles.statValue, { color: "#8B5CF6" }]}>
              {attendedCount}
            </Text>
            <Text style={styles.statLabel}>Attended</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.qrCard}
          activeOpacity={0.85}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setQrVisible(true); }}
        >
          <LinearGradient
            colors={["#003A47", "#001828"]}
            style={styles.qrCardGradient}
          >
            <View style={styles.qrPreview}>
              <Ionicons name="qr-code-outline" size={34} color={colors.studio.primary} />
            </View>
            <View style={styles.qrInfo}>
              <Text style={styles.qrCardTitle}>My Studio Pass</Text>
              <Text style={styles.qrCardDesc}>Show to admin to check in or deduct package credits</Text>
            </View>
            <View style={[styles.qrExpandBtn, { backgroundColor: colors.studio.primary + "20" }]}>
              <Ionicons name="expand-outline" size={18} color={colors.studio.primary} />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        <Modal visible={qrVisible} transparent animationType="fade" onRequestClose={() => setQrVisible(false)}>
          <View style={styles.qrModalOverlay}>
            <View style={styles.qrModal}>
              <TouchableOpacity style={styles.qrModalClose} onPress={() => setQrVisible(false)}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.qrModalLabel}>Studio Pass</Text>
              <View style={styles.qrModalCode}>
                {user.qrToken ? (
                  <QRCode
                    value={JSON.stringify({ app: "centralstudio", token: user.qrToken })}
                    size={220}
                    color="#000000"
                    backgroundColor="#FFFFFF"
                  />
                ) : (
                  <View style={styles.qrPlaceholderModal}>
                    <Ionicons name="qr-code-outline" size={48} color="#9CA3AF" />
                    <Text style={styles.qrPlaceholderText}>
                      Your studio pass is being prepared.{"\n"}Please refresh or contact reception.
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.qrModalName}>{user.fullName}</Text>
              <Text style={styles.qrModalEmail}>{user.email}</Text>
              {activePackages > 0 && (
                <View style={[styles.qrPackageBadge, { backgroundColor: "#22C55E20", borderColor: "#22C55E30" }]}>
                  <Ionicons name="card" size={14} color="#22C55E" />
                  <Text style={[styles.qrPackageBadgeText, { color: "#22C55E" }]}>
                    {activePackages} active package{activePackages !== 1 ? "s" : ""}
                  </Text>
                </View>
              )}
              <Text style={styles.qrModalHint}>Have the admin scan this code to check in or use a package credit</Text>
            </View>
          </View>
        </Modal>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Account</Text>
          </View>
          {SECTION_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.label}
              onPress={() => {
                if (item.route) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(item.route as any);
                }
              }}
              style={[styles.menuItem, { borderColor: "#2A2A35" }]}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIcon, { backgroundColor: "#1E1E26" }]}>
                <Ionicons name={item.icon as any} size={20} color="#9CA3AF" />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#6B7280" />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Security</Text>
          </View>
          <TouchableOpacity
            style={[styles.menuItem, { borderColor: "#2A2A35" }]}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/change-password");
            }}
          >
            <View style={[styles.menuIcon, { backgroundColor: "#1E1E26" }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" />
            </View>
            <Text style={styles.menuLabel}>Change Password</Text>
            <Ionicons name="chevron-forward" size={16} color="#6B7280" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderColor: "#2A2A35" }]}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/verify-email");
            }}
          >
            <View style={[styles.menuIcon, { backgroundColor: user.emailVerified ? "#22C55E15" : "#F59E0B15" }]}>
              <Ionicons name={user.emailVerified ? "mail" : "mail-open-outline"} size={20} color={user.emailVerified ? "#22C55E" : "#F59E0B"} />
            </View>
            <Text style={styles.menuLabel}>
              {user.emailVerified ? "Email Verified" : "Verify Email"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {user.accountType === "parent" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ gap: 2 }}>
                <Text style={styles.sectionTitle}>Children Profiles</Text>
                {children.length > 0 && (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" }}>
                    Child profiles are connected to this parent account.
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => { setEditingChild(undefined); setAddChildVisible(true); }}
                style={[styles.addChildBtn, { backgroundColor: colors.studio.primary + "15" }]}
              >
                <Ionicons name="add" size={16} color={colors.studio.primary} />
                <Text style={[styles.addChildBtnText, { color: colors.studio.primary }]}>Add Child</Text>
              </TouchableOpacity>
            </View>

            {children.length === 0 ? (
              <View style={[styles.emptyChildren, { borderColor: "#2A2A35" }]}>
                <Ionicons name="people-outline" size={28} color="#4B5563" />
                <Text style={styles.emptyChildrenText}>No children added yet</Text>
                <Text style={styles.emptyChildrenDesc}>Add your child profile to book classes for them.</Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {children.map((child) => (
                  <ChildCard
                    key={child.id}
                    child={child}
                    onEdit={() => { setEditingChild(child); setAddChildVisible(true); }}
                    onDelete={() => handleDeleteChild(child.id)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Sign Out</Text>
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
  scroll: { paddingHorizontal: 20 },
  guestContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  guestAvatarCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  guestSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  profileCard: { alignItems: "center", paddingVertical: 24, gap: 6 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  avatarImage: { width: 80, height: 80, borderRadius: 40, marginBottom: 4, backgroundColor: "#1E1E26" },
  avatarInitials: { fontSize: 28, fontFamily: "Inter_700Bold" },
  fullName: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  email: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  verifiedText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  phone: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  accountTypeTag: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, backgroundColor: "#1E1E26", borderWidth: 1, borderColor: "#2A2A35", marginTop: 2 },
  accountTypeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  providerTag: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, backgroundColor: "#1E1E26", borderWidth: 1, borderColor: "#2A2A35", marginTop: 2 },
  providerText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#9CA3AF", textTransform: "capitalize" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statCard: { flex: 1, padding: 14, borderRadius: 14, alignItems: "center", gap: 4 },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: "#FFFFFF" },
  addChildBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  addChildBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  childCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: colors.studio.card },
  childAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  childInfo: { flex: 1, gap: 2 },
  childName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  childMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  childNote: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  childAction: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  emptyChildren: { borderRadius: 14, borderWidth: 1, borderStyle: "dashed", padding: 24, alignItems: "center", gap: 8 },
  emptyChildrenText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  emptyChildrenDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4B5563", textAlign: "center", lineHeight: 16 },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, marginBottom: 8 },
  logoutText: { fontSize: 15, fontFamily: "Inter_500Medium" },
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
  qrCard: { borderRadius: 16, overflow: "hidden", marginBottom: 24, borderWidth: 1, borderColor: colors.studio.primary + "30" },
  qrCardGradient: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  qrPreview: { width: 60, height: 60, borderRadius: 12, overflow: "hidden", backgroundColor: colors.studio.primary + "12", borderWidth: 1, borderColor: colors.studio.primary + "38", alignItems: "center", justifyContent: "center" },
  qrInfo: { flex: 1 },
  qrCardTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  qrCardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 3, lineHeight: 16 },
  qrExpandBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  qrModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 },
  qrModal: { backgroundColor: "#0E1619", borderRadius: 24, padding: 28, alignItems: "center", gap: 12, width: "100%", borderWidth: 1, borderColor: "#1E2E38" },
  qrModalClose: { position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: "#1E1E26", alignItems: "center", justifyContent: "center" },
  qrModalLabel: { fontSize: 13, fontFamily: "Inter_700Bold", color: colors.studio.primary, letterSpacing: 2, textTransform: "uppercase" },
  qrModalCode: { backgroundColor: "#FFFFFF", padding: 16, borderRadius: 16, marginVertical: 4 },
  qrModalName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  qrModalEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  qrPackageBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  qrPackageBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  qrModalHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 17, marginTop: 4 },
  qrPlaceholderModal: { width: 220, height: 220, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F3F4F6", borderRadius: 8 },
  qrPlaceholderText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },
});
