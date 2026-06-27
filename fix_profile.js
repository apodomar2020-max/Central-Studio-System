const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'artifacts/central/app/(tabs)/profile.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Avatar Glow and Parent Pill
const avatarSearch = /<View style=\{styles\.avatarWrap\}>/g;
content = content.replace(avatarSearch, `<View style={styles.avatarGlowWrap}>\n            <LinearGradient colors={['rgba(0,182,215,0.4)', 'rgba(0,182,215,0)']} style={styles.avatarGlow} />\n          <View style={styles.avatarWrap}>`);

// Wait, I need to close the `avatarGlowWrap`. Let's just do a clean replace.
content = content.replace(
  /<View style=\{styles\.avatarWrap\}>([\s\S]*?)<\/View>\n          <\/View>\n          <Text style=\{styles\.fullName\}>\{user\.fullName\}<\/Text>/,
  `<View style={styles.avatarGlowWrap}>
            <LinearGradient colors={['rgba(0,182,215,0.3)', 'rgba(0,182,215,0)']} style={styles.avatarGlow} />
            <View style={styles.avatarWrap}>$1</View>
          </View>
          </View>
          <Text style={styles.fullName}>{user.fullName}</Text>`
);

// Account pill
content = content.replace(
  /<View style=\{styles\.accountTypePill\}>\n\s*<Text style=\{styles\.accountTypePillText\}>\n\s*\{user\.accountType === "parent" \? "PARENT" : "STUDENT"\} • \{user\.authProvider \? user\.authProvider \+ " account" : "Local account"\}\n\s*<\/Text>\n\s*<\/View>/,
  `<View style={styles.accountTypePill}>
            <Text style={[styles.accountTypePillText, { color: colors.studio.primary }]}>
              {user.accountType === "parent" ? "PARENT" : "STUDENT"}
            </Text>
            <Text style={[styles.accountTypePillText, { color: "#9CA3AF" }]}>
              {" • "}{user.authProvider ? user.authProvider + " account" : "Local account"}
            </Text>
          </View>`
);

// 2. Stats Icons
content = content.replace(
  /<View style=\{styles\.statsRow\}>([\s\S]*?)<Text style=\{styles\.sectionEyebrow\}>MY STUDIO PASS<\/Text>/,
  `<View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <Ionicons name="infinite" size={24} color={colors.studio.primary} />
            </View>
            <Text style={styles.statValue}>{totalCredits}</Text>
            <Text style={styles.statLabel}>Credits</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <Ionicons name="document-text" size={24} color="#FFB02E" />
            </View>
            <Text style={styles.statValue}>{upcoming}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <Ionicons name="checkmark-circle" size={24} color="#1FB871" />
            </View>
            <Text style={styles.statValue}>{attendedCount}</Text>
            <Text style={styles.statLabel}>Attended</Text>
          </View>
        </View>

        <Text style={styles.sectionEyebrow}>MY STUDIO PASS</Text>`
);

// 3. QR Code & Full Screen Button
content = content.replace(
  /<View style=\{styles\.qrPreviewBox\}>\n               <Ionicons name="qr-code-outline" size=\{60\} color="#0A0B0D" \/>\n            <\/View>/,
  `<View style={styles.qrPreviewBox}>
              <QRCode value={user.id || "central-studio-pass"} size={72} color="#000000" backgroundColor="transparent" />
            </View>`
);
content = content.replace(
  /<View style=\{styles\.qrExpandBtn\}>\n              <Ionicons name="expand-outline" size=\{14\} color="#0A0B0D" \/>/,
  `<View style={styles.qrExpandBtn}>
              <Ionicons name="scan-outline" size={14} color="#0A0B0D" />`
);

// 4. Edit Profile icon
// Wait, I see "create-outline" for Edit Profile in my code. It's probably fine, but I can change it to "pencil".
content = content.replace(
  /<Ionicons name="create-outline" size=\{20\} color=\{colors\.studio\.primary\} \/>/,
  `<Ionicons name="pencil-outline" size={20} color={colors.studio.primary} />`
);

