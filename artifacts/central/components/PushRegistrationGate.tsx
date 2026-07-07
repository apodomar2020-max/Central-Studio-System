import { useEffect } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { isExpoGo, registerPushNotificationsForCurrentUser } from "@/services/pushNotifications";

export default function PushRegistrationGate() {
  const { user } = useAppContext();

  useEffect(() => {
    console.log("[PUSH_DIAG] gate mounted");
    return () => {
      console.log("[PUSH_DIAG] gate unmounted");
    };
  }, []);

  useEffect(() => {
    const expoGo = isExpoGo();
    console.log("[PUSH_DIAG] gate evaluated", {
      userExists: Boolean(user?.id),
      userId: user?.id ?? null,
      emailVerified: Boolean(user?.emailVerified),
      isExpoGo: expoGo,
    });
    if (expoGo) {
      console.log("[PUSH_DIAG] gate skipped", { reason: "expo_go" });
      return;
    }
    if (!user?.id) {
      console.log("[PUSH_DIAG] gate skipped", { reason: "no_user" });
      return;
    }
    if (!user.emailVerified) {
      console.log("[PUSH_DIAG] gate skipped", { reason: "email_not_verified", userId: user.id });
      return;
    }
    registerPushNotificationsForCurrentUser().catch(() => {
      console.log("[PUSH_DIAG] gate registration failed", { userId: user.id });
      // Permission denial or Expo-token failures should never block app use.
    });
  }, [user?.emailVerified, user?.id]);

  return null;
}
