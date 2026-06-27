const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'artifacts/central/app/(tabs)/profile.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// The new UI structure for the ProfileScreen component
const uiRegex = /return \(\n    <View style=\{styles\.container\}>([\s\S]*?)<AddChildModal/m;

const newUI = `return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === "web" ? 120 : 90, paddingTop: (Platform.OS === "web" ? 67 : insets.top) + 12 },
        ]}
      >
        <View style={styles.profileCard}>
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
            <View style={styles.avatarVerifiedBadge}>
              <Ionicons name="checkmark" size={14} color="#0A0B0D" />
            </View>
          </View>
          <Text style={styles.fullName}>{user.fullName}</Text>
          <View style={styles.contactBlock}>
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={14} color="#9CA3AF" />
              <Text style={styles.contactText}>{user.email}</Text>
            </View>
            {user.phone ? (
              <View style={styles.contactRow}>
                <Ionicons name="call-outline" size={14} color="#9CA3AF" />
                <Text style={styles.contactText}>{user.phone}</Text>
              </View>
            ) : null}
          </View>
          
          <View style={styles.accountTypePill}>
            <Text style={styles.accountTypePillText}>
              {user.accountType === "parent" ? "PARENT" : "STUDENT"} • {user.authProvider ? user.authProvider + " account" : "Local account"}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.studio.primary + "20" }]}>
              <Ionicons name="infinite-outline" size={16} color={colors.studio.primary} />
            </View>
            <Text style={styles.statValue}>{totalCredits}</Text>
            <Text style={styles.statLabel}>Credits</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: "#FFB02E20" }]}>
              <Ionicons name="list-outline" size={16} color="#FFB02E" />
            </View>
            <Text style={styles.statValue}>{upcoming}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: "#1FB87120" }]}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#1FB871" />
            </View>
            <Text style={styles.statValue}>{attendedCount}</Text>
            <Text style={styles.statLabel}>Attended</Text>
          </View>
        </View>

        <Text style={styles.sectionEyebrow}>MY STUDIO PASS</Text>
        <TouchableOpacity
          style={styles.qrCard}
          activeOpacity={0.85}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setQrVisible(true); }}
        >
          <View style={styles.qrCardLeft}>
            <View style={styles.qrPreviewBox}>
               <Ionicons name="qr-code-outline" size={60} color="#0A0B0D" />
            </View>
          </View>
          <View style={styles.qrCardRight}>
            <Text style={styles.qrCardEyebrow}>MEMBER PASS</Text>
            <Text style={styles.qrCardTitle}>{user.fullName}</Text>
            <Text style={styles.qrCardDesc}>Show at reception to check in</Text>
            <View style={styles.qrExpandBtn}>
              <Ionicons name="expand-outline" size={14} color="#0A0B0D" />
              <Text style={styles.qrExpandText}>Full screen</Text>
            </View>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionEyebrow}>ACCOUNT</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/edit-profile")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: colors.studio.primary + "15" }]}>
              <Ionicons name="create-outline" size={20} color={colors.studio.primary} />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Edit Profile</Text>
              <Text style={styles.menuSubtitle}>Name, phone, photo, address</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/(tabs)/bookings")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FFB02E15" }]}>
              <Ionicons name="calendar-outline" size={20} color="#FFB02E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>My Bookings</Text>
              <Text style={styles.menuSubtitle}>Upcoming & past classes</Text>
            </View>
            <Text style={styles.menuTrailingText}>{bookings.length > 0 ? bookings.length.toString() : ""}</Text>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/package-center")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#7C3AED15" }]}>
              <Ionicons name="layers-outline" size={20} color="#7C3AED" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Package Center</Text>
              <Text style={styles.menuSubtitle}>Active packages & credits</Text>
            </View>
            <Text style={styles.menuTrailingText}>{totalCredits} cr</Text>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/credit-history")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: colors.studio.primary + "15" }]}>
              <Ionicons name="receipt-outline" size={20} color={colors.studio.primary} />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Credit History</Text>
              <Text style={styles.menuSubtitle}>Recent package usage</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
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
                    <Text style={styles.attendanceSubtitle}>{rec.instructorName} · {rec.date} {rec.time ? \`· \${rec.time}\` : ""}</Text>
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
                  style={styles.addChildTextBtn}
                >
                  <Text style={styles.addChildTextBtnLabel}>+ Add Child</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>ACTIVITY & SUPPORT</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/notifications")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FF2E7E15" }]}>
              <Ionicons name="notifications-outline" size={20} color="#FF2E7E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Notifications</Text>
              <Text style={styles.menuSubtitle}>Reminders, offers, updates</Text>
            </View>
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>3</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/help-support")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <Ionicons name="help-circle-outline" size={20} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Help & Support</Text>
              <Text style={styles.menuSubtitle}>FAQ, contact, submit an issue</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>PRIVACY & SECURITY</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity onPress={() => router.push("/change-password")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Change Password</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/verify-email")} style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#00B6D715" }]}>
              <Ionicons name="mail-outline" size={20} color="#00B6D7" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Email Verification</Text>
            </View>
            <View style={styles.verifiedGreenBadge}>
              <Ionicons name="checkmark" size={12} color="#1FB871" />
              <Text style={styles.verifiedGreenBadgeText}>Verified</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuItem, styles.menuItemBorder]} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#FFB02E15" }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#FFB02E" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Two-Factor Auth</Text>
              <Text style={styles.menuSubtitle}>Add an extra layer</Text>
            </View>
            <Text style={styles.menuTrailingText}>Off</Text>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/privacy-policy")} style={styles.menuItem} activeOpacity={0.7}>
            <View style={[styles.menuIcon, { backgroundColor: "#9CA3AF15" }]}>
              <Ionicons name="document-text-outline" size={20} color="#9CA3AF" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={styles.menuLabel}>Privacy & Permissions</Text>
              <Text style={styles.menuSubtitle}>Policy, terms, data usage</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleLogout} style={[styles.menuContainer, { marginTop: 24, marginBottom: 24 }]} activeOpacity={0.8}>
          <View style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: "#EF444415" }]}>
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
            </View>
            <View style={styles.menuTextCol}>
              <Text style={[styles.menuLabel, { color: "#EF4444" }]}>Sign Out</Text>
              <Text style={styles.menuSubtitle}>Sign out from the app</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color="#4C545E" />
          </View>
        </TouchableOpacity>
      </ScrollView>

      <AddChildModal\n`;

content = content.replace(uiRegex, newUI);

// Replace styles block completely 
// I need to use regex from `const styles = StyleSheet.create({` down to `qrPlaceholderText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 },\n});`

const newStyles = `const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.studio.background },
  scroll: { paddingHorizontal: 20 },
  guestContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  guestAvatarCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestTitle: { fontSize: 22, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  guestSubtitle: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  
  profileCard: { alignItems: "center", paddingTop: 12, paddingBottom: 24, gap: 4 },
  avatarWrap: { position: "relative", width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginBottom: 6, borderWidth: 2, borderColor: "#00B6D7", shadowColor: "#00B6D7", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 10 },
  avatarCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 88, height: 88, borderRadius: 44, backgroundColor: "#1E1E26" },
  avatarInitials: { fontSize: 28, fontFamily: "Anton_400Regular" },
  avatarVerifiedBadge: { position: "absolute", bottom: -2, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: "#00B6D7", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#0A0B0D" },
  fullName: { fontSize: 32, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF" },
  contactBlock: { alignItems: "center", gap: 6, marginTop: 4, marginBottom: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  contactText: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  accountTypePill: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.03)" },
  accountTypePillText: { fontSize: 11, fontFamily: "Archivo_700Bold", color: "#D1D5DB", letterSpacing: 0.5, textTransform: "uppercase" },
  
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 32 },
  statCard: { flex: 1, padding: 16, borderRadius: 16, alignItems: "center", backgroundColor: "#15171B", borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" },
  statIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontSize: 24, fontFamily: "Archivo_800ExtraBold", color: "#FFFFFF", marginBottom: 2 },
  statLabel: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  
  sectionEyebrow: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: "#4C545E", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase", marginLeft: 4 },
  
  qrCard: { flexDirection: "row", backgroundColor: "#0C1F2B", borderRadius: 16, overflow: "hidden", marginBottom: 32, borderWidth: 1, borderColor: "rgba(0,182,215,0.2)" },
  qrCardLeft: { width: "35%", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 12 },
  qrPreviewBox: { width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 2, borderColor: "#0A0B0D" },
  qrCardRight: { width: "65%", padding: 16, justifyContent: "center" },
  qrCardEyebrow: { fontSize: 11, fontFamily: "Archivo_800ExtraBold", color: "#00B6D7", letterSpacing: 2, marginBottom: 4 },
  qrCardTitle: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF", marginBottom: 4 },
  qrCardDesc: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF", marginBottom: 12 },
  qrExpandBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#00B6D7", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  qrExpandText: { fontSize: 12, fontFamily: "Archivo_700Bold", color: "#0A0B0D" },

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
  
  attendanceItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  attendanceDot: { width: 8, height: 8, borderRadius: 4 },
  attendanceTextCol: { flex: 1, gap: 2 },
  attendanceTitle: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  attendanceSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  attendanceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  attendanceBadgeText: { fontSize: 11, fontFamily: "Archivo_700Bold" },

  childrenContainer: { backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  childCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  childAvatarWrap: { position: "relative", width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: "#00B6D7", alignItems: "center", justifyContent: "center" },
  childAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#00B6D715" },
  childAvatarBadge: { position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: "#0A0B0D", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#00B6D7" },
  childInfo: { flex: 1, gap: 2 },
  childName: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  childGenderTag: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 1 },
  childMeta: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  childAction: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  
  addChildTextBtn: { width: "100%", paddingVertical: 16, alignItems: "center", justifyContent: "center" },
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
});`

const stylesRegex = /const styles = StyleSheet\.create\(\{[\s\S]*?qrPlaceholderText: \{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", textAlign: "center", lineHeight: 19, paddingHorizontal: 20 \},\n\}\);/m;

content = content.replace(stylesRegex, newStyles);

// Remove the SECTION_ITEMS array since we hardcoded the UI
content = content.replace(/const SECTION_ITEMS = \[\s*\{[\s\S]*?\];/m, '');

// Save
fs.writeFileSync(targetPath, content, 'utf8');
console.log('Rewrote profile.tsx successfully!');
