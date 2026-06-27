const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'artifacts/central/app/(tabs)/profile.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add subtitle to SECTION_ITEMS
const newSectionItems = `const SECTION_ITEMS = [
  { icon: "create-outline",        label: "Edit Profile",        subtitle: "Name, phone, photo, address",      route: "/edit-profile",      color: colors.studio.primary },
  { icon: "calendar-outline",      label: "My Bookings",         subtitle: "Upcoming & past classes",          route: "/(tabs)/bookings",   color: "#FFB02E" },
  { icon: "layers-outline",        label: "Package Center",       subtitle: "Active packages & credits",        route: "/package-center",    color: "#7C3AED" },
  { icon: "receipt-outline",       label: "Credit History",       subtitle: "Recent package usage",             route: "/credit-history",    color: colors.studio.primary },
  { icon: "qr-code-outline",       label: "My Studio Pass",       subtitle: "Scan at reception",                route: "/my-qr",             color: colors.studio.primary },
  { icon: "notifications-outline", label: "Notifications",        subtitle: "Preferences & history",            route: "/notifications",     color: "#FF2E7E" },
  { icon: "help-circle-outline",   label: "Help & Support",       subtitle: "FAQ & contact us",                 route: "/help-support",      color: "#9CA3AF" },
  { icon: "shield-checkmark-outline", label: "Privacy & Security", subtitle: "Terms & policies",                route: "/privacy-policy",   color: "#9CA3AF" },
];`;

