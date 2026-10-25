import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import LottieView from "lottie-react-native";

const animation = require("@/assets/animations/c9sB0AweiO.json");

/** Decorative only: the adjacent copy remains the accessible empty-state message. */
export default function PackageEmptyAnimation() {
  const player = useRef<LottieView>(null);
  const completed = useRef(false);
  const started = useRef(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    let mounted = true;
    let receivedEvent = false;
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", enabled => {
      receivedEvent = true;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted && !receivedEvent) setReduceMotion(enabled);
    }).catch(() => { if (mounted) setReduceMotion(true); });
    const app = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  useEffect(() => {
    if (failed || !focused || !active || reduceMotion !== false || completed.current) {
      player.current?.pause();
      return;
    }
    if (started.current) player.current?.resume();
    else { started.current = true; player.current?.play(); }
    return () => player.current?.pause();
  }, [active, focused, reduceMotion, failed]);

  return <View style={styles.frame} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {!failed && <LottieView ref={player} source={animation} autoPlay={false} loop={false}
      resizeMode="contain" style={StyleSheet.absoluteFill}
      progress={reduceMotion !== false ? 0.5 : undefined}
      onAnimationFinish={cancelled => { if (!cancelled) completed.current = true; }}
      onAnimationFailure={() => setFailed(true)} />}
  </View>;
}
const styles = StyleSheet.create({ frame: { width: "100%", height: 170, maxWidth: 250, alignSelf: "center" } });