// 5. Children Girl Color
// The ChildCard is defined in profile.tsx. I need to replace the color there.
content = content.replace(
  /const genderColor = child\.gender === "female" \? "#EC4899" : "#3B82F6";/g,
  `const genderColor = child.gender === "female" ? "#FF2E7E" : "#00B6D7";`
);
content = content.replace(
  /color=\{child\.gender === "female" \? "#EC4899" : "#3B82F6"\}/g,
  `color={genderColor}`
);
// Make sure genderColor is used in ChildCard for the person icon and tags.
content = content.replace(
  /<Ionicons name=\{child\.gender === "female" \? "person" : "person"\} size=\{20\} color="#00B6D7" \/>/,
  `<Ionicons name={child.gender === "female" ? "person" : "person"} size={20} color={genderColor} />`
);
content = content.replace(
  /<Text style=\{\[styles\.childGenderTag, \{ color: "#00B6D7" \}\]\}>\{genderLabel\}<\/Text>/,
  `<Text style={[styles.childGenderTag, { color: genderColor }]}>{genderLabel}</Text>`
);
content = content.replace(
  /childAvatarWrap: \{ position: "relative", width: 44, height: 44, borderRadius: 22, borderWidth: 1\.5, borderColor: "#00B6D7"/,
  `childAvatarWrap: { position: "relative", width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: genderColor` // Can't do this easily in stylesheet unless it's dynamic.
);

// So let's dynamically apply border color to childAvatarWrap:
content = content.replace(
  /<View style=\{styles\.childAvatarWrap\}>/,
  `<View style={[styles.childAvatarWrap, { borderColor: genderColor }]}>`
);
content = content.replace(
  /<View style=\{styles\.childAvatar\}>/,
  `<View style={[styles.childAvatar, { backgroundColor: genderColor + "15" }]}>`
);
content = content.replace(
  /<View style=\{styles\.childAvatarBadge\}>/,
  `<View style={[styles.childAvatarBadge, { borderColor: genderColor }]}>`
);

// Let's fix the accountTypePill textTransform issue:
content = content.replace(
  /accountTypePillText: \{ fontSize: 11, fontFamily: "Archivo_700Bold", color: "#D1D5DB", letterSpacing: 0\.5, textTransform: "uppercase" \},/,
  `accountTypePillText: { fontSize: 11, fontFamily: "Archivo_700Bold", letterSpacing: 0.5 },`
);
// And we need flexDirection: 'row' on the pill!
content = content.replace(
  /accountTypePill: \{ marginTop: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba\(255,255,255,0\.15\)", backgroundColor: "rgba\(255,255,255,0\.03\)" \},/,
  `accountTypePill: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.03)", flexDirection: 'row', alignItems: 'center' },`
);

// Style fixes:
// Remove background color from statIconWrap
content = content.replace(
  /statIconWrap: \{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 12 \},/,
  `statIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 8, backgroundColor: "rgba(255,255,255,0.03)" },`
);
content = content.replace(
  /avatarWrap: \{ position: "relative", width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginBottom: 6, borderWidth: 2, borderColor: "#00B6D7", shadowColor: "#00B6D7", shadowOffset: \{ width: 0, height: 0 \}, shadowOpacity: 0\.5, shadowRadius: 10, elevation: 10 \},/,
  `avatarWrap: { position: "relative", width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginBottom: 6, borderWidth: 2, borderColor: "#00B6D7" },
  avatarGlowWrap: { position: "relative", alignItems: "center", justifyContent: "center", marginBottom: 8, marginTop: 12 },
  avatarGlow: { position: "absolute", width: 140, height: 140, borderRadius: 70 },`
);
content = content.replace(
  /profileCard: \{ alignItems: "center", paddingTop: 12, paddingBottom: 24, gap: 4 \},/,
  `profileCard: { alignItems: "center", paddingTop: 4, paddingBottom: 24, gap: 4 },`
);


// We need to also clean up the QR Box padding
content = content.replace(
  /qrCardLeft: \{ width: "35%", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 12 \},/,
  `qrCardLeft: { width: "35%", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 8 },`
);
content = content.replace(
  /qrPreviewBox: \{ width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 2, borderColor: "#0A0B0D" \},/,
  `qrPreviewBox: { width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 2, borderColor: "#0A0B0D", backgroundColor: "#FFFFFF" },`
);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Fixed profile design details successfully!');
