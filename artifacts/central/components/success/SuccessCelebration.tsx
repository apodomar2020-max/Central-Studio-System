import * as Haptics from "expo-haptics";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const COLORS = ["#00B6D7", "#FF2E7E", "#FFB02E", "#B6E80A"] as const;

type ConfettiPiece = {
  left: `${number}%`;
  color: string;
  size: number;
  delay: number;
  duration: number;
  progress: Animated.Value;
};

/**
 * The shared success celebration used by submission-result screens.
 * It deliberately contains no video/background media: only the original
 * 24 falling pieces requested by design.
 */
export function SuccessConfetti(): React.ReactElement {
  const pieces = useRef<ConfettiPiece[]>(
    Array.from({ length: 24 }, (_, index) => ({
      left: `${(index * 4.2 + (index % 3) * 7) % 96}%` as `${number}%`,
      color: COLORS[index % COLORS.length],
      size: 6 + (index % 3) * 4,
      delay: (index % 7) * 110,
      duration: 1500 + (index % 5) * 280,
      progress: new Animated.Value(0),
    })),
  ).current;

  useEffect(() => {
    const loops = pieces.map((piece) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(piece.delay),
          Animated.timing(piece.progress, {
            toValue: 1,
            duration: piece.duration,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(piece.progress, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [pieces]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      {pieces.map((piece, index) => (
        <Animated.View
          key={index}
          style={{
            position: "absolute",
            top: "-6%",
            left: piece.left,
            width: piece.size,
            height: piece.size * 0.6,
            backgroundColor: piece.color,
            borderRadius: 1,
            opacity: piece.progress.interpolate({
              inputRange: [0, 0.08, 1],
              outputRange: [0, 1, 0],
            }),
            transform: [
              {
                translateY: piece.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 860],
                }),
              },
              {
                rotate: piece.progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "400deg"],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}

/** Runs the shared one-shot success haptic and returns the success-icon pop. */
export function useSuccessPopHaptic(): Animated.Value {
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const animation = Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [pop]);

  return pop;
}
