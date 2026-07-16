/**
 * CentralAlertDialog
 *
 * The single branded renderer behind every application-owned alert/decision
 * dialog in Central Studio. It replaces native `Alert.alert()` presentation
 * app-wide (see providers/CentralAlertProvider.tsx, which is the only
 * intended mounting point).
 *
 * Visual design follows CENTRAL_STUDIO_DESIGN_SYSTEM.md §9.6 and reuses the
 * layout/animation/token choices validated in the original
 * components/ui/CentralDecisionDialog.tsx (centered card, ink surface, cyan
 * border, backdrop fade + card fade/scale). That component remains in the
 * tree unused/untouched; this file is the generalized version that adds:
 *   - tone accent (info/success/warning/error/destructive) — presentation
 *     only, never changes which action fires which callback
 *   - a default single "OK" action (native Alert.alert(title, message)
 *     parity) — provided upstream by centralAlertLogic.normalizeAlertOptions
 *   - per-action pending/loading state driven by the provider's queue
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import colors from "@/constants/colors";
import type { CentralAlertTone, NormalizedCentralAlert } from "@/providers/centralAlertLogic";

export type CentralAlertDialogProps = {
  /** The alert currently at the front of the queue, or null when nothing is showing. */
  alert: NormalizedCentralAlert | null;
  /** Index of the action currently awaiting its async onPress, if any. */
  pendingIndex: number | null;
  onActionPress: (index: number) => void;
  onRequestClose: () => void;
};

const DURATION_BASE = 220; // Design System §7.1 "base"
const DURATION_FAST = 140; // Design System §7.1 "fast"

const TONE_ACCENT: Record<CentralAlertTone, string> = {
  info: colors.cyan,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
  destructive: colors.error,
};

export default function CentralAlertDialog({
  alert,
  pendingIndex,
  onActionPress,
  onRequestClose,
}: CentralAlertDialogProps) {
  const visible = alert != null;
  const [mounted, setMounted] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    let isCurrent = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => {
        if (isCurrent) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const duration = reduceMotion ? 0 : DURATION_BASE;
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(cardScale, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      const duration = reduceMotion ? 0 : DURATION_FAST;
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 0, duration, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(cardScale, { toValue: 0.96, duration, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  // Android hardware Back: swallow the event whenever the dialog is on
  // screen (matches a non-cancelable native Alert — Back neither dismisses
  // nor falls through to screen navigation). onRequestClose itself decides
  // whether that also triggers the alert's safe/cancel action.
  useEffect(() => {
    if (!mounted) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, onRequestClose]);

  if (!mounted || !alert) return null;

  const accent = TONE_ACCENT[alert.tone];

  function handleBackdropPress() {
    if (pendingIndex != null) return;
    onRequestClose();
  }

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onRequestClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFillObject, styles.backdropLayer, { opacity: backdropOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={handleBackdropPress}
            accessibilityRole={alert.dismissible ? "button" : undefined}
            accessibilityLabel={alert.dismissible ? "Dismiss dialog" : undefined}
          />
        </Animated.View>

        <Animated.View
          style={[styles.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <View style={[styles.accent, { backgroundColor: accent }]} />

          <Text style={styles.title} accessibilityRole="header">
            {alert.title}
          </Text>

          {alert.message ? <Text style={styles.message}>{alert.message}</Text> : null}

          <View style={styles.actions}>
            {alert.actions.map((action, index) => {
              const isBusy = pendingIndex === index;
              const isDisabled = action.disabled || (pendingIndex != null && pendingIndex !== index);
              return (
                <AlertActionButton
                  key={`${action.label}-${index}`}
                  label={action.label}
                  tone={action.tone}
                  busy={isBusy}
                  disabled={isDisabled}
                  onPress={() => onActionPress(index)}
                />
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AlertActionButton({
  label,
  tone,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  tone: "primary" | "neutral" | "danger";
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const toneStyle = ACTION_TONE_STYLES[tone];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.85}
      style={[styles.actionBase, toneStyle.button, (disabled || busy) && styles.actionDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={toneStyle.label.color} />
      ) : (
        <Text style={[styles.actionLabel, toneStyle.label]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const ACTION_TONE_STYLES = {
  danger: {
    button: { backgroundColor: "rgba(255,59,71,0.10)", borderWidth: 1, borderColor: "rgba(255,59,71,0.40)" },
    label: { color: colors.error },
  },
  primary: {
    button: { backgroundColor: colors.cyan },
    label: { color: "#0A0B0D" },
  },
  neutral: {
    button: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
    label: { color: "#FFFFFF" },
  },
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  backdropLayer: { backgroundColor: "rgba(6,7,8,0.72)" },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: colors.studio.card,
    borderWidth: 1,
    borderColor: "rgba(0,182,215,0.24)",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 4,
  },
  accent: { width: 36, height: 4, borderRadius: 999, marginBottom: 12 },
  title: { fontFamily: "Archivo_800ExtraBold", fontSize: 20, color: "#FFFFFF", marginBottom: 8 },
  message: { fontFamily: "Archivo_400Regular", fontSize: 14, lineHeight: 20, color: colors.ink[300], marginBottom: 20 },
  actions: { gap: 10 },
  actionBase: { width: "100%", minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionDisabled: { opacity: 0.5 },
  actionLabel: { fontFamily: "Archivo_800ExtraBold", fontSize: 14.5 },
});
