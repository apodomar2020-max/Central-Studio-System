const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'artifacts/central/app/(tabs)/bookings.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add import
if (!content.includes('LinearGradient')) {
  content = content.replace(
    'import { useSafeAreaInsets } from "react-native-safe-area-context";',
    'import { useSafeAreaInsets } from "react-native-safe-area-context";\nimport { LinearGradient } from "expo-linear-gradient";'
  );
}
if (!content.includes('ScrollView')) {
  content = content.replace('View,\n} from "react-native";', 'View,\n  ScrollView,\n  Modal,\n  Animated\n} from "react-native";');
}

// 2. Add BookingDetailOverlay component
const overlayCode = `
// ─── Booking Detail Overlay ───────────────────────────────────────────────────

function BookingDetailOverlay({ item, onClose, topPad }: { item: ListItem; onClose: () => void; topPad: number }) {
  const isBallet = item.kind === "ballet";
  const b = item.data as any;

  const tc = { label: isBallet ? "Assessment" : (b.danceType || "Class"), color: "#00B6D7", rgb: isBallet ? "167,139,250" : "45,205,236" };
  const title = isBallet ? "Ballet Assessment" : b.className;
  const ref = isBallet ? b.id : b.bookingNumber;
  const statusLabel = isBallet ? getBalletStatusInfo(b.status).label : b.bookingStatus;
  const statusColor = isBallet ? getBalletStatusInfo(b.status).color : "#1FB871";
  
  const dayDate = isBallet ? (b.slotLabel || "Pending") : (b.date ? b.date : "TBD");
  const time = isBallet ? "TBD" : (b.time ? \`\${b.time} (\${b.duration})\` : b.duration);
  const branch = isBallet ? "Main Branch" : b.location;
  
  const studentName = isBallet ? b.childName : b.participantName;
  const instName = isBallet ? "Assigned Instructor" : b.instructorName;

  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Approximate Timeline
  const isPast = isBallet ? (b.status === "rejected" || b.status === "cancelled") : (b.bookingStatus === "attended" || b.bookingStatus === "completed" || b.bookingStatus === "noShow");
  const isCancelled = isBallet ? (b.status === "cancelled") : (b.bookingStatus === "cancelled" || b.bookingStatus === "rejected");
  const timeline = !isPast && !isCancelled
    ? [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Payment Confirmed", done: b.paymentStatus === "paid" || b.paymentStatus === "not_required", date: b.paymentStatus === "paid" ? new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") : "—" },
        { label: "Class Date", done: false, date: dayDate }
      ]
    : isPast
    ? [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Payment Confirmed", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: isBallet ? "Assessment Completed" : "Attended", done: true, date: dayDate }
      ]
    : [
        { label: "Booking Created", done: true, date: new Date(b.createdAt || Date.now()).toLocaleDateString("en-GB") },
        { label: "Cancelled", done: true, date: dayDate }
      ];

  return (
    <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#0A0B0D", zIndex: 100 }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <LinearGradient
          colors={[\`rgba(\${tc.rgb},0.18)\`, "rgba(10,11,13,0)"]}
          style={{ paddingTop: topPad + 10, paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" }}
        >
          <TouchableOpacity onPress={onClose} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
            <Ionicons name="chevron-back" size={20} color="#8E97A2" />
            <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 14, color: "#8E97A2" }}>Back</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <View style={{ backgroundColor: \`rgba(\${tc.rgb},0.16)\`, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
              <Text style={{ fontFamily: "Archivo_800ExtraBold", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: tc.color }}>{tc.label}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 11, color: statusColor }}>{statusLabel}</Text>
            </View>
          </View>
          
          <Text style={{ fontFamily: "Anton_400Regular", fontSize: 36, lineHeight: 36, textTransform: "uppercase", color: "#FFFFFF", marginBottom: 6 }}>{title}</Text>
          <Text style={{ fontFamily: "SpaceMono_400Regular", fontSize: 12.5, color: "#4C545E" }}>Booking #{ref}</Text>
        </LinearGradient>

        <View style={{ padding: 20 }}>
          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>Schedule</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="calendar-outline" size={14} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Day & Date</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{dayDate}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="time-outline" size={14} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Time</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{time}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="location-outline" size={14} color="#4C545E" />
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#6B747F" }}>Branch</Text>
              </View>
              <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 13, color: "#FFFFFF" }}>{branch}</Text>
            </View>
          </View>

          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>People</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, marginBottom: 20, flexDirection: "row", gap: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person" size={16} color="#6B747F" />
              </View>
              <View>
                <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 9, color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.6 }}>Student</Text>
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>{studentName}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="person" size={16} color="#6B747F" />
              </View>
              <View>
                <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 9, color: "#6B747F", textTransform: "uppercase", letterSpacing: 0.6 }}>Instructor</Text>
                <Text style={{ fontFamily: "Archivo_600SemiBold", fontSize: 13, color: "#FFFFFF" }}>{instName}</Text>
              </View>
            </View>
          </View>

          <Text style={{ fontFamily: "SpaceMono_700Bold", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#00B6D7", marginBottom: 10 }}>Booking Timeline</Text>
          <View style={{ backgroundColor: "#15171B", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", padding: 14, paddingBottom: 0, marginBottom: 20 }}>
            {timeline.map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingBottom: i < timeline.length - 1 ? 14 : 14 }}>
                <View style={{ alignItems: "center", width: 20 }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: step.done ? "#00B6D7" : "rgba(255,255,255,0.07)", borderWidth: step.done ? 0 : 1.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
                    {step.done && <Ionicons name="checkmark" size={12} color="#0A0B0D" />}
                  </View>
                  {i < timeline.length - 1 && <View style={{ width: 1, height: 22, backgroundColor: step.done ? "rgba(0,182,215,0.35)" : "rgba(255,255,255,0.08)", marginVertical: 4 }} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14.5, color: step.done ? "#FFFFFF" : "#6B747F" }}>{step.label}</Text>
                  <Text style={{ fontFamily: "Archivo_400Regular", fontSize: 12, color: "#4C545E", marginTop: 2 }}>{step.date}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {toast ? (
        <View style={{ position: "absolute", bottom: 100, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.8)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 }}>
          <Text style={{ color: "#fff", fontFamily: "Archivo_600SemiBold", fontSize: 13 }}>{toast}</Text>
        </View>
      ) : null}

      <LinearGradient
        colors={["rgba(10,11,13,0)", "#0A0B0D"]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30, height: 80, flexDirection: "row", gap: 10, justifyContent: "space-evenly" }}
      >
        {!isPast && !isCancelled && (
          <TouchableOpacity onPress={() => showToast("Cancellation Coming Soon")} style={{ flex: 1, height: 48, backgroundColor: "rgba(255,59,71,0.1)", borderWidth: 1, borderColor: "rgba(255,59,71,0.3)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}>
            <Ionicons name="close-circle" size={16} color="#FF3B47" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FF3B47" }}>Cancel Booking</Text>
          </TouchableOpacity>
        )}
        {(isPast || b.paymentStatus === "paid") && (
          <TouchableOpacity onPress={() => showToast("Receipts Coming Soon")} style={{ flex: 1, height: 48, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 }}>
            <Ionicons name="download-outline" size={16} color="#FFFFFF" />
            <Text style={{ fontFamily: "Archivo_700Bold", fontSize: 14, color: "#FFFFFF" }}>Download Receipt</Text>
          </TouchableOpacity>
        )}
      </LinearGradient>
    </Animated.View>
  );
}
`;

