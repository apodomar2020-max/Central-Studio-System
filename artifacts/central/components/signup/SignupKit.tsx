/**
 * Signup design kit — exact React Native replicas of the shared primitives in
 * the Claude Design `signup-screens.jsx` (Icon, StageVideo, PrimaryCTA,
 * GhostBtn, BackBtn, Eyebrow, Divider, FloatInput, Google/Facebook/Apple logos).
 *
 * SVG glyph paths are copied verbatim from the design. Tokens mirror the
 * design's CSS variables. ProgressDots is the existing shared component.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { iosCapGuard, iosDisplayTextStyle, iosTextInputStyle } from "@/utils/iosTypography";

// ── Tokens (from the design's color/typography CSS variables) ────────────────
export const CS = {
  ink900: "#0A0B0D",
  cyan500: "#00B6D7",
  cyan400: "#2DCDEC",
  danger: "#FF3B47",
  amber: "#FFB02E",
  success: "#1FB871",
  base: "#07080a",
  white: "#FFFFFF",
};

// ── Icon (exact SVG paths from signup-screens.jsx) ───────────────────────────
export type SignupIconName =
  | "back" | "eye" | "eyeOff" | "check" | "arrow" | "mail" | "phone" | "lock" | "user" | "x";

export function Icon({
  name,
  size = 20,
  stroke = 2,
  color = "#FFFFFF",
}: {
  name: SignupIconName;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const sp = { stroke: color, strokeWidth: stroke, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "back" && <Path d="M15 18l-6-6 6-6" {...sp} />}
      {name === "eye" && (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" {...sp} />
          <Circle cx={12} cy={12} r={3} {...sp} />
        </>
      )}
      {name === "eyeOff" && (
        <>
          <Path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.3 3.3M6.6 6.6A18 18 0 0 0 2 12s3.5 8 10 8a10 10 0 0 0 4-.8" {...sp} />
          <Path d="M3 3l18 18" {...sp} />
        </>
      )}
      {name === "check" && <Path d="M20 6L9 17l-5-5" {...sp} />}
      {name === "arrow" && <Path d="M5 12h14M13 6l6 6-6 6" {...sp} />}
      {name === "mail" && (
        <>
          <Rect x={2.5} y={4.5} width={19} height={15} rx={2.5} {...sp} />
          <Path d="M3 6.5l9 6 9-6" {...sp} />
        </>
      )}
      {name === "phone" && (
        <Path d="M6.6 10.8a14 14 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 11 11 0 0 0 3.4.6A1.2 1.2 0 0 1 21 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 3.6 4.2 1.2 1.2 0 0 1 4.8 3H8a1.2 1.2 0 0 1 1.2 1.2 11 11 0 0 0 .6 3.4 1.2 1.2 0 0 1-.3 1.2Z" {...sp} />
      )}
      {name === "lock" && (
        <>
          <Rect x={3} y={11} width={18} height={11} rx={2} {...sp} />
          <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...sp} />
        </>
      )}
      {name === "user" && (
        <>
          <Circle cx={12} cy={8} r={4} {...sp} />
          <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" {...sp} />
        </>
      )}
      {name === "x" && <Path d="M18 6 6 18M6 6l12 12" {...sp} />}
    </Svg>
  );
}

// ── Brand logos (exact SVG from the design) ──────────────────────────────────
export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}
export function FacebookLogo({ size = 18, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </Svg>
  );
}
export function AppleLogo({ size = 20, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </Svg>
  );
}

// ── StageVideo (looping bg video + exact design gradient overlay) ────────────
export function StageVideo() {
  const player = useVideoPlayer(require("@/assets/EntroVideo.mp4"), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: CS.base }]} />
      <VideoView player={player} style={[StyleSheet.absoluteFill, { opacity: 0.39 }]} contentFit="cover" nativeControls={false} />
      <LinearGradient
        colors={["rgba(7,8,10,0.36)", "rgba(7,8,10,0)", "rgba(7,8,10,0.18)", "rgba(7,8,10,0.97)"]}
        locations={[0, 0.28, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

// ── PrimaryCTA (solid cyan, glow, press-scale, loading, arrow icon) ──────────
export const PrimaryCTA = React.memo(function PrimaryCTA({
  label,
  onPress,
  disabled,
  loading,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: SignupIconName;
  style?: ViewStyle;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.timing(scale, { toValue: v, duration: 120, useNativeDriver: true }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={disabled || loading ? undefined : onPress}
        onPressIn={() => to(0.975)}
        onPressOut={() => to(1)}
        style={[kit.cta, disabled && { backgroundColor: "rgba(0,182,215,0.35)", shadowOpacity: 0 }, style]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={CS.ink900} />
        ) : (
          <>
            <Text style={kit.ctaText}>{label}</Text>
            {icon && <Icon name={icon} size={18} stroke={2.6} color={CS.ink900} />}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
});

// ── GhostBtn (social / secondary) ────────────────────────────────────────────
export const GhostBtn = React.memo(function GhostBtn({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.timing(scale, { toValue: v, duration: 120, useNativeDriver: true }).start();
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        disabled={disabled}
        onPress={disabled ? undefined : onPress}
        onPressIn={() => { if (!disabled) to(0.975); }}
        onPressOut={() => { if (!disabled) to(1); }}
        style={kit.ghost}
      >
        {icon}
        <Text style={kit.ghostText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
});

// ── BackBtn (42px circle). NOTE: design has a stray red icon override; see report. ──
export const BackBtn = React.memo(function BackBtn({ onPress }: { onPress?: () => void }) {
  const lastPress = useRef(0);
  const handlePress = () => {
    const now = Date.now();
    if (now - lastPress.current < 1000) {
      return;
    }
    lastPress.current = now;
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      android_ripple={{ color: "rgba(255,255,255,0.1)", borderless: true }}
      style={({ pressed }) => [
        kit.back,
        { zIndex: 50, elevation: 10 },
        pressed && { opacity: 0.72 },
      ]}
    >
      <Icon name="back" size={22} stroke={2.4} color="#B6BDC6" />
    </Pressable>
  );
});


// ── ScreenTitle ──────────────────────────────────────────────────────────────
export const ScreenTitle = React.memo(function ScreenTitle({ text }: { text: string }) {
  return (
    <Text style={kit.screenTitle}>
      {text}
    </Text>
  );
});

// ── Eyebrow ──────────────────────────────────────────────────────────────────
export function Eyebrow({ children, color = CS.cyan400, style }: { children: React.ReactNode; color?: string; style?: TextStyle }) {
  return <Text style={[kit.eyebrow, { color }, style]}>{children}</Text>;
}

// ── Divider with centered label ──────────────────────────────────────────────
export function Divider({ label = "or" }: { label?: string }) {
  return (
    <View style={kit.dividerRow}>
      <View style={kit.dividerLine} />
      <Text style={kit.dividerText}>{label}</Text>
      <View style={kit.dividerLine} />
    </View>
  );
}

// ── FloatInput (floating label, left icon, focus/error states, rightEl) ──────
export const FloatInput = React.memo(function FloatInput({
  label,
  value,
  defaultValue,
  onChangeText,
  icon,
  error,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  rightEl,
}: {
  label: string;
  /** Controlled value. Omit for UNCONTROLLED mode (native owns the text — no
   *  per-keystroke JS↔native round-trip, the RN-recommended pattern for fast typing). */
  value?: string;
  /** Initial text for uncontrolled mode. */
  defaultValue?: string;
  onChangeText?: (v: string) => void;
  icon?: SignupIconName;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  rightEl?: React.ReactNode;
}) {
  const controlled = value !== undefined;
  const [focus, setFocus] = useState(false);
  // Uncontrolled: track only empty↔non-empty so the floating label can raise.
  // This flips at most once per fill — NOT on every keystroke — so typing in
  // uncontrolled mode triggers zero React re-renders of this input.
  const [hasTextU, setHasTextU] = useState(!!defaultValue);
  const hasText = controlled ? !!value : hasTextU;
  const raised = focus || hasText;
  const borderColor = error ? CS.danger : focus ? CS.cyan500 : "rgba(255,255,255,0.12)";
  const bg = focus ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.04)";
  const iconColor = focus ? CS.cyan500 : "rgba(255,255,255,0.3)";
  const labelColor = error ? CS.danger : focus ? CS.cyan500 : "rgba(255,255,255,0.38)";
  return (
    <View>
      <View style={[kit.fiWrap, { borderColor, backgroundColor: bg }, focus && !error ? kit.fiFocusRing : null]}>
        {icon && (
          <View style={kit.fiIcon}>
            <Icon name={icon} size={17} stroke={2} color={iconColor} />
          </View>
        )}
        <Text
          style={[
            kit.fiLabel,
            { left: icon ? 44 : 14, color: labelColor },
            raised ? kit.fiLabelRaised : kit.fiLabelRest,
          ]}
        >
          {label}
        </Text>
        <TextInput
          {...(controlled ? { value } : { defaultValue })}
          onChangeText={(v) => {
            if (!controlled) {
              const ne = v.length > 0;
              setHasTextU((prev) => (prev === ne ? prev : ne));
            }
            onChangeText?.(v);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          style={[kit.fiInput, { paddingLeft: icon ? 44 : 14, paddingRight: rightEl ? 44 : 14 }]}
        />
        {rightEl && <View style={kit.fiRight}>{rightEl}</View>}
      </View>
      {error ? <Text style={kit.fiError}>{error}</Text> : null}
    </View>
  );
});