content = content.replace(/const SECTION_ITEMS = \[\s*\{[\s\S]*?\];/m, newSectionItems);

// 2. ChildCard
const newChildCard = `function ChildCard({
  child,
  onEdit,
}: {
  child: ChildProfile;
  onEdit: () => void;
}) {
  const genderColor = child.gender === "female" ? "#EC4899" : "#3B82F6";
  const genderLabel = child.gender === "female" ? "GIRL" : "BOY";
  return (
    <View style={styles.childCard}>
      <View style={styles.childAvatarWrap}>
        <View style={styles.childAvatar}>
          <Ionicons name={child.gender === "female" ? "person" : "person"} size={20} color="#00B6D7" />
        </View>
        <View style={styles.childAvatarBadge}>
          <Ionicons name="link" size={10} color="#FFFFFF" />
        </View>
      </View>
      <View style={styles.childInfo}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.childName}>{child.fullName}</Text>
          <Text style={[styles.childGenderTag, { color: "#00B6D7" }]}>{genderLabel}</Text>
        </View>
        <Text style={styles.childMeta}>
          Age {child.age} {child.birthday ? \`· Born \${child.birthday}\` : ""}
        </Text>
      </View>
      <TouchableOpacity onPress={onEdit} style={styles.childAction}>
        <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );
}`;

content = content.replace(/function ChildCard\(\{[\s\S]*?\}\n\nfunction calculateAge/m, newChildCard + '\n\nfunction calculateAge');

// 3. ProfileScreen logic 
// Find `export default function ProfileScreen() {`
const profileStart = `export default function ProfileScreen() {
  const { user, setUser, bookings, children, addChild, updateChild, removeChild, userPackages } = useAppContext();
  const insets = useSafeAreaInsets();
  const [addChildVisible, setAddChildVisible] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | undefined>(undefined);
  const [qrVisible, setQrVisible] = useState(false);
  const [serverAttendedCount, setServerAttendedCount] = useState<number | null>(null);

  // Derive recent attendance
  const recentAttendance = React.useMemo(() => {
    return [...bookings]
      .filter((b) => b.bookingStatus === "attended" || b.bookingStatus === "noShow" || b.attendanceStatus === "attended" || b.attendanceStatus === "noShow")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 4);
  }, [bookings]);`;

content = content.replace(/export default function ProfileScreen\(\) \{[\s\S]*?const \[serverAttendedCount, setServerAttendedCount\] = useState<number \| null>\(null\);/, profileStart);

// 4. handleDeleteChild is not needed anymore for UI, but keep the function if we want.
// 5. Replace the UI returned by ProfileScreen
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
          {SECTION_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={item.label}
              onPress={() => {
                if (item.route) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(item.route as any);
                }
              }}
              style={[
                styles.menuItem,
                index < SECTION_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" }
              ]}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIcon, { backgroundColor: (item.color || "#9CA3AF") + "15" }]}>
                <Ionicons name={item.icon as any} size={20} color={item.color || "#9CA3AF"} />
              </View>
              <View style={styles.menuTextCol}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                {item.subtitle ? <Text style={styles.menuSubtitle}>{item.subtitle}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={17} color="#4C545E" />
            </TouchableOpacity>
          ))}
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
              const dotColor = isAttended ? "#1FB871" : "#EF4444";
              const badgeText = isAttended ? "Attended" : "Missed";
              const badgeColor = isAttended ? "#1FB871" : "#EF4444";
              
              return (
                <View key={rec.bookingNumber + idx} style={[styles.attendanceItem, idx < recentAttendance.length - 1 && { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" }]}>
                  <View style={[styles.attendanceDot, { backgroundColor: dotColor }]} />
                  <View style={styles.attendanceTextCol}>
                    <Text style={styles.attendanceTitle}>{rec.className || rec.danceType}</Text>
                    <Text style={styles.attendanceSubtitle}>{rec.instructorName} · {rec.date} {rec.time ? \`· \${rec.time}\` : ""}</Text>
                  </View>
                  <View style={[styles.attendanceBadge, { backgroundColor: badgeColor + "20" }]}>
                    <Text style={[styles.attendanceBadgeText, { color: badgeColor }]}>{badgeText}</Text>
                  </View>
                </View>
              )
            })
          )}
        </View>

        {user.accountType === "parent" && (
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
               <Text style={[styles.sectionEyebrow, { marginTop: 0 }]}>CHILDREN</Text>
               <TouchableOpacity
                  onPress={() => { setEditingChild(undefined); setAddChildVisible(true); }}
                  style={[styles.addChildBtn, { backgroundColor: colors.studio.primary + "15" }]}
                >
                  <Ionicons name="add" size={16} color={colors.studio.primary} />
                  <Text style={[styles.addChildBtnText, { color: colors.studio.primary }]}>Add Child</Text>
                </TouchableOpacity>
            </View>

            {children.length === 0 ? (
              <View style={styles.emptyChildren}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="people-outline" size={28} color="#4C545E" />
                </View>
                <Text style={styles.emptyChildrenText}>No children added yet</Text>
                <Text style={styles.emptyChildrenDesc}>Add your child profile to book classes for them.</Text>
              </View>
            ) : (
              <View style={styles.childrenContainer}>
                {children.map((child) => (
                  <ChildCard
                    key={child.id}
                    child={child}
                    onEdit={() => { setEditingChild(child); setAddChildVisible(true); }}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color="#6B7280" />
          <Text style={[styles.logoutText, { color: "#6B7280" }]}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <AddChildModal\n`;

content = content.replace(uiRegex, newUI);

// Replace styles
const stylesStart = `const styles = StyleSheet.create({
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
  menuIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  menuTextCol: { flex: 1, gap: 2 },
  menuLabel: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  menuSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#6B7280" },
  
  attendanceItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  attendanceDot: { width: 8, height: 8, borderRadius: 4 },
  attendanceTextCol: { flex: 1, gap: 2 },
  attendanceTitle: { fontSize: 15, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  attendanceSubtitle: { fontSize: 12, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  attendanceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  attendanceBadgeText: { fontSize: 11, fontFamily: "Archivo_700Bold" },

  childrenContainer: { backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  childCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)" },
  childAvatarWrap: { position: "relative", width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: "#00B6D7", alignItems: "center", justifyContent: "center" },
  childAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#00B6D715" },
  childAvatarBadge: { position: "absolute", bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: "#0A0B0D", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#00B6D7" },
  childInfo: { flex: 1, gap: 2 },
  childName: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  childGenderTag: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", letterSpacing: 1 },
  childMeta: { fontSize: 13, fontFamily: "Archivo_400Regular", color: "#9CA3AF" },
  childAction: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  
  addChildBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginBottom: 8 },
  addChildBtnText: { fontSize: 12, fontFamily: "Archivo_700Bold" },
  
  emptyChildren: { padding: 24, alignItems: "center", gap: 12, backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.03)", alignItems: "center", justifyContent: "center" },
  emptyChildrenText: { fontSize: 16, fontFamily: "Archivo_700Bold", color: "#FFFFFF" },
  emptyChildrenDesc: { fontSize: 14, fontFamily: "Archivo_400Regular", color: "#9CA3AF", textAlign: "center", lineHeight: 20 },
  
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, marginTop: 24, marginBottom: 8, backgroundColor: "#15171B", borderRadius: 16 },
  logoutText: { fontSize: 15, fontFamily: "Archivo_700Bold" },`;

content = content.replace(/const styles = StyleSheet\.create\(\{[\s\S]*?logoutText: \{ fontSize: 15, fontFamily: "Archivo_700Bold" \},/m, stylesStart);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Done rewrites!');
