const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'artifacts/central/app/(tabs)/profile.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add background ambient light
const profileCardStart = /<View style=\{styles\.profileCard\}>/;
content = content.replace(
  profileCardStart,
  `<View style={styles.profileCard}>\n          <LinearGradient colors={['rgba(0,182,215,0.12)', 'rgba(0,182,215,0)']} style={StyleSheet.absoluteFillObject} start={{x: 0.5, y: 0}} end={{x: 0.5, y: 0.4}} pointerEvents="none" />`
);

// 2. Avatar glow size
content = content.replace(
  /avatarGlow: \{ position: "absolute", width: 140, height: 140, borderRadius: 70 \}/,
  `avatarGlow: { position: "absolute", width: 220, height: 220, borderRadius: 110 }`
);

// 3. Verified badge size and position
content = content.replace(
  /avatarVerifiedBadge: \{ position: "absolute", bottom: -2, right: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: "#00B6D7", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#0A0B0D" \}/,
  `avatarVerifiedBadge: { position: "absolute", bottom: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: "#00B6D7", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#0A0B0D" }`
);
content = content.replace(
  /<Ionicons name="checkmark" size=\{14\} color="#0A0B0D" \/>/,
  `<Ionicons name="checkmark" size={12} color="#0A0B0D" />`
);

// 4. Studio Pass card height and QR size
content = content.replace(
  /qrCard: \{ flexDirection: "row", backgroundColor: "#0C1F2B", borderRadius: 16, overflow: "hidden", marginBottom: 32, borderWidth: 1, borderColor: "rgba\(0,182,215,0\.2\)" \}/,
  `qrCard: { flexDirection: "row", backgroundColor: "#0C1F2B", borderRadius: 16, overflow: "hidden", marginBottom: 32, borderWidth: 1, borderColor: "rgba(0,182,215,0.2)", minHeight: 140 }`
);
content = content.replace(
  /qrCardLeft: \{ width: "35%", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 8 \}/,
  `qrCardLeft: { width: "38%", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 12 }`
);
// Make the QR preview box take up more space and scale the QR code
content = content.replace(
  /qrPreviewBox: \{ width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 2, borderColor: "#0A0B0D", backgroundColor: "#FFFFFF" \}/,
  `qrPreviewBox: { width: "100%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8, borderWidth: 2.5, borderColor: "#0A0B0D", backgroundColor: "#FFFFFF" }`
);
content = content.replace(
  /<QRCode value=\{user\.id \|\| "central-studio-pass"\} size=\{72\} color="#000000" backgroundColor="transparent" \/>/,
  `<View style={{ transform: [{ scale: 1.15 }] }}><QRCode value={user.id || "central-studio-pass"} size={80} color="#000000" backgroundColor="transparent" /></View>`
);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Fixed hero visual details successfully!');
