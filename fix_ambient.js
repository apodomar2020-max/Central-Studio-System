const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'artifacts/central/app/(tabs)/profile.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add SVG imports
if (!content.includes("from 'react-native-svg'")) {
  content = content.replace(
    /import QRCode from "react-native-qrcode-svg";/,
    `import QRCode from "react-native-qrcode-svg";\nimport Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";`
  );
}

// 2. Replace ambient LinearGradient with Svg RadialGradient
const ambientGlowRegex = /<LinearGradient colors=\{\['rgba\(0,182,215,0\.12\)', 'rgba\(0,182,215,0\)'\]\} style=\{StyleSheet\.absoluteFillObject\} start=\{\{x: 0\.5, y: 0\}\} end=\{\{x: 0\.5, y: 0\.4\}\} pointerEvents="none" \/>/;
content = content.replace(
  ambientGlowRegex,
  `<View style={[StyleSheet.absoluteFillObject, { pointerEvents: 'none' }]}>
            <Svg height="100%" width="100%">
              <Defs>
                <RadialGradient
                  id="heroGlow"
                  cx="50%"
                  cy="-10%"
                  rx="120%"
                  ry="90%"
                  fx="50%"
                  fy="-10%"
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0%" stopColor="rgba(0, 182, 215, 0.16)" />
                  <Stop offset="60%" stopColor="transparent" />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)" />
            </Svg>
          </View>`
);

// 3. Remove inner explicit avatar LinearGradient because the ambient glow covers it now
const innerAvatarGlowRegex = /<LinearGradient colors=\{\['rgba\(0,182,215,0\.3\)', 'rgba\(0,182,215,0\)'\]\} style=\{styles\.avatarGlow\} \/>\n\s*/;
content = content.replace(innerAvatarGlowRegex, '');

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Fixed ambient light successfully!');