const kit = StyleSheet.create({
  cta: {
    width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 15, paddingHorizontal: 22, borderRadius: 12, backgroundColor: CS.cyan500,
    // iOS-only cyan glow (design box-shadow). No Android `elevation` — it renders a
    // gray box that reads as a stray shadow above the button.
    shadowColor: CS.cyan500, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { fontFamily: "Archivo_800ExtraBold", fontSize: 16, color: CS.ink900 },
  ghost: {
    width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 14, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.14)",
  },
  ghostText: { fontFamily: "Archivo_700Bold", fontSize: 15, color: "#FFFFFF" },
  back: {
    width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)",
    zIndex: 50, elevation: 10,
  },
  screenTitle: { fontFamily: "Anton_400Regular", fontSize: 85, lineHeight: 78, includeFontPadding: false, paddingTop: 6, textTransform: "uppercase", color: CS.cyan500, marginBottom: 6 - iosCapGuard(85, 78), ...iosDisplayTextStyle(85, 78) },
  eyebrow: { fontFamily: "Archivo_800ExtraBold", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 6 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  dividerText: { fontFamily: "Archivo_600SemiBold", fontSize: 12, color: "rgba(255,255,255,0.32)", letterSpacing: 0.7, textTransform: "uppercase" },
  fiWrap: { position: "relative", borderRadius: 12, borderWidth: 1.5, justifyContent: "center" },
  fiFocusRing: { shadowColor: CS.cyan500, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  fiIcon: { position: "absolute", left: 14, zIndex: 1 },
  fiLabel: { position: "absolute", fontFamily: "Archivo_700Bold" },
  fiLabelRest: { fontSize: 15, fontFamily: "Archivo_400Regular" },
  fiLabelRaised: { top: 8, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  fiInput: { paddingTop: 22, paddingBottom: 10, fontSize: 15, fontFamily: "Archivo_400Regular", color: "#FFFFFF", ...iosTextInputStyle(15, 18) },
  fiRight: { position: "absolute", right: 12 },
  fiError: { marginTop: 4, marginLeft: 4, fontSize: 12, color: CS.danger, fontFamily: "Archivo_600SemiBold" },
});
