import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useState } from "react";
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

import { useAppContext, ChildProfile } from "@/contexts/AppContext";
import { fetchMyApplications } from "@/services/balletAssessmentService";
import colors from "@/constants/colors";
import AppButton from "@/components/AppButton";

const SECTION_ITEMS = [
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
  const [age, setAge] = useState(initial ? String(initial.age) : "");
  const [gender, setGender] = useState<"male" | "female">(initial?.gender ?? "female");
  const [medicalNotes, setMedicalNotes] = useState(initial?.medicalNotes ?? "");
  const [emergencyName, setEmergencyName] = useState(initial?.emergencyContactName ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(initial?.emergencyContactPhone ?? "");

  function reset() {
    setFullName(initial?.fullName ?? "");
    setBirthday(initial?.birthday ?? "");
    setAge(initial ? String(initial.age) : "");
    setGender(initial?.gender ?? "female");
    setMedicalNotes(initial?.medicalNotes ?? "");
    setEmergencyName(initial?.emergencyContactName ?? "");
    setEmergencyPhone(initial?.emergencyContactPhone ?? "");
  }

  function handleSave() {
    if (!fullName.trim()) { Alert.alert("Required", "Please enter the child's full name."); return; }
    if (!age.trim() || isNaN(Number(age))) { Alert.alert("Required", "Please enter a valid age."); return; }
    onSave({
      fullName: fullName.trim(),
      birthday: birthday.trim(),
      age: parseInt(age, 10),
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
                <Text style={styles.fieldLabel}>Birthday</Text>
                <TextInput value={birthday} onChangeText={setBirthday} style={styles.input} placeholderTextColor="#4B5563" placeholder="YYYY-MM-DD" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Age *</Text>
                <TextInput value={age} onChangeText={setAge} style={styles.input} placeholderTextColor="#4B5563" placeholder="Age" keyboardType="numeric" />
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
    </Modal>
  );
}

export default function ProfileScreen() {
  const { user, setUser, bookings, children, addChild, updateChild, removeChild, userPackages } = useAppContext();
  const insets = useSafeAreaInsets();
  const [addChildVisible, setAddChildVisible] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | undefined>(undefined);
  const [qrVisible, setQrVisible] = useState(false);

  // Fetch ballet applications to determine account type.
  // A user is a "Parent" if they have registered children OR submitted ballet applications.
  const [hasBalletApplications, setHasBalletApplications] = useState(false);
  useEffect(() => {
    if (!user) return;
    const ctrl = new AbortController();
    fetchMyApplications(ctrl.signal)
      .then((apps) => {
        if (!ctrl.signal.aborted) setHasBalletApplications(apps.length > 0);
      })
      .catch(() => { /* non-critical — tag defaults to children check */ });
    return () => ctrl.abort();
  }, [user]);

  const upcoming = bookings.filter(
    (b) => b.bookingStatus === "confirmed" || b.bookingStatus === "pendingPayment"
  ).length;
  const activePackages = userPackages.filter(
    (p) => p.status === "active" && new Date(p.expiryDate) >= new Date()
  ).length;
  const totalCredits = userPackages
    .filter((p) => p.status === "active" && new Date(p.expiryDate) >= new Date())
    .reduce((sum, p) => sum + (p.remainingCredits ?? 0), 0);

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
          <View style={[styles.avatarCircle, { backgroundColor: colors.studio.primary + "30" }]}>
            <Text style={[styles.avatarInitials, { color: colors.studio.primary }]}>{initials}</Text>
          </View>
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
          {/* Account type tag — Parent if the user has registered children OR ballet applications.
              Dancer tag is reserved for a future dancer profile system. */}
          {(() => {
            const isParent = children.length > 0 || hasBalletApplications;
            return (
              <View style={styles.accountTypeTag}>
                <Ionicons
                  name={isParent ? "people-outline" : "person-outline"}
                  size={11}
                  color={isParent ? "#60A5FA" : "#A78BFA"}
                />
                <Text style={[styles.accountTypeText, { color: isParent ? "#60A5FA" : "#A78BFA" }]}>
                  {isParent ? "Parent" : "Student"}
                </Text>
              </View>
            );
          })()}
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
              {bookings.filter((b) => b.bookingStatus === "attended").length}
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
              {user.qrToken ? (
                <QRCode
                  value={JSON.stringify({ app: "centralstudio", token: user.qrToken })}
                  size={56}
                  color="#FFFFFF"
                  backgroundColor="transparent"
                />
              ) : (
                <Text style={styles.qrPlaceholderSmall}>Pass{"\n"}pending</Text>
              )}
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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Children Profiles</Text>
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
              <Text style={styles.emptyChildrenDesc}>Add your child's profile to book kids classes and ballet assessments</Text>
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
  avatarInitials: { fontSize: 28, fontFamily: "Inter_700Bold" },
  fullName: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#FFFFFF" },
  emailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  email: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  verifiedText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  phone: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  accountTypeTag: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, backgroundColor: "#1E1E26", borderWidth: 1, borderColor: "#2A2A35", marginTop: 2 },
  accountTypeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
  qrPreview: { width: 60, height: 60, borderRadius: 8, overflow: "hidden", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 2 },
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
  qrPlaceholderSmall: { fontSize: 8, fontFamily: "Inter_400Regular", color: "#FFFFFF60", textAlign: "center", lineHeight: 11 },
  qrPlaceholderModal: { width: 220, height: 220, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#F3F4F6", borderRadius: 8 },
  qrPlaceholderText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },
});
