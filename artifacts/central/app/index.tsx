import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAppContext } from "@/contexts/AppContext";

export default function IndexScreen() {
  const { isOnboarded, isLoading } = useAppContext();

  useEffect(() => {
    if (isLoading) return;
    if (!isOnboarded) {
      router.replace("/onboarding/language");
    } else {
      router.replace("/(tabs)/");
    }
  }, [isLoading, isOnboarded]);

  return <View style={{ flex: 1, backgroundColor: "#060C10" }} />;
}