if (!content.includes('function BookingDetailOverlay')) {
  content = content.replace('// ─── Styles ───────────────────────────────────────────────────────────────────', overlayCode + '\n// ─── Styles ───────────────────────────────────────────────────────────────────');
}

// 3. Add overlay rendering at the end of BookingsScreen
if (!content.includes('selectedItem && <BookingDetailOverlay')) {
  content = content.replace('      )}', '      )}\n      {selectedItem && <BookingDetailOverlay item={selectedItem} onClose={() => setSelectedItem(null)} topPad={Platform.OS === "web" ? 67 : insets.top} />}');
}

// 4. Update styling in StyleSheet
if (!content.includes('backgroundColor: "#00B6D7"')) {
  content = content.replace('backgroundColor: colors.studio.background', 'backgroundColor: "#0A0B0D"');
  content = content.replace('backgroundColor: "#1E1E26"', 'backgroundColor: "rgba(255,255,255,0.06)"');
  content = content.replace('fontFamily: "Inter_500Medium"', 'fontFamily: "Archivo_600SemiBold"');
  
  // replace newBookingBtn
  content = content.replace(/newBookingBtn: {[\s\S]*?},/, 'newBookingBtn: {\n    flexDirection: "row",\n    alignItems: "center",\n    gap: 4,\n    paddingHorizontal: 12,\n    paddingVertical: 7,\n    borderRadius: 20,\n    backgroundColor: "#00B6D7",\n  },');
  content = content.replace(/newBookingText: {[\s\S]*?},/, 'newBookingText: { fontSize: 13, fontFamily: "Archivo_800ExtraBold", color: "#000" },');
  content = content.replace(/tabRow: {[\s\S]*?},/, 'tabRow: { flexDirection: "row", gap: 8, marginBottom: 12 },');
  
  // add tab active state
  content = content.replace('tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },', 'tabActive: { backgroundColor: "#00B6D7" },\n  tabText: { fontSize: 13, fontFamily: "Archivo_600SemiBold" },\n  tabTextActive: { color: "#000", fontFamily: "Archivo_800ExtraBold" },\n  tabTextInactive: { color: "#8E97A2" },');
  content = content.replace(/tabBadge: {[\s\S]*?},/, 'tabBadge: {\n    minWidth: 18,\n    height: 18,\n    borderRadius: 9,\n    alignItems: "center",\n    justifyContent: "center",\n    paddingHorizontal: 4,\n    backgroundColor: "#00B6D7"\n  },');
  content = content.replace(/tabBadgeText: {[\s\S]*?},/, 'tabBadgeText: { fontSize: 10, fontFamily: "Archivo_800ExtraBold", color: "#000" },\n  filterScroll: { gap: 8, paddingRight: 20 },\n  filterChip: {\n    paddingHorizontal: 12,\n    paddingVertical: 6,\n    borderRadius: 16,\n    borderWidth: 1,\n    borderColor: "rgba(255,255,255,0.08)",\n    backgroundColor: "rgba(255,255,255,0.04)"\n  },\n  filterChipActive: {\n    backgroundColor: "#0A0B0D",\n    borderColor: "rgba(255,255,255,0.2)"\n  },\n  filterChipText: { fontSize: 12, fontFamily: "Archivo_600SemiBold", color: "#6B747F" },\n  filterChipTextActive: { color: "#FFFFFF" },');
}

fs.writeFileSync(file, content);
console.log('Patched bookings.tsx');
