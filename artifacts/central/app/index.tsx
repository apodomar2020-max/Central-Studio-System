import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useAppContext } from "@/contexts/AppContext";

export default function IndexScreen() {
  const { isLoading, user } = useAppContext();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      // Unauthenticated → design Welcome landing (offers Sign Up + Sign In).
      router.replace("/onboarding/welcome");
    } else if (!user.emailVerified) {
      router.replace("/verify-email" as never);
    } else if (!user.profileCompleted) {
      router.replace("/auth/complete-profile" as never);
    } else {
      router.replace("/(tabs)" as never);
    }
  }, [isLoading, user]);

  return <View style={{ flex: 1, backgroundColor: "#060C10" }} />;
}
