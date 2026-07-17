import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";

export function useAndroidHardwareBackGuard(enabled: boolean) {
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !enabled) return undefined;

      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        return enabledRef.current;
      });

      return () => {
        subscription.remove();
      };
    }, [enabled]),
  );
}
