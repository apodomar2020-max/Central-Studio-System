import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAppContext } from "@/contexts/AppContext";

export default function IndexScreen() {
  const { isOnboarded, isLoading, user } = useAppContext();

  useEffect(() => {
    if (isLoading) return;
    if (!isOnboarded) {
      router.replace("/onboarding/language");
    } else if (!user) {
      // Require login before accessing the app
      router.replace("/auth/login");
    } else {
      router.replace("/(tabs)/" as never);
    }
  }, [isLoading, isOnboarded, user]);

  return <View style={{ flex: 1, backgroundColor: "#060C10" }} />;
}
